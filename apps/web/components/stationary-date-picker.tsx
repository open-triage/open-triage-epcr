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

/** Date editor hosted by the common value-picker shell. */
export function StationaryDatePicker({ presentation, catalog, value, findings = [], disabled = false, initialFocus = false, onChange }: {
  readonly presentation: ScalarControlPresentation;
  readonly catalog: NemsisDataElement;
  readonly value?: EncounterValue;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onChange: (selection: StationaryScalarSelection | undefined) => void;
}) {
  const id = useId();
  const scalar = value?.kind === "scalar" ? value : undefined;
  const exceptionalKey = stationaryExceptionalKey(value);
  const stateKind = scalar ? "ordinary" : exceptionalKey ? "exceptional" : "unset";
  return <StationaryValuePicker
    elementId={presentation.elementId}
    occurrenceId={value?.occurrenceId}
    label={presentation.label}
    help={presentation.help}
    stateLabel={stateLabel(value)}
    stateKind={stateKind}
    exceptionalChoices={stationaryExceptionalChoices(catalog)}
    exceptionalKey={exceptionalKey}
    findings={findings}
    disabled={disabled}
    onExceptionalChange={(key) => onChange(stationaryExceptionalSelection(catalog, key))}
    onClear={() => onChange(undefined)}
  >
    <label htmlFor={`${id}-date`}>
      <span>Date</span>
      <input
        id={`${id}-date`}
        autoFocus={initialFocus}
        type="date"
        value={String(scalar?.lexical ?? scalar?.value ?? "")}
        min={presentation.min}
        max={presentation.max}
        aria-invalid={findings.length ? true : undefined}
        onChange={(event) => onChange(event.target.value ? { kind: "scalar", input: event.target.value } : undefined)}
      />
    </label>
  </StationaryValuePicker>;
}
