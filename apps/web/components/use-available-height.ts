"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Account for the actual headers above a desktop collection, including wrapped filters. */
export function useAvailableHeight<T extends HTMLElement>(bottomInset = 24) {
  const ref = useRef<T>(null);
  const measure = () => {
    const element = ref.current;
    if (!element || !element.getClientRects().length) return;
    // Use the document position so initial focus/scroll anchoring cannot grow the panel.
    const top = Math.max(0, element.getBoundingClientRect().top + window.scrollY);
    element.style.setProperty("--available-height", `${Math.max(200, window.innerHeight - top - bottomInset)}px`);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (ref.current?.parentElement) observer.observe(ref.current.parentElement);
    const header = document.querySelector(".session-bar");
    if (header) observer.observe(header);
    return () => { window.removeEventListener("resize", measure); observer.disconnect(); };
  });
  return ref;
}
