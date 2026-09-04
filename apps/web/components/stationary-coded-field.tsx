"use client";

import React, { useId, useState } from "react";
import type { EncounterValue } from "@open-triage/contracts";
import {
  codedSelectionFromOption,
  exceptionalSelection,
  type StationaryCodedField,
  type StationaryCodedSelection,
} from "../app/stationary-coded-value";

function currentExceptionalKey(value: EncounterValue | undefined): string {
  if (value?.kind === "null") return value.notValue ? `not-value:${value.notValue.code}` : "null";
  return value?.kind === "pertinent-negative" ? `pertinent-negative:${value.code}` : "";
}

function TerminologySearch({ id, field, coded, onChange }: {
  readonly id: string;
  readonly field: StationaryCodedField;
  readonly coded?: Extract<EncounterValue, { kind: "coded" }>;
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const [code, setCode] = useState(coded?.code ?? "");
  const [display, setDisplay] = useState(coded?.display ?? "");
  const [system, setSystem] = useState(coded?.system ?? field.systems[0]?.id ?? "");
  const selectOption = (selectedCode: string) => {
    const option = field.options.find((candidate) => candidate.code === selectedCode);
    if (!option) return setCode(selectedCode);
    setCode(option.code);
    setDisplay(option.label);
    if (option.system) setSystem(option.system);
    onChange(codedSelectionFromOption(option));
  };
  const commit = () => {
    if (!code.trim()) return onChange(undefined);
    const option = field.options.find((candidate) => candidate.code === code);
    onChange(option ? codedSelectionFromOption(option) : {
      kind: "coded", code: code.trim(), ...(display.trim() ? { display: display.trim() } : {}), ...(system ? { system } : {}),
    });
  };
  return (
    <div className="stationary-terminology-search" role="group" aria-label={`${field.label} terminology search`}>
      <label>
        <span>Search or enter code</span>
        <input type="search" list={`${id}-options`} value={code} aria-autocomplete="list" onChange={(event) => selectOption(event.target.value)} />
        <datalist id={`${id}-options`}>
          {field.options.map((option) => <option key={`${option.system ?? ""}:${option.code}`} value={option.code}>{option.label}</option>)}
        </datalist>
      </label>
      {field.controlKind === "external-search" && (
        <label>
          <span>Code system</span>
          <select value={system} onChange={(event) => setSystem(event.target.value)} required>
            {field.systems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
      )}
      <label>
        <span>Display</span>
        <input type="text" value={display} onChange={(event) => setDisplay(event.target.value)} />
      </label>
      <button type="button" onClick={commit}>Apply coded value</button>
      {field.options.length > 0 && <small>Suggestions are not exhaustive; another valid terminology code may be entered.</small>}
    </div>
  );
}

/** Accessible catalog-driven editor shared by inline, bundled, and external coded fields. */
export function StationaryCodedValueField({ field, value, onChange }: {
  readonly field: StationaryCodedField;
  readonly value?: EncounterValue;
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const id = useId();
  const coded = value?.kind === "coded" ? value : undefined;

  return (
    <fieldset className="stationary-coded-field" aria-describedby={`${id}-help`}>
      <legend>{field.label} <small>{field.elementId}</small></legend>
      <small id={`${id}-help`}>{field.help}</small>
      {field.controlKind === "select" ? (
        <label>
          <span>Value</span>
          <select value={coded?.code ?? ""} onChange={(event) => {
            const option = field.options.find(({ code }) => code === event.target.value);
            onChange(option ? codedSelectionFromOption(option) : undefined);
          }}>
            <option value="">Choose a value</option>
            {field.options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
      ) : (
        <TerminologySearch key={`${coded?.code ?? ""}:${coded?.system ?? ""}:${coded?.display ?? ""}`} id={id} field={field} coded={coded} onChange={onChange} />
      )}
      {field.exceptionalChoices.length > 0 && (
        <label>
          <span>Exceptional value</span>
          <select
            value={currentExceptionalKey(value)}
            onChange={(event) => onChange(exceptionalSelection(field, event.target.value))}
          >
            <option value="">No exceptional value</option>
            {field.exceptionalChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </select>
        </label>
      )}
    </fieldset>
  );
}
