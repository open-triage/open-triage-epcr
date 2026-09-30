"use client";

import type { CatalogDraftCustomCodedElement, ClinicalFormConfiguration, EncounterDocument, EncounterValue, FormDraftField } from "@open-triage/contracts";
import React from "react";
import { customTextIdentity } from "./custom-text-fields";
import { ClinicalSearchableSelect } from "./clinical-searchable-select";

const GROUP_ID = "PatientCareReportGroup";

export function customCodedValue(document: EncounterDocument, definition: CatalogDraftCustomCodedElement): EncounterValue | undefined {
  return document.groups.find((group) => group.id === GROUP_ID)?.instances[0]?.elements
    .find((element) => element.id === customTextIdentity(definition))?.values[0];
}

export function setCustomCodedValue(document: EncounterDocument, definition: CatalogDraftCustomCodedElement,
  value: EncounterValue | undefined): EncounterDocument {
  const identity = customTextIdentity(definition);
  return { ...document, groups: document.groups.map((group) => group.id !== GROUP_ID ? group : {
    ...group, instances: group.instances.map((instance, index) => index !== 0 ? instance : {
      ...instance, elements: value ? [...instance.elements.filter((element) => element.id !== identity),
        { id: identity, values: [value] }] : instance.elements.filter((element) => element.id !== identity),
    }),
  }) };
}

function selectedIdentity(value?: EncounterValue): string {
  if (value?.kind === "coded") return `code:${value.system ?? ""}:${value.code}`;
  if (value?.kind === "null" && value.notValue) return `not-value:${value.notValue.code}`;
  if (value?.kind === "pertinent-negative") return `pertinent-negative:${value.code}`;
  return "";
}

export function customCodedChoices(field: FormDraftField, definition: CatalogDraftCustomCodedElement, language = "en") {
  const choices = field.choicePolicy ? field.choicePolicy.flatMap((choice) => choice.kind === "code"
    ? definition.choices.filter((candidate) => candidate.code === choice.code && choice.codeSystem === definition.codeSystem)
      .map((candidate) => ({ key: `code:${definition.codeSystem}:${candidate.code}`, label: candidate.label, localization: candidate.localization }))
    : definition.permittedNotValues.includes(choice.code) && field.allowedAbsenceStates?.includes(choice.code)
      ? [{ key: `not-value:${choice.code}`, label: `NOT ${choice.code}`, localization: undefined }] : [])
    : [...definition.choices.map((candidate) => ({ key: `code:${definition.codeSystem}:${candidate.code}`,
      label: candidate.label, localization: candidate.localization })),
      ...definition.permittedNotValues.filter((code) => field.allowedAbsenceStates?.includes(code))
        .map((code) => ({ key: `not-value:${code}`, label: `NOT ${code}`, localization: undefined }))];
  const negatives = definition.permittedPertinentNegatives.filter((code) => field.allowedAbsenceStates?.includes(code))
    .map((code) => ({ key: `pertinent-negative:${code}`, label: `PN ${code}`, localization: undefined }));
  return [...choices, ...negatives].map((choice) => ({ key: choice.key,
    label: language === "sv" ? choice.localization?.sv?.label || choice.label : choice.label }));
}

export function CustomCodedFields({ document, fields, definitions = {}, language = "en", onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly fields: ReadonlyArray<FormDraftField>;
  readonly definitions?: ClinicalFormConfiguration["customFields"];
  readonly language?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  return <div className="custom-coded-fields">{fields.flatMap((field) => {
    if (field.source.kind !== "custom" || field.source.groupDefinitionId) return [];
    const definition = definitions?.[field.source.elementDefinitionId];
    if (!definition || definition.datatype !== "coded" || definition.recurrence === "multiple" || definition.correlatesTo) return [];
    const value = customCodedValue(document, definition);
    const label = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    const help = language === "sv" ? definition.localization?.sv?.description || definition.definition : definition.definition;
    const id = `custom-coded-${field.key.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
    return <div className="stationary-field-shell" data-element-id={customTextIdentity(definition)} key={field.key}>
      <label htmlFor={id}>{label}</label><p id={`${id}-help`}>{help}</p>
      <div id={id} aria-describedby={`${id}-help`}>
        <ClinicalSearchableSelect label={label} value={selectedIdentity(value)}
          placeholder={language === "sv" ? "Välj ett värde" : "Choose a value"}
          options={customCodedChoices(field, definition, language)
            .concat(value ? [{ key: "", label: language === "sv" ? "Ta bort" : "Delete" }] : [])}
          onChange={(key) => {
          const occurrenceId = value?.occurrenceId ?? crypto.randomUUID();
          const choice = definition.choices.find((candidate) => key === `code:${definition.codeSystem}:${candidate.code}`);
          const next: EncounterValue | undefined = choice ? { kind: "coded", occurrenceId, code: choice.code,
            system: definition.codeSystem, display: choice.label } : key.startsWith("not-value:")
            ? { kind: "null", occurrenceId, notValue: { code: key.slice(10) } }
            : key.startsWith("pertinent-negative:")
              ? { kind: "pertinent-negative", occurrenceId, code: key.slice(19) } : undefined;
          onDocumentChange(setCustomCodedValue(document, definition, next));
        }} />
      </div>
    </div>;
  })}</div>;
}
