"use client";

import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { Fragment, useState, type CSSProperties } from "react";
import {
  editNonRepeatingCodedValue,
  editNonRepeatingScalarSelection,
  editNonRepeatingScalarValue,
  nonRepeatingGroupInstances,
  STATIONARY_NON_REPEATING_GROUPS,
  type StationaryNonRepeatingField,
  type StationaryNonRepeatingGroup,
} from "../app/stationary-non-repeating";
import { scalarOccurrences, type ScalarValidationFinding } from "../app/stationary-scalar";
import { stationaryCodedField } from "../app/stationary-coded-value";
import { StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryDatePicker } from "./stationary-date-picker";
import { StationaryScalarControl } from "./stationary-scalar-control";
import { StationaryScalarOccurrences } from "./stationary-scalar-occurrences";

export type StationaryApplicability = {
  readonly applicable: boolean;
  readonly reason?: string;
};

function canonicalValueText(value: EncounterValue): string {
  if (value.kind === "scalar") return String(value.lexical ?? value.value);
  if (value.kind === "coded") return value.display ? `${value.display} (${value.code})` : value.code;
  if (value.kind === "pertinent-negative") return value.display ? `${value.display} (${value.code})` : value.code;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  return "Collection attempted; value absent";
}

function ReadOnlyField({ field, instance }: { readonly field: StationaryNonRepeatingField; readonly instance?: EncounterGroupInstance }) {
  const values = instance?.elements.find(({ id }) => id === field.id)?.values ?? [];
  return (
    <div className="stationary-read-only-field" data-element-id={field.id} data-read-only="true">
      <span>{field.catalog.name} <small>{field.id}</small></span>
      {values.length ? (
        <ul>{values.map((value) => <li key={value.occurrenceId}>
          <output>{canonicalValueText(value)}</output>
          {value.attributes && <small>Source attributes: {JSON.stringify(value.attributes)}</small>}
        </li>)}</ul>
      ) : <output>Not provided</output>}
      <small>{field.catalog.definition}</small>
    </div>
  );
}

