"use client";

import type { EncounterValue } from "@open-triage/contracts";
import React, { useId, useState } from "react";
import type { NemsisDataElement } from "../app/nemsis-data-model";
import type { ScalarControlPresentation, ScalarValidationFinding, StationaryScalarSelection } from "../app/stationary-scalar";
import {
  stationaryExceptionalChoices,
  stationaryExceptionalKey,
  stationaryExceptionalSelection,
} from "../app/stationary-value-picker";
import { StationaryValuePicker } from "./stationary-value-picker";

function ordinaryText(value: EncounterValue | undefined): string {
  return value?.kind === "scalar" ? String(value.lexical ?? value.value) : "";
}

function stateLabel(value: EncounterValue | undefined): string {
  if (!value) return "No selection";
  if (value.kind === "scalar") return ordinaryText(value);
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  return "No selection";
}

/** Integer and decimal editor hosted by the common value-picker shell. */
export function StationaryNumericPicker({ presentation, catalog, value, findings = [], disabled = false, initialFocus = false, onChange }: {
  readonly presentation: ScalarControlPresentation;
  readonly catalog: NemsisDataElement;
  readonly value?: EncounterValue;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onChange: (selection: StationaryScalarSelection | undefined) => void;
}) {
  const id = useId();
  const canonicalInput = ordinaryText(value);
  const [draft, setDraft] = useState<{ readonly base: string; readonly input: string }>();
  const input = draft?.base === canonicalInput ? draft.input : canonicalInput;
  const exceptionalKey = stationaryExceptionalKey(value);
  const stateKind = value?.kind === "scalar" ? "ordinary" : exceptionalKey ? "exceptional" : "unset";
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
    onExceptionalChange={(key) => { setDraft(undefined); onChange(stationaryExceptionalSelection(catalog, key)); }}
    onClear={() => { setDraft(undefined); onChange(undefined); }}
  >
    <label htmlFor={`${id}-number`}>
      <span>{presentation.family === "integer" ? "Whole number" : "Decimal number"}</span>
      <input
        id={`${id}-number`}
        autoFocus={initialFocus}
        type="number"
        inputMode={presentation.inputMode}
        value={input}
        min={presentation.min}
        max={presentation.max}
        step={presentation.step}
        required={catalog.occurrence.min > 0}
        aria-invalid={findings.length ? true : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setDraft({ base: canonicalInput, input: next });
          onChange(next === "" ? undefined : { kind: "scalar", input: next });
        }}
      />
    </label>
  </StationaryValuePicker>;
}
