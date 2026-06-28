import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getDatabase, ref, push, onValue }
  from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js';

// ── FIREBASE CONFIG ──────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyConXdhSHPmoHl-tnEVMRD6eXp2ilnRb1w',
  authDomain:        'floodgate-d63ae.firebaseapp.com',
  databaseURL:       'https://floodgate-d63ae-default-rtdb.firebaseio.com',
  projectId:         'floodgate-d63ae',
  storageBucket:     'floodgate-d63ae.firebasestorage.app',
  messagingSenderId: '753742117307',
  appId:             '1:753742117307:web:5e20b9119e22728197ac9e'
};

// ── FIREBASE INIT ────────────────────────────────────────
let dbRef = null;
try {
  const fbApp = initializeApp(FIREBASE_CONFIG);
  dbRef = ref(getDatabase(fbApp), 'points');
} catch (err) {
  console.error('[Floodgate] Firebase error:', err);
}

// ── STATE ────────────────────────────────────────────────
let map          = null;
let userMarker   = null;
let accuracyRing = null;
let currentPos   = null;
let gpsStarted   = false;
let gpsReady     = false;
let points       = [];
let markers      = {};
let lastCoords   = null;

// ── DOM ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const modal        = $('modal');
const gpsRow       = $('gps-row');
const gpsDot       = $('gps-dot');
const gpsLabel     = $('gps-label');
const enableWrap   = $('enable-wrap');
const btnTurnOn    = $('btn-turn-on');
const btnFixModal  = $('btn-fix-modal');
const modalError   = $('modal-error');
const topBadge     = $('top-badge');
const badgeCount   = $('badge-count');
const btnOpenList  = $('btn-open-list');
const bottomPanel  = $('bottom-panel');
const statusDot    = $('status-dot');
const statusLabel  = $('status-label');
const btnFix       = $('btn-fix');
const fixResult    = $('fix-result');
const resultCoords = $('result-coords');
const resultAcc    = $('result-accuracy');
const resultTime   = $('result-time');
const btnCopy      = $('btn-copy');
const drawer       = $('drawer');
const drawerBody   = $('drawer-body');
const btnClose     = $('btn-close-drawer');

// ── MAP ──────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([30, 15], 2);
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20
    }
  ).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
}

// ── USER MARKER ──────────────────────────────────────────
const USER_ICON = L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;background:#2563eb;border:3px solid white;
    border-radius:50%;box-shadow:0 0 0 3px rgba(37,99,235,.35);
    animation:pulse-ring 2s ease-out infinite;"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9]
});

function updateUserMarker(lat, lng, accuracy) {
  const ll = [lat, lng];
  if (!userMarker) {
    userMarker   = L.marker(ll, { icon: USER_ICON, zIndexOffset: 1000 }).addTo(map);
    accuracyRing = L.circle(ll, { radius: accuracy, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .08, weight: 1 }).addTo(map);
  } else {
    userMarker.setLatLng(ll);
    accuracyRing.setLatLng(ll);
    accuracyRing.setRadius(accuracy);
  }
}

// ── PIN MARKER ───────────────────────────────────────────
function makePinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;background:#ef4444;border:2.5px solid white;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 14]
  });
}

function addMarkerForPoint(p) {
  if (markers[p.id] || !map) return;
  markers[p.id] = L.marker([p.lat, p.lng], { icon: makePinIcon() })
    .addTo(map)
    .bindPopup(`
      <div style="min-width:190px">
        <b style="font-size:14px">📍 Fixed Point</b><br>
        <code style="font-size:12px;word-break:break-all;color:#0f172a">
          ${p.lat.toFixed(7)},<br>${p.lng.toFixed(7)}
        </code><br>
        <span style="color:#64748b;font-size:11px">
          ±${p.accuracy} m &nbsp;·&nbsp; ${new Date(p.timestamp).toLocaleString()}
        </span>
      </div>
    `);
}

