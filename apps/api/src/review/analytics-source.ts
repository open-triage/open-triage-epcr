import { BadRequestException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { AnalyticsDefinition, AnalyticsElement, AnalyticsValue } from "@open-triage/contracts";
import type { ReviewScope } from "./review-scope.js";
import type { AnalyticsOccurrence, AnalyticsReport } from "./analytics-engine.js";
import { customIdentitySql, userElement } from "./analytics-catalog.js";

const instant = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
const typed = (field: AnalyticsElement, value: unknown): AnalyticsValue | null => {
  if (value === null || value === undefined) return null;
  if (field.datatype === "number") return Number.isFinite(Number(value)) ? { type: "number", value: Number(value) } : null;
  if (field.datatype === "records") return null;
  if (field.datatype === "boolean") return { type: "boolean", value: value === true || value === "true" };
  return { type: field.datatype, value: String(value) };
};
export async function loadAnalyticsReports(database: Pick<EntityManager, "query">, scope: ReviewScope,
  definition: AnalyticsDefinition, fields: AnalyticsElement[], additionalElements: string[] = []): Promise<AnalyticsReport[]> {
  const ids = [...new Set([definition.metric, definition.groupBy, ...definition.filters.map((filter) => filter.element), ...additionalElements].filter((id): id is string => !!id && id !== "records"))];
  const selected = fields.filter((field) => !field.configured && ids.includes(field.id));
  const params = [scope.organizationId, scope.defaultDataset === "synthetic", scope.reports === "all", scope.userId, definition.from, definition.through];
  const rows = await database.query<Array<{ report_id: string; reporting_date: string; projected_at: Date;
    documenting_user_id: string; documenting_user_label: string;
    revision: string; amendment: number; field_values: Record<string, unknown>; field_absences: Record<string, unknown>;
    etimes_03: Date | null; etimes_06: Date | null; etimes_09: Date | null; etimes_11: Date | null;
    etimes_03_absent: boolean; etimes_06_absent: boolean; etimes_09_absent: boolean; etimes_11_absent: boolean }>>(`
    select p.report_id,p.reporting_date::text,p.projected_at,r.revision::text,
      r.documenting_user_id,case when $7::boolean then coalesce(u.display_name,r.documenting_user_id::text) else r.documenting_user_id::text end documenting_user_label,
      coalesce((select max(a.sequence) from clinical.amendment a where a.report_id=r.id),0) amendment,
      f.field_values,f.field_absences,t.etimes_03,t.etimes_06,t.etimes_09,t.etimes_11,
      t.etimes_03_absent,t.etimes_06_absent,t.etimes_09_absent,t.etimes_11_absent
    from analytics.review_volume_source p join clinical.report r on r.id=p.report_id and r.organization_id=p.organization_id
    left join app_identity.app_user u on u.id=r.documenting_user_id and u.organization_id=r.organization_id
    join analytics.review_field_source_with_identity f on f.report_id=p.report_id and f.reporting_date=p.reporting_date
    join analytics.review_operational_time_source t on t.report_id=p.report_id and t.reporting_date=p.reporting_date
    where p.organization_id=$1 and p.synthetic=$2 and ($3 or p.documenting_user_id=$4)
      and r.status='signed' and (r.expires_at is null or r.expires_at>now())
      and p.reporting_date between $5::date and $6::date
    order by p.report_id limit 20001`, [...params, scope.identifying]);
  if (rows.length > 20000) throw new BadRequestException("Analysis exceeds the 20,000-report limit; narrow the period");
  const reports = new Map<string, AnalyticsReport>();
  for (const row of rows) {
    const report: AnalyticsReport = { id: row.report_id, date: row.reporting_date,
      revision: JSON.stringify([row.projected_at, row.revision, row.amendment]), values: [] };
    if (selected.some((field) => field.id === userElement.id)) report.values.push({
      id: `${row.report_id}:${userElement.id}`, element: userElement.id,
      value: { type: "code", value: row.documenting_user_id }, label: row.documenting_user_label,
      state: "valid", unit: null, groupId: null, path: [], ordinal: 0, groupOrdinal: 0, clinicalTime: null,
    });
    for (const field of selected.filter((field) => field.source !== "custom" && !field.repeating)) {
      let value = typed(field, row.field_values[field.id]), state: AnalyticsOccurrence["state"] = value ? "valid" : "invalid";
      if (row.field_absences[field.id]) { value = null; state = "absent"; }
      if (field.interval) {
        const key = (id: string) => `etimes_${id.split(".")[1]}` as "etimes_03" | "etimes_06" | "etimes_09" | "etimes_11";
        const startKey = key(field.interval.start), endKey = key(field.interval.end);
        const start = row[startKey], end = row[endKey];
        if (row[`${startKey}_absent`] || row[`${endKey}_absent`]) { value = null; state = "absent"; }
        else if (!start || !end) continue;
        else {
          const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
          value = minutes >= 0 ? { type: "number", value: minutes } : null; state = value ? "valid" : "invalid";
        }
      } else if (row.field_values[field.id] == null && !row.field_absences[field.id]) continue;
      report.values.push({ id: `${row.report_id}:${field.id}`, element: field.id, value, label: value ? String(value.value) : null,
        state, unit: field.unit, groupId: null, path: [], ordinal: 0, groupOrdinal: 0, clinicalTime: null });
    }
    reports.set(report.id, report);
  }
  if (!reports.size) return [];
  const reportIds = [...reports.keys()];
  const repeatIds = selected.filter((field) => field.repeating && field.source !== "custom").map((field) => field.id);
  const customIds = selected.filter((field) => field.source === "custom").map((field) => field.id);
  interface OccurrenceRow { report_id: string; id: string; element: string; value: unknown; unit: string | null;
    absence: string | null; group_id: string | null; group_instance_id: string | null; parent_group_instance_id: string | null;
    instance_path: string[] | null; group_ordinal: number; element_ordinal: number; clinical_time: Date | null; label: string | null }
  const repeated = repeatIds.length ? await database.query<OccurrenceRow[]>(`select report_id,element_occurrence_id id,element_id element,
    coalesce(to_jsonb(numeric_value),to_jsonb(code)) value,unit_code unit,absence_kind absence,
    group_id,group_instance_id,parent_group_instance_id,null::text[] instance_path,group_ordinal,element_ordinal,clinical_time,code label
    from analytics.review_repeated_field_source where organization_id=$1 and synthetic=$2 and ($3 or documenting_user_id=$4)
      and report_id=any($5::uuid[]) and element_id=any($6::text[])
      and reporting_date between $7::date and $8::date order by report_id,element_occurrence_id limit 20001`,
  [...params.slice(0, 4), reportIds, repeatIds, definition.from, definition.through]) : [];
  const custom = customIds.length ? await database.query<OccurrenceRow[]>(`select c.report_id,c.element_occurrence_id id,
    ${customIdentitySql("c.custom_definition_id", "c.custom_definition")} element,
    case when c.value_kind in ('numeric','integer') then to_jsonb(coalesce(c.normalized_numeric,c.value_numeric,c.value_integer::numeric))
      when c.value_kind='boolean' then to_jsonb(c.value_boolean) when c.value_kind='date' then to_jsonb(c.value_date::text)
      when c.value_kind='datetime' then to_jsonb(c.value_datetime) when c.value_kind='text' then to_jsonb(c.value_text) else to_jsonb(c.code) end value,
    coalesce(c.normalized_unit_code,c.source_unit_code) unit,
    coalesce(c.absence_kind,c.not_value_code,c.pertinent_negative_code) absence,
    c.group_id,c.group_instance_id,c.parent_group_instance_id,c.instance_path::text[],c.group_ordinal,c.element_ordinal,c.clinical_time,c.code label
    from analytics.review_custom_field_source c join analytics.review_volume_source p on p.report_id=c.report_id and p.reporting_date=c.reporting_date
    where c.organization_id=$1 and p.synthetic=$2 and ($3 or p.documenting_user_id=$4)
      and c.report_id=any($5::uuid[]) and ${customIdentitySql("c.custom_definition_id", "c.custom_definition")}=any($6::text[])
      and (not c.is_identifying or $7) and c.reporting_date between $8::date and $9::date
    order by c.report_id,c.element_occurrence_id limit 20001`,
  [...params.slice(0, 4), reportIds, customIds, scope.identifying, definition.from, definition.through]) : [];
  if (repeated.length + custom.length > 20000) throw new BadRequestException("Analysis exceeds the 20,000-occurrence limit; narrow the query");
  for (const row of [...repeated, ...custom]) {
    const field = selected.find((field) => field.id === row.element)!;
    const value = row.absence ? null : typed(field, row.value);
    if (typeof value?.value === "string" && value.value.length > 256) throw new BadRequestException("Recorded value exceeds analytical limits");
    reports.get(row.report_id)!.values.push({ id: row.id, element: row.element, value,
      label: value ? String(value.value) : null, state: row.absence ? "absent" : value ? "valid" : "invalid",
      unit: row.unit ?? field.unit, groupId: row.group_id, path: row.instance_path ?? [row.parent_group_instance_id, row.group_instance_id].filter((id): id is string => !!id),
      groupOrdinal: Number(row.group_ordinal ?? 0), ordinal: Number(row.element_ordinal ?? 0), clinicalTime: instant(row.clinical_time) });
  }
  // Resolve only the selected coded values. Identity remains the original code;
  // translated/display labels never participate in grouping or authorization.
  const observedCodes = [...reports.values()].flatMap((report) => report.values.flatMap((row) =>
    row.value?.type === "code" && row.element !== userElement.id && !row.element.startsWith("custom:") ? [{ report_id: report.id, element: row.element, code: String(row.value.value) }] : []));
  const labels = observedCodes.length ? await database.query<Array<{ report_id: string; element: string; code: string; label: string }>>(`
    select distinct observed.report_id,observed.element,observed.code,option.display label
    from jsonb_to_recordset($1::jsonb) observed(report_id uuid,element text,code text)
      join clinical.report r on r.id=observed.report_id
      join catalog.value_set_element e on e.release_id=r.catalog_release_id and e.element_id=observed.element
      join catalog.value_set_option option on option.release_id=e.release_id and option.value_set_id=e.value_set_id and option.code=observed.code
    order by observed.report_id,observed.element,observed.code,option.display`, [JSON.stringify(observedCodes)]) : [];
  const names = new Map(labels.map((row) => [JSON.stringify([row.report_id, row.element, row.code]), row.label]));
  for (const report of reports.values()) for (const value of report.values) if (value.value)
    value.label = names.get(JSON.stringify([report.id, value.element, String(value.value.value)])) ?? value.label;
  return [...reports.values()];
}
