"use client";

import React, { useId, useMemo, useState } from "react";
import type { EncounterValue } from "@open-triage/contracts";
import {
  codedSelectionFromOption,
  exceptionalSelection,
  searchStationaryCodedOptions,
  type StationaryCodedField,
  type StationaryCodedSelection,
} from "../app/stationary-coded-value";
import { stationaryExceptionalKey } from "../app/stationary-value-picker";
import { StationaryValuePicker } from "./stationary-value-picker";

function stateLabel(value: EncounterValue | undefined): string {
  if (!value) return "No selection";
  if (value.kind === "coded") return value.display ? `${value.display} (${value.code})` : value.code;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  return "No selection";
}

function TerminologyCombobox({ id, field, value, disabled, onChange }: {
  readonly id: string;
  readonly field: StationaryCodedField;
  readonly value?: EncounterValue;
  readonly disabled: boolean;
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const coded = value?.kind === "coded" ? value : undefined;
  const exceptional = Boolean(stationaryExceptionalKey(value));
  const [query, setQuery] = useState(exceptional ? stateLabel(value) : coded?.display ? `${coded.display} (${coded.code})` : coded?.code ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [code, setCode] = useState(coded?.code ?? "");
  const [display, setDisplay] = useState(coded?.display ?? "");
  const [system, setSystem] = useState(coded?.system ?? field.systems[0]?.id ?? "");
  const results = useMemo(() => searchStationaryCodedOptions(field.options, query), [field.options, query]);
  const selectOption = (option: StationaryCodedField["options"][number]) => {
    setQuery(`${option.label} (${option.code})`);
    setCode(option.code);
    setDisplay(option.label);
    if (option.system) setSystem(option.system);
    setOpen(false);
    onChange(codedSelectionFromOption(option));
  };
  const commit = () => {
    if (!code.trim()) return onChange(undefined);
    const option = field.options.find((candidate) => candidate.code === code);
    const selection = option ? codedSelectionFromOption(option) : {
      kind: "coded", code: code.trim(), ...(display.trim() ? { display: display.trim() } : {}), ...(system ? { system } : {}),
    } as const;
    const committedCode = option?.code ?? code.trim();
    const committedDisplay = option?.label ?? display.trim();
    setQuery(committedDisplay ? `${committedDisplay} (${committedCode})` : committedCode);
    setOpen(false);
    onChange(selection);
  };
  const listboxId = `${id}-options`;
  return (
    <div className="stationary-terminology-combobox">
      <label htmlFor={`${id}-search`}>
        <span>Search by label or code</span>
        <input
          id={`${id}-search`}
          type="search"
          role="combobox"
          value={query}
          readOnly={exceptional}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={open && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          disabled={disabled}
          onFocus={() => !exceptional && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && results[activeIndex]) { event.preventDefault(); selectOption(results[activeIndex]); }
          }}
        />
      </label>
      {open && results.length > 0 && <div id={listboxId} className="stationary-terminology-results" role="listbox">
        {results.map((option, index) => <button
          id={`${listboxId}-${index}`}
          key={`${option.system ?? ""}:${option.code}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => setActiveIndex(index)}
          onClick={() => selectOption(option)}
        >
            <span>{option.label}</span><code>{option.code}</code>
        </button>)}
      </div>}
      <details className="stationary-terminology-advanced">
        <summary>Advanced</summary>
        <div>
          <label><span>Code</span><input type="text" value={code} disabled={disabled} onChange={(event) => setCode(event.target.value)} /></label>
          {field.controlKind === "external-search" && <label><span>Code system</span>
            <select value={system} disabled={disabled} onChange={(event) => setSystem(event.target.value)} required>
              {field.systems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>}
          {field.controlKind === "combobox" && <label><span>Code system (optional)</span><input type="text" value={system} disabled={disabled} onChange={(event) => setSystem(event.target.value)} /></label>}
          <label><span>Display</span><input type="text" value={display} disabled={disabled} onChange={(event) => setDisplay(event.target.value)} /></label>
          <button type="button" disabled={disabled || !code.trim()} onClick={commit}>Apply coded value</button>
          <small>Suggestions are not exhaustive; another valid terminology code may be entered.</small>
        </div>
      </details>
    </div>
  );
}

/** Accessible catalog-driven editor shared by inline, bundled, and external coded fields. */
export function StationaryCodedValueField({ field, value, disabled = false, onChange }: {
  readonly field: StationaryCodedField;
  readonly value?: EncounterValue;
  readonly disabled?: boolean;
  readonly onChange: (selection: StationaryCodedSelection | undefined) => void;
}) {
  const id = useId();
  const coded = value?.kind === "coded" ? value : undefined;
  const exceptionalKey = stationaryExceptionalKey(value);
  const stateKind = coded ? "ordinary" : exceptionalKey ? "exceptional" : "unset";
  const valueKey = value?.kind === "coded" ? `${value.kind}:${value.system ?? ""}:${value.code}:${value.display ?? ""}`
    : value?.kind === "null" ? `${value.kind}:${value.notValue?.code ?? ""}`
      : value?.kind === "pertinent-negative" ? `${value.kind}:${value.code}` : "unset";

  return (
    <StationaryValuePicker
      elementId={field.elementId}
      occurrenceId={value?.occurrenceId}
      label={field.label}
      help={field.help}
      stateLabel={stateLabel(value)}
      stateKind={stateKind}
      exceptionalChoices={field.exceptionalChoices}
      exceptionalKey={exceptionalKey}
      disabled={disabled}
      onExceptionalChange={(key) => onChange(exceptionalSelection(field, key))}
      onClear={() => onChange(undefined)}
    >
      {field.controlKind === "select" ? (
        <label htmlFor={`${id}-value`}>
          <span>Value</span>
          <select id={`${id}-value`} value={coded?.code ?? ""} disabled={disabled} onChange={(event) => {
            const option = field.options.find(({ code }) => code === event.target.value);
            onChange(option ? codedSelectionFromOption(option) : undefined);
          }}>
            <option value="">Choose a value</option>
            {field.options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
      ) : (
        <TerminologyCombobox key={valueKey} id={id} field={field} value={value} disabled={disabled} onChange={onChange} />
      )}
    </StationaryValuePicker>
  );
}
