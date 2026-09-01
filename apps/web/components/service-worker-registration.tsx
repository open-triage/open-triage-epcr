"use client";

import { useEffect } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("open-triage-")).map((key) => caches.delete(key))));
      return;
    }
    void navigator.serviceWorker.register(`${basePath}/sw.js`);
  }, []);
  return null;
}
