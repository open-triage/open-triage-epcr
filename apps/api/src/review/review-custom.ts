import type { ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult } from "@open-triage/contracts";
import { reduceRepeated, type RepeatedRow } from "./review-repeated.js";

export interface CustomReportRow {
  report_id: string;
  standard_group_value: string | null;
}

export interface CustomOccurrenceRow extends Omit<RepeatedRow, "group_value"> {
  custom_definition_id: string;
  instance_path: string[];
  categorical_value: string | null;
}

function related(left: CustomOccurrenceRow, right: CustomOccurrenceRow): boolean {
  if (!left.group_instance_id || !right.group_instance_id) return true;
  return left.instance_path.includes(right.group_instance_id) ||
    right.instance_path.includes(left.group_instance_id);
}

function placeholder(reportId: string, group: string | null): RepeatedRow {
  return { report_id: reportId, group_value: group, occurrence_id: null,
    group_id: null, group_instance_id: null, parent_group_instance_id: null,
    group_ordinal: null, element_ordinal: null, clinical_time: null,
    documented_time: null, code: null, categorical_value: null,
    numeric_value: null, unit_code: null, absence_kind: null,
    absence_code: null, normalization_rule_id: null, quality_flags: null };
}

/** Membership is per report. A group or filter occurrence narrows custom values
 * only to its own clinical entry or an ancestor/descendant entry. Siblings are
 * never joined merely because they share a report or ordinal. */
export function reduceCustom(reports: CustomReportRow[], occurrences: CustomOccurrenceRow[],
  definition: ReviewAnalysisDefinition, field: ReviewAnalysisField,
  groupField?: ReviewAnalysisField, filterField?: ReviewAnalysisField):
  Pick<ReviewAnalysisResult, "groups" | "sources"> {
  const byReport = new Map<string, CustomOccurrenceRow[]>();
  for (const row of occurrences) {
    byReport.set(row.report_id, [...(byReport.get(row.report_id) ?? []), row]);
  }
  const reducedRows: RepeatedRow[] = [];
  for (const report of reports) {
    const rows = byReport.get(report.report_id) ?? [];
    const target = rows.filter((row) => row.custom_definition_id === field.id);
    const filterRows = filterField?.source === "custom" ? rows.filter((row) =>
      row.custom_definition_id === filterField.id &&
      row.categorical_value === definition.filters.field?.value) : [];
    if (filterField?.source === "custom" && !filterRows.length) continue;
    const filtered = filterRows.length ? target.filter((row) =>
      filterRows.some((filter) => related(row, filter))) : target;
    const memberships = new Map<string | null, CustomOccurrenceRow[]>();
    if (groupField?.source === "custom") {
      for (const row of rows) {
        if (row.custom_definition_id !== groupField.id || row.categorical_value === null ||
          (filterRows.length && !filterRows.some((filter) => related(row, filter)))) continue;
        memberships.set(row.categorical_value,
          [...(memberships.get(row.categorical_value) ?? []), row]);
      }
      if (!memberships.size) memberships.set(null, []);
    } else memberships.set(report.standard_group_value, []);
    for (const [group, groupRows] of memberships) {
      const selected = groupRows.length ? filtered.filter((row) =>
        groupRows.some((groupRow) => related(row, groupRow))) : filtered;
      if (!selected.length) reducedRows.push(placeholder(report.report_id, group));
      else for (const row of selected) reducedRows.push({ ...row, group_value: group });
    }
  }
  return reduceRepeated(reducedRows, definition, null);
}
