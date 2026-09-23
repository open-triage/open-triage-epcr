"use client";

import type { ScalarEncounterValue } from "@open-triage/contracts";
import React, { useId, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
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

export function StationaryScalarControl({ presentation, value, inputValue, defaultDateTime, findings = [], disabled = false, initialFocus = false, embedded = false, onInput, onBlur }: {
  readonly presentation: ScalarControlPresentation;
  readonly value?: ScalarEncounterValue;
  readonly inputValue?: string | boolean;
  readonly defaultDateTime?: string;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly embedded?: boolean;
  readonly onInput: (input: string | boolean) => void;
  readonly onBlur?: (input: string | boolean) => void;
}) {
  const id = useId();
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
  if (presentation.family === "datetime") {
    const candidate = inputValue ?? value?.value;
    // Server-render and first hydration use the source clock; after mount the
    // browser converts it to local time without a timezone hydration mismatch.
    const parts = localClockReady ? localStationaryDateTimeParts : sourceDateTimeParts;
    const selected = parts(String(candidate ?? ""));
    const initial = parts(defaultDateTime ?? "");
    const control = <>
      <TimePicker
        label={presentation.label}
        date={selected?.date}
        value={selected?.time ?? ""}
        initialDate={initial?.date}
        initialValue={initial?.time}
        invalid={findings.length > 0}
        describedBy={`${embedded ? "" : helpId}${findings.length ? ` ${errorId}` : ""}`.trim() || undefined}
        initialFocus={initialFocus}
        hideLabel
        onChange={() => undefined}
        onDateTimeChange={(date, time) => onInput(stationaryLocalDateTimeInput(date, time))}
      />
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
    value: String(inputValue ?? value?.lexical ?? value?.value ?? ""),
    minLength: presentation.minLength,
    maxLength: presentation.maxLength,
    pattern: presentation.pattern,
    disabled,
    "aria-invalid": findings.length ? true as const : undefined,
    "aria-describedby": `${embedded ? "" : helpId}${findings.length ? ` ${errorId}` : ""}`.trim() || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onInput(event.target.value),
    onBlur: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onBlur?.(event.target.value),
  };
  const control = <>
      {presentation.elementId === "eNarrative.01" ? <textarea {...commonTextProperties} rows={5} /> : <input
        autoFocus={initialFocus}
        aria-label={presentation.label}
        type={presentation.inputType}
        checked={presentation.family === "boolean" ? Boolean(inputValue ?? value?.value) : undefined}
        value={presentation.inputType === "file" || presentation.family === "boolean" ? undefined : String(inputValue ?? value?.lexical ?? value?.value ?? "")}
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
        onBlur={(event) => onBlur?.(presentation.family === "boolean" ? event.target.checked : event.target.value)}
      />}
      {findings.length > 0 && <small className="stationary-validation-message error" id={errorId} role="alert">{findings.map(({ message }) => message).join(" ")}</small>}
    </>;
  if (embedded) return <div className={`stationary-embedded-control${findings.length ? " stationary-validation-state error" : ""}`} data-occurrence-id={value?.occurrenceId}>{control}</div>;
  return <fieldset className={`stationary-field-control${findings.length ? " stationary-validation-state error" : ""}`} data-element-id={presentation.elementId} {...(value ? { "data-occurrence-id": value.occurrenceId } : {})} aria-describedby={helpId}>
    <StationaryPickerLegend label={presentation.label} tooltipId={helpId} tooltip={<>{presentation.elementId}: {presentation.help}</>} />
    {control}
  </fieldset>;
}
