"use strict";
(() => {
  // service-worker/service-worker.ts
  var cacheName = "open-triage-shell-v2";
  var appRoot = new URL("./", self.registration.scope).toString();
  var appShell = [appRoot, new URL("manifest.webmanifest", appRoot).toString()];
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
        return await caches.match(event.request) ?? await caches.match(appRoot) ?? Response.error();
      })
    );
  });
})();
