import type { EncounterDocument, EncounterGroupInstance } from "@open-triage/contracts";
import { editStationaryCodedValue, type StationaryCodedField, type StationaryCodedSelection } from "./stationary-coded-value";
import {
  editScalarOccurrence,
  scalarControlPresentation,
  type ScalarEditResult,
  type ScalarControlPresentation,
} from "./stationary-scalar";
import {
  COMPILED_STATIONARY_LAYOUT,
  type CompiledStationaryGroup,
  type StationaryElementPlacement,
  type StationaryMode,
} from "./stationary-layout";
import {
  getNemsisGroup,
  requireNemsisDataElement,
  type NemsisDataElement,
  type NemsisGroup,
} from "./nemsis-data-model";

export type StationaryNonRepeatingField = {
  readonly id: string;
  readonly groupId: string;
  readonly mode: StationaryMode;
  readonly readOnly: boolean;
  readonly optional: boolean;
  readonly catalog: NemsisDataElement;
  readonly scalar?: ScalarControlPresentation;
};

export type StationaryNonRepeatingGroup = {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: ReadonlyArray<string>;
  readonly depth: number;
  readonly label: string;
  readonly help?: string;
  readonly mode: StationaryMode;
  readonly readOnly: boolean;
  readonly optional: boolean;
  readonly catalog: NemsisGroup;
  readonly fields: ReadonlyArray<StationaryNonRepeatingField>;
};

function fieldPresentation(group: CompiledStationaryGroup, placement: StationaryElementPlacement): StationaryNonRepeatingField {
  const catalog = requireNemsisDataElement(placement.id);
  const readOnly = group.mode === "read-only" || placement.mode === "read-only";
  return Object.freeze({
    id: placement.id,
    groupId: group.id,
    mode: placement.mode,
    readOnly,
    optional: catalog.occurrence.min === 0,
    catalog,
    ...(catalog.valueSource.kind === "scalar" ? {
      scalar: scalarControlPresentation(catalog, placement.label ?? catalog.name, placement.help ?? catalog.definition),
    } : {}),
  });
}

function collectNonRepeating(
  group: CompiledStationaryGroup,
  ancestors: ReadonlyArray<string>,
  result: StationaryNonRepeatingGroup[],
): void {
  const catalog = getNemsisGroup(group.id);
  if (!catalog) return;
  const path = [...ancestors, group.id];
  if (!catalog.repeating) {
    result.push(Object.freeze({
      id: group.id,
      parentId: group.parentId,
      path,
      depth: ancestors.length,
      label: group.presentation.label ?? catalog.name,
      ...(group.presentation.help ? { help: group.presentation.help } : {}),
      mode: group.mode,
      readOnly: group.mode === "read-only",
      optional: catalog.occurrence.min === 0,
      catalog,
      fields: Object.freeze(group.elements.map((placement) => fieldPresentation(group, placement))),
    }));
  }
  group.children.forEach((child) => collectNonRepeating(child, path, result));
}

const compiledNonRepeatingGroups: StationaryNonRepeatingGroup[] = [];
COMPILED_STATIONARY_LAYOUT.hierarchy.forEach((group) => collectNonRepeating(group, [], compiledNonRepeatingGroups));

/** Complete, canonical pre-order projection used by the inline renderer. */
export const STATIONARY_NON_REPEATING_GROUPS: ReadonlyArray<StationaryNonRepeatingGroup> = Object.freeze(compiledNonRepeatingGroups);

const groupPresentations = new Map(STATIONARY_NON_REPEATING_GROUPS.map((group) => [group.id, group]));
const elementPlacements = new Map(COMPILED_STATIONARY_LAYOUT.elements.map((element) => [element.id, element]));

export function requireEditableNonRepeatingElement(groupId: string, elementId: string): StationaryNonRepeatingField {
  const group = groupPresentations.get(groupId);
  if (!group) throw new Error(`${groupId} is not a configured non-repeating group`);
  const field = group.fields.find(({ id }) => id === elementId);
  if (!field || elementPlacements.get(elementId)?.groupId !== groupId) throw new Error(`${elementId} is not configured in ${groupId}`);
  if (group.readOnly || field.readOnly) throw new Error(`${elementId} is read-only system-owned metadata`);
  return field;
}

