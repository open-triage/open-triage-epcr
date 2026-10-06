import type { ReviewAnalysisField, ReviewVolumeResult } from "./index.js";
import type { MetricResult } from "./metrics.js";
import type { ValidationRuleOutcome } from "./validation-rules.js";

export type AnalyticsAggregation = "count" | "percentage" | "mean" | "median" | "minimum" | "maximum" | "p90";
export type AnalyticsValue = { type: "code" | "number" | "boolean" | "date" | "datetime" | "string"; value: string | number | boolean };
export interface AnalyticsElement extends ReviewAnalysisField {
  configured?: { kind: "metric" | "rule"; id: string; validationVersionId: string; version: number; catalogReleaseId: string; compiledSha256: string };
  datatype: AnalyticsValue["type"] | "records";
  aggregations: AnalyticsAggregation[];
  grouping: boolean;
  filtering: boolean;
  units: string[];
  recordCount: number;
}
export interface AnalyticsDefinition {
  version: 1;
  metric: string;
  aggregation: AnalyticsAggregation;
  visualization: "line" | "bar" | "table";
  from: string;
  through: string;
  groupBy: string | null;
  timeGrouping: "day" | "week" | "month";
  filters: Array<{ element: string; values: AnalyticsValue[] }>;
  outcome?: "pass" | "fail";
  reducer?: "first" | "last" | "minimum" | "maximum";
  unit?: string;
}
export interface AnalyticsSavedVisualization {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
}
export interface AnalyticsSaveVisualizationCommand {
  commandId: string;
  name: string;
  definition: AnalyticsDefinition;
  expectedVersion?: number;
}
export interface AnalyticsOpenedVisualization {
  saved: AnalyticsSavedVisualization;
  definition: AnalyticsDefinition;
  elements: AnalyticsElement[];
  filters: Array<{ element: string; values: AnalyticsCatalogValue[] }>;
}
export interface AnalyticsCatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  scope: "own" | "all";
  dataset: "real" | "synthetic";
  coverage: "readable-history";
}
export interface AnalyticsCatalogValue { identity: AnalyticsValue; label: string; recordCount: number }
export interface AnalyticsCatalogCountsRequest {
  definition: AnalyticsDefinition;
  selection: { purpose: "metric" | "group" | "filter"; ids: string[] } | { purpose: "values"; element: string; values: AnalyticsValue[] };
}
export interface AnalyticsCatalogCounts {
  total: number;
  included: number;
  elements: Array<{ id: string; included: number }>;
  values: Array<{ identity: AnalyticsValue; included: number }>;
}
export interface AnalyticsCompleteness { total: number; valid: number; missing: number; absent: number; invalid: number; notApplicable?: number; failed?: number }
export interface AnalyticsCell extends AnalyticsCompleteness {
  series: string;
  bucket: string | null;
  value: number | null;
  count: number;
  numerator: number | null;
  denominator: number | null;
}
export type AnalyticsEvaluationEvidence = {
  definition: NonNullable<AnalyticsElement["configured"]>;
  reportRevision: string;
  amendmentSequence: number;
} & (MetricResult | ValidationRuleOutcome | { state: "failed"; value: null; reason: string });
export interface AnalyticsResult {
  definition: AnalyticsDefinition;
  metric: AnalyticsElement;
  group: AnalyticsElement | null;
  filters: Array<{ element: AnalyticsElement; values: Array<{ identity: AnalyticsValue; label: string }> }>;
  population: ReviewVolumeResult["population"] & { dataset: "real" | "synthetic" };
  timeZone: string;
  interval: { start: string; endExclusive: string };
  freshness: ReviewVolumeResult["freshness"];
  completeness: AnalyticsCompleteness;
  summary: number | null;
  unit: string | null;
  overlapping: boolean;
  buckets: Array<{ key: string; from: string; through: string }>;
  series: Array<{ id: string; group: AnalyticsValue | null; groupLabel: string | null;
    category: AnalyticsValue | null; categoryLabel: string | null }>;
  cells: AnalyticsCell[];
  evidence?: Array<{ reportId: string; reportingDate: string; evaluation: AnalyticsEvaluationEvidence }>;
  exportRevision: string;
}
