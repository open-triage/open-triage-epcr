"use client";

import { useEffect, useEffectEvent } from "react";

/** Keep polling tied to visibility and scope, rather than callback identity. */
export function useVisiblePolling(refresh: () => void | Promise<void>, intervalMs: number,
  enabled = true, scope = "", refreshOnStart = true) {
  const refreshLatest = useEffectEvent(refresh);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pending = false;
    const update = async () => {
      if (stopped || pending || document.visibilityState !== "visible") return;
      pending = true;
      try { await refreshLatest(); } finally { pending = false; }
    };
    if (refreshOnStart) queueMicrotask(() => void update());
    const timer = window.setInterval(() => void update(), intervalMs);
    const visible = () => { void update(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [enabled, intervalMs, scope, refreshOnStart]);
}
