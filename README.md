# Floodgate — Location Mapper

A real-time location pinning map. Open it on any device, allow location access, press **Fix My Location**, and your exact GPS coordinates are pinned on the shared map for everyone to see.

**Live site:** `https://YOUR-USERNAME.github.io/floodgate/`

---

## Features

- Full-screen interactive map with GPS tracking
- Blue pulsing dot shows your current position (updates continuously)
- **Fix My Location** button locks your exact coordinates as a red pin
- All pins are visible to everyone in real time (requires Firebase setup)
- Copy coordinates to clipboard with one tap
- List of all recorded points with timestamps
- Works on desktop and mobile (including iPhone/Android)
- No API key needed for the map (uses free OpenStreetMap/CARTO tiles)

---

## Step 1 — Set up Firebase (for shared points)

Without Firebase, points are only stored on the local device. To share points across all users:

### 1.1 Create a Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → give it a name → click through to create
3. On the project dashboard, click **Add app** → choose the **Web** icon (`</>`)
4. Register the app (no need for Firebase Hosting)
5. **Copy the `firebaseConfig` object** shown — you'll need it next

### 1.2 Enable Realtime Database

1. In the left sidebar, go to **Build → Realtime Database**
2. Click **Create Database**
3. Choose a region (e.g. `us-central1`)
4. Select **Start in test mode** → click **Enable**

### 1.3 Set database rules

In the Realtime Database console, click the **Rules** tab and paste:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Click **Publish**. This allows anyone to read and write — appropriate for a public shared map.

### 1.4 Add your config to the app

Open `app.js` and replace the placeholder block near the top:

```js
const FIREBASE_CONFIG = {
  apiKey:            'YOUR_API_KEY',          // ← paste your real values here
  authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId:             'YOUR_APP_ID'
};
```

---

## Step 2 — Deploy to GitHub Pages

### 2.1 Create a GitHub repository

1. Go to [https://github.com/new](https://github.com/new)
2. Name it `floodgate` (or anything you like)
3. Set it to **Public**
4. Click **Create repository**

### 2.2 Push the files

```bash
cd /path/to/Floodgate
git init
git add .
git commit -m "Initial Floodgate map"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/floodgate.git
git push -u origin main
```

### 2.3 Enable GitHub Pages

1. In your repository, go to **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose **main** branch, **/ (root)** folder
4. Click **Save**
5. After ~1 minute, your site is live at:
   `https://YOUR-USERNAME.github.io/floodgate/`

### 2.4 Update the live URL

Edit this `README.md` and replace `YOUR-USERNAME` in the live site link at the top with your actual GitHub username.

---

## How to use

1. Open the site URL on your phone or computer
2. Click **Turn On Location** — allow location access when the browser asks
3. The map centers on your position with a blue dot
4. When the GPS is ready, press **Fix My Location**
5. A red pin drops at your exact coordinates, shown in the panel below
6. Tap the **Points** button (top right) to see all recorded locations
7. Click any point in the list to jump to it on the map

---

## Notes

- **HTTPS is required** for the Geolocation API. GitHub Pages always serves over HTTPS, so it works automatically.
- For best accuracy, use a mobile device outdoors with GPS enabled.
- The free Firebase Realtime Database tier allows 1 GB storage and 10 GB/month bandwidth — more than enough for thousands of pins.
- Points stored in Firebase are permanent until you delete them from the Firebase console.
