import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getDatabase, ref, push, onValue }
  from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js';

// ── FIREBASE ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyConXdhSHPmoHl-tnEVMRD6eXp2ilnRb1w',
  authDomain:        'floodgate-d63ae.firebaseapp.com',
  databaseURL:       'https://floodgate-d63ae-default-rtdb.firebaseio.com',
  projectId:         'floodgate-d63ae',
  storageBucket:     'floodgate-d63ae.firebasestorage.app',
  messagingSenderId: '753742117307',
  appId:             '1:753742117307:web:5e20b9119e22728197ac9e'
};
let dbRef = null;
try {
  dbRef = ref(getDatabase(initializeApp(FIREBASE_CONFIG)), 'points');
} catch (e) { console.error(e); }

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

// ── USER MARKER (blue pulsing dot) ───────────────────────
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
    accuracyRing = L.circle(ll, {
      radius: accuracy, color: '#2563eb',
      fillColor: '#2563eb', fillOpacity: .08, weight: 1
    }).addTo(map);
  } else {
    userMarker.setLatLng(ll);
    accuracyRing.setLatLng(ll);
    accuracyRing.setRadius(accuracy);
  }
}

// ── PIN MARKER (red drop pin) ────────────────────────────
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

// ── LOAD / SYNC POINTS ───────────────────────────────────
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
          const pt = { ...p, id };
          points.push(pt);
          addMarkerForPoint(pt);
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

function saveLocally(point) {
  const p = { ...point, id: `local-${Date.now()}` };
  points.push(p); addMarkerForPoint(p);
  badgeCount.textContent = points.length;
  try {
    const s = JSON.parse(localStorage.getItem('fg-points') || '[]');
    s.push(p); localStorage.setItem('fg-points', JSON.stringify(s));
  } catch (e) {}
}

// ── GPS ──────────────────────────────────────────────────
function startGPS() {
  if (gpsStarted) return;
  gpsStarted = true;

  // Show searching state in modal
  enableWrap.classList.add('hidden');
  gpsRow.classList.remove('hidden');
  gpsDot.className    = 'dot dot-amber';
  gpsLabel.textContent = 'Finding your location…';

  // Use getCurrentPosition first — it works with "Allow this time" permission
  // and reliably calls the callback the moment permission is granted.
  // Then start watchPosition so the blue dot stays live.
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onPosition(pos);
      // Now permission is confirmed — start continuous tracking
      navigator.geolocation.watchPosition(onPosition, () => {}, {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 5000
      });
    },
    onGeoError,
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
  );
}

// ── POSITION CALLBACK ────────────────────────────────────
function onPosition(pos) {
  currentPos = pos;
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;

  if (!gpsReady) {
    gpsReady = true;

    // Zoom map to user's real location
    map.setView([lat, lng], 16);

    // Update modal status briefly, then auto-close and show bottom panel
    gpsDot.className    = 'dot dot-green';
    gpsLabel.textContent = `Location found · ±${Math.round(accuracy)} m`;

    setTimeout(() => {
      modal.classList.add('hidden');
      topBadge.classList.remove('hidden');
      bottomPanel.classList.remove('hidden');
    }, 800);
  }

  updateUserMarker(lat, lng, accuracy);

  // Keep bottom panel status updated
  if (!bottomPanel.classList.contains('hidden')) {
    statusDot.className     = 'dot dot-green';
    statusLabel.textContent = `GPS active · ±${Math.round(accuracy)} m`;
  }
}

// ── GEO ERROR ────────────────────────────────────────────
function onGeoError(err) {
  const msgs = {
    1: 'Location access was denied. Please allow it when asked and try again.',
    2: 'Could not determine location. Make sure GPS is enabled on your device.',
    3: 'Location request timed out. Please try again.'
  };
  modalError.textContent = msgs[err.code] || 'Could not get location.';
  modalError.classList.remove('hidden');

  // Reset so the user can try again
  enableWrap.classList.remove('hidden');
  gpsRow.classList.add('hidden');
  btnTurnOn.disabled    = false;
  btnTurnOn.textContent = 'Try Again';
  gpsStarted = false;
}

