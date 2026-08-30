/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const cacheName = "open-triage-shell-v1";
const appShell = ["/", "/manifest.webmanifest"];

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
      return (await caches.match(event.request)) ?? (await caches.match("/")) ?? Response.error();
    })
  );
});

export {};
