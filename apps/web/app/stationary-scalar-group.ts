import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { requireNemsisDataElement } from "./nemsis-data-model";
import { scalarControlPresentation } from "./stationary-scalar";

export const STATIONARY_SCALAR_GROUP_ID = "ePatient.PatientNameGroup";
export const STATIONARY_SCALAR_ELEMENT_IDS = ["ePatient.02", "ePatient.03", "ePatient.04"] as const;

const configuredGroup = COMPILED_STATIONARY_LAYOUT.groups.find(({ id }) => id === STATIONARY_SCALAR_GROUP_ID);
if (!configuredGroup || configuredGroup.mode === "read-only") throw new Error(`${STATIONARY_SCALAR_GROUP_ID} must be editable in the stationary layout`);
for (const id of STATIONARY_SCALAR_ELEMENT_IDS) {
  const placement = COMPILED_STATIONARY_LAYOUT.elements.find((candidate) => candidate.id === id);
  if (!placement || placement.groupId !== STATIONARY_SCALAR_GROUP_ID || placement.mode === "read-only") {
    throw new Error(`${id} must be editable in ${STATIONARY_SCALAR_GROUP_ID}`);
  }
}

export const STATIONARY_SCALAR_FIELDS = STATIONARY_SCALAR_ELEMENT_IDS.map((id) => {
  const catalog = requireNemsisDataElement(id);
  const placement = COMPILED_STATIONARY_LAYOUT.elements.find((candidate) => candidate.id === id)!;
  return {
    ...scalarControlPresentation(catalog, placement.label ?? catalog.name, placement.help ?? catalog.definition),
    id,
  };
});

export function stationaryScalarValues(document: EncounterDocument): Readonly<Record<string, string>> {
  const instance = document.groups.find(({ id }) => id === STATIONARY_SCALAR_GROUP_ID)?.instances[0];
  return Object.fromEntries(STATIONARY_SCALAR_ELEMENT_IDS.map((id) => {
    const value = instance?.elements.find((element) => element.id === id)?.values[0];
    return [id, value?.kind === "scalar" ? String(value.value) : ""];
  }));
}

/** Replaces one canonical scalar value while retaining its group and occurrence identities. */
export function editStationaryScalarValue(
  document: EncounterDocument,
  elementId: typeof STATIONARY_SCALAR_ELEMENT_IDS[number],
  value: string,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): EncounterDocument {
  if (!STATIONARY_SCALAR_ELEMENT_IDS.includes(elementId)) throw new Error(`${elementId} is not configured in the stationary scalar group`);
  const groupIndex = document.groups.findIndex(({ id }) => id === STATIONARY_SCALAR_GROUP_ID);
  if (groupIndex < 0) throw new Error(`Canonical document is missing ${STATIONARY_SCALAR_GROUP_ID}`);
  const group = document.groups[groupIndex]!;
  const instance = group.instances[0];
  if (!instance) throw new Error(`Canonical document is missing an occurrence of ${STATIONARY_SCALAR_GROUP_ID}`);
  const elementIndex = instance.elements.findIndex(({ id }) => id === elementId);
  const existingElement = instance.elements[elementIndex];
  const existingValue = existingElement?.values[0];
  const nextValues: EncounterValue[] = value.length
    ? [{ ...(existingValue?.attributes ? { attributes: existingValue.attributes } : {}), kind: "scalar", occurrenceId: existingValue?.occurrenceId ?? createId(), value }]
    : [];
  const elements = [...instance.elements];
  if (existingElement) elements[elementIndex] = { ...existingElement, values: nextValues };
  else if (value.length) elements.push({ id: elementId, values: nextValues });
  const instances = [...group.instances];
  instances[0] = { ...instance, elements };
  const groups = [...document.groups];
  groups[groupIndex] = { ...group, instances };
  return { ...document, encounter: { ...document.encounter, updatedAt: now.toISOString() }, groups };
}
