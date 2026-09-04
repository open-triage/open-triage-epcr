import type { EncounterDocument, EncounterGroupInstance } from "@open-triage/contracts";
import { stableDraftId, type SaveDraftReportCommand } from "./draft-report";

const OWNER = "x-open-triage-owner";

function clinicianOwned(instance: EncounterGroupInstance): boolean {
  return instance.attributes?.[OWNER] === "clinician";
}

export type PendingDraftTargets = {
  readonly groupIds: ReadonlySet<string>;
  readonly occurrenceIds: ReadonlySet<string>;
};

function mutationChanged<T>(current: T, baseline: T | undefined): boolean {
  return baseline === undefined || JSON.stringify(current) !== JSON.stringify(baseline);
}

/** Identifies the actual local targets in a full-document draft command. */
export function pendingDraftTargets(
  command: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
  baseline: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): PendingDraftTargets {
  const baselineGroups = new Map(baseline.groups.map((group) => [group.id, group]));
  const baselineOccurrences = new Map(baseline.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  return {
    groupIds: new Set(command.groups.filter((group) => mutationChanged(group, baselineGroups.get(group.id))).map(({ id }) => id)),
    occurrenceIds: new Set(command.occurrences.filter((occurrence) => mutationChanged(occurrence, baselineOccurrences.get(occurrence.id))).map(({ id }) => id)),
  };
}

function targetId(reportId: string, kind: "group" | "occurrence", id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : stableDraftId(reportId, `${kind}:${id}`);
}

function mergeInstance(
  reportId: string,
  local: EncounterGroupInstance,
  server: EncounterGroupInstance,
  targets: PendingDraftTargets,
): EncounterGroupInstance {
  const localElements = new Map(local.elements.map((element) => [element.id, element]));
  const elementIds = new Set([...server.elements.map(({ id }) => id), ...local.elements.map(({ id }) => id)]);
  const elements = [...elementIds].flatMap((elementId) => {
    const localElement = localElements.get(elementId);
    const serverElement = server.elements.find(({ id }) => id === elementId);
    const localChanged = localElement?.values.filter((value) => targets.occurrenceIds.has(targetId(reportId, "occurrence", value.occurrenceId))) ?? [];
    const localChangedIds = new Set(localChanged.map((value) => targetId(reportId, "occurrence", value.occurrenceId)));
    const serverValues = serverElement?.values.filter((value) => !localChangedIds.has(targetId(reportId, "occurrence", value.occurrenceId))) ?? [];
    const values = [...serverValues, ...localChanged];
    return values.length ? [{ ...(serverElement ?? localElement!), values }] : [];
  });
  return { ...server, elements };
}

/**
 * Applies the server's current inbound snapshot while retaining locally edited
 * clinician groups. Stable draft identities match a local group to its
 * normalized server identity after the first successful save.
 */
export function reconcileActiveReportDocument(
  reportId: string,
  local: EncounterDocument,
  server: EncounterDocument,
  preservePendingClinicianEdits = true,
  pendingTargets?: PendingDraftTargets,
): EncounterDocument {
  if (!preservePendingClinicianEdits) return server;
  if (pendingTargets) {
    const localInstances = new Map(local.groups.flatMap((group) => group.instances.map((instance) => [
      targetId(reportId, "group", instance.instanceId), instance,
    ] as const)));
    const groups = server.groups.map((group) => ({
      ...group,
      instances: group.instances.flatMap((serverInstance) => {
        const id = targetId(reportId, "group", serverInstance.instanceId);
        const localInstance = localInstances.get(id);
        if (pendingTargets.groupIds.has(id) && !localInstance) return [];
        if (pendingTargets.groupIds.has(id) && localInstance) return [localInstance];
        return [localInstance ? mergeInstance(reportId, localInstance, serverInstance, pendingTargets) : serverInstance];
      }),
    }));
    const serverGroupIds = new Set(server.groups.flatMap((group) => group.instances.map((instance) => targetId(reportId, "group", instance.instanceId))));
    for (const localGroup of local.groups) {
      const additions = localGroup.instances.filter((instance) => {
        const id = targetId(reportId, "group", instance.instanceId);
        return pendingTargets.groupIds.has(id) && !serverGroupIds.has(id);
      });
      if (!additions.length) continue;
      const existing = groups.find((group) => group.id === localGroup.id);
      if (existing) (existing as { instances: EncounterGroupInstance[] }).instances.push(...additions);
      else groups.push({ ...localGroup, instances: additions });
    }
    return { ...server, groups: groups.filter((group) => group.instances.length > 0) };
  }
  const localByGroup = new Map(local.groups.map((group) => [group.id, group]));
  const groupIds = new Set([...server.groups.map(({ id }) => id), ...local.groups.map(({ id }) => id)]);
  const groups = [...groupIds].flatMap((groupId) => {
    const localOwned = localByGroup.get(groupId)?.instances.filter(clinicianOwned) ?? [];
    const localServerIds = new Set(localOwned.flatMap(({ instanceId }) => [instanceId, stableDraftId(reportId, `group:${instanceId}`)]));
    const serverGroup = server.groups.find(({ id }) => id === groupId);
    const serverInstances = serverGroup?.instances.filter((instance) => !clinicianOwned(instance) && !localServerIds.has(instance.instanceId)) ?? [];
    const instances = [...serverInstances, ...localOwned];
    return instances.length ? [{ ...(serverGroup ?? { id: groupId }), instances }] : [];
  });
  return { ...server, groups };
}
