import { BadRequestException, ConflictException } from "@nestjs/common";
import { compiledValidationBundleSha256, readValidationDefinition, evaluateMetric, evaluateValidationOutcomes,
  type AnalyticsElement, type CompiledValidationBundle, type EncounterDocument, type MetricResult, type ValidationRuleOutcome } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { assembleEncounterDocument } from "../reports/encounter-document.persistence.js";
import type { AnalyticsReport } from "./analytics-engine.js";
import type { ReviewScope } from "./review-scope.js";
import { normalizedMetricEvidence } from "./metric-evidence.js";

export interface ConfiguredAnalyticsLibrary { bundle: CompiledValidationBundle | null; elements: AnalyticsElement[] }
/** Membership comes from the active configuration, even with no readable report observations. */
export async function configuredAnalyticsLibrary(database: Pick<EntityManager, "query">, scope: ReviewScope): Promise<ConfiguredAnalyticsLibrary> {
  const [version] = await database.query<Array<{ id: string; version: number; catalog_release_id: string;
    compiled_bundle: CompiledValidationBundle; compiled_sha256: string; source_rule?: unknown }>>(`
    select v.id,v.version,v.catalog_release_id,v.compiled_bundle,v.compiled_sha256,v.source_rule
    from app_identity.active_configuration_bundle active join validation.version v on v.id=active.validation_version_id
      and v.organization_id=active.organization_id
    where active.organization_id=$1 and v.status='published'`, [scope.organizationId]);
  if (!version) return { bundle: null, elements: [] };
  if (compiledValidationBundleSha256(version.compiled_bundle) !== version.compiled_sha256)
    throw new ConflictException("The active Validation configuration failed its integrity check");
  const bundle = { ...version.compiled_bundle, rules: [...version.compiled_bundle.rules] };
  // Older publications deduplicated equivalent execution rules. Restore each configured
  // identity for analysis without changing clinical finding/queue deduplication.
  const sources = version.source_rule ? readValidationDefinition(version.source_rule).rules : [];
  const key = (rule: typeof sources[number]) => JSON.stringify([rule.enabled, rule.severity,
    rule.executionTargets.includes("review") ? rule.reviewPriority ?? "medium" : null,
    [...rule.executionTargets].sort(), rule.primaryTargetElementId, rule.message.trim(), rule.source.trim().replace(/\s+/g, " ")]);
  const compiledBySource = new Map(sources.flatMap((source) => {
    const rule = bundle.rules.find((rule) => rule.ruleId === source.id); return rule ? [[key(source), rule] as const] : [];
  }));
  for (const source of sources) if (!bundle.rules.some((rule) => rule.ruleId === source.id)) {
    const equivalent = compiledBySource.get(key(source));
    if (equivalent) bundle.rules.push({ ...equivalent, ruleId: source.id, name: source.name, localization: source.localization });
  }
  const identifying = scope.identifying ? [] : await database.query<Array<{ element_id: string }>>(`
    select element_id from catalog.analytics_element_mapping where release_id=$1 and identifying
    union
    select definition->>'namespace'||'.'||(definition->>'slug') as element_id
      from catalog.release cr cross join lateral jsonb_array_elements(coalesce(cr.provenance->'customElementDefinitions','[]'::jsonb)) definition
      where cr.id=$1 and (definition->>'identifying')::boolean`, [version.catalog_release_id]);
  const blocked = new Set(identifying.map((row) => row.element_id));
  const allowed = (references: string[]) => !references.some((id) => blocked.has(id));
  const identity = (kind: "metric" | "rule", id: string) => ({ kind, id, validationVersionId: version.id,
    version: Number(version.version), catalogReleaseId: version.catalog_release_id, compiledSha256: version.compiled_sha256 });
  return { bundle, elements: [
    ...(bundle.metrics ?? []).filter((metric) => metric.enabled && metric.reviewEnabled && allowed(metric.references.elementIds)).map((metric): AnalyticsElement => ({
      id: `metric:${version.id}:${metric.id}`, label: metric.name, configured: identity("metric", metric.id),
      datatype: "number", kind: "numeric", unit: metric.unit, units: [metric.unit], operations: ["mean", "median", "minimum", "maximum"],
      aggregations: ["mean", "median", "minimum", "maximum", "p90"], grouping: false, filtering: false, recordCount: 0,
    })),
    ...bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes("review") && allowed(rule.references.elementIds)).map((rule): AnalyticsElement => ({
      id: `rule:${version.id}:${rule.ruleId}`, label: rule.name, configured: identity("rule", rule.ruleId),
      datatype: "boolean", kind: "categorical", unit: null, units: [], operations: ["distribution"], aggregations: ["count", "percentage"],
      grouping: false, filtering: false, recordCount: 0,
    })),
  ] };
}

