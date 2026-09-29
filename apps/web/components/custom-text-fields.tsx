"use client";

import type { CatalogDraftCustomTextElement, ClinicalFormConfiguration, EncounterDocument, FormDraftField } from "@open-triage/contracts";
import React from "react";
import { clinicalInstantParts, clinicalWallTimeInput, useAgencyTimeZone } from "../app/agency-time-zone";
import { TimePicker } from "./time-picker";

const GROUP_ID = "PatientCareReportGroup";

export function customTextIdentity(definition: CatalogDraftCustomTextElement): string {
  return `${definition.namespace}.${definition.slug}`;
}

export function customTextValue(document: EncounterDocument, definition: CatalogDraftCustomTextElement): string {
  const group = document.groups.find(({ id }) => id === GROUP_ID);
  const value = group?.instances[0]?.elements.find(({ id }) => id === customTextIdentity(definition))?.values[0];
  return value?.kind === "scalar" ? String(value.value) : "";
}

export function setCustomTextValue(document: EncounterDocument, definition: CatalogDraftCustomTextElement,
  text: string | number | boolean | null): EncounterDocument {
  const identity = customTextIdentity(definition);
  const empty = text === "" || text === null;
  return { ...document, groups: document.groups.map((group) => group.id !== GROUP_ID ? group : {
    ...group, instances: group.instances.map((instance, index) => index !== 0 ? instance : {
      ...instance, elements: empty
        ? instance.elements.filter(({ id }) => id !== identity)
        : [...instance.elements.filter(({ id }) => id !== identity), {
          id: identity, values: [{ kind: "scalar" as const,
            occurrenceId: instance.elements.find(({ id }) => id === identity)?.values[0]?.occurrenceId ?? crypto.randomUUID(),
            value: text as string | number | boolean,
            ...(definition.datatype === "dateTime" && typeof text === "string" ? (() => {
              const offset = /([+-])(\d{2}):(\d{2})$/.exec(text);
              return offset ? { utcOffsetMinutes: (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) } : {};
            })() : {}) }] }],
    }),
  }) };
}

export function customTextFindings(definition: CatalogDraftCustomTextElement, value: string | number | boolean | null, language = "en"): string[] {
  const swedish = language === "sv";
  if (value === "" || value === null) return ["Mandatory", "Required"].includes(definition.usage)
    ? [swedish ? "Ett värde krävs." : "A value is required."] : [];
  const constraints = definition.constraints;
  if (definition.datatype === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (typeof value === "boolean" || !Number.isFinite(number)) return [swedish ? "Ange ett giltigt tal." : "Enter a valid number."];
    return [
      ...(constraints.minimum !== undefined && number < constraints.minimum ? [swedish ? `Ange minst ${constraints.minimum}.` : `Enter at least ${constraints.minimum}.`] : []),
      ...(constraints.maximum !== undefined && number > constraints.maximum ? [swedish ? `Ange högst ${constraints.maximum}.` : `Enter at most ${constraints.maximum}.`] : []),
    ];
  }
  if (definition.datatype === "boolean") return typeof value === "boolean" ? [] : [swedish ? "Välj ja eller nej." : "Choose yes or no."];
  if (definition.datatype === "dateTime") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
    ? [] : [swedish ? "Ange giltigt datum och tid." : "Enter a valid date and time."];
  if (typeof value !== "string") return [swedish ? "Ange text." : "Enter text."];
  return [
    ...(constraints.minLength !== undefined && value.length < constraints.minLength ? [swedish
      ? `Ange minst ${constraints.minLength} tecken.` : `Enter at least ${constraints.minLength} characters.`] : []),
    ...(value.length > (constraints.maxLength ?? 100000) ? [swedish
      ? `Ange högst ${constraints.maxLength ?? 100000} tecken.` : `Enter at most ${constraints.maxLength ?? 100000} characters.`] : []),
    ...(constraints.pattern && !new RegExp(`^(?:${constraints.pattern})$`).test(value) ? [swedish
      ? "Värdet matchar inte katalogens mönster." : "Value does not match the catalog pattern."] : []),
  ];
}

export function CustomTextFields({ document, fields, definitions = {}, language = "en", onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly fields: ReadonlyArray<FormDraftField>;
  readonly definitions?: ClinicalFormConfiguration["customFields"];
  readonly language?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const zone = useAgencyTimeZone();
  return <div className="custom-text-fields">{fields.flatMap((field) => {
    if (field.source.kind !== "custom") return [];
    const definition = definitions?.[field.source.elementDefinitionId];
    if (!definition || !["string", "number", "dateTime", "boolean"].includes(definition.datatype) || field.source.groupDefinitionId) return [];
    const value = customTextValue(document, definition);
    const findings = customTextFindings(definition, value, language);
    const id = `custom-text-${field.key.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
    const label = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    const help = language === "sv" ? definition.localization?.sv?.description || definition.definition : definition.definition;
    return <div className="stationary-field-shell" data-element-id={customTextIdentity(definition)} key={field.key}>
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-help`}>{help}</p>
      {definition.datatype === "string" ? <textarea id={id} rows={3} value={value} aria-describedby={`${id}-help${findings.length ? ` ${id}-errors` : ""}`}
        aria-invalid={Boolean(findings.length)} required={field.required || ["Mandatory", "Required"].includes(definition.usage)}
        minLength={definition.constraints.minLength} maxLength={definition.constraints.maxLength ?? 100000}
        onChange={(event) => onDocumentChange(setCustomTextValue(document, definition, event.target.value))} />
      : definition.datatype === "number" ? <input id={id} type="number" step="any" value={value}
        min={definition.constraints.minimum} max={definition.constraints.maximum}
        aria-describedby={`${id}-help${findings.length ? ` ${id}-errors` : ""}`} aria-invalid={Boolean(findings.length)}
        onChange={(event) => onDocumentChange(setCustomTextValue(document, definition,
          event.target.value === "" ? null : Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : event.target.value))} />
      : definition.datatype === "boolean" ? <select id={id} value={value} aria-describedby={`${id}-help${findings.length ? ` ${id}-errors` : ""}`}
        aria-invalid={Boolean(findings.length)} onChange={(event) => onDocumentChange(setCustomTextValue(document, definition,
          event.target.value === "" ? null : event.target.value === "true"))}>
        <option value="">{language === "sv" ? "Inte angivet" : "Not recorded"}</option>
        <option value="true">{language === "sv" ? "Ja" : "Yes"}</option><option value="false">{language === "sv" ? "Nej" : "No"}</option>
      </select> : <><TimePicker label={label} language={language === "sv" ? "sv" : "en"}
        date={clinicalInstantParts(value, zone)?.date} value={clinicalInstantParts(value, zone)?.time ?? ""}
        selectedInstant={value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined}
        onChange={() => undefined} onDateTimeChange={(date, time, selected) => {
          const instant = clinicalWallTimeInput(date, time, zone, selected);
          const offset = clinicalInstantParts(instant, zone)?.offset ?? "+00:00";
          onDocumentChange(setCustomTextValue(document, definition, `${date}T${time}:00${offset}`));
        }} />
        {value && <button type="button" onClick={() => onDocumentChange(setCustomTextValue(document, definition, null))}>
          {language === "sv" ? "Rensa" : "Clear"}</button>}</>}
      {findings.length > 0 && <ul id={`${id}-errors`}>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
    </div>;
  })}</div>;
}
