"use client";

import { isAndroidRuntime, nativeUiOrigin, NATIVE_UI_SOURCE_EVENT } from "../app/android-runtime";
import { APPLICATION_FOREGROUND_EVENT, applicationVisible } from "../app/application-foreground";
import { canApplyUiUpdate, UI_UPDATE_BOUNDARY_EVENT, UI_UPDATE_CHECK_EVENT, UI_UPDATE_FAILED_EVENT } from "../app/ui-update-boundary";
import { useEffect } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const native = isAndroidRuntime();
    if (!native && (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true")) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("open-triage-")).map((key) => caches.delete(key))));
      return;
    }
    let hasController = Boolean(navigator.serviceWorker.controller);
    let pending = false, refreshing = false, checking = false, active = true;
    const applyUpdatedShell = () => {
      if (!pending || refreshing || !applicationVisible() || !canApplyUiUpdate()) return;
      refreshing = true;
      window.location.reload();
    };
    const useUpdatedShell = () => {
      // Android's first page can be the bundled bootstrap; adopt the server UI once it is cached.
      if (!hasController && !native) { hasController = true; return; }
      hasController = true;
      pending = true; applyUpdatedShell();
    };
    const check = async () => {
      if (!active || checking || !applicationVisible() || native && !nativeUiOrigin()) return;
      checking = true;
      try {
        const registration = await navigator.serviceWorker.register(`${basePath}/sw.js`, { updateViaCache: "none" });
        if (active) await registration.update();
        // A restored connection can leave the APK loader under an unchanged active worker.
        // Confirm that the server shell is available before replacing that loader.
        if (active && native && registration.active && document.querySelector(".native-ui-loading")) {
          const response = await fetch(`${basePath}/`, { cache: "no-store" });
          const html = response.ok ? await response.text() : "";
          if (active && html && !new DOMParser().parseFromString(html, "text/html").getElementById("native-bootstrap")) {
            pending = true; applyUpdatedShell();
          }
        }
      } catch { if (active) window.dispatchEvent(new Event(UI_UPDATE_FAILED_EVENT)); }
      finally { checking = false; }
    };
    const idle = () => {
      applyUpdatedShell();
      if (canApplyUiUpdate()) navigator.serviceWorker.controller?.postMessage({ type: "UI_UPDATE_IDLE" });
    };
    const status = (event: MessageEvent) => {
      if (event.data?.type === "UI_UPDATE_STATUS") event.ports[0]?.postMessage({ blocked: !canApplyUiUpdate() });
    };
    const visible = () => { idle(); void check(); };
    navigator.serviceWorker.addEventListener("controllerchange", useUpdatedShell);
    navigator.serviceWorker.addEventListener("message", status);
    window.addEventListener(UI_UPDATE_BOUNDARY_EVENT, idle);
    window.addEventListener(UI_UPDATE_CHECK_EVENT, visible);
    window.addEventListener(NATIVE_UI_SOURCE_EVENT, visible);
    window.addEventListener("online", visible);
    window.addEventListener(APPLICATION_FOREGROUND_EVENT, visible);
    document.addEventListener("visibilitychange", visible);
    void check();
    idle();
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", useUpdatedShell);
      navigator.serviceWorker.removeEventListener("message", status);
      window.removeEventListener(UI_UPDATE_BOUNDARY_EVENT, idle);
      window.removeEventListener(UI_UPDATE_CHECK_EVENT, visible);
      window.removeEventListener(NATIVE_UI_SOURCE_EVENT, visible);
      window.removeEventListener("online", visible);
      window.removeEventListener(APPLICATION_FOREGROUND_EVENT, visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
