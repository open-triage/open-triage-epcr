"use client";

import type { EncounterValue } from "@open-triage/contracts";
import React from "react";
import { clinicalDateTimeParts, composeClinicalDateTime } from "../app/time-picker";
import type { NemsisDataElement } from "../app/nemsis-data-model";
import type { ScalarControlPresentation, ScalarValidationFinding, StationaryScalarSelection } from "../app/stationary-scalar";
import { stationaryExceptionalChoices, stationaryExceptionalKey, stationaryExceptionalSelection } from "../app/stationary-value-picker";
import { StationaryValuePicker } from "./stationary-value-picker";
import { TimePicker } from "./time-picker";

function valueText(value: EncounterValue | undefined): string {
  if (!value) return "No selection";
  if (value.kind === "scalar") return String(value.lexical ?? value.value);
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  return "No selection";
}

/** Offset-aware clinical date/time editor hosted by the shared stationary picker shell. */
export function StationaryDateTimePicker({ presentation, catalog, value, findings = [], disabled = false, initialFocus = false, onChange }: {
  readonly presentation: ScalarControlPresentation;
  readonly catalog: NemsisDataElement;
  readonly value?: EncounterValue;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onChange: (selection: StationaryScalarSelection | undefined) => void;
}) {
  const scalarText = value?.kind === "scalar" ? String(value.lexical ?? value.value) : "";
  const parts = clinicalDateTimeParts(scalarText);
  const exceptionalKey = stationaryExceptionalKey(value);
  const stateKind = scalarText ? "ordinary" : exceptionalKey ? "exceptional" : "unset";
  return <StationaryValuePicker
    elementId={presentation.elementId}
    occurrenceId={value?.occurrenceId}
    label={presentation.label}
    help={presentation.help}
    stateLabel={valueText(value)}
    stateKind={stateKind}
    exceptionalChoices={stationaryExceptionalChoices(catalog)}
    exceptionalKey={exceptionalKey}
    findings={findings}
    disabled={disabled}
    onExceptionalChange={(key) => onChange(stationaryExceptionalSelection(catalog, key))}
    onClear={() => onChange(undefined)}
  >
    <TimePicker
      label="Date and time"
      date={parts.date}
      value={parts.time}
      minDate={presentation.min?.slice(0, 10)}
      maxDate={presentation.max?.slice(0, 10)}
      invalid={findings.length > 0}
      initialFocus={initialFocus}
      onChange={() => undefined}
      onDateTimeChange={(date, time) => onChange({ kind: "scalar", input: composeClinicalDateTime(date, time, scalarText) })}
    />
  </StationaryValuePicker>;
}
