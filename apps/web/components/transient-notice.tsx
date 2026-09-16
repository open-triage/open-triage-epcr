"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

type TransientNoticeProps = {
  readonly message: string | null;
  readonly onDismiss: () => void;
  readonly focusOnMount?: boolean;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "role" | "aria-live">;

export function TransientNotice({ message, onDismiss, focusOnMount = false, className, ...attributes }: TransientNoticeProps) {
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && focusOnMount) notice.current?.focus();
  }, [focusOnMount, message]);

  useEffect(() => {
    if (!message) return;
    const dismissOnOutsideInteraction = (event: Event) => {
      if (!notice.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("pointerdown", dismissOnOutsideInteraction, { capture: true, once: true });
    window.addEventListener("keydown", dismissOnOutsideInteraction, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", dismissOnOutsideInteraction, { capture: true });
      window.removeEventListener("keydown", dismissOnOutsideInteraction, { capture: true });
    };
  }, [message, onDismiss]);

  if (!message) return null;
  return <div {...attributes} ref={notice} className={`transient-notice${className ? ` ${className}` : ""}`} role="status" aria-live="polite"
    tabIndex={focusOnMount ? -1 : undefined}>
    <span>{message}</span>
  </div>;
}
