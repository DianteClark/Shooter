// Pass-through service worker, registered on Android only (js/ui/android.js). Chrome and Samsung Internet offer
// "Install app" only to a site whose worker handles fetch; this one hands every request straight to the network with
// its own cache mode, so the HTTP cache and js/ui/updater.js behave exactly as without it. Nothing is stored here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).catch(() => Response.error()));
});
