// Shell assets only: never cache API responses, credentials, or order data.
const CACHE = "zetas-shell-v1";
const ROOT = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(ROOT, { cache: "reload" });
    if (!response.ok) throw new Error("Cannot cache application shell");
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], ROOT))
      .filter((url) => url.origin === self.location.origin && url.pathname.includes("/assets/"))
      .map((url) => url.href);
    await cache.addAll([...new Set(assets)]);
    await cache.put(ROOT, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("zetas-shell-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(CACHE)).put(ROOT, response.clone());
        return response;
      } catch {
        return (await caches.match(ROOT)) || Response.error();
      }
    })());
  } else if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })());
  }
});