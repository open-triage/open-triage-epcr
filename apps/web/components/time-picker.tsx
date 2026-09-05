"use client";

import React, { useEffect, useRef, useState } from "react";
import { adjustClinicalDate, adjustClockPart, formatClinicalDate, formatClinicalTime, localClinicalDate, parseClinicalTime, repeatDelay } from "../app/time-picker";

type ClockPart = "hours" | "minutes";

type Props = {
  readonly label: React.ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly date?: string;
  readonly initialValue?: string;
  readonly initialDate?: string;
  readonly onDateChange?: (value: string) => void;
  readonly onDateTimeChange?: (date: string, time: string) => void;
  readonly describedBy?: string;
  readonly invalid?: boolean;
  readonly initialFocus?: boolean;
  readonly className?: string;
  readonly hideLabel?: boolean;
};

export function TimePicker({ label, value, onChange, date = "", initialValue, initialDate, onDateChange, onDateTimeChange, describedBy, invalid, initialFocus, className, hideLabel = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseClinicalTime(value || initialValue || ""));
  const [draftDate, setDraftDate] = useState(date || initialDate || localClinicalDate());
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => popover.current?.querySelector<HTMLElement>("[role='spinbutton']")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function showPicker() {
    setDraft(parseClinicalTime(value || initialValue || ""));
    setDraftDate(date || initialDate || localClinicalDate());
    setOpen(true);
  }

  function change(part: ClockPart, delta: number) {
    setDraft((current) => ({
      ...current,
      [part]: adjustClockPart(current[part], delta, part === "hours" ? 24 : 60),
    }));
  }

  return (
    <div className={`time-picker-field ${className ?? ""}`.trim()}>
      {!hideLabel && <span className="time-picker-label">{label}</span>}
      <button
        type="button"
        className="time-picker-trigger"
        aria-label={typeof label === "string" ? value && date ? `${label}: ${formatClinicalDate(date)} at ${value}. Change` : `${label}: not recorded. Set date and time` : undefined}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        data-invalid={invalid || undefined}
        data-dialog-initial-focus={initialFocus ? "" : undefined}
        onClick={showPicker}
      >
        <span aria-hidden="true">◷</span>
        <strong>{value && date ? `${formatClinicalDate(date)} · ${value}` : "Not recorded"}</strong>
        <span>{value && date ? "Change" : "Set"}</span>
      </button>
      {open && (
        <div
          ref={popover}
          className="time-picker-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Select clinical time"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <div className="time-picker-heading">
            <strong>Select time</strong>
            <span>Drag up or down · hold to speed up</span>
          </div>
          <div className="time-wheels" aria-label={`Selected time ${formatClinicalTime(draft.hours, draft.minutes)}`}>
            <DateWheel value={draftDate} onChange={(delta) => setDraftDate((current) => adjustClinicalDate(current, delta))} />
            <TimeWheel label="Hour" value={draft.hours} limit={24} onChange={(delta) => change("hours", delta)} />
            <span className="time-separator" aria-hidden="true">:</span>
            <TimeWheel label="Minute" value={draft.minutes} limit={60} onChange={(delta) => change("minutes", delta)} />
          </div>
          <output className="time-picker-output" aria-live="polite">{formatClinicalDate(draftDate)} · {formatClinicalTime(draft.hours, draft.minutes)}</output>
          <div className="time-picker-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" onClick={() => {
              const time = formatClinicalTime(draft.hours, draft.minutes);
              if (onDateTimeChange) onDateTimeChange(draftDate, time);
              else { onDateChange?.(draftDate); onChange(time); }
              setOpen(false);
            }}>Use date &amp; time</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateWheel({ value, onChange }: { readonly value: string; readonly onChange: (delta: number) => void }) {
  const drag = useAcceleratingDrag(onChange);
  return (
    <div className="time-wheel-group date-wheel-group">
      <span>Date</span>
      <button type="button" aria-label="Next date" onClick={() => onChange(1)}>▲</button>
      <div
        className="time-wheel date-wheel"
        role="spinbutton"
        tabIndex={0}
        aria-label="Date"
        aria-valuetext={value}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); onChange(1); }
          if (event.key === "ArrowDown") { event.preventDefault(); onChange(-1); }
        }}
        onWheel={(event) => { event.preventDefault(); onChange(event.deltaY < 0 ? 1 : -1); }}
        {...drag}
      >
        <small>{formatClinicalDate(adjustClinicalDate(value, 1))}</small>
        <strong>{formatClinicalDate(value)}</strong>
        <small>{formatClinicalDate(adjustClinicalDate(value, -1))}</small>
      </div>
      <button type="button" aria-label="Previous date" onClick={() => onChange(-1)}>▼</button>
    </div>
  );
}

function TimeWheel({ label, value, limit, onChange }: { readonly label: string; readonly value: number; readonly limit: number; readonly onChange: (delta: number) => void }) {
  const drag = useAcceleratingDrag(onChange);
  return (
    <div className="time-wheel-group">
      <span>{label}</span>
      <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(1)}>▲</button>
      <div
        className="time-wheel"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit - 1}
        aria-valuenow={value}
        aria-valuetext={String(value).padStart(2, "0")}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); onChange(1); }
          if (event.key === "ArrowDown") { event.preventDefault(); onChange(-1); }
          if (event.key === "PageUp") { event.preventDefault(); onChange(5); }
          if (event.key === "PageDown") { event.preventDefault(); onChange(-5); }
        }}
        onWheel={(event) => { event.preventDefault(); onChange(event.deltaY < 0 ? 1 : -1); }}
        {...drag}
      >
        <small>{String(adjustClockPart(value, 1, limit)).padStart(2, "0")}</small>
        <strong>{String(value).padStart(2, "0")}</strong>
        <small>{String(adjustClockPart(value, -1, limit)).padStart(2, "0")}</small>
      </div>
      <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(-1)}>▼</button>
    </div>
  );
}

function useAcceleratingDrag(onChange: (delta: number) => void) {
  const gesture = useRef<{ pointerId: number; startY: number; direction: number; startedAt: number; timer: number | null } | null>(null);

  function stop() {
    if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
  }

  useEffect(() => stop, []);

  function repeat() {
    const active = gesture.current;
    if (!active || active.direction === 0) return;
    onChange(active.direction);
    active.timer = window.setTimeout(repeat, repeatDelay(performance.now() - active.startedAt));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const distance = event.clientY - active.startY;
    const direction = Math.abs(distance) < 12 ? 0 : distance < 0 ? 1 : -1;
    if (direction === active.direction) return;
    if (active.timer) window.clearTimeout(active.timer);
    active.direction = direction;
    active.startedAt = performance.now();
    if (direction) {
      onChange(direction);
      active.timer = window.setTimeout(repeat, repeatDelay(0));
    }
  }

  return {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, startY: event.clientY, direction: 0, startedAt: performance.now(), timer: null };
    },
    onPointerMove,
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