function instanceForParent(document: EncounterDocument, groupId: string, parentInstanceId: string | undefined): EncounterGroupInstance | undefined {
  const instances = document.groups.find(({ id }) => id === groupId)?.instances ?? [];
  return parentInstanceId === undefined
    ? instances.find((instance) => instance.parentInstanceId === undefined) ?? (instances.length === 1 ? instances[0] : undefined)
    : instances.find((instance) => instance.parentInstanceId === parentInstanceId);
}

function appendGroupInstance(document: EncounterDocument, groupId: string, instance: EncounterGroupInstance): EncounterDocument {
  const index = document.groups.findIndex(({ id }) => id === groupId);
  if (index < 0) return { ...document, groups: [...document.groups, { id: groupId, instances: [instance] }] };
  const groups = [...document.groups];
  const group = groups[index]!;
  groups[index] = { ...group, instances: [...group.instances, instance] };
  return { ...document, groups };
}

/** A New patient report has no dispatch skeleton; create its single PCR ancestry on first edit. */
function ensurePatientCareReportInstance(document: EncounterDocument, createId: () => string):
  { readonly document: EncounterDocument; readonly instance: EncounterGroupInstance } | undefined {
  const existing = document.groups.find(({ id }) => id === "PatientCareReportGroup")?.instances ?? [];
  if (existing.length === 1) return { document, instance: existing[0]! };
  if (existing.length > 1) return undefined;
  const dataset = ensureNonRepeatingInstance(document, "EMSDataSet", undefined, createId);
  let next = dataset.document;
  const headers = next.groups.find(({ id }) => id === "HeaderGroup")?.instances ?? [];
  if (headers.length > 1) return undefined;
  const header = headers[0] ?? { instanceId: createId(), parentInstanceId: dataset.instance.instanceId, elements: [] };
  if (!headers.length) next = appendGroupInstance(next, "HeaderGroup", header);
  const instance: EncounterGroupInstance = { instanceId: createId(), parentInstanceId: header.instanceId, elements: [] };
  return { document: appendGroupInstance(next, "PatientCareReportGroup", instance), instance };
}

export function ensureNonRepeatingInstance(
  document: EncounterDocument,
  groupId: string,
  requestedParentInstanceId: string | undefined,
  createId: () => string,
): { readonly document: EncounterDocument; readonly instance: EncounterGroupInstance } {
  const catalog = getNemsisGroup(groupId);
  if (!catalog || catalog.repeating) throw new Error(`${groupId} is not a non-repeating NEMSIS group`);
  const parent = catalog.parentId ? getNemsisGroup(catalog.parentId) : undefined;
  let next = document;
  let parentInstanceId = requestedParentInstanceId;
  if (parent) {
    if (parent.repeating) {
      const parentInstances = next.groups.find(({ id }) => id === parent.id)?.instances ?? [];
      let chosen = parentInstanceId
        ? parentInstances.find(({ instanceId }) => instanceId === parentInstanceId)
        : parentInstances.length === 1 ? parentInstances[0] : undefined;
      if (!chosen && !parentInstanceId && parent.id === "PatientCareReportGroup" && parentInstances.length === 0) {
        const created = ensurePatientCareReportInstance(next, createId);
        if (created) { next = created.document; chosen = created.instance; }
      }
      if (!chosen) throw new Error(`${groupId} requires a containing ${parent.id} occurrence`);
      parentInstanceId = chosen.instanceId;
    } else {
      const explicitParent = requestedParentInstanceId
        ? next.groups.find(({ id }) => id === parent.id)?.instances.find(({ instanceId }) => instanceId === requestedParentInstanceId)
        : undefined;
      const ensuredParent = explicitParent
        ? { document: next, instance: explicitParent }
        : ensureNonRepeatingInstance(next, parent.id, requestedParentInstanceId, createId);
      next = ensuredParent.document;
      parentInstanceId = ensuredParent.instance.instanceId;
    }
  } else {
    parentInstanceId = undefined;
  }
  const existing = instanceForParent(next, groupId, parentInstanceId);
  if (existing) return { document: next, instance: existing };
  const instance: EncounterGroupInstance = {
    instanceId: createId(),
    ...(parentInstanceId ? { parentInstanceId } : {}),
    elements: [],
  };
  const groupIndex = next.groups.findIndex(({ id }) => id === groupId);
  const groups = [...next.groups];
  if (groupIndex < 0) groups.push({ id: groupId, instances: [instance] });
  else {
    const group = groups[groupIndex]!;
    groups[groupIndex] = { ...group, instances: [...group.instances, instance] };
  }
  return { document: { ...next, groups }, instance };
}

