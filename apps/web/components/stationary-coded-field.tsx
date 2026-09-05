"use client";

import React, { useId, useState } from "react";
import type { EncounterValue } from "@open-triage/contracts";
import {
  codedSelectionFromOption,
  exceptionalSelection,
  repeatableExceptionalChoices,
  type StationaryCodedField,
  type StationaryCodedSelection,
} from "../app/stationary-coded-value";
import { StationaryPickerLegend } from "./stationary-picker-label";

function currentExceptionalKey(value: EncounterValue | undefined): string {
  if (value?.kind === "null") return value.notValue ? `not-value:${value.notValue.code}` : "null";
  return value?.kind === "pertinent-negative" ? `pertinent-negative:${value.code}` : "";
}

function CodedPickerControl({ field, value, disabled, exceptionalChoices = field.exceptionalChoices, onChange }: {
  readonly field: StationaryCodedField;
  readonly value?: EncounterValue;
  readonly disabled: boolean;
  readonly exceptionalChoices?: StationaryCodedField["exceptionalChoices"];
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const coded = value?.kind === "coded" ? value : undefined;
  const [exceptionalOpen, setExceptionalOpen] = useState(false);
  const exceptionalKey = currentExceptionalKey(value);
  const exceptionalLabel = field.exceptionalChoices.find(({ key }) => key === exceptionalKey)?.label;

  return <div className="stationary-coded-picker-row" data-occurrence-id={value?.occurrenceId}>
    <div className="stationary-coded-main-control">
      <select aria-label={field.label} value={coded?.code ?? ""} disabled={disabled} onChange={(event) => {
        const option = field.options.find(({ code }) => code === event.target.value);
        onChange(option ? codedSelectionFromOption(option) : undefined);
      }}>
        <option value="">{coded ? "Delete" : exceptionalLabel ?? "Choose a value"}</option>
        {field.options.map((option) => <option key={`${option.system ?? ""}:${option.code}`} value={option.code}>{option.label}</option>)}
      </select>
    </div>
    {field.exceptionalChoices.length > 0 && <div className="stationary-exceptional-picker">
      <button
        className={`null-value-trigger ${exceptionalKey ? "active" : ""}`}
        type="button"
        aria-label={`Set unavailable or pertinent-negative value for ${field.label}`}
        aria-expanded={exceptionalOpen}
        disabled={disabled}
        onClick={() => setExceptionalOpen((open) => !open)}
      >×</button>
      {exceptionalOpen && <div className="null-value-menu" role="menu" aria-label={`${field.label} unavailable or pertinent-negative values`}>
        {exceptionalChoices.map((choice) => <button key={choice.key} type="button" role="menuitem" onClick={() => {
          onChange(exceptionalSelection(field, choice.key));
          setExceptionalOpen(false);
        }}>{choice.label}</button>)}
        {exceptionalKey && <button type="button" role="menuitem" onClick={() => { onChange(undefined); setExceptionalOpen(false); }}>Clear exceptional value</button>}
      </div>}
    </div>}
  </div>;
}

/** Catalog-driven coded picker. Codes stay canonical while people choose labels. */
export function StationaryCodedValueField({ field, value, disabled = false, onChange }: {
  readonly field: StationaryCodedField;
  readonly value?: EncounterValue;
  readonly disabled?: boolean;
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const id = useId();
  return <fieldset className="stationary-field-control stationary-coded-field" aria-describedby={`${id}-help`} data-element-id={field.elementId} {...(value ? { "data-occurrence-id": value.occurrenceId } : {})}>
    <StationaryPickerLegend label={field.label} tooltipId={`${id}-help`} tooltip={<>{field.elementId}: {field.help}</>} />
    <CodedPickerControl field={field} value={value} disabled={disabled} onChange={onChange} />
  </fieldset>;
}

/** One through-border picker that owns every occurrence of a repeatable coded element. */
export function StationaryCodedOccurrencesField({ field, values, disabled = false, onChange }: {
  readonly field: StationaryCodedField;
  readonly values: ReadonlyArray<EncounterValue>;
  readonly disabled?: boolean;
  readonly onChange: (value: EncounterValue | undefined, selection: StationaryCodedSelection | undefined) => void;
}) {
  const id = useId();
  return <fieldset className="stationary-field-control stationary-coded-field stationary-multiple-picker" aria-describedby={`${id}-help`} data-element-id={field.elementId}>
    <StationaryPickerLegend label={field.label} tooltipId={`${id}-help`} tooltip={<>{field.elementId}: {field.help}</>} />
    {values.map((value) => <CodedPickerControl key={value.occurrenceId} field={field} value={value} disabled={disabled}
      exceptionalChoices={repeatableExceptionalChoices(field, values, value)}
      onChange={(selection) => onChange(value, selection)} />)}
    <CodedPickerControl key={`new-${values.length}`} field={field} disabled={disabled} exceptionalChoices={repeatableExceptionalChoices(field, values)} onChange={(selection) => {
      if (selection) onChange(undefined, selection);
    }} />
  </fieldset>;
}
