"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Focus recovery controls only after the parent directory is visible and busy
 * state has committed. A queued animation frame can run before that commit and
 * cannot focus a control inside the still-hidden directory.
 */
export function useRecoveryFormFocus(form: RefObject<HTMLFormElement | null>, ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    const target = form.current?.querySelector<HTMLElement>('input[type="password"], button[type="submit"]');
    if (target?.isConnected && !target.matches(":disabled") && target.getClientRects().length > 0)
      target.focus({ preventScroll: true });
  }, [form, ready]);
}
