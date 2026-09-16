"use client";

import { useEffect, useRef } from "react";

export function TransientNotice({ message, onDismiss, focusOnMount = false }: {
  readonly message: string | null;
  readonly onDismiss: () => void;
  readonly focusOnMount?: boolean;
}) {
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && focusOnMount) notice.current?.focus();
  }, [focusOnMount, message]);

  useEffect(() => {
    if (!message) return;
    window.addEventListener("pointerdown", onDismiss, { capture: true, once: true });
    window.addEventListener("keydown", onDismiss, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", onDismiss, { capture: true });
      window.removeEventListener("keydown", onDismiss, { capture: true });
    };
  }, [message, onDismiss]);

  if (!message) return null;
  return <div ref={notice} className="transient-notice" role="status" aria-live="polite"
    tabIndex={focusOnMount ? -1 : undefined}>
    <span>{message}</span>
    <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>×</button>
  </div>;
}
