import { createHash } from "node:crypto";
import type { ReviewAnalysisResult, ReviewVolumeResult } from "@open-triage/contracts";

type Cell = string | number | boolean | null | undefined;

// Spreadsheet software may execute values whose first significant character is
// a formula introducer. Prefix only text; aggregate numbers remain numeric.
function cell(value: Cell): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = typeof value === "string" &&
    /^[\s\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2060\ufeff]*[=+\-@]/u.test(raw)
    ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(rows: Cell[][]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Includes authorization scope, source freshness, definition, and every value. */
export function aggregateRevision(result: ReviewAnalysisResult | ReviewVolumeResult): string {
  const { exportRevision: _ignored, ...payload } = result;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function context(result: ReviewAnalysisResult | ReviewVolumeResult): Cell[][] {
  return [
    ["context", "value"],
    ["dataset", result.definition.filters.dataset],
    ["from", result.definition.filters.from],
    ["to", result.definition.filters.to],
    ["population_unit", result.population.unit],
    ["report_scope", result.population.scope],
    ["organization_id", result.population.organizationId],
    ["signed_only", result.population.signedOnly],
    ["freshness_status", result.freshness.status],
    ["observed_at", result.freshness.observedAt],
    ["freshness_target_seconds", result.freshness.targetSeconds],
    ["oldest_backlog_seconds", result.freshness.oldestBacklogSeconds],
    ["replica_lag_seconds", result.freshness.replicaLagSeconds],
    ["result_revision", aggregateRevision(result)],
  ];
}

export function volumeCsv(result: ReviewVolumeResult): string {
  const rows: Cell[][] = [
    ...context(result),
    ["measure", result.definition.measure],
    ["grouping", result.definition.grouping],
    ["total", result.total],
    [],
    ["date", "count"],
    ...result.points.map((point) => [point.date, point.count]),
  ];
  return csv(rows);
}

export function analysisCsv(result: ReviewAnalysisResult): string {
  const { definition, field } = result;
  const rows: Cell[][] = [
    ...context(result),
    ["measure", field.id],
    ["measure_label", field.label],
    ["operation", definition.operation],
    ["field_source", field.source],
    ["repeating", field.repeating ?? false],
    ["unit", field.unit],
    ["group_by", definition.groupBy],
    ["reducer", definition.reducer],
    ["selected_unit", definition.unit],
    ["filter_field", definition.filters.field?.id],
    ["filter_value", definition.filters.field?.value],
    ["interval_start", field.interval?.start],
    ["interval_end", field.interval?.end],
    [],
    ["group", "group_missing", "denominator", "missing", "absent", "invalid",
      "value", "count", "percentage", "summary", "unit"],
  ];
  for (const group of result.groups) {
    const base: Cell[] = [group.group, group.group === null, group.denominator,
      group.missing, group.absent, group.invalid];
    if (definition.operation === "distribution" && group.values.length) {
      for (const value of group.values)
        rows.push([...base, value.value, value.count, value.percentage, null, field.unit]);
    } else rows.push([...base, null, null, null, group.summary, field.unit]);
  }
  return csv(rows);
}
