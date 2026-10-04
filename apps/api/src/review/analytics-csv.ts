import type { AnalyticsResult } from "@open-triage/contracts";
import type { AnalyticsContribution } from "./analytics-engine.js";
import { csv } from "./review-csv.js";
export function unifiedAnalyticsCsv(result: AnalyticsResult, contributions: AnalyticsContribution[], kind: "aggregate" | "records") {
  const context = [
    ["context", "value"], ["definition_json", JSON.stringify(result.definition)], ["result_revision", result.exportRevision],
    ["organization_id", result.population.organizationId], ["report_scope", result.population.scope], ["dataset", result.population.dataset],
    ["population_unit", result.population.unit], ["signed_only", true], ["timezone", result.timeZone],
    ["start_inclusive", result.interval.start], ["end_exclusive", result.interval.endExclusive],
    ["metric", result.metric.id], ["metric_label", result.metric.label], ["aggregation", result.definition.aggregation],
    ["configured_definition_json", JSON.stringify(result.metric.configured ?? null)], ["selected_outcome", result.definition.outcome],
    ["percentile_convention", result.definition.aggregation === "p90" ? "nearest rank: ceil(0.90 * n), one-based" : null],
    ["unit", result.unit], ["summary", result.summary], ["completeness_json", JSON.stringify(result.completeness)],
    ["overlapping_memberships", result.overlapping], ["freshness_status", result.freshness.status], ["observed_at", result.freshness.observedAt], [],
  ];
  if (kind === "records") return csv([...context,
    ["report_id", "reporting_date", "groups_json", "value_json", "state", "permitted_occurrences_json", "group_contributions_json"],
    ...contributions.map((row) => [row.reportId, row.date, JSON.stringify(row.groups), JSON.stringify(row.value), row.state, JSON.stringify(row.occurrences), JSON.stringify(row.contributions)]),
  ]);
  return csv([...context,
    ["group_identity", "group_label", "category_identity", "category_label", "bucket", "bucket_from", "bucket_through",
      "aggregation", "value", "unit", "count", "numerator", "denominator", "reports", "valid", "missing", "absent", "invalid", "not_applicable", "failed"],
    ...result.cells.map((cell) => {
      const series = result.series.find((series) => series.id === cell.series)!;
      const bucket = result.buckets.find((bucket) => bucket.key === cell.bucket);
      return [JSON.stringify(series.group), series.groupLabel, JSON.stringify(series.category), series.categoryLabel,
        cell.bucket, bucket?.from, bucket?.through, result.definition.aggregation, cell.value, result.unit, cell.count, cell.numerator, cell.denominator,
        cell.total, cell.valid, cell.missing, cell.absent, cell.invalid, cell.notApplicable, cell.failed];
    }),
  ]);
}
