"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/** Desktop panels share scrolling, positioning below their toolbar, and Escape handling. */
export function WorkspaceSidebar({ id, label, className = "", docked = true, anchor, onEscape, children }: {
  id: string;
  label: string;
  className?: string;
  docked?: boolean;
  anchor?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!docked || !anchor?.current || !panel.current) return;
    const toolbar = anchor.current;
    const sidebar = panel.current;
    let frame = 0;
    const measure = () => sidebar.style.setProperty("--workspace-sidebar-top", `${Math.max(0, toolbar.getBoundingClientRect().bottom)}px`);
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [anchor, docked]);

  return <aside ref={panel} id={id} aria-label={label} className={`${docked ? "workspace-sidebar " : ""}${className}`}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !onEscape ||
        (event.target as HTMLElement).closest("dialog[open], [role=dialog], [role=alertdialog]")) return;
      event.preventDefault(); event.stopPropagation(); onEscape();
    }}>{children}</aside>;
}
