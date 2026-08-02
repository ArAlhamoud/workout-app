// ── Offline cache ──────────────────────────────────────────────
const CACHE_NAME = 'workout-app-v2';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Navigation requests: network-first, offline fallback page on failure.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
    ),
  );
});

// ── Rest-timer notifications: REMOVED ──────────────────────────
// This worker used to accept SCHEDULE_NOTIFICATION / CANCEL_NOTIFICATION
// messages from RestTimer and call showNotification(). That never fired inside
// the Capacitor iOS shell — WKWebView has no Web Notifications and iOS has no
// navigator.vibrate — so it only ever worked in desktop Safari/Chrome while
// making the native app look like it had background alerts.
//
// Rest alerts now live entirely in src/components/RestTimer.tsx
// (scheduleRestAlert / cancelRestAlert), which is the single seam that will be
// swapped to @capacitor/local-notifications + @capacitor/haptics once the
// plugin batch is installed. Do not re-add notification handling here.
