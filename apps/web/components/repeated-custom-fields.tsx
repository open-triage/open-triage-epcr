"use client";

import type { CatalogDraftCustomElement, ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, EncounterValue, FormDraftField } from "@open-triage/contracts";
import React, { useState } from "react";
import { customTextFindings, customTextIdentity } from "./custom-text-fields";
import { ClinicalSearchableSelect } from "./clinical-searchable-select";
import { getNemsisGroup } from "../app/nemsis-data-model";

const ROOT = "PatientCareReportGroup";
const targetNames: Record<string, { en: string; sv: string }> = {
  "eMedications.MedicationGroup": { en: "Medication", sv: "Läkemedel" },
  "eExam.AssessmentGroup": { en: "Assessment", sv: "Bedömning" },
};

export function customTargets(document: EncounterDocument, definition: CatalogDraftCustomElement, groupId?: string): ReadonlyArray<EncounterGroupInstance> {
  return document.groups.find((group) => group.id === (groupId ?? definition.correlatesTo ?? ROOT))?.instances ?? [];
}

export function customValues(instance: EncounterGroupInstance, definition: CatalogDraftCustomElement): ReadonlyArray<EncounterValue> {
  return instance.elements.find((element) => element.id === customTextIdentity(definition))?.values ?? [];
}

/** Replaces only one identified value in one identified clinical entry. */
export function setCustomOccurrence(document: EncounterDocument, definition: CatalogDraftCustomElement,
  targetInstanceId: string, value: EncounterValue | undefined, occurrenceId?: string, targetGroupId?: string): EncounterDocument {
  const groupId = targetGroupId ?? definition.correlatesTo ?? ROOT;
  const elementId = customTextIdentity(definition);
  if (!customTargets(document, definition, groupId).some((instance) => instance.instanceId === targetInstanceId))
    throw new Error(`Missing custom correlation target ${groupId}/${targetInstanceId}`);
  return { ...document, groups: document.groups.map((group) => group.id !== groupId ? group : {
    ...group, instances: group.instances.map((instance) => instance.instanceId !== targetInstanceId ? instance : {
      ...instance, elements: (() => {
        const previous = customValues(instance, definition);
        if (occurrenceId && !previous.some((entry) => entry.occurrenceId === occurrenceId)) throw new Error("Unknown custom occurrence");
        if (value && !occurrenceId && definition.recurrence === "single" && previous.length) throw new Error("Custom field permits one value per target");
        const next = occurrenceId ? previous.flatMap((entry) => entry.occurrenceId === occurrenceId ? (value ? [value] : []) : [entry])
          : value ? [...previous, value] : previous;
        if (definition.datatype === "coded" && next.length > 1 &&
          (next.some((entry) => entry.kind !== "coded") || next.some((entry, index) => next.findIndex((other) =>
            other.kind === "coded" && entry.kind === "coded" && other.code === entry.code && other.system === entry.system) !== index)))
          throw new Error("Custom coded field cannot combine exceptional or duplicate choices");
        return [...instance.elements.filter((element) => element.id !== elementId), ...(next.length ? [{ id: elementId, values: next }] : [])];
      })(),
    }),
  }) };
}

