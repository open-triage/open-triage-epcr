import type { ClinicalFormConfiguration, EncounterDocument, EncounterValue, FormDraftField } from "@open-triage/contracts";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { getNemsisDataElement } from "./nemsis-data-model";
import type { StationaryValidationFinding } from "./stationary-validation";

export type ChecklistFieldTarget = {
  readonly field: FormDraftField;
  readonly groupId: string;
  readonly instanceId: string;
  readonly elementId: string;
  readonly value?: EncounterValue;
  readonly kind: "standard-scalar" | "standard-coded" | "custom-scalar" | "custom-coded";
};

const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements
  .filter(({ mode }) => mode !== "read-only").map(({ id }) => id));

/** Only a finding with one configured, existing, single-value field may edit in place. */
export function checklistFieldTarget(finding: StationaryValidationFinding, document: EncounterDocument,
  form?: ClinicalFormConfiguration): ChecklistFieldTarget | undefined {
  if (!form || !finding.target.fieldId || !finding.target.groupInstanceId || finding.target.parentGroupInstanceId) return;
  const { groupId, groupInstanceId: instanceId, fieldId: elementId, occurrenceId } = finding.target;
  const instance = document.groups.find(({ id }) => id === groupId)?.instances
    .find(({ instanceId: id }) => id === instanceId);
  if (!instance) return;
  const values = instance.elements.find(({ id }) => id === elementId)?.values ?? [];
  if (values.length > 1 || (occurrenceId && values[0]?.occurrenceId !== occurrenceId)) return;
  const configured = form.definition.sections.flatMap(({ fields }) => fields).filter((field) =>
    field.source.kind === "nemsis" ? field.source.elementId === elementId
      : `${form.customFields?.[field.source.elementDefinitionId]?.namespace}.${form.customFields?.[field.source.elementDefinitionId]?.slug}` === elementId);
  if (configured.length !== 1) return;
  const field = configured[0]!;
  if (field.source.kind === "custom") {
    const definition = form.customFields?.[field.source.elementDefinitionId];
    if (!definition || groupId !== "PatientCareReportGroup" || field.source.groupDefinitionId ||
      definition.recurrence === "multiple" || definition.correlatesTo) return;
    return { field, groupId, instanceId, elementId, value: values[0],
      kind: definition.datatype === "coded" ? "custom-coded" : "custom-scalar" };
  }
  const element = getNemsisDataElement(elementId);
  const maximum = form.catalogFields[elementId]?.maxOccurs ?? element?.occurrence.max;
  if (!element || element.groupPath.at(-1) !== groupId || !editableElements.has(elementId) ||
    maximum !== 1 || element.occurrence.max !== 1) return;
  return { field, groupId, instanceId, elementId, value: values[0],
    kind: element.valueSource.kind === "scalar" ? "standard-scalar" : "standard-coded" };
}
