"use client";

import type { CatalogDraftCustomGroup, ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, FormDraftField } from "@open-triage/contracts";
import React from "react";
import { RepeatedCustomFields } from "./repeated-custom-fields";
import { getNemsisGroup } from "../app/nemsis-data-model";

const ROOT = "PatientCareReportGroup";

export function customGroupInstances(document: EncounterDocument, definition: CatalogDraftCustomGroup): ReadonlyArray<EncounterGroupInstance> {
  return document.groups.find((group) => group.id === `${definition.namespace}.${definition.slug}`)?.instances ?? [];
}

export function addCustomGroupInstance(document: EncounterDocument, definition: CatalogDraftCustomGroup, parentInstanceId: string, instanceId: string): EncounterDocument {
  const parent = document.groups.find((group) => group.id === (definition.correlatesTo ?? ROOT))?.instances.find((instance) => instance.instanceId === parentInstanceId);
  if (!parent) throw new Error(`Missing custom group parent ${parentInstanceId}`);
  const instances = customGroupInstances(document, definition);
  if (definition.recurrence === "single" && instances.some((instance) => instance.parentInstanceId === parentInstanceId))
    throw new Error("Custom group permits one entry per target");
  if (instances.some((instance) => instance.instanceId === instanceId)) throw new Error("Duplicate custom group identity");
  const groupId = `${definition.namespace}.${definition.slug}`;
  const newInstance = { instanceId, parentInstanceId, elements: [] };
  return document.groups.some((group) => group.id === groupId)
    ? { ...document, groups: document.groups.map((group) => group.id === groupId ? { ...group, instances: [...group.instances, newInstance] } : group) }
    : { ...document, groups: [...document.groups, { id: groupId, instances: [newInstance] }] };
}

export function removeCustomGroupInstance(document: EncounterDocument, definition: CatalogDraftCustomGroup, instanceId: string): EncounterDocument {
  const groupId = `${definition.namespace}.${definition.slug}`;
  return { ...document, groups: document.groups.map((group) => group.id === groupId
    ? { ...group, instances: group.instances.filter((instance) => instance.instanceId !== instanceId) } : group) };
}

function parentLabel(parent: EncounterGroupInstance, target: string | undefined, language: string): string {
  if (!target) return language === "sv" ? "Patientrapport" : "Patient report";
  const kind = target === "eMedications.MedicationGroup" ? language === "sv" ? "Läkemedel" : "Medication"
    : target === "eExam.AssessmentGroup" ? language === "sv" ? "Bedömning" : "Assessment"
      : getNemsisGroup(target)?.name ?? target;
  const value = parent.elements.flatMap((element) => element.values)
    .find((candidate) => candidate.kind === "coded" || candidate.kind === "scalar");
  const detail = value?.kind === "coded" ? value.display || value.code
    : value?.kind === "scalar" ? String(value.value) : parent.instanceId;
  return `${kind}: ${detail}`;
}

export function CustomGroupFields({ document, fields, definitions, groups, language = "en", onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly fields: ReadonlyArray<FormDraftField>;
  readonly definitions?: ClinicalFormConfiguration["customFields"];
  readonly groups?: ClinicalFormConfiguration["customGroups"];
  readonly language?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const groupedFields = new Map<string, FormDraftField[]>();
  for (const field of fields) if (field.source.kind === "custom" && field.source.groupDefinitionId) {
    const entries = groupedFields.get(field.source.groupDefinitionId) ?? [];
    entries.push(field);
    groupedFields.set(field.source.groupDefinitionId, entries);
  }
  return <div className="custom-group-fields">{[...groupedFields].map(([groupDefinitionId, memberFields]) => {
    const definition = groups?.[groupDefinitionId];
    if (!definition) return null;
    const groupId = `${definition.namespace}.${definition.slug}`;
    const parents = document.groups.find((group) => group.id === (definition.correlatesTo ?? ROOT))?.instances ?? [];
    const title = language === "sv" ? definition.localization?.sv?.label || definition.title : definition.title;
    return <section key={groupDefinitionId} data-custom-group-definition-id={groupDefinitionId}>
      <h3>{title}</h3>
      {parents.map((parent) => {
        const instances = customGroupInstances(document, definition).filter((instance) => instance.parentInstanceId === parent.instanceId);
        return <div key={parent.instanceId} data-custom-group-parent-id={parent.instanceId}>
          <h4>{parentLabel(parent, definition.correlatesTo, language)}</h4>
          {instances.map((instance, index) => <div key={instance.instanceId} data-custom-group-instance-id={instance.instanceId}>
            <h5>{title} {index + 1}</h5>
            <RepeatedCustomFields document={document} fields={memberFields} definitions={definitions} language={language}
              targetGroupId={groupId} targetInstanceId={instance.instanceId} onDocumentChange={onDocumentChange} />
            <button className="button-danger" type="button" onClick={() => onDocumentChange(removeCustomGroupInstance(document, definition, instance.instanceId))}>
              {language === "sv" ? "Ta bort grupp" : "Remove group"}</button>
          </div>)}
          {(definition.recurrence === "multiple" || instances.length === 0) && <button type="button" onClick={() =>
            onDocumentChange(addCustomGroupInstance(document, definition, parent.instanceId, crypto.randomUUID()))}>
            {language === "sv" ? "Lägg till grupp" : "Add group"}</button>}
        </div>;
      })}
    </section>;
  })}</div>;
}