// ── FIX LOCATION ────────────────────────────────────────
async function fixLocation() {
  if (!currentPos) return;

  const { latitude: lat, longitude: lng, accuracy } = currentPos.coords;
  const now   = new Date();
  const point = { lat, lng, accuracy: Math.round(accuracy), timestamp: now.toISOString() };

  // Show coordinates in bottom panel
  fixResult.classList.remove('hidden');
  resultCoords.textContent = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;
  resultAcc.textContent    = `±${Math.round(accuracy)} m`;
  resultTime.textContent   = now.toLocaleString();
  lastCoords = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;

  // Visual feedback on button
  const origHTML = btnFix.innerHTML;
  btnFix.classList.add('success');
  btnFix.innerHTML = `
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg> Location Fixed!`;
  setTimeout(() => { btnFix.classList.remove('success'); btnFix.innerHTML = origHTML; }, 2500);

  // Save to Firebase or localStorage
  if (dbRef) {
    try { await push(dbRef, point); } catch (e) { saveLocally(point); }
  } else {
    saveLocally(point);
  }
}

// ── DRAWER ───────────────────────────────────────────────
function openDrawer() {
  drawerBody.innerHTML = '';
  if (!points.length) {
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

// ── EVENTS ───────────────────────────────────────────────
btnTurnOn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    modalError.textContent = 'Geolocation is not supported by your browser.';
    modalError.classList.remove('hidden');
    return;
  }
  btnTurnOn.disabled = true;
  btnTurnOn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         style="animation:spin .9s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    Finding location…`;
  modalError.classList.add('hidden');
  startGPS();
});

btnFix.addEventListener('click', fixLocation);

btnCopy.addEventListener('click', () => {
  if (!lastCoords) return;
  const done = () => {
    btnCopy.textContent = 'Copied!'; btnCopy.classList.add('copied');
    setTimeout(() => { btnCopy.textContent = 'Copy Coordinates'; btnCopy.classList.remove('copied'); }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(lastCoords).then(done).catch(() => { legacyCopy(); done(); });
  } else { legacyCopy(); done(); }
});
function legacyCopy() {
  const el = Object.assign(document.createElement('textarea'), { value: lastCoords });
  el.style.cssText = 'position:fixed;top:-9999px';
  document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
}

btnOpenList.addEventListener('click', openDrawer);
btnClose.addEventListener('click', () => drawer.classList.add('hidden'));
$('map').addEventListener('click',  () => drawer.classList.add('hidden'));

// ── STARTUP ──────────────────────────────────────────────
initMap();
loadPoints();

// Auto-detect if location permission is already granted.
// If yes: skip the button, start GPS immediately.
// If not: wait for the user to click "Turn On Location".
(async () => {
  if (!navigator.geolocation) {
    modalError.textContent = 'Geolocation is not supported by your browser.';
    modalError.classList.remove('hidden');
    enableWrap.classList.add('hidden');
    return;
  }

  // Method 1: Permissions API (Chrome, Firefox, iOS 16+)
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') { startGPS(); return; }
      if (perm.state === 'denied') {
        modalError.textContent = 'Location is blocked. Please allow it in your browser settings and reload.';
        modalError.classList.remove('hidden');
        enableWrap.classList.add('hidden');
        return;
      }
      perm.addEventListener('change', () => {
        if (perm.state === 'granted' && !gpsStarted) startGPS();
      });
      return;
    } catch (e) { /* Firefox throws — fall through */ }
  }

  // Method 2: Silent probe for older iOS Safari
  // If location was previously granted, getCurrentPosition succeeds instantly.
  navigator.geolocation.getCurrentPosition(
    () => { if (!gpsStarted) startGPS(); },
    () => { /* silently show the Turn On button */ },
    { maximumAge: 60000, timeout: 1500, enableHighAccuracy: false }
  );
})();
