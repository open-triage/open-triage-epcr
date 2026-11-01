"use client";

import React from "react";
import type { DestinationEntry } from "@open-triage/contracts";
import { resolveMessage } from "../app/localization";
import { ClinicalSearchableSelect } from "./clinical-searchable-select";

/** Uses the report's protected configuration projection, including while offline. */
export function DestinationRecommendations({ items, language, disabled, name, code, populated, none, onSelect }: {
  items: DestinationEntry[];
  language: string;
  disabled: boolean;
  populated: boolean;
  none: boolean;
  name?: string;
  code?: string;
  onSelect: (entry: DestinationEntry | "none" | undefined) => void;
}) {
  const label = resolveMessage(language, "hospital.destinationChoose");
  const active = items.filter(entry => entry.active);
  const selected = active.find(entry => entry.displayName === name && entry.localCode === code);
  return <fieldset className="stationary-field-control stationary-coded-field">
    <legend className="stationary-picker-label">{label}</legend>
    <ClinicalSearchableSelect label={label} value={none ? "none" : selected?.id} disabled={disabled}
      placeholder={[name, code].filter(Boolean).join(" — ") || label}
      options={[
        ...(populated ? [{ key: "", label: resolveMessage(language, "admin.delete") }] : []),
        { key: "none", label: resolveMessage(language, "hospital.destinationNone") },
        ...active.map(entry => ({ key: entry.id, label: `${entry.displayName} — ${entry.localCode}` })),
      ]}
      onChange={key => {
        if (key === "none" && !disabled) return onSelect("none");
        if (!key && populated && !disabled) return onSelect(undefined);
        const entry = active.find(entry => entry.id === key);
        if (entry && !disabled) onSelect(entry);
      }} />
  </fieldset>;
}
