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
  if (!rootResponse.ok) throw new Error("Application shell could not be cached");
  const html = await rootResponse.clone().text();
  const linkedAssets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(([, value]) => new URL(value!, appRoot).toString())
    .filter((value) => new URL(value).origin === self.location.origin);
  await cache.put(appRoot, rootResponse);
  await cache.addAll([...new Set([...appShell.slice(1), ...linkedAssets])]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheStaticShell().then(() => self.skipWaiting()).catch(async (error) => {
    await caches.delete(cacheName);
    throw error;
  }));
});

async function cleanIdleShells(): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const blocked = await Promise.all(clients.map(client => new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const finish = (value: boolean) => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish(true), 1500);
    channel.port1.onmessage = event => finish(event.data?.blocked !== false);
    client.postMessage({ type: "UI_UPDATE_STATUS" }, [channel.port2]);
  })));
  // A page without the new status listener may still be editing. Retain its assets.
  if (blocked.some(Boolean)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith("open-triage-shell-") && key !== cacheName).slice(0, -1).map(key => caches.delete(key)));
}

self.addEventListener("activate", event => { event.waitUntil(self.clients.claim().then(cleanIdleShells)); });
self.addEventListener("message", event => {
  if (event.data?.type === "UI_UPDATE_IDLE") event.waitUntil(cleanIdleShells());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.endsWith(".json")) return;

  event.respondWith(fetch(event.request).then((response) => {
    if (!response.ok && (isApprovedStaticRequest(event.request) || event.request.mode === "navigate")) throw new Error("Application shell unavailable");
    if (response.ok && isApprovedStaticRequest(event.request)) {
      event.waitUntil(caches.open(cacheName).then((cache) => cache.put(event.request, response.clone())));
    }
    return response;
  }).catch(async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(event.request)) ??
      (isApprovedStaticRequest(event.request) && requestUrl.pathname.includes("/_next/static/") ? await caches.match(event.request) : undefined) ??
      (event.request.mode === "navigate" ? await cache.match(appRoot) : undefined) ?? Response.error();
  }));
});

export {};