/** Batch read the same normalized base and amendment inputs used by clinical evaluation.
 * The caller's population is re-authorized here; no analytical query has workflow side effects.
 */
export async function contributeConfiguredDefinition(database: Pick<EntityManager, "query">, scope: ReviewScope,
  reports: AnalyticsReport[], metric: AnalyticsElement, library: ConfiguredAnalyticsLibrary) {
  return contributeConfiguredDefinitions(database, scope, reports, [metric], library);
}
export async function contributeConfiguredDefinitions(database: Pick<EntityManager, "query">, scope: ReviewScope,
  reports: AnalyticsReport[], metrics: AnalyticsElement[], library: ConfiguredAnalyticsLibrary) {
  if (!metrics.some((metric) => metric.configured) || !library.bundle) return;
  if (reports.length > 2000) throw new BadRequestException("Configured analysis exceeds 2,000 reports; narrow the period");
  if (!reports.length) return;
  const bundle = library.bundle;
  const definitions = [...new Map(metrics.map((metric) => [metric.id, metric])).values()].flatMap((metric) => {
    const configured = metric.configured;
    if (!configured) return [];
    const definition = configured.kind === "metric" ? bundle.metrics?.find((metric) => metric.id === configured.id) : undefined;
    const rule = configured.kind === "rule" ? bundle.rules.find((rule) => rule.ruleId === configured.id) : undefined;
    if (!definition && !rule) throw new ConflictException("Configured definition changed; select it again");
    return [{ metric, configured, definition, rule }];
  });
  const ids = reports.map((report) => report.id);
  type DocumentReport = Parameters<typeof assembleEncounterDocument>[0] & { catalog_release_id: string; revision: string; amendment: number };
  const rows = await database.query<DocumentReport[]>(`select r.id,r.created_at,r.updated_at,r.catalog_release_id,r.revision::text,
    f.id form_id,fv.version form_version,cr.standard catalog_standard,cr.version catalog_version,cr.dataset catalog_dataset,
    coalesce((select max(a.sequence) from clinical.amendment a where a.report_id=r.id),0) amendment
    from clinical.report r join forms.form_version fv on fv.id=r.form_version_id join forms.form f on f.id=fv.form_id
      join catalog.release cr on cr.id=r.catalog_release_id
    where r.id=any($1::uuid[]) and r.organization_id=$2 and r.synthetic=$3 and ($4 or r.documenting_user_id=$5)
      and r.status='signed' and (r.expires_at is null or r.expires_at>now())`,
  [ids, scope.organizationId, scope.defaultDataset === "synthetic", scope.reports === "all", scope.userId]);
  if (rows.length !== reports.length) throw new ConflictException("Analytical report access changed; refresh the result");
  const compatibleIds = rows.filter((row) => definitions.some(({ configured }) => row.catalog_release_id === configured.catalogReleaseId)).map((row) => row.id);
  type GroupRow = Parameters<typeof assembleEncounterDocument>[1][number] & { report_id: string };
  type ValueRow = Parameters<typeof assembleEncounterDocument>[2][number] & { report_id: string; identifying?: boolean };
  const groupRows = compatibleIds.length ? await database.query<GroupRow[]>(`select id,report_id,parent_group_instance_id,group_id,ordinal,documented_time,correlation_id
    from clinical.group_instance where report_id=any($1::uuid[]) and tombstoned_at is null order by report_id,group_id,ordinal,id limit 50001`, [compatibleIds]) : [];
  const valueRows = compatibleIds.length ? await database.query<ValueRow[]>(`select * from clinical.element_occurrence
    where report_id=any($1::uuid[]) and tombstoned_at is null order by report_id,element_id,ordinal,id limit 50001`, [compatibleIds]) : [];
  const overlays = compatibleIds.length ? await database.query<Array<{ report_id: string; action: string;
    target_element_occurrence_id: string | null; corrected_value: Partial<ValueRow> | null }>>(`
    select a.report_id,c.action,c.target_element_occurrence_id,c.corrected_value from clinical.amendment a
      join clinical.amendment_change c on c.amendment_id=a.id where a.report_id=any($1::uuid[]) order by a.sequence,c.id limit 50001`, [compatibleIds]) : [];
  if (groupRows.length > 50000 || valueRows.length > 50000 || overlays.length > 50000)
    throw new BadRequestException("Configured analysis exceeds 50,000 input rows; narrow the query");
  const values = new Map(valueRows.map((row) => [row.id, row]));
  for (const overlay of overlays) {
    if (overlay.action === "remove" && overlay.target_element_occurrence_id) values.delete(overlay.target_element_occurrence_id);
    else if (overlay.corrected_value) {
      const previous = overlay.target_element_occurrence_id ? values.get(overlay.target_element_occurrence_id) : undefined;
      const next = { ...previous, ...overlay.corrected_value, report_id: overlay.report_id } as ValueRow;
      values.set(next.id, next);
    }
  }
  const groupsByReport = new Map<string, GroupRow[]>(), valuesByReport = new Map<string, ValueRow[]>();
  for (const group of groupRows) { const groups = groupsByReport.get(group.report_id) ?? []; groups.push(group); groupsByReport.set(group.report_id, groups); }
  for (const value of values.values()) { const rows = valuesByReport.get(value.report_id) ?? []; rows.push(value); valuesByReport.set(value.report_id, rows); }
  const metadata = new Map(rows.map((row) => [row.id, row]));
  for (const report of reports) {
    const row = metadata.get(report.id)!;
    let document: EncounterDocument | undefined;
    for (const { metric, configured, definition, rule } of definitions) {
      report.revision = JSON.stringify([report.revision, row.revision, row.amendment, configured]);
      let result: MetricResult | ValidationRuleOutcome | { state: "failed"; value: null; reason: string };
      if (row.catalog_release_id !== configured.catalogReleaseId) result = { state: "failed", value: null, reason: "Historical report catalog is incompatible with this definition" };
      else if (!scope.identifying && (valuesByReport.get(row.id) ?? []).some(value => value.identifying &&
        (definition?.references.elementIds ?? rule?.references.elementIds ?? []).includes(value.element_id)))
        result = { state: "failed", value: null, reason: "Calculation inputs require identifying-data access" };
      else {
        document ??= assembleEncounterDocument(row, groupsByReport.get(row.id) ?? [], valuesByReport.get(row.id) ?? []);
        // A stable revision-owned time keeps time-based applicability reproducible across display/export.
        const context = { timestamp: new Date(row.updated_at).toISOString() };
        result = definition ? { ...evaluateMetric(definition, document, context) } :
          { ...evaluateValidationOutcomes({ ...bundle, rules: [rule!] }, document, "review", context).outcomes[0]! };
        if (!scope.identifying) result = "metricId" in result ? normalizedMetricEvidence(result)
          : { ...result, metricEvidence: result.metricEvidence.map(normalizedMetricEvidence) };
      }
      report.values.push({ id: `${report.id}:${metric.id}`, element: metric.id,
        value: result.state === "valid" && result.value !== null ? { type: configured.kind === "metric" ? "number" : "boolean", value: result.value } : null,
        state: result.state, label: result.state === "valid" ? String(result.value) : null, unit: metric.unit,
        groupId: null, path: [], ordinal: 0, groupOrdinal: 0, clinicalTime: null,
        evidence: { ...result, reportRevision: row.revision, amendmentSequence: row.amendment, definition: configured } });
    }
  }
}
