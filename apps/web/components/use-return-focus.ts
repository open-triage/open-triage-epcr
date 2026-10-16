"use client";
import { useLayoutEffect, useRef } from "react";

/** Restore a caller-owned trigger after closure and async busy state commit.
 * No queued frame may outlive the component or target another account's view.
 */
export function useReturnFocus(open: boolean, busy: boolean, resolveTrigger: () => HTMLElement | null) {
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (open) { pending.current = true; return; }
    if (!pending.current || busy) return;
    pending.current = false;
    const trigger = resolveTrigger();
    if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus({ preventScroll: true });
  }, [open, busy, resolveTrigger]);
}
