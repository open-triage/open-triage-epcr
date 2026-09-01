/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const cacheName = "open-triage-shell-v2";
const appRoot = new URL("./", self.registration.scope).toString();
const appShell = [appRoot, new URL("manifest.webmanifest", appRoot).toString()];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appShell)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      return (await caches.match(event.request)) ?? (await caches.match(appRoot)) ?? Response.error();
    })
  );
});

export {};
