import { createHash } from "node:crypto";
import type { ReviewAnalysisResult, ReviewVolumeResult, ReviewWorkloadResult } from "@open-triage/contracts";

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

export function csv(rows: Cell[][]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Includes authorization scope, source freshness, definition, and every value. */
export function aggregateRevision(result: ReviewAnalysisResult | ReviewVolumeResult | ReviewWorkloadResult): string {
  const { exportRevision: _ignored, ...payload } = result;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function workloadCsv(result: ReviewWorkloadResult): string {
  const rows: Cell[][] = [
    ["context", "value"],
    ["dataset", result.definition.filters.dataset],
    ["from", result.definition.filters.from],
    ["to", result.definition.filters.to],
    ["population_unit", result.population.unit],
    ["report_scope", result.population.scope],
    ["organization_id", result.population.organizationId],
    ["includes_unsigned", result.population.includesUnsigned],
    ["freshness_source", result.freshness.source],
    ["observed_at", result.freshness.observedAt],
    ["result_revision", aggregateRevision(result)],
    ["group_by", result.definition.groupBy],
    ["total_items", result.totalItems],
    ["reopened_items", result.reopenedItems],
    ["unsigned_items", result.unsignedItems],
    ["exceptionally_closed_items", result.exceptionallyClosedItems],
    [], ["group", "item_count"],
    ...result.groups.map((group) => [group.key, group.count]),
  ];
  return csv(rows);
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
    ["review_criterion_id", definition.filters.review?.criterionId],
    ["recorded_review_outcome_id", definition.filters.review?.outcomeOptionId],
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

/** JSON cells preserve repeated values and Review items while keeping one row per report. */
export function underlyingCsv(result: ReviewAnalysisResult | ReviewVolumeResult | ReviewWorkloadResult): string {
  const header: Cell[][] = [["context", "value"],
    ["dataset", result.definition.filters.dataset],
    ["from", result.definition.filters.from], ["to", result.definition.filters.to],
    ["population_unit", result.population.unit], ["report_scope", result.population.scope],
    ["organization_id", result.population.organizationId],
    ["result_revision", aggregateRevision(result)],
    ["record_representation", "JSON arrays in cells; one CSV row per patient report"], []];
  if ("totalItems" in result) {
    const rows: Cell[][] = [["group_by", result.definition.groupBy],
      ["observed_at", result.freshness.observedAt], [],
      ["report_id", "reporting_date", "dataset", "review_items_json"]];
    for (const source of result.sources ?? []) rows.push([source.reportId, source.reportingDate,
      result.definition.filters.dataset, JSON.stringify(source.items)]);
    return csv([...header, ...rows]);
  }
  if ("total" in result) {
    const rows: Cell[][] = [["measure", result.definition.measure],
      ["grouping", result.definition.grouping], ["observed_at", result.freshness.observedAt], [],
      ["report_id", "reporting_date", "dataset"]];
    for (const source of result.sources ?? []) rows.push([source.reportId, source.reportingDate,
      result.definition.filters.dataset]);
    return csv([...header, ...rows]);
  }
  const byReport = new Map<string, { reportingDate: string | null; values: Array<{
    group: string | null; value: string[] | number | null; state: string;
    unit: string | null; selectedOccurrenceId: string | null; orderMode: string | null;
    operationalTime: NonNullable<ReviewAnalysisResult["sources"]>[number]["operationalTime"];
    occurrences: NonNullable<ReviewAnalysisResult["sources"]>[number]["sourceValues"];
  }> }>();
  for (const source of result.sources ?? []) {
    const report = byReport.get(source.reportId) ?? { reportingDate: source.reportingDate ?? null, values: [] };
    report.values.push({ group: source.group, value: source.value,
      state: source.operationalTime?.state ?? source.state ?? (source.value === null ||
        Array.isArray(source.value) && source.value.length === 0 ? "missing" : "valid"),
      unit: source.unit, selectedOccurrenceId: source.selectedOccurrenceId ?? null,
      orderMode: source.orderMode ?? null, operationalTime: source.operationalTime,
      occurrences: source.sourceValues });
    byReport.set(source.reportId, report);
  }
  const rows: Cell[][] = [["measure", result.field.id],
    ["group_by", result.definition.groupBy], ["operation", result.definition.operation],
    ["reducer", result.definition.reducer], ["selected_unit", result.definition.unit],
    ["filter_field", result.definition.filters.field?.id],
    ["filter_value", result.definition.filters.field?.value],
    ["review_criterion_id", result.definition.filters.review?.criterionId],
    ["recorded_review_outcome_id", result.definition.filters.review?.outcomeOptionId],
    ["observed_at", result.freshness.observedAt], [],
    ["report_id", "reporting_date", "dataset", "field_id",
    "operation", "group_values_json"]];
  for (const [id, source] of [...byReport].sort((a, b) => a[0].localeCompare(b[0])))
    rows.push([id, source.reportingDate, result.definition.filters.dataset, result.field.id,
      result.definition.operation, JSON.stringify(source.values)]);
  return csv([...header, ...rows]);
}
