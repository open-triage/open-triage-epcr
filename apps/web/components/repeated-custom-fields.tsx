"use client";

import type { CatalogDraftCustomElement, ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, EncounterValue, FormDraftField } from "@open-triage/contracts";
import React, { useState } from "react";
import { customTextFindings, customTextIdentity } from "./custom-text-fields";

const ROOT = "PatientCareReportGroup";
const targetNames: Record<string, { en: string; sv: string }> = {
  "eMedications.MedicationGroup": { en: "Medication", sv: "Läkemedel" },
  "eExam.AssessmentGroup": { en: "Assessment", sv: "Bedömning" },
};

export function customTargets(document: EncounterDocument, definition: CatalogDraftCustomElement): ReadonlyArray<EncounterGroupInstance> {
  return document.groups.find((group) => group.id === (definition.correlatesTo ?? ROOT))?.instances ?? [];
}

export function customValues(instance: EncounterGroupInstance, definition: CatalogDraftCustomElement): ReadonlyArray<EncounterValue> {
  return instance.elements.find((element) => element.id === customTextIdentity(definition))?.values ?? [];
}

/** Replaces only one identified value in one identified clinical entry. */
export function setCustomOccurrence(document: EncounterDocument, definition: CatalogDraftCustomElement,
  targetInstanceId: string, value: EncounterValue | undefined, occurrenceId?: string): EncounterDocument {
  const groupId = definition.correlatesTo ?? ROOT;
  const elementId = customTextIdentity(definition);
  if (!customTargets(document, definition).some((instance) => instance.instanceId === targetInstanceId))
    throw new Error(`Missing custom correlation target ${groupId}/${targetInstanceId}`);
  return { ...document, groups: document.groups.map((group) => group.id !== groupId ? group : {
    ...group, instances: group.instances.map((instance) => instance.instanceId !== targetInstanceId ? instance : {
      ...instance, elements: (() => {
        const previous = customValues(instance, definition);
        if (occurrenceId && !previous.some((entry) => entry.occurrenceId === occurrenceId)) throw new Error("Unknown custom occurrence");
        if (value && !occurrenceId && definition.recurrence === "single" && previous.length) throw new Error("Custom field permits one value per target");
        const next = occurrenceId ? previous.flatMap((entry) => entry.occurrenceId === occurrenceId ? (value ? [value] : []) : [entry])
          : value ? [...previous, value] : previous;
        return [...instance.elements.filter((element) => element.id !== elementId), ...(next.length ? [{ id: elementId, values: next }] : [])];
      })(),
    }),
  }) };
}

function targetLabel(instance: EncounterGroupInstance, groupId: string, index: number, language: string): string {
  const title = targetNames[groupId]?.[language === "sv" ? "sv" : "en"] ?? groupId;
  const first = instance.elements.flatMap((element) => element.values).find((value) => value.kind === "coded" || value.kind === "scalar");
  const detail = first?.kind === "coded" ? first.display || first.code : first?.kind === "scalar" ? String(first.value) : "";
  return `${title} ${index + 1}${detail ? ` — ${detail}` : ""}`;
}

function codedOptions(definition: Extract<CatalogDraftCustomElement, { datatype: "coded" }>, field: FormDraftField) {
  const allowed = field.choicePolicy?.filter((choice) => choice.kind === "code").map((choice) => `${choice.codeSystem}:${choice.code}`);
  return definition.choices.filter((choice) => !allowed || allowed.includes(`${definition.codeSystem}:${choice.code}`));
}

function codedKey(value: EncounterValue | undefined): string {
  if (value?.kind === "coded") return `code:${value.code}`;
  if (value?.kind === "null" && value.notValue) return `not:${value.notValue.code}`;
  if (value?.kind === "pertinent-negative") return `pn:${value.code}`;
  return "";
}

