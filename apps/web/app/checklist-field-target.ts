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
  readonly values: ReadonlyArray<EncounterValue>;
  readonly multiple: boolean;
  readonly context: string;
  readonly kind: "standard-scalar" | "standard-coded" | "custom-scalar" | "custom-coded";
};

const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements
  .filter(({ mode }) => mode !== "read-only").map(({ id }) => id));

function entryContext(document: EncounterDocument, groupId: string, instanceId: string): string {
  const group = document.groups.find(({ id }) => id === groupId)!;
  const instance = group.instances.find(({ instanceId: id }) => id === instanceId)!;
  const index = group.instances.filter(({ parentInstanceId }) => parentInstanceId === instance.parentInstanceId)
    .findIndex(({ instanceId: id }) => id === instanceId) + 1;
  const parents = instance.parentInstanceId ? document.groups.flatMap(({ id, instances }) => instances
    .filter(({ instanceId: id }) => id === instance.parentInstanceId).map((entry) => ({ id, entry })))
    : [];
  const owner = parents?.length === 1 ? parents[0] : undefined;
  const first = owner?.entry.elements.flatMap(({ values }) => values)
    .find((value) => value.kind === "coded" || value.kind === "scalar");
  const detail = first?.kind === "coded" ? first.display || first.code : first?.kind === "scalar" ? String(first.value) : undefined;
  const name = groupId.includes("Medication") ? "Medication" : groupId.includes("Assessment") || groupId.includes("Exam")
    ? "Assessment" : groupId === "PatientCareReportGroup" ? "Report" : groupId.split(".").at(-1)!.replace(/Group$/, "");
  const ownerName = owner?.id.includes("Medication") ? "Medication" : owner?.id.includes("Assessment") || owner?.id.includes("Exam")
    ? "Assessment" : owner?.id.split(".").at(-1)?.replace(/Group$/, "");
  const ownerIndex = owner ? document.groups.find(({ id }) => id === owner.id)!.instances
    .filter(({ parentInstanceId }) => parentInstanceId === owner.entry.parentInstanceId)
    .findIndex(({ instanceId: id }) => id === owner.entry.instanceId) + 1 : undefined;
  return `${ownerName ? `${ownerName} ${ownerIndex}${detail ? `: ${detail}` : ""} · ` : ""}${name} ${index}`;
}

/** A checklist control is offered only when its canonical target is unambiguous and editable. */
export function checklistFieldTarget(finding: StationaryValidationFinding, document: EncounterDocument,
  form?: ClinicalFormConfiguration): ChecklistFieldTarget | undefined {
  if (!form || !finding.target.fieldId || !finding.target.groupInstanceId) return;
  const { groupId, groupInstanceId: instanceId, fieldId: elementId, occurrenceId } = finding.target;
  const matchingGroups = document.groups.filter(({ id }) => id === groupId);
  if (matchingGroups.length !== 1) return;
  const matchingInstances = matchingGroups[0]!.instances.filter(({ instanceId: id }) => id === instanceId);
  if (matchingInstances.length !== 1) return;
  const instance = matchingInstances[0];
  if (!instance || finding.target.parentGroupInstanceId && instance.parentInstanceId !== finding.target.parentGroupInstanceId) return;
  const values = instance.elements.find(({ id }) => id === elementId)?.values ?? [];
  if (instance.elements.filter(({ id }) => id === elementId).length > 1 ||
    occurrenceId && values.filter(({ occurrenceId: id }) => id === occurrenceId).length !== 1) return;
  const value = occurrenceId ? values.find(({ occurrenceId: id }) => id === occurrenceId)
    : values.length === 1 ? values[0] : undefined;
  if (occurrenceId && !value) return;
  if (!occurrenceId && values.length > 1 && !finding.id.startsWith("stationary:field.minimum:")) return;
  const configured = form.definition.sections.flatMap(({ fields }) => fields).filter((field) =>
    field.source.kind === "nemsis" ? field.source.elementId === elementId
      : `${form.customFields?.[field.source.elementDefinitionId]?.namespace}.${form.customFields?.[field.source.elementDefinitionId]?.slug}` === elementId);
  if (configured.length !== 1) return;
  const field = configured[0]!;
  const context = entryContext(document, groupId, instanceId);
  if (field.source.kind === "custom") {
    const definition = form.customFields?.[field.source.elementDefinitionId];
    const customGroup = field.source.groupDefinitionId ? form.customGroups?.[field.source.groupDefinitionId] : undefined;
    const expectedGroup = customGroup ? `${customGroup.namespace}.${customGroup.slug}`
      : definition?.correlatesTo ?? "PatientCareReportGroup";
    if (!definition || groupId !== expectedGroup || field.source.groupDefinitionId && !customGroup ||
      definition.recurrence === "single" && values.length > 1) return;
    return { field, groupId, instanceId, elementId, value, values, context,
      multiple: definition.recurrence === "multiple",
      kind: definition.datatype === "coded" ? "custom-coded" : "custom-scalar" };
  }
  const element = getNemsisDataElement(elementId);
  const maximum = form.catalogFields[elementId]?.maxOccurs ?? element?.occurrence.max;
  if (!element || element.groupPath.at(-1) !== groupId || !editableElements.has(elementId) ||
    maximum === 0 || maximum === 1 && values.length > 1) return;
  return { field, groupId, instanceId, elementId, value, values, context, multiple: maximum !== 1,
    kind: element.valueSource.kind === "scalar" ? "standard-scalar" : "standard-coded" };
}
