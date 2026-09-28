"use client";

import React, { useEffect, useState, type ReactNode } from "react";

/** Reserve space immediately, but avoid flashing copy for fast operations. */
export function LoadingStatus({ children, className = "", delayMs = 400 }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delayMs?: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  return <p className={className} role="status" style={{ minHeight: "1.35em" }}>
    {visible ? children : <span aria-hidden="true">&nbsp;</span>}
  </p>;
}
