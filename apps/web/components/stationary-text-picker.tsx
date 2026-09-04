"use client";

import type { EncounterValue } from "@open-triage/contracts";
import React, { useId } from "react";
import type { NemsisDataElement } from "../app/nemsis-data-model";
import type { ScalarControlPresentation, ScalarValidationFinding, StationaryScalarSelection } from "../app/stationary-scalar";
import {
  stationaryExceptionalChoices,
  stationaryExceptionalKey,
  stationaryExceptionalSelection,
} from "../app/stationary-value-picker";
import { StationaryValuePicker } from "./stationary-value-picker";

function stateLabel(value: EncounterValue | undefined): string {
  if (!value) return "No selection";
  if (value.kind === "scalar") return String(value.lexical ?? value.value);
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  return "No selection";
}

/** Text editor hosted by the common value-picker shell. */
export function StationaryTextPicker({ presentation, catalog, value, inputValue, findings = [], disabled = false, initialFocus = false, onChange }: {
  readonly presentation: ScalarControlPresentation;
  readonly catalog: NemsisDataElement;
  readonly value?: EncounterValue;
  readonly inputValue?: string;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onChange: (selection: StationaryScalarSelection | undefined) => void;
}) {
  const id = useId();
  const scalar = value?.kind === "scalar" ? value : undefined;
  const exceptionalKey = stationaryExceptionalKey(value);
  const stateKind = scalar ? "ordinary" : exceptionalKey ? "exceptional" : "unset";
  const currentInput = inputValue ?? String(scalar?.lexical ?? scalar?.value ?? "");
  const editorProps = {
    id: `${id}-text`,
    "aria-label": `${presentation.label} ${presentation.elementId}`,
    autoFocus: initialFocus,
    value: currentInput,
    minLength: presentation.minLength,
    maxLength: presentation.maxLength,
    pattern: presentation.pattern,
    "aria-invalid": findings.length ? true : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value ? { kind: "scalar", input: event.target.value } : undefined),
  };
  const multiline = presentation.maxLength !== undefined && presentation.maxLength > 500;
  return <StationaryValuePicker
    elementId={presentation.elementId}
    occurrenceId={value?.occurrenceId}
    label={presentation.label}
    help={presentation.help}
    stateLabel={inputValue !== undefined ? inputValue || "No selection" : stateLabel(value)}
    stateKind={inputValue !== undefined ? inputValue ? "ordinary" : "unset" : stateKind}
    exceptionalChoices={stationaryExceptionalChoices(catalog)}
    exceptionalKey={inputValue !== undefined ? "" : exceptionalKey}
    findings={findings}
    disabled={disabled}
    onExceptionalChange={(key) => onChange(stationaryExceptionalSelection(catalog, key))}
    onClear={() => onChange(undefined)}
  >
    <label htmlFor={`${id}-text`}>
      <span>{multiline ? "Text" : "Value"}</span>
      {multiline ? <textarea {...editorProps} /> : <input {...editorProps} type="text" inputMode={presentation.inputMode} />}
    </label>
  </StationaryValuePicker>;
}
