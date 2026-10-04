import { BadRequestException } from "@nestjs/common";
import type { AnalyticsDefinition, AnalyticsElement, AnalyticsValue, AnalyticsResult, AnalyticsCompleteness, AnalyticsEvaluationEvidence } from "@open-triage/contracts";

export interface AnalyticsOccurrence {
  id: string; element: string; value: AnalyticsValue | null; label: string | null;
  evidence?: AnalyticsEvaluationEvidence;
  state: "valid" | "absent" | "invalid" | "missing" | "not-applicable" | "failed"; unit: string | null;
  groupId: string | null; path: string[]; ordinal: number; groupOrdinal: number;
  clinicalTime: string | null;
}
export interface AnalyticsReport {
  id: string; date: string; revision: string; values: AnalyticsOccurrence[];
}
export interface AnalyticsContribution {
  reportId: string; date: string; groups: Array<AnalyticsValue | null>;
  value: AnalyticsValue[] | number | null; state: "valid" | "absent" | "invalid" | "missing" | "not-applicable" | "failed";
  occurrences: AnalyticsOccurrence[];
  contributions: Array<{ group: AnalyticsValue | null; value: AnalyticsValue[] | number | null; state: string; occurrences: AnalyticsOccurrence[] }>;
}
export const valueKey = (value: AnalyticsValue | null): string => JSON.stringify(value);
export function validAnalyticsDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validateAnalytics(input: AnalyticsDefinition, fields: AnalyticsElement[]): AnalyticsDefinition {
  if (!input || input.version !== 1 || !validAnalyticsDate(input.from) || !validAnalyticsDate(input.through) ||
    input.from > input.through || (Date.parse(input.through) - Date.parse(input.from)) / 86400000 > 365 ||
    !["line", "bar", "table"].includes(input.visualization) || !["day", "week", "month"].includes(input.timeGrouping) ||
    !Array.isArray(input.filters) || input.filters.length > 20)
    throw new BadRequestException("Choose valid dates (at most 366 days) and visualization controls");
  const metric = fields.find((field) => field.id === input.metric);
  if (!metric || !metric.aggregations.includes(input.aggregation))
    throw new BadRequestException("This aggregation is not supported for the selected metric");
  if (metric.configured?.kind === "rule" ? !["pass", "fail"].includes(input.outcome ?? "") : input.outcome !== undefined)
    throw new BadRequestException("Select a pass or fail outcome for Boolean rule analysis");
  if (input.groupBy !== null && !fields.some((field) => field.id === input.groupBy && field.grouping))
    throw new BadRequestException("Grouping element is unavailable");
  if (metric.repeating && metric.kind === "numeric" && !["first", "last", "minimum", "maximum"].includes(input.reducer ?? ""))
    throw new BadRequestException("Select a per-report value for a repeated numeric metric");
  if (input.reducer && (!metric.repeating || metric.kind !== "numeric"))
    throw new BadRequestException("This metric does not support a per-report reducer");
  if ((metric.units.length > 1 || metric.id === "eMedications.05") && !input.unit ||
    input.unit && !metric.units.includes(input.unit))
    throw new BadRequestException("Select a compatible recorded unit");
  const seen = new Set<string>();
  const filters = input.filters.map((filter) => {
    const field = fields.find((field) => field.id === filter?.element && field.filtering);
    if (!field || seen.has(field.id) || !Array.isArray(filter.values) || !filter.values.length || filter.values.length > 100)
      throw new BadRequestException("Select one or more recorded values for each distinct filter element");
    seen.add(field.id);
    const values = filter.values.map((value): AnalyticsValue => {
      if (!value || value.type !== field.datatype ||
        (value.type === "number" ? typeof value.value !== "number" || !Number.isFinite(value.value) :
          value.type === "boolean" ? typeof value.value !== "boolean" :
            typeof value.value !== "string" || !value.value || value.value.length > 256))
        throw new BadRequestException("Filter value has an incompatible datatype");
      return { type: value.type, value: value.value };
    });
    return { element: field.id, values: [...new Map(values.map((value) => [valueKey(value), value])).values()]
      .sort((a, b) => valueKey(a).localeCompare(valueKey(b))) };
  }).sort((a, b) => a.element.localeCompare(b.element));
  return { version: 1, metric: metric.id, aggregation: input.aggregation, visualization: input.visualization,
    from: input.from, through: input.through, groupBy: input.groupBy, timeGrouping: input.timeGrouping, filters,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.reducer ? { reducer: input.reducer } : {}), ...(input.unit ? { unit: input.unit } : {}) };
}
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export function analyticsBuckets(definition: AnalyticsDefinition): AnalyticsResult["buckets"] {
  if (definition.visualization !== "line") return [];
  const buckets: AnalyticsResult["buckets"] = [];
  for (let date = definition.from; date <= definition.through; date = nextDay(date)) {
    const day = new Date(`${date}T00:00:00Z`);
    let key = date;
    if (definition.timeGrouping === "month") key = `${date.slice(0, 7)}-01`;
    if (definition.timeGrouping === "week") {
      day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); key = day.toISOString().slice(0, 10);
    }
    const previous = buckets.at(-1);
    if (previous?.key === key) previous.through = date;
    else buckets.push({ key, from: date, through: date });
  }
  return buckets;
}
function related(left: AnalyticsOccurrence, right: AnalyticsOccurrence): boolean {
  if (!left.path.length || !right.path.length) return true;
  // Different standard clinical sections are report-level dimensions. Custom
  // entries and repetitions in the same section retain their pinned ancestry.
  if (left.groupId !== right.groupId && !left.element.startsWith("custom:") && !right.element.startsWith("custom:")) return true;
  return left.path.includes(right.path.at(-1)!) || right.path.includes(left.path.at(-1)!);
}
function selectValue(rows: AnalyticsOccurrence[], metric: AnalyticsElement, definition: AnalyticsDefinition) {
  const relevant = rows.filter((row) => !definition.unit || row.unit === definition.unit || row.state === "absent");
  const valid = relevant.filter((row) => row.state === "valid" && row.value !== null);
  const state = valid.length ? "valid" : relevant.some((row) => row.state === "failed") ? "failed" :
    relevant.some((row) => row.state === "not-applicable") ? "not-applicable" : relevant.some((row) => row.state === "invalid") ? "invalid" :
    relevant.some((row) => row.state === "absent") ? "absent" : "missing";
  if (metric.datatype === "records") return { value: 1, state: "valid" as const, occurrences: [] };
  if (metric.kind === "categorical") return { value: [...new Map(valid.map((row) => [valueKey(row.value), row.value!])).values()], state, occurrences: relevant };
  const candidates = valid.filter((row) => typeof row.value?.value === "number");
  const clinical = candidates.every((row) => row.clinicalTime !== null);
  candidates.sort((a, b) => (clinical ? (a.clinicalTime ?? "").localeCompare(b.clinicalTime ?? "") : 0) ||
    a.groupOrdinal - b.groupOrdinal || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const numbers = candidates.map((row) => Number(row.value!.value));
  const value = numbers.length === 0 ? null : definition.reducer === "minimum" ? Math.min(...numbers) :
    definition.reducer === "maximum" ? Math.max(...numbers) : definition.reducer === "last" ? numbers.at(-1)! : numbers[0]!;
  return { value, state, occurrences: relevant };
}
function summary(values: number[], aggregation: AnalyticsDefinition["aggregation"]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (aggregation === "p90") return sorted[Math.ceil(sorted.length * 0.9) - 1]!;
  if (aggregation === "minimum") return sorted[0]!;
  if (aggregation === "maximum") return sorted.at(-1)!;
  if (aggregation === "median") return (sorted[Math.floor(sorted.length / 2)]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
const emptyCompleteness = (): AnalyticsCompleteness => ({ total: 0, valid: 0, missing: 0, absent: 0, invalid: 0 });
function reportFilters(report: AnalyticsReport, definition: AnalyticsDefinition) {
  const matches = definition.filters.map((filter) => report.values.filter((row) => row.element === filter.element &&
    row.state === "valid" && filter.values.some((value) => valueKey(value) === valueKey(row.value))));
  return { included: matches.every((rows) => rows.length > 0),
    compatible: (row: AnalyticsOccurrence) => matches.every((filter) => filter.some((other) => related(row, other))) };
}
export function matchingAnalyticsReports(reports: AnalyticsReport[], definition: AnalyticsDefinition) {
  return reports.filter((report) => reportFilters(report, definition).included);
}
/** Count reports, never observations, chart series, or only the selected Boolean outcome. */
export function countAnalyticsRecords(reports: AnalyticsReport[], definition: AnalyticsDefinition, metric: AnalyticsElement,
  element?: string, identity?: AnalyticsValue) {
  let total = 0, included = 0;
  for (const report of reports) {
    const filters = reportFilters(report, definition);
    if (!filters.included) continue;
    total++;
    const candidates = element ? report.values.filter((row) => row.element === element && row.state === "valid" && row.value &&
      filters.compatible(row) && (!identity || valueKey(row.value) === valueKey(identity))) : null;
    if (candidates && !candidates.length) continue;
    const selected = selectValue(report.values.filter((row) => row.element === metric.id && filters.compatible(row) &&
      (!candidates || candidates.some((candidate) => related(row, candidate)))), metric, definition);
    if (selected.state === "valid") included++;
  }
  return { total, included };
}
export function aggregateAnalytics(reports: AnalyticsReport[], definition: AnalyticsDefinition, metric: AnalyticsElement) {
  const configured = !!metric.configured;
  const booleanRule = metric.configured?.kind === "rule";
  const countsForMetric = () => ({ ...emptyCompleteness(), ...(configured ? { notApplicable: 0, failed: 0 } : {}) });
  const countState = (counts: AnalyticsCompleteness, state: string) => {
    const key = state === "not-applicable" ? "notApplicable" : state as keyof AnalyticsCompleteness;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const buckets = analyticsBuckets(definition);
  const contributions: AnalyticsContribution[] = [];
  const series = new Map<string, AnalyticsResult["series"][number]>();
  const groupLabels = new Map<string, string | null>();
  const memberships = new Map<string, Array<{ report: string; date: string; value: number | AnalyticsValue[] | null; state: string }>>();
  const completeness = countsForMetric();
  const overallNumbers: number[] = [];
  const matched: AnalyticsReport[] = [];
  let overlapping = false;
  for (const report of reports) {
    const { included, compatible } = reportFilters(report, definition);
    if (!included) continue;
    const target = report.values.filter((row) => row.element === metric.id && compatible(row));
    const overall = selectValue(target, metric, definition);
    completeness.total++; countState(completeness, overall.state);
    if (typeof overall.value === "number") overallNumbers.push(overall.value);
    matched.push(report);
    const groupRows = definition.groupBy ? report.values.filter((row) => row.element === definition.groupBy && row.state === "valid" && row.value && compatible(row)) : [];
    const groups = new Map<string, { value: AnalyticsValue | null; label: string | null; rows: AnalyticsOccurrence[] }>();
    for (const row of groupRows) {
      const key = valueKey(row.value), group = groups.get(key) ?? { value: row.value, label: row.label, rows: [] };
      group.rows.push(row); groups.set(key, group);
    }
    if (!groups.size) groups.set("null", { value: null, label: null, rows: [] });
    if (groups.size > 1 || Array.isArray(overall.value) && overall.value.length > 1) overlapping = true;
    const contribution: AnalyticsContribution = { reportId: report.id, date: report.date, groups: [...groups.values()].map((group) => group.value),
      value: overall.value, state: overall.state as AnalyticsContribution["state"], occurrences: overall.occurrences, contributions: [] };
    contributions.push(contribution);
    for (const [groupKey, group] of groups) {
      groupLabels.set(groupKey, group.label);
      const selected = selectValue(target.filter((row) => !group.rows.length || group.rows.some((other) => related(row, other))), metric, definition);
      contribution.contributions.push({ group: group.value, ...selected });
      const members = memberships.get(groupKey) ?? [];
      members.push({ report: report.id, date: report.date, value: selected.value, state: selected.state });
      memberships.set(groupKey, members);
      const categories: Array<AnalyticsValue | null> = booleanRule ? [{ type: "boolean", value: definition.outcome === "pass" }] : Array.isArray(selected.value) ? selected.value : [null];
      for (const category of categories) {
        const id = JSON.stringify([group.value, category]);
        series.set(id, { id, group: group.value, groupLabel: group.label, category,
          categoryLabel: booleanRule ? definition.outcome! : category ? target.find((row) => valueKey(row.value) === valueKey(category))?.label ?? String(category.value) : null });
      }
    }
  }
  // Retain group completeness even if no valid categorical values were recorded.
  if (metric.kind === "categorical" && metric.datatype !== "records") for (const key of memberships.keys()) {
    if (![...series.values()].some((item) => valueKey(item.group) === key)) {
      const group = JSON.parse(key) as AnalyticsValue | null, id = JSON.stringify([group, null]);
      series.set(id, { id, group, groupLabel: groupLabels.get(key) ?? (group ? String(group.value) : null), category: null, categoryLabel: null });
    }
  }
  if (!series.size && !definition.groupBy && (metric.datatype === "records" || configured))
    series.set("[null,null]", { id: "[null,null]", group: null, groupLabel: null, category: null, categoryLabel: null });
  const ordered = [...series.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (ordered.length > 100 || ordered.length * Math.max(1, buckets.length) > 20000)
    throw new BadRequestException("Analysis exceeds the 100-series or 20,000-cell limit; narrow the query");
  const populationByBucket = new Map(buckets.map((bucket) => [bucket.key,
    matched.filter((report) => report.date >= bucket.from && report.date <= bucket.through).length]));
  const cells: AnalyticsResult["cells"] = [];
  for (const item of ordered) for (const bucket of buckets.length ? buckets : [null]) {
    const inBucket = (date: string) => !bucket || date >= bucket.from && date <= bucket.through;
    const members = (memberships.get(valueKey(item.group)) ?? []).filter((member) => inBucket(member.date));
    const counts = countsForMetric();
    for (const member of members) { counts.total++; countState(counts, member.state); }
    const count = metric.datatype === "records" ? members.length : item.category ? members.filter((member) =>
      Array.isArray(member.value) && member.value.some((value) => valueKey(value) === valueKey(item.category))).length : counts.valid;
    const denominator = metric.datatype === "records" ? bucket ? populationByBucket.get(bucket.key)! : matched.length : counts.valid;
    const number = definition.aggregation === "count" ? count : definition.aggregation === "percentage" ?
      denominator ? 100 * count / denominator : null : summary(members.flatMap((member) => typeof member.value === "number" ? [member.value] : []), definition.aggregation);
    cells.push({ ...counts, series: item.id, bucket: bucket?.key ?? null, value: number, count,
      numerator: definition.aggregation === "percentage" || booleanRule ? count : null,
      denominator: definition.aggregation === "percentage" || booleanRule ? denominator : null });
  }
  return { buckets, series: ordered, cells, completeness, overlapping, contributions,
    summary: booleanRule ? (() => {
      const numerator = contributions.filter((row) => row.state === "valid" && Array.isArray(row.value) && row.value.some((value) => value.value === (definition.outcome === "pass"))).length;
      return definition.aggregation === "count" ? numerator : completeness.valid ? 100 * numerator / completeness.valid : null;
    })() : metric.kind === "numeric" ? summary(overallNumbers, definition.aggregation) :
      definition.aggregation === "count" && metric.datatype === "records" ? completeness.total : null };
}
