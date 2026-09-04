import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import { COMPILED_STATIONARY_LAYOUT, type CompiledStationaryGroup } from "./stationary-layout";
import { getNemsisGroup, NEMSIS_DATA_MODEL } from "./nemsis-data-model";
import { ensureNonRepeatingInstance } from "./stationary-non-repeating";

export type RepeatingGroupFinding = {
  readonly code: "cardinality" | "parent" | "identity";
  readonly message: string;
};

export type RepeatingGroupEditResult =
  | { readonly ok: true; readonly document: EncounterDocument; readonly instanceId: string }
  | { readonly ok: false; readonly document: EncounterDocument; readonly findings: ReadonlyArray<RepeatingGroupFinding> };

export type RepeatingGroupSummaryCell = {
  readonly elementId: string;
  readonly label: string;
  readonly values: ReadonlyArray<{ readonly occurrenceId: string; readonly text: string }>;
};

export function configuredRepeatingGroups(): ReadonlyArray<CompiledStationaryGroup> {
  const groups: CompiledStationaryGroup[] = [];
  const visit = (group: CompiledStationaryGroup) => {
    if (group.presentation.kind === "table") groups.push(group);
    group.children.forEach(visit);
  };
  COMPILED_STATIONARY_LAYOUT.hierarchy.forEach(visit);
  return groups;
}

export function repeatingGroupInstances(
  document: EncounterDocument,
  groupId: string,
  parentInstanceId?: string,
): ReadonlyArray<EncounterGroupInstance> {
  const instances = document.groups.find(({ id }) => id === groupId)?.instances ?? [];
  return parentInstanceId === undefined ? instances : instances.filter((instance) => instance.parentInstanceId === parentInstanceId);
}

export function eligibleRepeatingGroupParents(document: EncounterDocument, groupId: string): ReadonlyArray<EncounterGroupInstance> {
  const group = getNemsisGroup(groupId);
  if (!group) return [];
  if (group.parentId === null) return [];
  return document.groups.find(({ id }) => id === group.parentId)?.instances ?? [];
}

function changed(document: EncounterDocument, groups: EncounterDocument["groups"], now: Date): EncounterDocument {
  return { ...document, encounter: { ...document.encounter, updatedAt: now.toISOString() }, groups };
}

function failure(document: EncounterDocument, code: RepeatingGroupFinding["code"], message: string): RepeatingGroupEditResult {
  return { ok: false, document, findings: [{ code, message }] };
}

/** Adds a canonical group occurrence beneath an existing canonical parent occurrence. */
export function addRepeatingGroupOccurrence(
  document: EncounterDocument,
  groupId: string,
  parentInstanceId: string | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): RepeatingGroupEditResult {
  const catalogGroup = getNemsisGroup(groupId);
  if (!catalogGroup?.repeating) throw new Error(`${groupId} is not a catalog repeating group`);
  let nextDocument = document;
  let resolvedParentInstanceId = parentInstanceId;
  if (catalogGroup.parentId !== null) {
    let parentExists = nextDocument.groups.find(({ id }) => id === catalogGroup.parentId)?.instances
      .some(({ instanceId }) => instanceId === resolvedParentInstanceId);
    const parentCatalog = getNemsisGroup(catalogGroup.parentId);
    if (!resolvedParentInstanceId && !parentCatalog?.repeating) {
      try {
        const ensured = ensureNonRepeatingInstance(nextDocument, catalogGroup.parentId, undefined, createId);
        nextDocument = ensured.document;
        resolvedParentInstanceId = ensured.instance.instanceId;
        parentExists = true;
      } catch { /* A missing or ambiguous repeating ancestor is reported below. */ }
    }
    if (!parentExists) return failure(document, "parent", `${catalogGroup.name} requires an existing ${catalogGroup.parentId} parent.`);
  } else if (parentInstanceId !== undefined) {
    return failure(document, "parent", `${catalogGroup.name} is a root group and cannot have a parent occurrence.`);
  }
  const existing = repeatingGroupInstances(nextDocument, groupId, resolvedParentInstanceId);
  if (catalogGroup.occurrence.max !== "unbounded" && existing.length >= catalogGroup.occurrence.max) {
    return failure(document, "cardinality", `${catalogGroup.name} allows ${catalogGroup.occurrence.max} occurrence${catalogGroup.occurrence.max === 1 ? "" : "s"} per parent.`);
  }
  const instanceId = createId();
  if (nextDocument.groups.some((group) => group.instances.some((instance) => instance.instanceId === instanceId))) {
    return failure(document, "identity", `Group occurrence identity ${instanceId} is already in use.`);
  }
  const instance: EncounterGroupInstance = {
    instanceId,
    ...(resolvedParentInstanceId ? { parentInstanceId: resolvedParentInstanceId } : {}),
    elements: [],
  };
  const groupIndex = nextDocument.groups.findIndex(({ id }) => id === groupId);
  const groups = [...nextDocument.groups];
  if (groupIndex < 0) groups.push({ id: groupId, instances: [instance] });
  else groups[groupIndex] = { ...groups[groupIndex]!, instances: [...groups[groupIndex]!.instances, instance] };
  return { ok: true, document: changed(nextDocument, groups, now), instanceId };
}

