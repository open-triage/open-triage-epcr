import type { EncounterValue, MetricResult } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

export async function restrictedMetricInputs(database: Pick<EntityManager, "query">, reportIds: string[], inputIds: string[]) {
  if (!inputIds.length) return new Set<string>();
  const rows = await database.query<Array<{ report_id: string; element_id: string }>>(`
    select distinct report_id,element_id from clinical.element_occurrence
    where report_id=any($1::uuid[]) and element_id=any($2::text[]) and identifying`, [reportIds, inputIds]);
  return new Set(rows.map(row => `${row.report_id}:${row.element_id}`));
}

/** Match the restricted report view: expose normalized values, never source extensions. */
export function normalizedMetricEvidence(metric: MetricResult): MetricResult {
  const normalize = (value: EncounterValue): EncounterValue => {
    const common = { occurrenceId: value.occurrenceId,
      ...(value.notValue ? { notValue: { code: value.notValue.code } } : {}),
      ...(value.pertinentNegative ? { pertinentNegative: { code: value.pertinentNegative.code } } : {}) };
    if (value.kind === "scalar") return { ...common, kind: "scalar", value: value.value };
    if (value.kind === "coded") return { ...common, kind: "coded", code: value.code,
      ...(value.system ? { system: value.system } : {}), ...(value.display ? { display: value.display } : {}) };
    if (value.kind === "pertinent-negative") return { ...common, kind: value.kind, code: value.code };
    return { ...common, kind: value.kind };
  };
  return { ...metric, observations: metric.observations.map(observation => ({ ...observation,
    values: observation.values.filter(value => value.kind !== "scalar" || typeof value.value !== "string" ||
      /^\d{4}-\d{2}-\d{2}(?:T[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value.value)).map(normalize) })) };
}