// ── LOAD POINTS ──────────────────────────────────────────
function loadPoints() {
  if (dbRef) {
    onValue(dbRef, snap => {
      const data = snap.val();
      points = [];
      Object.keys(markers).forEach(id => {
        if (!data || !data[id]) { map.removeLayer(markers[id]); delete markers[id]; }
      });
      if (data) {
        Object.entries(data).forEach(([id, p]) => {
          const point = { ...p, id };
          points.push(point);
          addMarkerForPoint(point);
        });
      }
      badgeCount.textContent = points.length;
    });
  } else {
    try { points = JSON.parse(localStorage.getItem('fg-points') || '[]'); } catch { points = []; }
    points.forEach(addMarkerForPoint);
    badgeCount.textContent = points.length;
  }
}

// ── GPS ──────────────────────────────────────────────────
function startGPS() {
  if (gpsStarted) return;
  gpsStarted = true;

  // Hide the "Turn On Location" button, show the searching status
  enableWrap.classList.add('hidden');
  gpsRow.classList.remove('hidden');
  gpsDot.className    = 'dot dot-amber';
  gpsLabel.textContent = 'Finding your location…';

  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }

  navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    timeout:            20000,
    maximumAge:         5000
  });
}

function onPosition(pos) {
  currentPos = pos;
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;

  // Update the GPS status line
  gpsDot.className     = 'dot dot-green';
  gpsLabel.textContent = `GPS ready · ±${Math.round(accuracy)} m`;

  if (!gpsReady) {
    gpsReady = true;

    // Zoom map to the user's real location
    map.setView([lat, lng], 16);

    // Activate the Fix My Location button
    btnFixModal.disabled = false;
  }

  updateUserMarker(lat, lng, accuracy);

  // Keep bottom panel status fresh when visible
  if (!bottomPanel.classList.contains('hidden')) {
    statusDot.className     = 'dot dot-green';
    statusLabel.textContent = `GPS active · ±${Math.round(accuracy)} m`;
  }
}

function onGeoError(err) {
  const msgs = {
    1: 'Location access was denied. Please allow it in your browser settings and reload.',
    2: 'Location could not be determined. Make sure GPS is enabled and try again.',
    3: 'Location request timed out. Please try again.'
  };
  showError(msgs[err.code] || 'Unknown location error.');
  // Show Turn On button again so user can retry
  enableWrap.classList.remove('hidden');
  gpsRow.classList.add('hidden');
  btnTurnOn.disabled = false;
  btnTurnOn.textContent = 'Try Again';
  gpsStarted = false;
}

function showError(msg) {
  modalError.textContent = msg;
  modalError.classList.remove('hidden');
}

// ── SAVE POINT ───────────────────────────────────────────
function saveLocally(point) {
  const p = { ...point, id: `local-${Date.now()}` };
  points.push(p);
  addMarkerForPoint(p);
  badgeCount.textContent = points.length;
  try {
    const s = JSON.parse(localStorage.getItem('fg-points') || '[]');
    s.push(p);
    localStorage.setItem('fg-points', JSON.stringify(s));
  } catch (e) {}
}

async function savePoint() {
  if (!currentPos) return;
  const { latitude: lat, longitude: lng, accuracy } = currentPos.coords;
  const now   = new Date();
  const point = { lat, lng, accuracy: Math.round(accuracy), timestamp: now.toISOString() };

  // Update bottom panel result
  fixResult.classList.remove('hidden');
  resultCoords.textContent = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;
  resultAcc.textContent    = `±${Math.round(accuracy)} m`;
  resultTime.textContent   = now.toLocaleString();
  lastCoords = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;

  if (dbRef) {
    try { await push(dbRef, point); }
    catch (e) { saveLocally(point); }
  } else {
    saveLocally(point);
  }
}

// ── FIX FROM MODAL ───────────────────────────────────────
async function fixFromModal() {
  if (!currentPos) return;

  btnFixModal.disabled  = true;
  btnFixModal.innerHTML = `
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg> Saving…`;

  await savePoint();

  setTimeout(() => {
    // Close modal
    modal.classList.add('hidden');
    // Show top badge and bottom panel
    topBadge.classList.remove('hidden');
    bottomPanel.classList.remove('hidden');
    statusDot.className     = 'dot dot-green';
    statusLabel.textContent = `GPS active · ±${Math.round(currentPos.coords.accuracy)} m`;
  }, 500);
}

