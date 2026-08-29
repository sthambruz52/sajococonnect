// Minimal service worker - exists purely to satisfy Chrome's PWA "installable"
// requirement. It doesn't cache anything; every request just passes straight
// through to the network, so the app always gets fresh data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
