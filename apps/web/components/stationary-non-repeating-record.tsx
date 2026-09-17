"use client";

import type { ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { useId, useState } from "react";
import {
  editNonRepeatingCodedValue,
  editNonRepeatingScalarValue,
  nonRepeatingGroupInstances,
  STATIONARY_NON_REPEATING_GROUPS,
  type StationaryNonRepeatingField,
  type StationaryNonRepeatingGroup,
} from "../app/stationary-non-repeating";
import { scalarOccurrences, stationaryDateTimeDefault, type ScalarValidationFinding } from "../app/stationary-scalar";
import { configuredStationaryCodedField } from "../app/stationary-coded-value";
import { StationaryCodedOccurrencesField, StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryScalarControl } from "./stationary-scalar-control";
import { StationaryScalarOccurrences } from "./stationary-scalar-occurrences";
import { StationaryPickerLegend } from "./stationary-picker-label";
import type { StationarySectionFinding } from "../app/stationary-record";
import { StationaryValidationMessages, stationaryFindingSeverity } from "./stationary-validation-messages";

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
  const id = useId();
  const values = instance?.elements.find(({ id }) => id === field.id)?.values ?? [];
  return (
    <fieldset className="stationary-field-control stationary-read-only-field" data-element-id={field.id} data-read-only="true" tabIndex={0} aria-describedby={`${id}-help`}>
      <StationaryPickerLegend label={field.catalog.name} tooltipId={`${id}-help`} tooltip={<>{field.id}: {field.catalog.definition}</>} />
      {values.length ? (
        <ul>{values.map((value) => <li key={value.occurrenceId}>
          <output>{canonicalValueText(value)}</output>
          {value.attributes && <small>Source attributes: {JSON.stringify(value.attributes)}</small>}
        </li>)}</ul>
      ) : <output>Not provided</output>}
    </fieldset>
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
  const [raw, setRaw] = useState<string | boolean>();
  if (!field.scalar) return null;
  if (instance && field.scalar.repeatable) {
    return <div data-element-id={field.id} data-group-instance-id={instance.instanceId} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
      <StationaryScalarOccurrences document={document} groupInstanceId={instance.instanceId} presentation={field.scalar}
        disabled={disabled} onDocumentChange={disabled ? () => undefined : onDocumentChange} />
    </div>;
  }
  const value = instance ? scalarOccurrences(document, group.id, instance.instanceId, field.id)[0] : undefined;
  const commit = (input: string | boolean) => {
    if (disabled) return;
    const result = editNonRepeatingScalarValue(document, {
      groupId: group.id, elementId: field.id,
      ...(instance ? { groupInstanceId: instance.instanceId } : {}),
      ...(parentInstanceId ? { parentInstanceId } : {}),
      ...(value ? { occurrenceId: value.occurrenceId } : {}),
    }, input);
    if (!result.ok) return setFindings(result.findings);
    setFindings([]);
    setRaw(undefined);
    onDocumentChange(result.document);
  };
  return <div data-element-id={field.id} {...(instance ? { "data-group-instance-id": instance.instanceId } : {})} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
    <StationaryScalarControl presentation={field.scalar} value={value} inputValue={raw} findings={findings} disabled={disabled} onInput={(input) => {
      setRaw(input);
      setFindings([]);
      if (field.scalar?.family === "datetime") commit(input);
    }} onBlur={commit} defaultDateTime={field.scalar.family === "datetime" ? stationaryDateTimeDefault(document, {
      groupId: group.id, groupInstanceId: instance?.instanceId,
    }) : undefined} />
  </div>;
}

function EditableCodedField({ document, group, field, instance, parentInstanceId, disabled, catalogField, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly group: StationaryNonRepeatingGroup;
  readonly field: StationaryNonRepeatingField;
  readonly instance?: EncounterGroupInstance;
  readonly parentInstanceId?: string;
  readonly disabled: boolean;
  readonly catalogField?: ClinicalFormConfiguration["catalogFields"][string];
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const values = instance?.elements.find(({ id }) => id === field.id)?.values ?? [];
  const codedField = configuredStationaryCodedField(field.catalog, catalogField);
  const repeatable = field.catalog.occurrence.max === "unbounded" || field.catalog.occurrence.max > 1;
  if (repeatable) return <StationaryCodedOccurrencesField
    field={codedField}
    values={values}
    disabled={disabled}
    onChange={(value, selection) => {
      if (disabled) return;
      onDocumentChange(editNonRepeatingCodedValue(document, {
        groupId: group.id, elementId: field.id,
        ...(instance ? { groupInstanceId: instance.instanceId } : {}),
        ...(parentInstanceId ? { parentInstanceId } : {}),
        ...(value ? { occurrenceId: value.occurrenceId } : {}),
        codedField,
      }, selection));
    }}
  />;
  const presentations = values.length ? values : [undefined];
  return <div data-element-id={field.id} {...(instance ? { "data-group-instance-id": instance.instanceId } : {})} aria-disabled={disabled || undefined} className={disabled ? "stationary-field-disabled" : undefined}>
    {presentations.map((value) => <StationaryCodedValueField
      key={value?.occurrenceId ?? "new"}
      field={codedField}
      value={value}
      disabled={disabled}
      onChange={(selection) => {
        if (disabled) return;
        onDocumentChange(editNonRepeatingCodedValue(document, {
          groupId: group.id, elementId: field.id,
          ...(instance ? { groupInstanceId: instance.instanceId } : {}),
          ...(parentInstanceId ? { parentInstanceId } : {}),
          ...(value ? { occurrenceId: value.occurrenceId } : {}),
          codedField,
        }, selection));
      }}
    />)}
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
export function StationaryNonRepeatingRecord({ document, applicability = {}, groups = STATIONARY_NON_REPEATING_GROUPS, findings = [], catalogFields = {}, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly applicability?: Readonly<Record<string, StationaryApplicability>>;
  readonly groups?: ReadonlyArray<StationaryNonRepeatingGroup>;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const visibleGroups = groups.filter(({ fields }) => fields.length > 0);
  if (!visibleGroups.length) return null;
  return <div className="stationary-non-repeating-record" aria-label="Complete non-repeating NEMSIS record">
    {visibleGroups.map((group) => {
      const contexts = renderContexts(document, group);
      const ancestry = group.path.join(" / ");
      const groupFindings = findings.filter((finding) => finding.target.groupId === group.id && !(finding.target.fieldId ?? finding.target.elementId));
      const groupSeverity = stationaryFindingSeverity(groupFindings);
      return <section
        className={`stationary-inline-group stationary-depth-${Math.min(group.depth, 9)} ${group.readOnly ? "stationary-read-only-group" : "stationary-editable-group"}${groupSeverity ? ` stationary-validation-state ${groupSeverity}` : ""}`}
        data-group-id={group.id}
        data-group-path={ancestry}
        data-cardinality="single"
        id={`stationary-group-${group.id.replaceAll(".", "-")}`}
        key={group.id}
        aria-label={`${group.label} fields`}
      >
        {contexts.map(({ instance, parentInstanceId }, contextIndex) => <div className="stationary-inline-fields" key={instance?.instanceId ?? parentInstanceId ?? contextIndex}>
          {group.fields.map((field) => {
            const fieldApplicability = applicability[field.id];
            const disabled = fieldApplicability?.applicable === false;
            const fieldFindings = findings.filter((finding) => {
              const targetField = finding.target.fieldId ?? finding.target.elementId;
              const targetInstance = finding.target.groupInstanceId ?? finding.target.instanceId;
              return finding.target.groupId === group.id && targetField === field.id && (!targetInstance || targetInstance === instance?.instanceId);
            });
            const fieldSeverity = stationaryFindingSeverity(fieldFindings);
            return <div className={`stationary-field-shell${fieldSeverity ? ` stationary-validation-state ${fieldSeverity}` : ""}`} key={field.id}>
              {disabled && <p className="stationary-applicability" data-element-id={field.id}>Not applicable{fieldApplicability.reason ? `: ${fieldApplicability.reason}` : ""}</p>}
              {field.readOnly
                ? <ReadOnlyField field={field} instance={instance} />
                : field.scalar
                  ? <EditableScalarField document={document} group={group} field={field} instance={instance} parentInstanceId={parentInstanceId} disabled={disabled} onDocumentChange={onDocumentChange} />
                : <EditableCodedField document={document} group={group} field={field} instance={instance} parentInstanceId={parentInstanceId} disabled={disabled} catalogField={catalogFields[field.id]} onDocumentChange={onDocumentChange} />}
              <StationaryValidationMessages findings={fieldFindings} />
            </div>;
          })}
        </div>)}
        <StationaryValidationMessages findings={groupFindings} />
      </section>;
    })}
  </div>;
}
