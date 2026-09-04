/**
 * The cabinet is used at a workbench, where the signal comes and goes. This
 * keeps the app shell available offline and nothing else: every part, count and
 * photo is fetched under /api, which is never cached, because an inventory
 * served from an old visit and presented as current is worse than an error.
 */

const CACHE = "parts-cabinet-shell-v1";
const SHELL = ["/", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One unreachable file must not stop the rest of the shell from caching.
      .then((cache) => Promise.all(SHELL.map((path) => cache.add(path).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function store(request, response) {
  if (!response.ok || response.type !== "basic") return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

/** Only for build assets, whose filenames carry a content hash. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await store(request, response);
  return response;
}

/** The network always wins when it answers, so nothing stale is served online. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await store(request, response);
    return response;
  } catch (failure) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw failure;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(url.pathname.startsWith("/_next/static/") ? cacheFirst(request) : networkFirst(request));
});
