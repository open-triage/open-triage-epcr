import type { EntityManager } from "typeorm";
import { BadRequestException } from "@nestjs/common";
import type { AnalyticsCatalogPage, AnalyticsCatalogValue, AnalyticsElement, AnalyticsValue } from "@open-triage/contracts";
import type { ReviewScope } from "./review-scope.js";
import { reviewFields, repeatedReviewFields, operationalTimeFields } from "./review-fields.js";

export const numericAggregations = ["mean", "median", "minimum", "maximum", "p90"] as const;
export const recordsElement: AnalyticsElement = { id: "records", label: "Records", datatype: "records", kind: "categorical", unit: null,
  operations: ["distribution"], aggregations: ["count", "percentage"], grouping: false, filtering: false, units: [], recordCount: 0 };
export const userElement: AnalyticsElement = { id: "record.documenting-user", label: "User", datatype: "code", kind: "categorical", unit: null,
  operations: [], aggregations: [], grouping: true, filtering: true, units: [], recordCount: 0 };
export const standardElements: AnalyticsElement[] = [...reviewFields, ...repeatedReviewFields, ...operationalTimeFields].map((field) => ({
  ...field, datatype: field.kind === "numeric" ? "number" : "code",
  operations: field.kind === "numeric" ? ["mean", "median", "minimum", "maximum"] : ["distribution"],
  aggregations: field.kind === "numeric" ? [...numericAggregations] : ["count", "percentage"],
  grouping: !("interval" in field), filtering: !("interval" in field),
  units: field.unit ? [field.unit] : [], recordCount: 0,
}));
export const customIdentitySql = (id: string, definition: string) =>
  `('custom:' || (${id})::text || ':' || md5((${definition} - 'title' - 'localization' - 'retired' - 'usage')::text))`;

