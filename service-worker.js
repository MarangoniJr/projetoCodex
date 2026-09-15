// Authenticated API responses and receipts must never enter an offline cache.
self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("reembolso-viagem-")) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
