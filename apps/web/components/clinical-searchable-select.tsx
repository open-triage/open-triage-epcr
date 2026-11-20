"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TriageColour } from "@open-triage/contracts";
import { resolveMessage } from "../app/localization";

export type ClinicalSelectOption = {
  readonly key: string;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly disabled?: boolean;
  readonly triageColour?: TriageColour;
};

type Placement = { readonly left: number; readonly top: number; readonly width: number; readonly maxHeight: number };

export function ClinicalSearchableSelect({ label, value, values, options, disabled = false, placeholder, onChange, onOpenChange }: {
  readonly label: string;
  readonly value?: string;
  readonly values?: ReadonlyArray<string>;
  readonly options: ReadonlyArray<ClinicalSelectOption>;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onChange: (key: string) => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const openingOffset = useRef<number | null>(null);
  const touchOpening = useRef(false);
  const [popupHost, setPopupHost] = useState<Element | null>(null);
  const open = popupHost !== null;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const visible = options.filter((option) => (option.accessibleLabel ?? option.label).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = options.find((option) => option.key === value);
  const selectedValues = values ? options.filter((option) => values.includes(option.key)) : [];
  const language = typeof document !== "undefined" ? document.documentElement.lang : "en";
  const emptyLabel = placeholder ?? resolveMessage(language, "clinicalSelect.chooseValue");

  const attachPopup = useCallback((node: HTMLDivElement | null) => {
    popup.current = node;
    if (!node) return;
    // Focus once per opening. Touch users can choose a row without summoning
    // the keyboard; tapping Search still opens it normally.
    (touchOpening.current ? node : search.current)?.focus({ preventScroll: true });
  }, []);

  const close = useCallback((restoreFocus = true) => {
    setPopupHost(null);
    onOpenChange?.(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, [onOpenChange]);

  function commit(key: string) {
    onChange(key);
    if (values) {
      setQuery("");
      setActive(0);
      if (!touchOpening.current) search.current?.focus({ preventScroll: true });
    } else close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
      const left = Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8));
      // Search is above the first result. When space permits, the first result
      // covers the pointer location after the opening click has finished.
      const preferred = openingOffset.current !== null ? rect.top + openingOffset.current - 48 - 24 : rect.top - 48;
      const bottom = viewportTop + viewportHeight - 8;
      const top = Math.max(viewportTop + 8, Math.min(preferred, bottom - 96));
      const next = { left, top, width, maxHeight: bottom - top };
      setPlacement(current => current && current.left === next.left && current.top === next.top && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
    }
    const onScroll = (event: Event) => {
      // Scrolling options cannot move the anchor or require a new placement.
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      position();
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, close]);

  useEffect(() => {
    if (!open || active < 0) return;
    const list = popup.current?.querySelector<HTMLElement>('[role="listbox"]');
    const option = popup.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-option-${active}`)}`);
    if (!list || !option) return;
    // scrollIntoView also scrolls outer containers, including the page. Only
    // the result list should move when navigating with the keyboard.
    const row = option.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [active, id, open, query]);

  return <>
    <button ref={trigger} type="button" className="clinical-searchable-trigger" disabled={disabled}
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
      onPointerDown={event => { touchOpening.current = event.pointerType === "touch"; }}
      onClick={(event) => {
        if (open) { close(); return; }
        touchOpening.current = event.detail > 0 && touchOpening.current;
        openingOffset.current = event.detail ? event.clientY - event.currentTarget.getBoundingClientRect().top : null;
        setActive(0);
        setQuery("");
        setPopupHost(event.currentTarget.closest('[aria-modal="true"]') ?? document.body);
        onOpenChange?.(true);
      }}>{values ? selectedValues.map((option) => option.label).join(", ") || emptyLabel : selected?.label ?? emptyLabel}</button>
    {popupHost && placement && createPortal(<div ref={attachPopup} className="clinical-searchable-popup" style={placement} tabIndex={-1} role="group" aria-label={label}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <input ref={search} type="search" role="combobox" aria-label={resolveMessage(language, "clinicalSelect.search", { label })} aria-autocomplete="list"
        placeholder={resolveMessage(language, "clinicalSelect.search", { label })}
        aria-expanded="true" aria-controls={`${id}-options`}
        aria-activedescendant={visible[active] ? `${id}-option-${active}` : undefined}
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && visible.length) { event.preventDefault(); setActive((index) => Math.min(index + 1, visible.length - 1)); }
          if (event.key === "ArrowUp" && visible.length) { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Home" && visible.length) { event.preventDefault(); setActive(0); }
          if (event.key === "End" && visible.length) { event.preventDefault(); setActive(visible.length - 1); }
          if (event.key === "Enter" && visible[active]) { event.preventDefault(); if (!visible[active].disabled) commit(visible[active].key); }
        }} />
      <div id={`${id}-options`} className="clinical-searchable-options" role="listbox" aria-label={label} aria-multiselectable={values ? true : undefined}>
        {visible.length ? visible.map((option, index) => <button key={option.key} id={`${id}-option-${index}`}
          type="button" role="option" disabled={option.disabled} data-west-colour={option.triageColour} aria-selected={values ? values.includes(option.key) : option.key === value}
          aria-label={option.accessibleLabel}
          className={`${index === active ? "is-active " : ""}${values?.includes(option.key) ? "is-selected" : ""}`.trim()}
          onMouseEnter={() => setActive(index)} onClick={() => commit(option.key)}>{option.label}</button>)
          : <div className="clinical-searchable-empty" role="status">{resolveMessage(language, "clinicalSelect.noMatches")}</div>}
      </div>
    </div>, popupHost)}
  </>;
}
