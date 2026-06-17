// ═══════════════════════════════════════════════════════════
//  FLOODGATE  ·  app.js
//
//  Firebase setup (for shared points across all users):
//  1. https://console.firebase.google.com → create project → add web app
//  2. Build → Realtime Database → Create database (test mode)
//  3. Replace the placeholder values below with your config.
//  Without Firebase: points are saved to localStorage only.
// ═══════════════════════════════════════════════════════════

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
const FB_READY = !Object.values(FIREBASE_CONFIG).some(v => String(v).startsWith('YOUR_'));
let dbRef = null;

if (FB_READY) {
  try {
    const fbApp = initializeApp(FIREBASE_CONFIG);
    dbRef = ref(getDatabase(fbApp), 'points');
  } catch (err) {
    console.error('[Floodgate] Firebase init failed:', err);
  }
}

// ── STATE ────────────────────────────────────────────────
let map          = null;
let userMarker   = null;
let accuracyRing = null;
let currentPos   = null;
let gpsStarted   = false;   // true once watchPosition has been called
let gpsReady     = false;   // true once the first position fix arrives
let points       = [];
let markers      = {};
let lastFixCoords = null;

// ── DOM REFS ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const modal          = $('modal');
const btnAction      = $('btn-action');
const modalGpsRow    = $('modal-gps-row');
const modalGpsDot    = $('modal-gps-dot');
const modalGpsLabel  = $('modal-gps-label');
const modalHint      = $('modal-hint');
const modalError     = $('modal-error');
const topBadge       = $('top-badge');
const badgeCount     = $('badge-count');
const btnOpenList    = $('btn-open-list');
const bottomPanel    = $('bottom-panel');
const statusDot      = $('status-dot');
const statusLabel    = $('status-label');
const btnFix         = $('btn-fix');
const fixResult      = $('fix-result');
const resultCoords   = $('result-coords');
const resultAccuracy = $('result-accuracy');
const resultTime     = $('result-time');
const btnCopy        = $('btn-copy');
const drawer         = $('drawer');
const drawerBody     = $('drawer-body');
const btnCloseDrawer = $('btn-close-drawer');

// ── MAP: initializes immediately to a world view ─────────
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true })
         .setView([30, 15], 2);

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }
  ).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
}

// ── USER LOCATION MARKER ─────────────────────────────────
const USER_ICON = L.divIcon({
  className: '',
  html: `<div style="
    width:18px;height:18px;
    background:#2563eb;border:3px solid white;border-radius:50%;
    box-shadow:0 0 0 3px rgba(37,99,235,.35);
    animation:pulse-ring 2s ease-out infinite;
  "></div>`,
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

// ── POINT MARKERS ────────────────────────────────────────
function makePinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:16px;height:16px;
      background:#ef4444;border:2.5px solid white;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,.35);
    "></div>`,
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
  if (FB_READY && dbRef) {
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
      refreshBadge();
    });
  } else {
    try { points = JSON.parse(localStorage.getItem('fg-points') || '[]'); }
    catch { points = []; }
    points.forEach(addMarkerForPoint);
    refreshBadge();
  }
}

function saveLocally(point) {
  const id = `local-${Date.now()}`;
  const p  = { ...point, id };
  points.push(p);
  addMarkerForPoint(p);
  refreshBadge();
  try {
    const stored = JSON.parse(localStorage.getItem('fg-points') || '[]');
    stored.push(p);
    localStorage.setItem('fg-points', JSON.stringify(stored));
  } catch (e) { console.warn(e); }
}