function EditableScalarField({ document, group, field, instance, parentInstanceId, disabled, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly group: StationaryNonRepeatingGroup;
  readonly field: StationaryNonRepeatingField;
  readonly instance?: EncounterGroupInstance;
  readonly parentInstanceId?: string;
  readonly disabled: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const [findings, setFindings] = useState<ReadonlyArray<ScalarValidationFinding>>([]);
  if (!field.scalar) return null;
  if (field.id === "ePatient.17") {
    const value = instance?.elements.find(({ id }) => id === field.id)?.values[0];
    return <div data-element-id={field.id} {...(instance ? { "data-group-instance-id": instance.instanceId } : {})} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
      <StationaryDatePicker presentation={field.scalar} catalog={field.catalog} value={value} findings={findings} disabled={disabled} onChange={(selection) => {
        if (disabled) return;
        const result = editNonRepeatingScalarSelection(document, {
          groupId: group.id, elementId: field.id,
          ...(instance ? { groupInstanceId: instance.instanceId } : {}),
          ...(parentInstanceId ? { parentInstanceId } : {}),
          ...(value ? { occurrenceId: value.occurrenceId } : {}),
        }, selection);
        if (!result.ok) return setFindings(result.findings);
        setFindings([]);
        onDocumentChange(result.document);
      }} />
    </div>;
  }
  if (instance && (scalarOccurrences(document, group.id, instance.instanceId, field.id).length > 0 || field.scalar.repeatable)) {
    return <div data-element-id={field.id} data-group-instance-id={instance.instanceId} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
      <StationaryScalarOccurrences document={document} groupInstanceId={instance.instanceId} presentation={field.scalar}
        disabled={disabled} onDocumentChange={disabled ? () => undefined : onDocumentChange} />
    </div>;
  }
  return <div data-element-id={field.id} {...(instance ? { "data-group-instance-id": instance.instanceId } : {})} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
    <StationaryScalarControl presentation={field.scalar} findings={findings} disabled={disabled} onInput={(input) => {
      if (disabled) return;
      const result = editNonRepeatingScalarValue(document, {
        groupId: group.id, elementId: field.id,
        ...(instance ? { groupInstanceId: instance.instanceId } : {}),
        ...(parentInstanceId ? { parentInstanceId } : {}),
      }, input);
      if (!result.ok) return setFindings(result.findings);
      setFindings([]);
      onDocumentChange(result.document);
    }} />
  </div>;
}

function EditableCodedField({ document, group, field, instance, parentInstanceId, disabled, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly group: StationaryNonRepeatingGroup;
  readonly field: StationaryNonRepeatingField;
  readonly instance?: EncounterGroupInstance;
  readonly parentInstanceId?: string;
  readonly disabled: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const values = instance?.elements.find(({ id }) => id === field.id)?.values ?? [];
  const presentations = values.length ? values : [undefined];
  return <div data-element-id={field.id} {...(instance ? { "data-group-instance-id": instance.instanceId } : {})} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
    {presentations.map((value) => <StationaryCodedValueField
      key={value?.occurrenceId ?? "new"}
      field={stationaryCodedField(field.catalog)}
      value={value}
      disabled={disabled}
      onChange={(selection) => {
        if (disabled) return;
        onDocumentChange(editNonRepeatingCodedValue(document, {
          groupId: group.id, elementId: field.id,
          ...(instance ? { groupInstanceId: instance.instanceId } : {}),
          ...(parentInstanceId ? { parentInstanceId } : {}),
          ...(value ? { occurrenceId: value.occurrenceId } : {}),
        }, selection));
      }}
    />)}
    {field.catalog.occurrence.max !== 1 && values.length > 0 && <StationaryCodedValueField
      key={`new-${values.length}`}
      field={stationaryCodedField(field.catalog)}
      disabled={disabled}
      onChange={(selection) => {
        if (!disabled && selection) onDocumentChange(editNonRepeatingCodedValue(document, {
          groupId: group.id, elementId: field.id,
          ...(instance ? { groupInstanceId: instance.instanceId } : {}),
          ...(parentInstanceId ? { parentInstanceId } : {}),
        }, selection));
      }}
    />}
  </div>;
}

function renderContexts(document: EncounterDocument, group: StationaryNonRepeatingGroup): ReadonlyArray<{ instance?: EncounterGroupInstance; parentInstanceId?: string }> {
  const instances = nonRepeatingGroupInstances(document, group.id);
  if (instances.length) return instances.map((instance) => ({ instance, ...(instance.parentInstanceId ? { parentInstanceId: instance.parentInstanceId } : {}) }));
  if (!group.parentId) return [{}];
  const parentInstances = document.groups.find(({ id }) => id === group.parentId)?.instances ?? [];
  if (parentInstances.length) return parentInstances.map(({ instanceId }) => ({ parentInstanceId: instanceId }));
  return [{}];
}

/** Full inline stationary projection. Fields stay in the DOM even when optional or not applicable. */
export function StationaryNonRepeatingRecord({ document, applicability = {}, groups = STATIONARY_NON_REPEATING_GROUPS, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly applicability?: Readonly<Record<string, StationaryApplicability>>;
  readonly groups?: ReadonlyArray<StationaryNonRepeatingGroup>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  return <div className="stationary-non-repeating-record" aria-label="Complete non-repeating NEMSIS record">
    {groups.map((group) => {
      const contexts = renderContexts(document, group);
      const ancestry = group.path.join(" / ");
      return <section
        className={`stationary-inline-group ${group.readOnly ? "stationary-read-only-group" : "stationary-editable-group"}`}
        data-group-id={group.id}
        data-group-path={ancestry}
        data-cardinality="single"
        id={`stationary-group-${group.id.replaceAll(".", "-")}`}
        key={group.id}
        style={{ "--stationary-depth": group.depth } as CSSProperties}
        aria-labelledby={`stationary-group-${group.id.replaceAll(".", "-")}-heading`}
      >
        <header>
          <div>
            <p className="eyebrow">{group.readOnly ? "Read-only system metadata" : "Canonical non-repeating group"}</p>
            <h2 id={`stationary-group-${group.id.replaceAll(".", "-")}-heading`}>{group.label}</h2>
          </div>
          <span>{group.id}</span>
        </header>
        <small className="stationary-group-ancestry">{ancestry} · single occurrence{group.optional ? " · optional" : ""}</small>
        {contexts.map(({ instance, parentInstanceId }, contextIndex) => <div className="stationary-inline-fields" key={instance?.instanceId ?? parentInstanceId ?? contextIndex}>
          {contexts.length > 1 && <h3>Occurrence beneath {parentInstanceId ?? "root"}</h3>}
          {group.fields.map((field) => {
            const fieldApplicability = applicability[field.id];
            const disabled = fieldApplicability?.applicable === false;
            return <Fragment key={field.id}>
              {disabled && <p className="stationary-applicability" data-element-id={field.id}>Not applicable{fieldApplicability.reason ? `: ${fieldApplicability.reason}` : ""}</p>}
              {field.readOnly
                ? <ReadOnlyField field={field} instance={instance} />
                : field.scalar
                  ? <EditableScalarField document={document} group={group} field={field} instance={instance} parentInstanceId={parentInstanceId} disabled={disabled} onDocumentChange={onDocumentChange} />
                  : <EditableCodedField document={document} group={group} field={field} instance={instance} parentInstanceId={parentInstanceId} disabled={disabled} onDocumentChange={onDocumentChange} />}
            </Fragment>;
          })}
          {!group.fields.length && <p className="stationary-structural-group">Structural group; contained repeating groups remain discoverable in hierarchy order.</p>}
        </div>)}
      </section>;
    })}
  </div>;
}
