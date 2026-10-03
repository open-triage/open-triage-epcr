import { createHash } from "node:crypto";
import type { CompiledValidationRule, EncounterDocument } from "@open-triage/contracts";

export type ReviewInputLine = { key: string; elementId: string | null; groupInstanceId: string;
  occurrenceId: string | null; digest: string; identifying: boolean };
export type ReviewInputChange = { elementId: string | null; groupInstanceId: string;
  occurrenceId: string | null; change: "added" | "removed" | "changed"; identifying: boolean };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Hash the exact occurrence membership and states read by a criterion, without storing values. */
export function reviewInputLineage(document: EncounterDocument, rule: CompiledValidationRule,
  identifying: ReadonlySet<string>): ReviewInputLine[] {
  const referencedGroups = new Set(rule.references.groupIds ?? []);
  const referenced = new Set([...(referencedGroups.size ? [] : [rule.primaryTarget.elementId]), ...rule.references.elementIds]);
  const allElements = referenced.has("*");
  const instances = document.groups.flatMap((group) => group.instances.map((instance) =>
    ({ groupId: group.id, instance })));
  let included = new Set(instances.map(({ instance }) => instance.instanceId));
  if (rule.scope) {
    included = new Set(instances.filter(({ groupId }) => groupId === rule.scope!.groupId)
      .map(({ instance }) => instance.instanceId));
    let size = -1;
    while (size !== included.size) {
      size = included.size;
      for (const { instance } of instances)
        if (instance.parentInstanceId && included.has(instance.parentInstanceId)) included.add(instance.instanceId);
    }
  }
  const lines: ReviewInputLine[] = [];
  for (const { groupId, instance } of instances) {
    if (!included.has(instance.instanceId)) continue;
    if ((rule.scope && groupId === rule.scope.groupId) || referencedGroups.has(groupId)) lines.push({
      key: `group:${instance.instanceId}`, elementId: null, groupInstanceId: instance.instanceId,
      occurrenceId: null, digest: digest({ groupId, parentInstanceId: instance.parentInstanceId }), identifying: false,
    });
    for (const element of instance.elements) {
      if (!allElements && !referenced.has(element.id)) continue;
      if (!element.values.length) lines.push({ key: `empty:${instance.instanceId}:${element.id}`,
        elementId: element.id, groupInstanceId: instance.instanceId, occurrenceId: null,
        digest: digest({ groupId, parentInstanceId: instance.parentInstanceId, empty: true }),
        identifying: identifying.has(element.id) });
      for (const value of element.values) lines.push({
        key: `value:${instance.instanceId}:${element.id}:${value.occurrenceId}`,
        elementId: element.id, groupInstanceId: instance.instanceId, occurrenceId: value.occurrenceId,
        digest: digest({ groupId, parentInstanceId: instance.parentInstanceId, value }),
        identifying: identifying.has(element.id),
      });
    }
  }
  return lines.sort((a, b) => a.key.localeCompare(b.key));
}

export function changedReviewInputs(before: readonly ReviewInputLine[], after: readonly ReviewInputLine[]): ReviewInputChange[] {
  const old = new Map(before.map((line) => [line.key, line]));
  const current = new Map(after.map((line) => [line.key, line]));
  return [...new Set([...old.keys(), ...current.keys()])].sort().flatMap((key) => {
    const prior = old.get(key), next = current.get(key);
    if (prior && next && prior.digest === next.digest) return [];
    const line = next ?? prior!;
    return [{ elementId: line.elementId, groupInstanceId: line.groupInstanceId,
      occurrenceId: line.occurrenceId,
      change: !prior ? "added" as const : !next ? "removed" as const : "changed" as const,
      identifying: line.identifying }];
  });
}
