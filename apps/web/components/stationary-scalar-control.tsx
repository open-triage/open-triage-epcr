"use client";

import type { ScalarEncounterValue } from "@open-triage/contracts";
import type { ChangeEvent } from "react";
import type { ScalarControlPresentation, ScalarValidationFinding } from "../app/stationary-scalar";

export function StationaryScalarControl({ presentation, value, inputValue, findings = [], onInput }: {
  readonly presentation: ScalarControlPresentation;
  readonly value?: ScalarEncounterValue;
  readonly inputValue?: string | boolean;
  readonly findings?: ReadonlyArray<ScalarValidationFinding>;
  readonly onInput: (input: string | boolean) => void;
}) {
  const errorId = `${presentation.elementId}-${value?.occurrenceId ?? "new"}-error`;
  const helpId = `${presentation.elementId}-help`;
  const readBinary = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => onInput(String(reader.result).split(",", 2)[1] ?? ""));
    reader.readAsDataURL(file);
  };
  return (
    <label>
      <span>{presentation.label} <small>{presentation.elementId}</small></span>
      <input
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
        aria-invalid={findings.length ? true : undefined}
        aria-describedby={`${helpId}${findings.length ? ` ${errorId}` : ""}`}
        onChange={(event) => presentation.family === "binary" ? readBinary(event)
          : onInput(presentation.family === "boolean" ? event.target.checked : event.target.value)}
      />
      <small id={helpId}>{presentation.help}</small>
      {findings.length > 0 && <small id={errorId} role="alert">{findings.map(({ message }) => message).join(" ")}</small>}
    </label>
  );
}
