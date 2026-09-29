"use client";

import { useEffect, useId, useRef, useState } from "react";
import { availableUiLanguages, languageDisplayName, resolveMessage } from "../app/localization";

export function LanguageSelector({ language, onChange }: {
  readonly language: string;
  readonly onChange: (language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const label = resolveMessage(language, "navigation.language");
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return <div ref={root} className="session-language-selector" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.preventDefault(); setOpen(false); trigger.current?.focus();
    }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }}>
    <button ref={trigger} className="language-trigger" type="button" title={label} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}>
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="19" cy="13" r="11" />
            <ellipse cx="19" cy="13" rx="6" ry="11" />
            <path d="M19 2v22M8 13h22M10 7c5 4 13 4 18 0" />
            <path d="M6 17h11a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H9l-6 1 1-4a4 4 0 0 1-2-3v-3a4 4 0 0 1 4-4Z" fill="var(--green)" />
            <path d="M7 22h9M7 26h7" />
          </svg>
    </button>
    {open && <div id={menuId} className="language-menu" role="menu" aria-label={label}>
      {availableUiLanguages.map((code) => <button key={code} type="button" role="menuitemradio"
        aria-checked={language === code} tabIndex={-1} onClick={() => {
          onChange(code); setOpen(false); trigger.current?.focus();
        }}>
        <span>{languageDisplayName(code, code)}</span><span aria-hidden="true">{language === code ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
