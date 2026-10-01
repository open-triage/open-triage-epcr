"use client";

import type { EncounterValue, ScalarEncounterValue } from "@open-triage/contracts";
import React, { useId, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import { useAgencyTimeZone } from "../app/agency-time-zone";
import { canonicalDecimal, displayDecimal, useRegionalFormat } from "../app/regional-format";
import { localStationaryDateTimeParts, stationaryLocalDateTimeInput } from "../app/stationary-date-time";
import type { ScalarControlPresentation, ScalarValidationFinding } from "../app/stationary-scalar";
import { StationaryPickerLegend } from "./stationary-picker-label";
import { TimePicker } from "./time-picker";

function sourceDateTimeParts(value: string): { date: string; time: string; offset: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (match) return { date: match[1]!, time: match[2]!, offset: match[3] ?? "" };
  return undefined;
}

const subscribeToClientClock = () => () => undefined;
const clientClockReady = () => true;
const serverClockReady = () => false;

export function StationaryScalarControl({ presentation, value, exceptionalValue, exceptionalChoices = [], inputValue, defaultDateTime, findings = [], disabled = false, initialFocus = false, embedded = false, onInput, onBlur, onExceptionalChange }: {
  readonly presentation: ScalarControlPresentation;
  readonly value?: ScalarEncounterValue;
  readonly exceptionalValue?: Extract<EncounterValue, { kind: "null" }>;
  readonly exceptionalChoices?: ReadonlyArray<{ readonly code: string; readonly label: string }>;
  readonly inputValue?: string | boolean;
  readonly defaultDateTime?: string;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly embedded?: boolean;
  readonly onInput: (input: string | boolean) => void;
  readonly onBlur?: (input: string | boolean) => void;
  readonly onExceptionalChange?: (code: string | undefined) => void;
}) {
  const id = useId();
  const region = useRegionalFormat();
  const zone = useAgencyTimeZone();
  const [exceptionalOpen, setExceptionalOpen] = useState(false);
  const shownValue = inputValue ?? (presentation.family === "numeric"
    ? displayDecimal(String(value?.lexical ?? value?.value ?? ""), region) : value?.lexical ?? value?.value ?? "");
  const commit = (input: string | boolean) => onBlur?.(presentation.family === "numeric" && typeof input === "string"
    ? canonicalDecimal(input) ?? input : input);
  const localClockReady = useSyncExternalStore(subscribeToClientClock, clientClockReady, serverClockReady);
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const readBinary = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => onInput(String(reader.result).split(",", 2)[1] ?? ""));
    reader.readAsDataURL(file);
  };
  const exceptionalControl = exceptionalChoices.length && onExceptionalChange ? <div className="stationary-exceptional-picker">
    <button className={`null-value-trigger${exceptionalValue ? " active" : ""}`} type="button"
      aria-label={`Set unavailable value for ${presentation.label}`} aria-expanded={exceptionalOpen}
      disabled={disabled} onClick={() => setExceptionalOpen((open) => !open)}>×</button>
    {exceptionalOpen && <div className="null-value-menu" role="menu" aria-label={`${presentation.label} unavailable values`}>
      {exceptionalChoices.map(({ code, label }) => <button type="button" role="menuitem" key={code} onClick={() => {
        onExceptionalChange(code); setExceptionalOpen(false);
      }}>{label}</button>)}
      {exceptionalValue && <button type="button" role="menuitem" onClick={() => {
        onExceptionalChange(undefined); setExceptionalOpen(false);
      }}>Clear unavailable value</button>}
    </div>}
  </div> : exceptionalValue ? <output>{exceptionalValue.notValue?.display ?? exceptionalValue.notValue?.code}</output> : null;
  if (presentation.family === "datetime") {
    const candidate = inputValue ?? value?.value;
    // Server-render and first hydration use the source clock; after mount the
    // browser converts it to local time without a timezone hydration mismatch.
    const parts = localClockReady ? (input: string) => localStationaryDateTimeParts(input, zone) : sourceDateTimeParts;
    const selected = parts(String(candidate ?? ""));
    const initial = parts(defaultDateTime ?? "");
    const control = <>
      <div className="stationary-scalar-value-row"><TimePicker
        label={presentation.label}
        date={selected?.date}
        value={selected?.time ?? ""}
        initialDate={initial?.date}
        initialValue={initial?.time}
        selectedInstant={typeof candidate === "string" && !Number.isNaN(Date.parse(candidate)) ? new Date(candidate).toISOString() : undefined}
        invalid={findings.length > 0}
        describedBy={`${embedded ? "" : helpId}${findings.length ? ` ${errorId}` : ""}`.trim() || undefined}
        initialFocus={initialFocus}
        hideLabel
        onChange={() => undefined}
        onDateTimeChange={(date, time, selectedInstant) => {
          if (selected && selected.date === date && selected.time === time) return;
          onInput(stationaryLocalDateTimeInput(date, time, zone, selectedInstant));
        }}
      />
      {exceptionalControl}</div>
      {findings.length > 0 && <small className="stationary-validation-message error" id={errorId} role="alert">{findings.map(({ message }) => message).join(" ")}</small>}
    </>;
    if (embedded) return <div className={`stationary-embedded-control stationary-datetime-control${findings.length ? " stationary-validation-state error" : ""}`} data-occurrence-id={value?.occurrenceId}>{control}</div>;
    return <fieldset className={`stationary-field-control stationary-datetime-control${findings.length ? " stationary-validation-state error" : ""}`} data-element-id={presentation.elementId} {...(value ? { "data-occurrence-id": value.occurrenceId } : {})} aria-describedby={helpId}>
      <StationaryPickerLegend label={presentation.label} tooltipId={helpId} tooltip={<>{presentation.elementId}: {presentation.help}</>} />
      {control}
    </fieldset>;
  }
  const commonTextProperties = {
    autoFocus: initialFocus,
    "aria-label": presentation.label,
    value: String(shownValue),
    minLength: presentation.minLength,
    maxLength: presentation.maxLength,
    pattern: presentation.pattern,
    disabled,
    "aria-invalid": findings.length ? true as const : undefined,
    "aria-describedby": `${embedded ? "" : helpId}${findings.length ? ` ${errorId}` : ""}`.trim() || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onInput(event.target.value),
    onBlur: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(event.target.value),
  };
  const control = <>
      <div className="stationary-scalar-value-row">{presentation.elementId === "eNarrative.01" ? <textarea {...commonTextProperties} rows={5} /> : <input
        autoFocus={initialFocus}
        aria-label={presentation.label}
        type={presentation.inputType}
        checked={presentation.family === "boolean" ? Boolean(inputValue ?? value?.value) : undefined}
        value={presentation.inputType === "file" || presentation.family === "boolean" ? undefined : String(shownValue)}
        inputMode={presentation.inputMode}
        min={presentation.min}
        max={presentation.max}
        minLength={presentation.minLength}
        maxLength={presentation.maxLength}
        pattern={presentation.pattern}
        step={presentation.step}
        disabled={disabled}
        aria-invalid={findings.length ? true : undefined}
        aria-describedby={`${embedded ? "" : helpId}${findings.length ? ` ${errorId}` : ""}`.trim() || undefined}
        onChange={(event) => presentation.family === "binary" ? readBinary(event)
          : onInput(presentation.family === "boolean" ? event.target.checked : event.target.value)}
        onBlur={(event) => commit(presentation.family === "boolean" ? event.target.checked : event.target.value)}
      />}
      {exceptionalControl}</div>
      {findings.length > 0 && <small className="stationary-validation-message error" id={errorId} role="alert">{findings.map(({ message }) => message).join(" ")}</small>}
    </>;
  if (embedded) return <div className={`stationary-embedded-control${findings.length ? " stationary-validation-state error" : ""}`} data-occurrence-id={value?.occurrenceId}>{control}</div>;
  return <fieldset className={`stationary-field-control${findings.length ? " stationary-validation-state error" : ""}`} data-element-id={presentation.elementId} {...(value ? { "data-occurrence-id": value.occurrenceId } : {})} aria-describedby={helpId}>
    <StationaryPickerLegend label={presentation.label} tooltipId={helpId} tooltip={<>{presentation.elementId}: {presentation.help}</>} />
    {control}
  </fieldset>;
}