// Live discovery deliberately uses the existing API's clinical read privileges,
// not private projections or an analyst grant. Every base and amendment row is
// rooted in the same authorized, nonexpired report set. No query-date predicate.
export const catalogSourceSql = `with scoped_reports as materialized (
  select r.id,r.catalog_release_id,r.organization_id,r.status,r.documenting_user_id
  from clinical.report r where r.organization_id=$1::uuid and r.synthetic=$2::boolean
    and ($3::boolean or r.documenting_user_id=$4::uuid)
    and (r.expires_at is null or r.expires_at>now())
) , custom_definitions as materialized (
  select release.id catalog_release_id,entry definition from catalog.release release
    join (select distinct catalog_release_id from scoped_reports) scope on scope.catalog_release_id=release.id
    cross join lateral jsonb_array_elements(coalesce(release.provenance->'customElementDefinitions','[]'::jsonb)) entry
) , amendments as (
  select r.id report_id,r.catalog_release_id,c.target_element_occurrence_id,c.action,c.id change_id,a.sequence,
    c.original_value,
    (select jsonb_object_agg(coalesce(aliases.mapping->>entry.key,entry.key),entry.value)
      from jsonb_each(coalesce(c.corrected_value,'{}'::jsonb)) entry) corrected_value
  from scoped_reports r join clinical.amendment a on a.report_id=r.id
    join clinical.amendment_change c on c.amendment_id=a.id
    cross join (select '{"elementOccurrenceId":"id","reportId":"report_id","catalogReleaseId":"catalog_release_id","elementId":"element_id","elementIdentityId":"element_identity_id","groupInstanceId":"group_instance_id","valueKind":"value_kind","valueNumeric":"value_numeric","valueInteger":"value_integer","valueBoolean":"value_boolean","valueDate":"value_date","valueDateTime":"value_datetime","valueText":"value_text","codeDisplay":"code_display","codeSystem":"code_system","sourceAttributes":"source_attributes","notValueCode":"not_value_code","pertinentNegativeCode":"pertinent_negative_code","absenceCode":"absence_code"}'::jsonb mapping) aliases
), versions as (
  select r.id report_id,r.catalog_release_id,o.id occurrence_id,to_jsonb(o) value,0 sequence,'base' action,'' change_id
  from scoped_reports r join clinical.element_occurrence o on o.report_id=r.id where o.tombstoned_at is null
    -- Discard nonanalytical base fields before materializing JSON occurrences.
    -- Amendment overlays still read their complete original/corrected values.
    and (o.element_id=any($5::text[]) or exists (
      select 1 from custom_definitions custom where custom.catalog_release_id=r.catalog_release_id
        and custom.definition->>'id'=o.element_identity_id::text))
  union all
  select c.report_id,c.catalog_release_id,coalesce(c.target_element_occurrence_id,(c.corrected_value->>'id')::uuid),
    coalesce(c.original_value,to_jsonb(o),'{}'::jsonb)||coalesce(c.corrected_value,'{}'::jsonb),c.sequence,c.action,c.change_id::text
  from amendments c left join clinical.element_occurrence o on o.report_id=c.report_id and o.id=c.target_element_occurrence_id
), effective as (
  select distinct on (report_id,occurrence_id) * from versions
  order by report_id,occurrence_id,sequence desc,change_id desc
), medication_units as materialized (
  -- Resolve units once per medication group. A correlated scan of effective
  -- rereads the entire occurrence set for every dose and spills to disk.
  select distinct on (report_id,value->>'group_instance_id') report_id,
    value->>'group_instance_id' group_instance_id,value->>'code' code
  from effective where value->>'element_id'='eMedications.06' and action<>'remove'
  order by report_id,value->>'group_instance_id',occurrence_id
), permitted as (
  select e.report_id,e.catalog_release_id,e.value,
    case when custom.definition is not null then ${customIdentitySql("custom.definition->>'id'", "custom.definition")} else e.value->>'element_id' end element,
    custom.definition,
    coalesce(custom.definition->>'title',ed.name,e.value->>'element_id') label,
    coalesce(custom.definition->>'datatype',case when e.value->>'element_id'=any($6::text[]) then 'number' else 'coded' end) datatype
  from effective e
    left join catalog.element_definition ed on ed.release_id=e.catalog_release_id
      and ed.element_identity_id=(e.value->>'element_identity_id')::uuid
    left join catalog.analytics_element_mapping mapping on mapping.release_id=e.catalog_release_id and mapping.element_id=e.value->>'element_id'
    left join custom_definitions custom on custom.catalog_release_id=e.catalog_release_id
      and custom.definition->>'id'=e.value->>'element_identity_id'
  where e.action<>'remove' and coalesce(e.value->>'tombstoned_at','')=''
    and (e.value->>'element_id'=any($5::text[]) or custom.definition is not null)
    and (not coalesce((e.value->>'identifying')::boolean,false) and not coalesce(mapping.identifying,false)
      and not coalesce((custom.definition->>'identifying')::boolean,false) or ($7::boolean and custom.definition is not null))
), typed as (
  select p.*,case when value->>'value_kind' in ('null','absent','pertinent-negative')
      or value->>'not_value_code' is not null or value->>'pertinent_negative_code' is not null then null
    when datatype='number' then jsonb_build_object('type','number','value',coalesce(nullif(value->'value_numeric','null'::jsonb),value->'value_integer'))
    when datatype='coded' then jsonb_build_object('type','code','value',value->'code')
    when datatype='boolean' then jsonb_build_object('type','boolean','value',value->'value_boolean')
    when datatype='date' then jsonb_build_object('type','date','value',value->'value_date')
    when datatype='string' and length(value->>'value_text')<=256 then jsonb_build_object('type','string','value',value->'value_text')
    when datatype='dateTime' then jsonb_build_object('type','datetime','value',value->'value_datetime')
    else null end identity,
    case when value->>'element_id'='eMedications.05' then unit.code
      else value->'source_attributes'->>'unit' end unit
  from permitted p
    left join medication_units unit on p.value->>'element_id'='eMedications.05'
      and unit.report_id=p.report_id and unit.group_instance_id=p.value->>'group_instance_id'
  union all
  select r.id,r.catalog_release_id,
    jsonb_build_object('code_display',case when $7::boolean then coalesce(u.display_name,r.documenting_user_id::text) else r.documenting_user_id::text end),
    '${userElement.id}',null::jsonb,'User','coded',
    jsonb_build_object('type','code','value',r.documenting_user_id::text),null::text
  from scoped_reports r left join app_identity.app_user u on u.id=r.documenting_user_id and u.organization_id=r.organization_id
)`;
export function catalogParams(scope: ReviewScope) {
  return [scope.organizationId, scope.defaultDataset === "synthetic", scope.reports === "all", scope.userId,
    [...[...reviewFields, ...repeatedReviewFields].map((field) => field.id), "eMedications.06"],
    standardElements.filter((field) => field.kind === "numeric").map((field) => field.id), scope.identifying];
}
interface CatalogRow { element: string; label: string; datatype: string; definition: Record<string, unknown> | null;
  count: string; units: string[]; repeating: boolean; oversized: boolean }