/** Returns existing inline occurrences without manufacturing identities during render. */
export function nonRepeatingGroupInstances(document: EncounterDocument, groupId: string): ReadonlyArray<EncounterGroupInstance> {
  if (!groupPresentations.has(groupId)) throw new Error(`${groupId} is not a configured non-repeating group`);
  return document.groups.find(({ id }) => id === groupId)?.instances ?? [];
}

/** Edits through the generic scalar contract and creates only the missing single-occurrence ancestry. */
export function editNonRepeatingScalarValue(
  document: EncounterDocument,
  target: { readonly groupId: string; readonly elementId: string; readonly groupInstanceId?: string; readonly parentInstanceId?: string; readonly occurrenceId?: string },
  input: string | boolean,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): ScalarEditResult {
  const field = requireEditableNonRepeatingElement(target.groupId, target.elementId);
  if (!field.scalar) throw new Error(`${target.elementId} is coded, not scalar`);
  const currentInstance = target.groupInstanceId
    ? nonRepeatingGroupInstances(document, target.groupId).find(({ instanceId }) => instanceId === target.groupInstanceId)
    : undefined;
  if (target.groupInstanceId && !currentInstance) throw new Error(`${target.groupId} is missing instance ${target.groupInstanceId}`);
  if (!currentInstance && input === "" && field.catalog.occurrence.min === 0) return { ok: true, document, occurrenceId: target.occurrenceId ?? "" };
  const ensured = currentInstance
    ? { document, instance: currentInstance }
    : ensureNonRepeatingInstance(document, target.groupId, target.parentInstanceId, createId);
  return editScalarOccurrence(ensured.document, {
    groupId: target.groupId,
    groupInstanceId: ensured.instance.instanceId,
    elementId: target.elementId,
    ...(target.occurrenceId ? { occurrenceId: target.occurrenceId } : {}),
    input,
  }, createId, now);
}

/** Coded/exceptional counterpart with the same ownership and ancestry enforcement. */
export function editNonRepeatingCodedValue(
  document: EncounterDocument,
  target: { readonly groupId: string; readonly elementId: string; readonly groupInstanceId?: string; readonly parentInstanceId?: string; readonly occurrenceId?: string; readonly codedField?: StationaryCodedField },
  selection: StationaryCodedSelection | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): EncounterDocument {
  const field = requireEditableNonRepeatingElement(target.groupId, target.elementId);
  if (field.scalar) throw new Error(`${target.elementId} is scalar, not coded`);
  const currentInstance = target.groupInstanceId
    ? nonRepeatingGroupInstances(document, target.groupId).find(({ instanceId }) => instanceId === target.groupInstanceId)
    : undefined;
  if (target.groupInstanceId && !currentInstance) throw new Error(`${target.groupId} is missing instance ${target.groupInstanceId}`);
  if (!currentInstance && !selection) return document;
  const ensured = currentInstance
    ? { document, instance: currentInstance }
    : ensureNonRepeatingInstance(document, target.groupId, target.parentInstanceId, createId);
  return editStationaryCodedValue(ensured.document, {
    groupId: target.groupId,
    instanceId: ensured.instance.instanceId,
    elementId: target.elementId,
    ...(target.codedField ? { codedField: target.codedField } : {}),
    ...(target.occurrenceId ? { occurrenceId: target.occurrenceId } : {}),
  }, selection, createId, now);
}
