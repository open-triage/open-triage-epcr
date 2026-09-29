"use client";

import type { CatalogDraftCustomTextElement, ClinicalFormConfiguration, EncounterDocument, FormDraftField } from "@open-triage/contracts";
import React from "react";

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
  text: string): EncounterDocument {
  const identity = customTextIdentity(definition);
  return { ...document, groups: document.groups.map((group) => group.id !== GROUP_ID ? group : {
    ...group, instances: group.instances.map((instance, index) => index !== 0 ? instance : {
      ...instance, elements: text === ""
        ? instance.elements.filter(({ id }) => id !== identity)
        : [...instance.elements.filter(({ id }) => id !== identity), {
          id: identity, values: [{ kind: "scalar" as const,
            occurrenceId: instance.elements.find(({ id }) => id === identity)?.values[0]?.occurrenceId ?? crypto.randomUUID(),
            value: text }] }],
    }),
  }) };
}

export function customTextFindings(definition: CatalogDraftCustomTextElement, value: string, language = "en"): string[] {
  const swedish = language === "sv";
  if (!value) return ["Mandatory", "Required"].includes(definition.usage)
    ? [swedish ? "Ett värde krävs." : "A value is required."] : [];
  const constraints = definition.constraints;
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
  return <div className="custom-text-fields">{fields.flatMap((field) => {
    if (field.source.kind !== "custom") return [];
    const definition = definitions?.[field.source.elementDefinitionId];
    if (!definition || definition.datatype !== "string" || field.source.groupDefinitionId) return [];
    const value = customTextValue(document, definition);
    const findings = customTextFindings(definition, value, language);
    const id = `custom-text-${field.key.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
    const label = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    const help = language === "sv" ? definition.localization?.sv?.description || definition.definition : definition.definition;
    return <div className="stationary-field-shell" data-element-id={customTextIdentity(definition)} key={field.key}>
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-help`}>{help}</p>
      <textarea id={id} rows={3} value={value} aria-describedby={`${id}-help${findings.length ? ` ${id}-errors` : ""}`}
        aria-invalid={Boolean(findings.length)} required={field.required || ["Mandatory", "Required"].includes(definition.usage)}
        minLength={definition.constraints.minLength} maxLength={definition.constraints.maxLength ?? 100000}
        onChange={(event) => onDocumentChange(setCustomTextValue(document, definition, event.target.value))} />
      {findings.length > 0 && <ul id={`${id}-errors`}>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
    </div>;
  })}</div>;
}