function descendantInstanceIds(document: EncounterDocument, instanceId: string): Set<string> {
  const descendants = new Set([instanceId]);
  let size = 0;
  while (size !== descendants.size) {
    size = descendants.size;
    for (const group of document.groups) for (const instance of group.instances) {
      if (instance.parentInstanceId && descendants.has(instance.parentInstanceId)) descendants.add(instance.instanceId);
    }
  }
  return descendants;
}

/** Removes a row and any nested group rows owned by it, retaining catalog minimums. */
export function removeRepeatingGroupOccurrence(
  document: EncounterDocument,
  groupId: string,
  instanceId: string,
  now = new Date(),
): RepeatingGroupEditResult {
  const catalogGroup = getNemsisGroup(groupId);
  if (!catalogGroup?.repeating) throw new Error(`${groupId} is not a catalog repeating group`);
  const group = document.groups.find(({ id }) => id === groupId);
  const instance = group?.instances.find((candidate) => candidate.instanceId === instanceId);
  if (!group || !instance) return failure(document, "identity", `${catalogGroup.name} occurrence ${instanceId} does not exist.`);
  const siblings = repeatingGroupInstances(document, groupId, instance.parentInstanceId);
  if (siblings.length <= catalogGroup.occurrence.min) {
    return failure(document, "cardinality", `${catalogGroup.name} requires ${catalogGroup.occurrence.min} occurrence${catalogGroup.occurrence.min === 1 ? "" : "s"} per parent.`);
  }
  const removedIds = descendantInstanceIds(document, instanceId);
  const groups = document.groups.flatMap((candidate) => {
    const instances = candidate.instances.filter(({ instanceId: id }) => !removedIds.has(id));
    return instances.length ? [{ ...candidate, instances }] : [];
  });
  return { ok: true, document: changed(document, groups, now), instanceId };
}

/** Reorders rows only within their canonical parent occurrence. */
export function moveRepeatingGroupOccurrence(
  document: EncounterDocument,
  groupId: string,
  instanceId: string,
  toIndex: number,
  now = new Date(),
): RepeatingGroupEditResult {
  const catalogGroup = getNemsisGroup(groupId);
  if (!catalogGroup?.repeating) throw new Error(`${groupId} is not a catalog repeating group`);
  const groupIndex = document.groups.findIndex(({ id }) => id === groupId);
  const group = document.groups[groupIndex];
  const moving = group?.instances.find((instance) => instance.instanceId === instanceId);
  if (!group || !moving) return failure(document, "identity", `${catalogGroup.name} occurrence ${instanceId} does not exist.`);
  const siblings = group.instances.filter(({ parentInstanceId }) => parentInstanceId === moving.parentInstanceId);
  const fromIndex = siblings.findIndex((instance) => instance.instanceId === instanceId);
  if (toIndex < 0 || toIndex >= siblings.length) return failure(document, "cardinality", `The requested ${catalogGroup.name} row order is unavailable.`);
  const reordered = [...siblings];
  reordered.splice(toIndex, 0, reordered.splice(fromIndex, 1)[0]!);
  let nextSibling = 0;
  const instances = group.instances.map((instance) => instance.parentInstanceId === moving.parentInstanceId ? reordered[nextSibling++]! : instance);
  const groups = [...document.groups];
  groups[groupIndex] = { ...group, instances };
  return { ok: true, document: changed(document, groups, now), instanceId };
}

export function encounterValueSummary(value: EncounterValue): string {
  if (value.kind === "scalar") return value.lexical ?? String(value.value);
  if (value.kind === "coded") return value.display ?? value.code;
  if (value.kind === "pertinent-negative") return value.display ?? `Pertinent negative (${value.code})`;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "No value";
  return "Not recorded";
}

/** Resolves configured columns through descendant elements while retaining occurrence ids. */
export function repeatingGroupSummary(
  document: EncounterDocument,
  placement: CompiledStationaryGroup,
  instance: EncounterGroupInstance,
): ReadonlyArray<RepeatingGroupSummaryCell> {
  return (placement.presentation.columns ?? []).map((column) => {
    const element = NEMSIS_DATA_MODEL.elements.find(({ id }) => id === column.elementId);
    const ownerGroupId = element?.groupPath.at(-1);
    const ownerInstances = ownerGroupId === placement.id ? [instance]
      : document.groups.find(({ id }) => id === ownerGroupId)?.instances.filter(({ parentInstanceId }) => parentInstanceId === instance.instanceId) ?? [];
    const values = ownerInstances.flatMap((owner) => owner.elements.find(({ id }) => id === column.elementId)?.values ?? []);
    return {
      elementId: column.elementId,
      label: column.label ?? element?.name ?? column.elementId,
      values: values.map((value) => ({ occurrenceId: value.occurrenceId, text: encounterValueSummary(value) })),
    };
  });
}
