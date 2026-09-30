"use client";

import type { ClinicalFormConfiguration, EncounterDocument } from "@open-triage/contracts";
import { useState } from "react";
import { checklistFieldTarget } from "../app/checklist-field-target";
import { getNemsisDataElement } from "../app/nemsis-data-model";
import { resolveCatalogElementText } from "../app/catalog-localization";
import { configuredStationaryCodedField, editStationaryCodedValue } from "../app/stationary-coded-value";
import { editScalarNotValue, editScalarOccurrence, scalarControlPresentation, stationaryDateTimeDefault, type ScalarValidationFinding } from "../app/stationary-scalar";
import type { StationaryValidationFinding } from "../app/stationary-validation";
import { StationaryCodedOccurrencesField, StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryScalarControl } from "./stationary-scalar-control";
import { CustomTextFields } from "./custom-text-fields";
import { CustomCodedFields } from "./custom-coded-fields";
import { RepeatedCustomFields } from "./repeated-custom-fields";

export function ChecklistFieldEditor({ finding, document, form, language, disabled, onDocumentChange, onMultiChoiceOpenChange }: {
  readonly finding: StationaryValidationFinding;
  readonly document: EncounterDocument;
  readonly form: ClinicalFormConfiguration;
  readonly language: string;
  readonly disabled: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
  readonly onMultiChoiceOpenChange?: (open: boolean) => void;
}) {
  const [raw, setRaw] = useState<string | boolean>();
  const [errors, setErrors] = useState<ReadonlyArray<ScalarValidationFinding>>([]);
  const target = checklistFieldTarget(finding, document, form);
  if (!target) return null;
  const context = <p className="checklist-target-context">{target.context}{target.value && target.multiple ? ` · Value ${target.values.findIndex((value) => value.occurrenceId === target.value?.occurrenceId) + 1}` : ""}</p>;
  if (target.kind.startsWith("custom-") && (target.multiple || target.field.source.kind === "custom" &&
    (target.field.source.groupDefinitionId || form.customFields?.[target.field.source.elementDefinitionId]?.correlatesTo))) {
    return <div className="checklist-inline-target">{context}<RepeatedCustomFields document={document} fields={[target.field]}
      definitions={form.customFields} language={language} targetInstanceId={target.instanceId}
      targetGroupId={target.field.source.kind === "custom" && target.field.source.groupDefinitionId ? target.groupId : undefined}
      onlyOccurrenceId={finding.target.occurrenceId}
      onMultiChoiceOpenChange={onMultiChoiceOpenChange}
      onDocumentChange={disabled ? () => undefined : onDocumentChange} /></div>;
  }
  if (target.kind === "custom-scalar") return <div className="checklist-inline-target">{context}<CustomTextFields document={document} fields={[target.field]}
    definitions={form.customFields} language={language} onDocumentChange={disabled ? () => undefined : onDocumentChange} /></div>;
  if (target.kind === "custom-coded") return <div className="checklist-inline-target">{context}<CustomCodedFields document={document} fields={[target.field]}
    definitions={form.customFields} language={language} onDocumentChange={disabled ? () => undefined : onDocumentChange} /></div>;
  const element = getNemsisDataElement(target.elementId)!;
  const configured = form.catalogFields[target.elementId];
  const label = configured ? resolveCatalogElementText(configured, target.elementId, language === "sv" ? "sv" : "en", "label") : element.name;
  const help = configured ? resolveCatalogElementText(configured, target.elementId, language === "sv" ? "sv" : "en", "description") : element.definition;
  if (target.kind === "standard-coded" && target.multiple && !finding.target.occurrenceId) return <div className="checklist-inline-target">{context}
    <StationaryCodedOccurrencesField field={{ ...configuredStationaryCodedField(element, configured), label, help }}
      values={target.values} disabled={disabled} onOpenChange={onMultiChoiceOpenChange}
      onChange={(value, selection) => onDocumentChange(editStationaryCodedValue(document, {
        groupId: target.groupId, instanceId: target.instanceId, elementId: target.elementId,
        ...(value ? { occurrenceId: value.occurrenceId } : {}), codedField: configuredStationaryCodedField(element, configured),
      }, selection))} /></div>;
  if (target.kind === "standard-coded") return <div className="checklist-inline-target">{context}<StationaryCodedValueField
    field={{ ...configuredStationaryCodedField(element, configured), label, help }} value={target.value} disabled={disabled}
    onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
      groupId: target.groupId, instanceId: target.instanceId, elementId: target.elementId,
      ...(target.value ? { occurrenceId: target.value.occurrenceId } : {}),
      codedField: configuredStationaryCodedField(element, configured),
    }, selection))} /></div>;
  const presentation = scalarControlPresentation(element, label, help);
  const exceptionalChoices = element.permittedNotValues.filter(({ code }) =>
    configured?.choiceOrder === undefined || configured.choiceOrder.some((choice) =>
      choice.kind === "not-value" && choice.code === code));
  const commit = (input: string | boolean) => {
    if (disabled) return;
    const result = editScalarOccurrence(document, { groupId: target.groupId, groupInstanceId: target.instanceId,
      elementId: target.elementId, ...(target.value ? { occurrenceId: target.value.occurrenceId } : {}), input });
    if (!result.ok) { setErrors(result.findings); return; }
    setErrors([]);
    setRaw(undefined);
    onDocumentChange(result.document);
  };
  return <div className="checklist-inline-target">{context}<StationaryScalarControl presentation={presentation} value={target.value?.kind === "scalar" ? target.value : undefined}
    exceptionalValue={target.value?.kind === "null" ? target.value : undefined}
    exceptionalChoices={exceptionalChoices}
    onExceptionalChange={(code) => {
      if (disabled) return;
      if (!code) return commit("");
      onDocumentChange(editScalarNotValue(document, { groupId: target.groupId, groupInstanceId: target.instanceId,
        elementId: target.elementId, ...(target.value ? { occurrenceId: target.value.occurrenceId } : {}), code }));
    }}
    inputValue={raw} findings={errors} disabled={disabled}
    defaultDateTime={presentation.family === "datetime" ? stationaryDateTimeDefault(document, {
      groupId: target.groupId, groupInstanceId: target.instanceId,
    }) : undefined}
    onInput={(input) => { setRaw(input); setErrors([]); if (presentation.family === "datetime") commit(input); }}
    onBlur={commit} /></div>;
}
