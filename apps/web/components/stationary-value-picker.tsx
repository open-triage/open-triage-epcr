"use client";

import React, { useId, type ReactNode } from "react";
import type { StationaryExceptionalChoice } from "../app/stationary-value-picker";

/** Shared accessible frame for datatype-specific stationary value editors. */
export function StationaryValuePicker({
  elementId,
  occurrenceId,
  label,
  help,
  stateLabel,
  stateKind,
  exceptionalChoices,
  exceptionalKey,
  findings = [],
  disabled = false,
  children,
  onExceptionalChange,
  onClear,
}: {
  readonly elementId: string;
  readonly occurrenceId?: string;
  readonly label: string;
  readonly help: string;
  readonly stateLabel: string;
  readonly stateKind: "unset" | "ordinary" | "exceptional";
  readonly exceptionalChoices: ReadonlyArray<StationaryExceptionalChoice>;
  readonly exceptionalKey: string;
  readonly findings?: ReadonlyArray<{ readonly message: string }>;
  readonly disabled?: boolean;
  readonly children: ReactNode;
  readonly onExceptionalChange: (key: string) => void;
  readonly onClear: () => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = `${helpId}${findings.length ? ` ${errorId}` : ""}`;
  return (
    <fieldset
      className="stationary-value-picker"
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={findings.length ? true : undefined}
      data-element-id={elementId}
      data-value-state={stateKind}
      {...(occurrenceId ? { "data-occurrence-id": occurrenceId } : {})}
    >
      <legend>{label} <small>{elementId}</small></legend>
      <small id={helpId}>{help}</small>
      <div className="stationary-value-picker-editor">{children}</div>
      <output className={`stationary-value-picker-state ${stateKind}`} aria-live="polite">
        <span>Current selection</span>
        <strong>{stateLabel}</strong>
      </output>
      {exceptionalChoices.length > 0 && <label className="stationary-value-picker-exceptional">
        <span>Exceptional value</span>
        <select value={exceptionalKey} onChange={(event) => onExceptionalChange(event.target.value)}>
          <option value="">No exceptional value</option>
          {exceptionalChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
        </select>
      </label>}
      <button type="button" className="stationary-value-picker-clear" disabled={disabled || stateKind === "unset"} onClick={onClear}>Clear selection</button>
      {findings.length > 0 && <small id={errorId} role="alert">{findings.map(({ message }) => message).join(" ")}</small>}
    </fieldset>
  );
}
