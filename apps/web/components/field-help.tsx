"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function FieldHelp({ text, label, className, id: suppliedId, focusable = true }: {
  readonly text: string; readonly label: ReactNode; readonly className?: string;
  readonly id?: string; readonly focusable?: boolean;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, above: false });
  const positionTooltip = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 368)),
      top: rect.top > 180 ? rect.top - 8 : rect.bottom + 8, above: rect.top > 180 });
  }, []);
  const showTooltip = () => { positionTooltip(); setOpen(true); };
  useEffect(() => {
    if (!open || !text) return;
    window.addEventListener("scroll", positionTooltip, true);
    window.addEventListener("resize", positionTooltip);
    return () => { window.removeEventListener("scroll", positionTooltip, true); window.removeEventListener("resize", positionTooltip); };
  }, [open, text, positionTooltip]);
  const tooltipContent = open && text && createPortal(<span id={id} role="tooltip" className="field-help-tooltip"
    style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}>{text}</span>, document.body);
  return <>
    <span ref={trigger} className={[text && "field-help-item", className].filter(Boolean).join(" ") || undefined}
      tabIndex={text && focusable ? 0 : undefined} data-tooltip-trigger={text ? "" : undefined}
      aria-describedby={open && text ? id : undefined}
      onMouseEnter={showTooltip} onMouseLeave={() => { if (!trigger.current?.contains(document.activeElement)) setOpen(false); }}
      onFocus={showTooltip} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onClick={(event) => { event.stopPropagation(); showTooltip(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }}>{label}</span>
    {tooltipContent}
  </>;
}