export function RepeatedCustomFields({ document, fields, definitions = {}, language = "en", onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly fields: ReadonlyArray<FormDraftField>;
  readonly definitions?: ClinicalFormConfiguration["customFields"];
  readonly language?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  return <div className="repeated-custom-fields">{fields.flatMap((field) => {
    if (field.source.kind !== "custom" || field.source.groupDefinitionId) return [];
    const definition = definitions?.[field.source.elementDefinitionId];
    if (!definition || (definition.recurrence === "single" && !definition.correlatesTo)) return [];
    const groupId = definition.correlatesTo ?? ROOT;
    const label = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    const help = language === "sv" ? definition.localization?.sv?.description || definition.definition : definition.definition;
    return <fieldset key={field.key} data-element-id={customTextIdentity(definition)}>
      <legend>{label}</legend><p>{help}</p>
      {customTargets(document, definition).map((instance, targetIndex) => {
        const values = customValues(instance, definition);
        const pendingKey = `${field.key}:${instance.instanceId}`;
        const displayed: ReadonlyArray<EncounterValue> = pending[pendingKey]
          ? [...values, { kind: "absent", occurrenceId: `pending:${pendingKey}` }] : values;
        return <div key={instance.instanceId} data-custom-target-id={instance.instanceId}>
          <h4>{targetLabel(instance, groupId, targetIndex, language)}</h4>
          {displayed.map((value, valueIndex) => {
            const isPending = value.occurrenceId.startsWith("pending:");
            const id = `custom-${field.key}-${instance.instanceId}-${value.occurrenceId}`.replaceAll(/[^A-Za-z0-9_-]/g, "-");
            const scalar = value.kind === "scalar" ? value.value : "";
            const findings = definition.datatype === "coded" ? [] : customTextFindings(definition, scalar, language);
            const update = (next: EncounterValue | undefined) => {
              if (isPending) {
                setPending((current) => ({ ...current, [pendingKey]: false }));
                if (next) onDocumentChange(setCustomOccurrence(document, definition, instance.instanceId,
                  { ...next, occurrenceId: crypto.randomUUID() }));
              } else onDocumentChange(setCustomOccurrence(document, definition,
                instance.instanceId, next, value.occurrenceId));
            };
            return <div key={value.occurrenceId} data-custom-occurrence-id={value.occurrenceId}>
              <label htmlFor={id}>{label}{definition.recurrence === "multiple" ? ` ${valueIndex + 1}` : ""}</label>
              {definition.datatype === "coded" ? <select id={id} value={codedKey(value)} onChange={(event) => {
                const key = event.target.value;
                const choice = definition.choices.find((candidate) => key === `code:${candidate.code}`);
                update(choice ? { kind: "coded", occurrenceId: value.occurrenceId, code: choice.code, system: definition.codeSystem, display: choice.label }
                  : key.startsWith("not:") ? { kind: "null", occurrenceId: value.occurrenceId, notValue: { code: key.slice(4) } }
                  : key.startsWith("pn:") ? { kind: "pertinent-negative", occurrenceId: value.occurrenceId, code: key.slice(3) } : undefined);
              }}><option value="">{language === "sv" ? "Välj värde" : "Choose a value"}</option>
                {codedOptions(definition, field).map((choice) => <option value={`code:${choice.code}`} key={choice.code}>{language === "sv" ? choice.localization?.sv?.label || choice.label : choice.label}</option>)}
                {definition.permittedNotValues.filter((code) => field.allowedAbsenceStates?.includes(code)).map((code) =>
                  <option value={`not:${code}`} key={`not:${code}`}>NOT {code}</option>)}
                {definition.permittedPertinentNegatives.filter((code) => field.allowedAbsenceStates?.includes(code)).map((code) =>
                  <option value={`pn:${code}`} key={`pn:${code}`}>PN {code}</option>)}
              </select> : definition.datatype === "boolean" ? <select id={id} value={isPending ? "" : String(scalar)} onChange={(event) => update({ kind: "scalar", occurrenceId: value.occurrenceId, value: event.target.value === "true" })}>
                <option value="" disabled>{language === "sv" ? "Välj värde" : "Choose a value"}</option>
                <option value="true">{language === "sv" ? "Ja" : "Yes"}</option><option value="false">{language === "sv" ? "Nej" : "No"}</option></select>
              : definition.datatype === "string" || definition.datatype === "other" ? <textarea id={id} value={String(scalar)}
                onChange={(event) => update({ kind: "scalar", occurrenceId: value.occurrenceId, value: event.target.value })} />
              : definition.datatype === "binary" ? <><input id={id} type="file" onChange={async (event) => {
                const file = event.currentTarget.files?.[0]; if (!file || file.size > 75000) return;
                const encoded = btoa(Array.from(new Uint8Array(await file.arrayBuffer()), (byte) => String.fromCharCode(byte)).join(""));
                update({ kind: "scalar", occurrenceId: value.occurrenceId, value: encoded });
              }} /><span>{String(scalar).length ? `${Math.floor(String(scalar).length * 3 / 4)} bytes saved` : ""}</span></>
              : <input id={id} type={definition.datatype === "number" ? "number" : "datetime-local"}
                step={definition.datatype === "number" ? "any" : undefined}
                value={definition.datatype === "dateTime" ? String(scalar).slice(0, 16) : String(scalar)}
                onChange={(event) => { if (event.target.value) update({ kind: "scalar", occurrenceId: value.occurrenceId,
                  value: definition.datatype === "number" ? Number(event.target.value) : new Date(event.target.value).toISOString() }); }} />}
              {findings.length > 0 && <ul>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
              <button type="button" onClick={() => update(undefined)}>{isPending ? language === "sv" ? "Avbryt" : "Cancel"
                : language === "sv" ? "Ta bort värde" : "Remove value"}</button>
            </div>;
          })}
          {!pending[pendingKey] && (definition.recurrence === "multiple" || values.length === 0) &&
            <button type="button" onClick={() => setPending((current) => ({ ...current, [pendingKey]: true }))}>
              {language === "sv" ? "Lägg till värde" : "Add value"}</button>}
        </div>;
      })}
      {customTargets(document, definition).length === 0 && <p>{language === "sv" ? "Lägg till en målpost först." : "Add a target entry first."}</p>}
    </fieldset>;
  })}</div>;
}