function targetLabel(instance: EncounterGroupInstance, groupId: string, index: number, language: string): string {
  const title = targetNames[groupId]?.[language === "sv" ? "sv" : "en"] ?? getNemsisGroup(groupId)?.name ?? groupId;
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

function codedChoice(definition: Extract<CatalogDraftCustomElement, { datatype: "coded" }>, key: string, occurrenceId: string): EncounterValue | undefined {
  const choice = definition.choices.find((candidate) => key === `code:${candidate.code}`);
  if (choice) return { kind: "coded", occurrenceId, code: choice.code, system: definition.codeSystem, display: choice.label };
  if (key.startsWith("not:")) return { kind: "null", occurrenceId, notValue: { code: key.slice(4) } };
  if (key.startsWith("pn:")) return { kind: "pertinent-negative", occurrenceId, code: key.slice(3) };
  return undefined;
}

export function RepeatedCustomFields({ document, fields, definitions = {}, language = "en", targetGroupId, targetInstanceId, onlyOccurrenceId, onDocumentChange, onMultiChoiceOpenChange }: {
  readonly document: EncounterDocument;
  readonly fields: ReadonlyArray<FormDraftField>;
  readonly definitions?: ClinicalFormConfiguration["customFields"];
  readonly language?: string;
  readonly targetGroupId?: string;
  readonly targetInstanceId?: string;
  readonly onlyOccurrenceId?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
  readonly onMultiChoiceOpenChange?: (open: boolean) => void;
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  return <div className="repeated-custom-fields">{fields.flatMap((field) => {
    if (field.source.kind !== "custom" || Boolean(field.source.groupDefinitionId) !== Boolean(targetGroupId) ||
      targetGroupId && !field.source.groupDefinitionId) return [];
    const definition = definitions?.[field.source.elementDefinitionId];
    if (!definition || !targetGroupId && definition.recurrence === "single" && !definition.correlatesTo) return [];
    const groupId = targetGroupId ?? definition.correlatesTo ?? ROOT;
    const label = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    const help = language === "sv" ? definition.localization?.sv?.description || definition.definition : definition.definition;
    return <fieldset key={field.key} data-element-id={customTextIdentity(definition)}>
      <legend>{label}</legend><p>{help}</p>
      {customTargets(document, definition, targetGroupId).filter((instance) => !targetInstanceId || instance.instanceId === targetInstanceId).map((instance, targetIndex) => {
        const values = customValues(instance, definition);
        const pendingKey = `${field.key}:${instance.instanceId}`;
        const displayed: ReadonlyArray<EncounterValue> = onlyOccurrenceId ? values.filter((value) => value.occurrenceId === onlyOccurrenceId) : pending[pendingKey]
          ? [...values, { kind: "absent", occurrenceId: `pending:${pendingKey}` }] : values;
        if (definition.datatype === "coded" && definition.recurrence === "multiple" && !onlyOccurrenceId) {
          const selected = values.map(codedKey);
          const exceptional = values.some((value) => value.kind !== "coded");
          const choices = [
            ...codedOptions(definition, field).map((choice) => ({ key: `code:${choice.code}`,
              label: language === "sv" ? choice.localization?.sv?.label || choice.label : choice.label })),
            ...definition.permittedNotValues.filter((code) => field.allowedAbsenceStates?.includes(code))
              .map((code) => ({ key: `not:${code}`, label: `NOT ${code}` })),
            ...definition.permittedPertinentNegatives.filter((code) => field.allowedAbsenceStates?.includes(code))
              .map((code) => ({ key: `pn:${code}`, label: `PN ${code}` })),
          ];
          return <div key={instance.instanceId} data-custom-target-id={instance.instanceId}>
            <h4>{targetLabel(instance, groupId, targetIndex, language)}</h4>
            <ClinicalSearchableSelect label={label} values={selected} onOpenChange={onMultiChoiceOpenChange}
              placeholder={language === "sv" ? "Välj värden" : "Choose values"}
              options={choices.map((choice) => ({ ...choice, disabled: !selected.includes(choice.key) &&
                (exceptional || values.length > 0 && !choice.key.startsWith("code:")) }))}
              onChange={(key) => {
                const existing = values.find((value) => codedKey(value) === key);
                if (existing) { onDocumentChange(setCustomOccurrence(document, definition, instance.instanceId,
                  undefined, existing.occurrenceId, targetGroupId)); return; }
                if (exceptional || values.length > 0 && !key.startsWith("code:")) return;
                const next = codedChoice(definition, key, crypto.randomUUID());
                if (next) onDocumentChange(setCustomOccurrence(document, definition, instance.instanceId, next, undefined, targetGroupId));
              }} />
          </div>;
        }
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
                  { ...next, occurrenceId: crypto.randomUUID() }, undefined, targetGroupId));
              } else onDocumentChange(setCustomOccurrence(document, definition,
                instance.instanceId, next, value.occurrenceId, targetGroupId));
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
              <button className={isPending ? undefined : "button-danger"} type="button" onClick={() => update(undefined)}>{isPending ? language === "sv" ? "Avbryt" : "Cancel"
                : language === "sv" ? "Ta bort värde" : "Remove value"}</button>
            </div>;
          })}
          {!onlyOccurrenceId && !pending[pendingKey] && (definition.recurrence === "multiple" || values.length === 0) &&
            <button type="button" onClick={() => setPending((current) => ({ ...current, [pendingKey]: true }))}>
              {language === "sv" ? "Lägg till värde" : "Add value"}</button>}
        </div>;
      })}
      {customTargets(document, definition, targetGroupId).length === 0 && <p>{language === "sv" ? "Lägg till en målpost först." : "Add a target entry first."}</p>}
    </fieldset>;
  })}</div>;
}
