"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export function ExceptionalValueMenu({ label, menuLabel = label, selected = false, disabled = false,
  choices, onSelect, open: controlledOpen, onOpenChange }: {
  readonly label: string;
  readonly menuLabel?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly choices: ReadonlyArray<{ key: string; label: string }>;
  readonly onSelect: (key: string) => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const notify = useRef(onOpenChange);
  useLayoutEffect(() => { notify.current = onOpenChange; }, [onOpenChange]);
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const close = (restore: boolean) => {
    setOpen(false);
    const host = root.current?.closest<HTMLElement>("[data-element-id]");
    const elementId = host?.dataset.elementId;
    if (restore) requestAnimationFrame(() => {
      const field = host?.isConnected ? host : [...document.querySelectorAll<HTMLElement>("[data-element-id]")]
        .find((candidate) => candidate.dataset.elementId === elementId);
      const target = trigger.current?.isConnected ? trigger.current : field?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
      target?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setLocalOpen(false); notify.current?.(false); }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="stationary-exceptional-picker" ref={root} onBlur={(event) => {
    if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false);
  }} onKeyDown={(event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
      event.key === "ArrowDown" ? (current + 1) % items.length :
        event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : null;
    if (index !== null) { event.preventDefault(); event.stopPropagation(); items[index]?.focus(); }
  }}>
    <button ref={trigger} className={`null-value-trigger${selected ? " active" : ""}`} type="button"
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => open ? close(true) : setOpen(true)}
      onKeyDown={(event) => {
        if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}>×</button>
    {open && <div className="null-value-menu" role="menu" id={id} aria-label={menuLabel}>
      {choices.map((choice) => <button key={choice.key} type="button" role="menuitem" onClick={() => {
        onSelect(choice.key); close(true);
      }}>{choice.label}</button>)}
    </div>}
  </div>;
}
