"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ClinicalSelectOption = { readonly key: string; readonly label: string };

type Placement = { readonly left: number; readonly top: number; readonly width: number; readonly maxHeight: number };

export function ClinicalSearchableSelect({ label, value, options, disabled = false, placeholder = "Choose a value", onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<ClinicalSelectOption>;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onChange: (key: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const openingPoint = useRef<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const visible = options.filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = options.find((option) => option.key === value);
  const swedish = typeof document !== "undefined" && document.documentElement.lang === "sv";

  function close(restoreFocus = true) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  }

  function commit(key: string) {
    onChange(key);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const point = openingPoint.current;
      // Search is above the first result. When space permits, the first result
      // covers the pointer location after the opening click has finished.
      const preferred = point ? point.y - 48 - 24 : rect.top - 48;
      const top = Math.max(viewportTop + 8, Math.min(preferred, viewportTop + viewportHeight - 104));
      setPlacement({ left, top, width, maxHeight: Math.max(96, viewportTop + viewportHeight - top - 8) });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, placement]);

  useEffect(() => {
    if (open && active >= 0) popup.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-option-${active}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, open, query]);

  return <>
    <button ref={trigger} type="button" className="clinical-searchable-trigger" disabled={disabled}
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
      onClick={(event) => {
        if (open) { close(); return; }
        openingPoint.current = event.detail ? { x: event.clientX, y: event.clientY } : null;
        setActive(0);
        setQuery("");
        setOpen(true);
      }}>{selected?.label ?? placeholder}</button>
    {open && placement && createPortal(<div ref={popup} className="clinical-searchable-popup" style={placement}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <input ref={search} type="search" role="combobox" aria-label={`${swedish ? "Sök" : "Search"} ${label}`} aria-autocomplete="list"
        aria-expanded="true" aria-controls={`${id}-options`}
        aria-activedescendant={visible[active] ? `${id}-option-${active}` : undefined}
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && visible.length) { event.preventDefault(); setActive((index) => Math.min(index + 1, visible.length - 1)); }
          if (event.key === "ArrowUp" && visible.length) { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Home" && visible.length) { event.preventDefault(); setActive(0); }
          if (event.key === "End" && visible.length) { event.preventDefault(); setActive(visible.length - 1); }
          if (event.key === "Enter" && visible[active]) { event.preventDefault(); commit(visible[active].key); }
        }} />
      <div id={`${id}-options`} className="clinical-searchable-options" role="listbox" aria-label={label}>
        {visible.length ? visible.map((option, index) => <button key={option.key} id={`${id}-option-${index}`}
          type="button" role="option" aria-selected={option.key === value} className={index === active ? "is-active" : ""}
          onMouseEnter={() => setActive(index)} onClick={() => commit(option.key)}>{option.label}</button>)
          : <div className="clinical-searchable-empty" role="status">{swedish ? "Inga matchande värden" : "No matching values"}</div>}
      </div>
    </div>, document.body)}
  </>;
}
