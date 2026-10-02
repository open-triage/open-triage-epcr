import type { ReviewAnalysisDefinition, ReviewAnalysisResult } from "@open-triage/contracts";

export interface RepeatedRow {
  report_id: string; group_value: string | null; occurrence_id: string | null;
  group_id: string | null; group_instance_id: string | null;
  parent_group_instance_id: string | null; group_ordinal: number | null; element_ordinal: number | null;
  clinical_time: Date | string | null; documented_time: Date | string | null;
  code: string | null; numeric_value: string | number | null; unit_code: string | null;
  absence_kind: string | null; absence_code: string | null;
  normalization_rule_id: string | null; quality_flags: string[] | null;
}

function instant(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/** Clinical time is used only when every candidate has it. Otherwise first/last means
 * documented occurrence order, not clinical chronology. Ordinals and IDs break ties. */
function compareOccurrence(a: RepeatedRow, b: RepeatedRow, useClinicalTime: boolean): number {
  const at = instant(a.clinical_time), bt = instant(b.clinical_time);
  if (useClinicalTime && at && bt && at !== bt) return at < bt ? -1 : 1;
  const ao = Number(a.group_ordinal ?? 0), bo = Number(b.group_ordinal ?? 0);
  return ao - bo || Number(a.element_ordinal ?? 0) - Number(b.element_ordinal ?? 0) ||
    (a.occurrence_id ?? "").localeCompare(b.occurrence_id ?? "");
}

export function reduceRepeated(rows: RepeatedRow[], definition: ReviewAnalysisDefinition,
  unit: string | null): Pick<ReviewAnalysisResult, "groups" | "sources"> {
  const reports = new Map<string, { group: string | null; rows: RepeatedRow[] }>();
  for (const row of rows) {
    const item = reports.get(row.report_id) ?? { group: row.group_value, rows: [] };
    if (row.occurrence_id) item.rows.push(row);
    reports.set(row.report_id, item);
  }
  const groups = new Map<string | null, ReviewAnalysisResult["groups"][number]>();
  const numerics = new Map<string | null, number[]>();
  const sources: NonNullable<ReviewAnalysisResult["sources"]> = [];
  for (const [reportId, report] of reports) {
    const group = groups.get(report.group) ?? { group: report.group, denominator: 0, missing: 0,
      absent: 0, values: [], summary: null };
    group.denominator++;
    const relevant = report.rows.filter((row) => unit === null || row.unit_code === unit);
    const sourceValues = relevant.map((row) => ({ occurrenceId: row.occurrence_id!,
      groupId: row.group_id!, groupInstanceId: row.group_instance_id!,
      parentGroupInstanceId: row.parent_group_instance_id,
      value: definition.operation === "distribution" ? row.code :
        row.numeric_value === null ? null : Number(row.numeric_value), unit: row.unit_code,
      clinicalTime: instant(row.clinical_time), documentedTime: instant(row.documented_time),
      absenceKind: row.absence_kind, absenceCode: row.absence_code,
      normalizationRuleId: row.normalization_rule_id, qualityFlags: row.quality_flags ?? [] }));
    let value: string[] | number | null = null;
    let selectedOccurrenceId: string | undefined;
    let orderMode: "clinical-time" | "occurrence-order" | undefined;
    if (definition.operation === "distribution") {
      const categories = [...new Set(relevant.map((row) => row.code).filter((code): code is string => !!code))].sort();
      value = categories;
      for (const category of categories) {
        const bucket = group.values.find((item) => item.value === category);
        if (bucket) bucket.count++; else group.values.push({ value: category, count: 1, percentage: 0 });
      }
      if (!categories.length) {
        if (relevant.some((row) => row.absence_kind)) group.absent++; else group.missing++;
      }
    } else {
      const candidates = relevant.filter((row) => row.numeric_value !== null &&
        Number.isFinite(Number(row.numeric_value)));
      if (!candidates.length) {
        if (relevant.some((row) => row.absence_kind)) group.absent++; else group.missing++;
      } else {
        const reducer = definition.reducer!;
        const useClinicalTime = candidates.every((row) => instant(row.clinical_time) !== null);
        const order = (a: RepeatedRow, b: RepeatedRow) =>
          compareOccurrence(a, b, useClinicalTime);
        const selected = reducer === "minimum" ? [...candidates].sort((a, b) =>
          Number(a.numeric_value) - Number(b.numeric_value) || order(a, b))[0] :
          reducer === "maximum" ? [...candidates].sort((a, b) =>
            Number(b.numeric_value) - Number(a.numeric_value) || order(a, b))[0] :
            [...candidates].sort(order)[reducer === "first" ? 0 : candidates.length - 1];
        value = Number(selected!.numeric_value);
        selectedOccurrenceId = selected!.occurrence_id!;
        orderMode = useClinicalTime ? "clinical-time" : "occurrence-order";
        const values = numerics.get(report.group) ?? [];
        values.push(value); numerics.set(report.group, values);
      }
    }
    sources.push({ reportId, group: report.group, value, unit,
      ...(selectedOccurrenceId ? { selectedOccurrenceId, orderMode } : {}),
      occurrenceIds: relevant.map((row) => row.occurrence_id!),
      groupInstanceIds: [...new Set(relevant.map((row) => row.group_instance_id!))], sourceValues });
    groups.set(report.group, group);
  }
  for (const group of groups.values()) {
    group.values.sort((a, b) => b.count - a.count || (a.value ?? "").localeCompare(b.value ?? ""));
    for (const item of group.values) item.percentage = 100 * item.count / group.denominator;
    const values = (numerics.get(group.group) ?? []).sort((a, b) => a - b);
    if (values.length) {
      const mid = Math.floor(values.length / 2);
      group.summary = definition.operation === "mean" ? values.reduce((a, b) => a + b, 0) / values.length :
        definition.operation === "median" ? (values[mid]! + values[Math.floor((values.length - 1) / 2)]!) / 2 :
        definition.operation === "minimum" ? values[0]! : values[values.length - 1]!;
    }
  }
  return { groups: [...groups.values()], sources };
}
