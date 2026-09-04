import type { EncounterDocument, EncounterGroupInstance } from "@open-triage/contracts";
import { stableDraftId } from "./draft-report";

const OWNER = "x-open-triage-owner";

function clinicianOwned(instance: EncounterGroupInstance): boolean {
  return instance.attributes?.[OWNER] === "clinician";
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
): EncounterDocument {
  if (!preservePendingClinicianEdits) return server;
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
