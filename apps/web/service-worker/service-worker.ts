/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
declare const __OPEN_TRIAGE_BUILD_SHA__: string;

const cacheName = `open-triage-shell-v5-${__OPEN_TRIAGE_BUILD_SHA__}`;
const appRoot = new URL("./", self.registration.scope).toString();
const appShell = [
  appRoot,
  new URL("manifest.webmanifest", appRoot).toString(),
];

function isApprovedStaticRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.toString() === appRoot || url.toString() === appShell[1]) return true;
  return url.pathname.includes("/_next/static/") &&
    ["script", "style", "font", "image"].includes(request.destination);
}

async function cacheStaticShell(): Promise<void> {
  const cache = await caches.open(cacheName);
  const rootResponse = await fetch(appRoot);
  if (!rootResponse.ok) throw new Error("Static demo shell could not be cached");
  const html = await rootResponse.clone().text();
  const linkedAssets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(([, value]) => new URL(value!, appRoot).toString())
    .filter((value) => new URL(value).origin === self.location.origin);
  await cache.put(appRoot, rootResponse);
  await cache.addAll([...new Set([...appShell.slice(1), ...linkedAssets])]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([cacheStaticShell(), self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("open-triage-shell-") && key !== cacheName).map((key) => caches.delete(key)))),
  ]));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.endsWith(".json")) return;

  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && isApprovedStaticRequest(event.request)) {
      event.waitUntil(caches.open(cacheName).then((cache) => cache.put(event.request, response.clone())));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) ??
    (event.request.mode === "navigate" ? await caches.match(appRoot) : undefined) ?? Response.error()));
});

export {};