export async function catalogElements(database: Pick<EntityManager, "query">, scope: ReviewScope): Promise<AnalyticsElement[]> {
  const rows = await database.query<CatalogRow[]>(`${catalogSourceSql}
    select element,max(label) label,min(datatype) datatype,min(definition::text)::jsonb definition,
      bool_or(datatype='string' and length(value->>'value_text')>256) oversized,
      count(distinct report_id)::text count,array_remove(array_agg(distinct unit),null) units,
      bool_or(coalesce(definition->>'recurrence','')='multiple' or definition->>'correlatesTo' is not null
        or definition->>'groupDefinitionId' is not null) repeating
    from typed group by element order by element`, catalogParams(scope));
  const result: AnalyticsElement[] = [];
  for (const row of rows) {
    const standard = [userElement, ...standardElements].find((field) => field.id === row.element);
    if (standard) { result.push({ ...standard, recordCount: Number(row.count), units: [...new Set([...standard.units, ...row.units])].sort() }); continue; }
    if (!row.definition) continue;
    const datatype: AnalyticsValue["type"] = row.datatype === "number" ? "number" : row.datatype === "coded" ? "code" :
      row.datatype === "boolean" ? "boolean" : row.datatype === "date" ? "date" : row.datatype === "dateTime" ? "datetime" : "string";
    const supported = ["number", "coded", "boolean", "date", "dateTime", "string"].includes(row.datatype) && !row.oversized;
    result.push({ id: row.element, label: row.label, source: "custom", datatype,
      kind: datatype === "number" ? "numeric" : "categorical", unit: row.units.length === 1 ? row.units[0]! : null,
      repeating: row.repeating, units: row.units.sort(), recordCount: Number(row.count), grouping: supported, filtering: supported,
      operations: !supported ? [] : datatype === "number" ? ["mean", "median", "minimum", "maximum"] : ["distribution"],
      aggregations: !supported ? [] : datatype === "number" ? [...numericAggregations] : ["count", "percentage"],
      ...(!supported ? { unsupportedReason: "Long text and opaque values are not available for analytics" } : {}) });
  }
  // Operational metrics are calculated from the existing signed endpoint view.
  const operational = await database.query<Array<{ response: string; scene: string; transport: string }>>(`select
    count(*) filter (where etimes_03 is not null or etimes_06 is not null)::text response,
    count(*) filter (where etimes_06 is not null or etimes_09 is not null)::text scene,
    count(*) filter (where etimes_09 is not null or etimes_11 is not null)::text transport
    from analytics.review_operational_time_source p join clinical.report r on r.id=p.report_id
    where p.organization_id=$1 and p.synthetic=$2 and ($3 or p.documenting_user_id=$4)
      and (r.expires_at is null or r.expires_at>now())`, catalogParams(scope).slice(0, 4));
  for (const key of ["response", "scene", "transport"] as const) if (Number(operational[0]?.[key]) > 0) {
    const field = standardElements.find((field) => field.id === `review.duration.${key}`)!;
    result.push({ ...field, recordCount: Number(operational[0]![key]) });
  }
  return [recordsElement, ...result.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))];
}
export function catalogPage<T>(items: T[], total: number, page: number, scope: ReviewScope): AnalyticsCatalogPage<T> {
  return { items, total, page, pageSize: 50, scope: scope.reports, dataset: scope.defaultDataset, coverage: "readable-history" };
}
export function catalogPagination(search = "", page = "1") {
  if (typeof search !== "string" || search.length > 120 || !/^[1-9][0-9]{0,5}$/.test(page))
    throw new BadRequestException("Invalid catalog search or page");
  return { search, page: Number(page) };
}
export async function catalogValues(database: Pick<EntityManager, "query">, scope: ReviewScope,
  element: AnalyticsElement, search: string, page: number): Promise<AnalyticsCatalogPage<AnalyticsCatalogValue>> {
  const rows = await database.query<Array<{ identity: AnalyticsValue; label: string; count: string; total: string }>>(`${catalogSourceSql}, choices as (
    select identity,coalesce(max(value->>'code_display'),max(option.display),identity->>'value') label,
      count(distinct report_id)::text count
    from typed left join lateral (select option.display from catalog.value_set_element link
      join catalog.value_set_option option on option.release_id=link.release_id and option.value_set_id=link.value_set_id
      where link.release_id=typed.catalog_release_id and link.element_id=typed.value->>'element_id'
        and option.code=typed.value->>'code' order by option.code_system limit 1) option on true
    where element=$8 and identity is not null and identity->'value'<>'null'::jsonb
    group by identity
  ), searched as (select * from choices where strpos(lower(label),lower($9))>0 or strpos(lower(identity->>'value'),lower($9))>0)
    select page.*,total.total from (select count(*)::text total from searched) total
    left join lateral (select * from searched order by label,identity::text limit 50 offset $10) page on true`,
  [...catalogParams(scope), element.id, search, (page - 1) * 50]);
  return catalogPage(rows.filter((row) => row.identity !== null).map((row) => ({ identity: row.identity, label: row.label, recordCount: Number(row.count) })),
    Number(rows[0]?.total ?? 0), page, scope);
}