// ── MODAL BUTTON STATES ──────────────────────────────────
//  'enable'  → blue  "Enable Location"  (permission not yet asked)
//  'loading' → gray  "Finding location…" (GPS started, waiting for fix)
//  'ready'   → green "Fix My Location"  (GPS has a fix, ready to pin)
//  'denied'  → gray  "Location Blocked" (permission denied)
function setButton(state) {
  btnAction.className = 'btn-action';
  btnAction.disabled  = false;

  switch (state) {
    case 'enable':
      btnAction.innerHTML     = 'Enable Location';
      modalHint.classList.remove('hidden');
      break;

    case 'loading':
      btnAction.disabled  = true;
      btnAction.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             style="animation:spin .9s linear infinite">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Finding location…`;
      modalHint.classList.add('hidden');
      break;

    case 'ready':
      btnAction.classList.add('state-ready');
      btnAction.innerHTML = `
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        Fix My Location`;
      modalHint.classList.add('hidden');
      break;

    case 'denied':
      btnAction.disabled  = true;
      btnAction.innerHTML = 'Location Blocked';
      modalHint.classList.add('hidden');
      break;
  }
}

function showModalError(msg) {
  modalError.textContent = msg;
  modalError.classList.remove('hidden');
}

// ── GPS ──────────────────────────────────────────────────
function startGPS() {
  if (gpsStarted) return;
  gpsStarted = true;

  if (!navigator.geolocation) {
    showModalError('Geolocation is not supported by your browser.');
    setButton('denied');
    return;
  }

  // Show GPS row with searching state
  modalGpsRow.classList.remove('hidden');
  modalGpsDot.className = 'dot dot-amber';
  modalGpsLabel.textContent = 'Finding location…';

  navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    timeout:            20000,
    maximumAge:         5000
  });
}

// ── GEOLOCATION CALLBACKS ────────────────────────────────
function onPosition(pos) {
  currentPos = pos;
  const { latitude, longitude, accuracy } = pos.coords;

  // Update GPS row in modal
  modalGpsRow.classList.remove('hidden');
  modalGpsDot.className   = 'dot dot-green';
  modalGpsLabel.textContent = `GPS ready · ±${Math.round(accuracy)} m`;

  if (!gpsReady) {
    gpsReady = true;
    // Zoom map to the user's real location
    map.setView([latitude, longitude], 16);
    // Switch button to "Fix My Location"
    setButton('ready');
  }

  updateUserMarker(latitude, longitude, accuracy);

  // Keep bottom panel status updated when it's visible
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
  showModalError(msgs[err.code] || 'Unknown location error.');
  setButton('denied');
  gpsStarted = false; // Allow retry
}

// ── FIX LOCATION ────────────────────────────────────────
async function fixLocation() {
  if (!currentPos) return;

  const { latitude: lat, longitude: lng, accuracy } = currentPos.coords;
  const now   = new Date();
  const point = { lat, lng, accuracy: Math.round(accuracy), timestamp: now.toISOString() };

  // Populate the bottom panel result fields
  fixResult.classList.remove('hidden');
  resultCoords.textContent   = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;
  resultAccuracy.textContent = `±${Math.round(accuracy)} m`;
  resultTime.textContent     = now.toLocaleString();
  lastFixCoords = `${lat.toFixed(7)}, ${lng.toFixed(7)}`;

  // Save to Firebase or localStorage
  if (FB_READY && dbRef) {
    try {
      await push(dbRef, point);
    } catch (err) {
      console.error('[Floodgate] Firebase write failed:', err);
      saveLocally(point);
    }
  } else {
    saveLocally(point);
  }
}

// Fix and close the modal (used from the modal button)
async function fixAndCloseModal() {
  if (!currentPos) return;

  // Flash button to confirm
  const origHTML = btnAction.innerHTML;
  btnAction.disabled  = true;
  btnAction.innerHTML = `
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Location Fixed!`;

  await fixLocation();

  // Close modal after a brief moment
  setTimeout(() => {
    modal.classList.add('hidden');

    // Reveal top badge and bottom panel
    topBadge.classList.remove('hidden');
    bottomPanel.classList.remove('hidden');

    // Bottom panel: update status
    statusDot.className     = 'dot dot-green';
    statusLabel.textContent = `GPS active · ±${Math.round(currentPos.coords.accuracy)} m`;
  }, 600);
}

// Fix from the bottom panel button (used after modal is closed)
async function fixFromPanel() {
  if (!currentPos) return;

  const origHTML = btnFix.innerHTML;
  btnFix.classList.add('btn-success');
  btnFix.innerHTML = `
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Location Fixed!`;

  await fixLocation();

  setTimeout(() => {
    btnFix.classList.remove('btn-success');
    btnFix.innerHTML = origHTML;
  }, 2500);
}

// ── BADGE ────────────────────────────────────────────────
function refreshBadge() {
  badgeCount.textContent = points.length;
}

// ── DRAWER ───────────────────────────────────────────────
function openDrawer() {
  drawerBody.innerHTML = '';

  if (points.length === 0) {
    drawerBody.innerHTML = `
      <div class="drawer-empty">
        No points recorded yet.<br>
        Press <strong>Fix My Location</strong> to add yours.
      </div>`;
  } else {
    [...points]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .forEach(p => {
        const el = document.createElement('div');
        el.className = 'point-item';
        el.innerHTML = `
          <div class="pi-coords">${p.lat.toFixed(7)},&thinsp;${p.lng.toFixed(7)}</div>
          <div class="pi-meta">±${p.accuracy} m &nbsp;·&nbsp; ${new Date(p.timestamp).toLocaleString()}</div>
        `;
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

// ── EVENT LISTENERS ──────────────────────────────────────
btnAction.addEventListener('click', () => {
  if (!gpsStarted) {
    // First click: start GPS, show loading
    setButton('loading');
    startGPS();
  } else if (gpsReady) {
    // GPS is ready: fix and close modal
    fixAndCloseModal();
  }
  // if gpsStarted && !gpsReady: button is disabled (loading), nothing to do
});

btnFix.addEventListener('click', fixFromPanel);

btnCopy.addEventListener('click', () => {
  if (!lastFixCoords) return;
  const doCopy = () => {
    btnCopy.textContent = 'Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => { btnCopy.textContent = 'Copy Coordinates'; btnCopy.classList.remove('copied'); }, 2200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(lastFixCoords).then(doCopy).catch(() => { legacyCopy(lastFixCoords); doCopy(); });
  } else { legacyCopy(lastFixCoords); doCopy(); }
});

function legacyCopy(text) {
  const el = Object.assign(document.createElement('textarea'), { value: text });
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

btnOpenList.addEventListener('click', openDrawer);
btnCloseDrawer.addEventListener('click', () => drawer.classList.add('hidden'));
document.getElementById('map').addEventListener('click', () => drawer.classList.add('hidden'));

// ── STARTUP ──────────────────────────────────────────────
// 1. Map renders immediately (world view)
initMap();

// 2. Load existing saved points onto the map right away
loadPoints();

// 3. Check if location permission is already granted
//    If yes: auto-start GPS and show "Fix My Location" when ready
//    If denied: show error
//    If unknown/prompt: leave button as "Enable Location"
(async () => {
  if (!navigator.geolocation) {
    showModalError('Geolocation is not supported by your browser.');
    setButton('denied');
    return;
  }

  if (!navigator.permissions) {
    // Older browsers (some iOS Safari) — wait for user to click
    return;
  }

  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });

    if (status.state === 'granted') {
      setButton('loading');
      startGPS();
    } else if (status.state === 'denied') {
      showModalError('Location is blocked. Please allow it in your browser settings and reload the page.');
      setButton('denied');
    }
    // 'prompt' → default "Enable Location" button, no change needed

    // React to future permission changes (e.g. user unblocks in settings)
    status.addEventListener('change', () => {
      if (status.state === 'granted' && !gpsStarted) {
        setButton('loading');
        startGPS();
      } else if (status.state === 'denied') {
        showModalError('Location is blocked. Please allow it in your browser settings and reload.');
        setButton('denied');
      }
    });
  } catch (e) {
    // Firefox: permissions.query may throw for geolocation — wait for user click
  }
})();
