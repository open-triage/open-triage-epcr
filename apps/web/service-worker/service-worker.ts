/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
declare const SAMPLE_DISPATCH_ASSIGNMENT_ENABLED: boolean;

const cacheName = "open-triage-shell-v3";
const appRoot = new URL("./", self.registration.scope).toString();
const appShell = [
  appRoot,
  new URL("manifest.webmanifest", appRoot).toString(),
  ...(SAMPLE_DISPATCH_ASSIGNMENT_ENABLED ? [
    new URL("demo-assigned-calls.json", appRoot).toString(),
    new URL("demo-open-calls.json", appRoot).toString(),
    new URL("demo-open-assignment.json", appRoot).toString(),
  ] : []),
];

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
  event.waitUntil(cacheStaticShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("open-triage-shell-") && key !== cacheName).map((key) => caches.delete(key)))),
  ]));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      event.waitUntil(caches.open(cacheName).then((cache) => cache.put(event.request, response.clone())));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) ??
    (event.request.mode === "navigate" ? await caches.match(appRoot) : undefined) ?? Response.error()));
});

export {};