export const catalogLabelKey = (element: string, identity: AnalyticsValue) => JSON.stringify([element, identity.type, identity.value]);
export async function catalogSelectedLabels(database: Pick<EntityManager, "query">, scope: ReviewScope,
  selections: Array<{ element: string; identity: AnalyticsValue }>): Promise<Map<string, string>> {
  if (!selections.length) return new Map();
  const unique = [...new Map(selections.map((selection) => [catalogLabelKey(selection.element, selection.identity), selection])).values()];
  const rows = await database.query<Array<{ element: string; identity: AnalyticsValue; label: string }>>(`${catalogSourceSql}
    select typed.element,typed.identity,coalesce(max(typed.value->>'code_display'),max(option.display),typed.identity->>'value') label
    from typed join jsonb_to_recordset($8::jsonb) wanted(element text,identity jsonb)
      on wanted.element=typed.element and wanted.identity=typed.identity
    left join lateral (select option.display from catalog.value_set_element link
      join catalog.value_set_option option on option.release_id=link.release_id and option.value_set_id=link.value_set_id
      where link.release_id=typed.catalog_release_id and link.element_id=typed.value->>'element_id'
        and option.code=typed.value->>'code' order by option.code_system limit 1) option on true
    group by typed.element,typed.identity`, [...catalogParams(scope), JSON.stringify(unique)]);
  return new Map(rows.map((row) => [catalogLabelKey(row.element, row.identity), row.label]));
}