// ── FIX FROM BOTTOM PANEL ────────────────────────────────
async function fixFromPanel() {
  if (!currentPos) return;

  const orig = btnFix.innerHTML;
  btnFix.classList.add('success');
  btnFix.innerHTML = `
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg> Location Fixed!`;

  await savePoint();

  setTimeout(() => {
    btnFix.classList.remove('success');
    btnFix.innerHTML = orig;
  }, 2500);
}

// ── DRAWER ───────────────────────────────────────────────
function openDrawer() {
  drawerBody.innerHTML = '';
  if (points.length === 0) {
    drawerBody.innerHTML = '<div class="drawer-empty">No points yet.<br>Press <strong>Fix My Location</strong> to add yours.</div>';
  } else {
    [...points].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(p => {
      const el = document.createElement('div');
      el.className = 'point-item';
      el.innerHTML = `
        <div class="pi-coords">${p.lat.toFixed(7)},&thinsp;${p.lng.toFixed(7)}</div>
        <div class="pi-meta">±${p.accuracy} m &nbsp;·&nbsp; ${new Date(p.timestamp).toLocaleString()}</div>`;
      el.addEventListener('click', () => {
        drawer.classList.add('hidden');
        map.setView([p.lat, p.lng], 18);
        setTimeout(() => markers[p.id]?.openPopup(), 350);
      });
      drawerBody.appendChild(el);
    });
  }
  drawer.classList.remove('hidden');
}

// ── COPY ─────────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
  if (!lastCoords) return;
  const done = () => {
    btnCopy.textContent = 'Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => { btnCopy.textContent = 'Copy Coordinates'; btnCopy.classList.remove('copied'); }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(lastCoords).then(done).catch(() => { legacyCopy(lastCoords); done(); });
  } else { legacyCopy(lastCoords); done(); }
});
function legacyCopy(t) {
  const el = Object.assign(document.createElement('textarea'), { value: t });
  el.style.cssText = 'position:fixed;top:-9999px';
  document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
}

// ── EVENTS ───────────────────────────────────────────────
btnTurnOn.addEventListener('click', () => {
  if (!navigator.geolocation) { showError('Geolocation not supported by your browser.'); return; }
  btnTurnOn.disabled  = true;
  btnTurnOn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         style="animation:spin .9s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    Finding location…`;
  startGPS();
});

btnFixModal.addEventListener('click', fixFromModal);
btnFix.addEventListener('click',      fixFromPanel);
btnOpenList.addEventListener('click', openDrawer);
btnClose.addEventListener('click',    () => drawer.classList.add('hidden'));
$('map').addEventListener('click',    () => drawer.classList.add('hidden'));

// ── STARTUP ──────────────────────────────────────────────
initMap();
loadPoints();

// Detect whether location is already on — if yes, skip the button entirely.
// Uses two methods so it works on every browser (Chrome, Firefox, iOS Safari).
(async () => {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    btnTurnOn.disabled = true;
    return;
  }

  // ── Method 1: Permissions API (Chrome Android, Firefox, iOS 16+) ──────
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });

      if (perm.state === 'granted') {
        // Location is already ON → start immediately, no button needed
        startGPS();
        return;
      }

      if (perm.state === 'denied') {
        showError('Location is blocked. Please allow it in your browser settings and reload.');
        btnTurnOn.disabled = true;
        return;
      }

      // 'prompt' → keep the "Turn On Location" button visible (default state)
      // React if the user grants permission through browser settings later
      perm.addEventListener('change', () => {
        if (perm.state === 'granted' && !gpsStarted) startGPS();
        if (perm.state === 'denied' && !gpsStarted) {
          showError('Location is blocked. Please allow it in your browser settings and reload.');
          btnTurnOn.disabled = true;
        }
      });
      return; // Wait for button click
    } catch (e) {
      // Firefox throws for geolocation — fall through to Method 2
    }
  }

  // ── Method 2: Silent probe (older iOS Safari, Firefox fallback) ────────
  // Tries to get a position with a short timeout.
  // If location was already granted and cached: succeeds instantly → skip button.
  // If not granted: fails quietly → button stays visible for user to click.
  navigator.geolocation.getCurrentPosition(
    () => startGPS(),  // Worked silently — location was already on
    () => {},          // Failed — show the "Turn On Location" button (default)
    { maximumAge: 60000, timeout: 2000, enableHighAccuracy: false }
  );
})();
