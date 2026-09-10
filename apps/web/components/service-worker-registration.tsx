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
    const controlledAtLoad = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    const useUpdatedShell = () => {
      if (!controlledAtLoad || refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", useUpdatedShell);
    void navigator.serviceWorker.register(`${basePath}/sw.js`, { updateViaCache: "none" })
      .then((registration) => registration.update());
    return () => navigator.serviceWorker.removeEventListener("controllerchange", useUpdatedShell);
  }, []);
  return null;
}
