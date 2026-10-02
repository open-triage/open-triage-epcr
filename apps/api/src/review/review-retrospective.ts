import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { compiledValidationBundleSha256, evaluateValidationBundleSafely,
  type CompiledValidationBundle } from "@open-triage/contracts";
import type { ReviewRetrospectiveDefinition, ReviewRetrospectivePreview,
  ReviewRetrospectiveRun, ReviewRetrospectiveVersion } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { encounterDocument } from "../reports/encounter-document.persistence.js";
import type { ReviewScope } from "./review-scope.js";

const LIMIT = 500;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateRetrospectiveDefinition(input: ReviewRetrospectiveDefinition): void {
  if (!input || !uuid.test(input.criterionId) || !uuid.test(input.validationVersionId) ||
    !day(input.from) || !day(input.to) || input.from > input.to ||
    (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86400000 > 365 ||
    !["real", "synthetic"].includes(input.dataset))
    throw new BadRequestException("Invalid retrospective Review selection");
}

export function requireRetrospectiveAdmin(scope: ReviewScope): void {
  if (!scope.administrator || scope.reports !== "all")
    throw new ForbiddenException("Review administration and all-report access are required");
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type VersionRow = { id: string; rule_id: string; catalog_release_id: string;
  compiled_sha256: string; compiled_bundle: CompiledValidationBundle;
  display_name: string; version: number; published_at: Date | string };
type CandidateRow = { report_id: string; reporting_date: string; signed_snapshot_id: string;
  amendment_sequence: string | number; catalog_release_id: string;
  existing_item_version: string | null };

export type RetrospectiveCandidate = CandidateRow & { outcome: ReviewRetrospectivePreview["reports"][number]["outcome"];
  findingCount: number; failureCode: string | null };

export async function retrospectiveVersions(manager: Pick<EntityManager, "query">,
  scope: ReviewScope): Promise<ReviewRetrospectiveVersion[]> {
  requireRetrospectiveAdmin(scope);
  const rows = await manager.query<VersionRow[]>(`
    select id,rule_id,catalog_release_id,display_name,version,published_at
    from validation.version v
    where v.organization_id=$1 and v.status='published'
      and exists (select 1 from jsonb_array_elements(v.compiled_bundle->'rules') rule
        where rule->>'ruleId'=v.rule_id::text and rule->>'enabled'='true'
          and rule->'executionTargets' ? 'review')
    order by published_at desc,id limit 500`, [scope.organizationId]);
  return rows.map((row) => ({ criterionId: row.rule_id, validationVersionId: row.id,
    name: row.display_name, version: Number(row.version), catalogReleaseId: row.catalog_release_id,
    publishedAt: new Date(row.published_at).toISOString() }));
}

export async function loadRetrospectivePopulation(manager: Pick<EntityManager, "query">,
  scope: ReviewScope, definition: ReviewRetrospectiveDefinition): Promise<{
    version: VersionRow; rows: CandidateRow[]; sourceRevision: string;
  }> {
  requireRetrospectiveAdmin(scope);
  validateRetrospectiveDefinition(definition);
  const [version] = await manager.query<VersionRow[]>(`
    select id,rule_id,catalog_release_id,compiled_sha256,compiled_bundle,
      display_name,version,published_at
    from validation.version where id=$1 and organization_id=$2 and rule_id=$3
      and status='published'`, [definition.validationVersionId, scope.organizationId, definition.criterionId]);
  if (!version || !version.compiled_bundle.rules.some((rule) => rule.ruleId === definition.criterionId &&
    rule.enabled && rule.executionTargets.includes("review")))
    throw new NotFoundException("Published Review criterion version is unavailable");
  const [route] = await manager.query<Array<{ version: string }>>(`
    select version::text from clinical.review_criterion_route
    where organization_id=$1 and criterion_id=$2`, [scope.organizationId, definition.criterionId]);
  const rows = await manager.query<CandidateRow[]>(`
    select r.id report_id,r.reporting_date::text,s.id signed_snapshot_id,
      r.catalog_release_id,
      coalesce((select max(a.sequence) from clinical.amendment a where a.report_id=r.id),0)::text amendment_sequence,
      item.version::text existing_item_version
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    left join clinical.review_item item on item.organization_id=r.organization_id
      and item.report_id=r.id and item.criterion_id=$5::uuid
    where r.organization_id=$1 and r.synthetic=$2 and r.status='signed'
      and r.reporting_date between $3::date and $4::date
    order by r.reporting_date,r.id limit 501`,
  [scope.organizationId, definition.dataset === "synthetic", definition.from, definition.to,
    definition.criterionId]);
  if (rows.length > LIMIT) throw new BadRequestException(
    `Retrospective preview exceeds ${LIMIT} reports; choose a shorter period`);
  const sourceRevision = digest([definition, scope.organizationId, scope.reports,
    version.compiled_sha256, route?.version ?? "0", rows]);
  return { version, rows, sourceRevision };
}

export async function previewRetrospective(manager: Pick<EntityManager, "query">,
  scope: ReviewScope, definition: ReviewRetrospectiveDefinition): Promise<{
    preview: ReviewRetrospectivePreview; candidates: RetrospectiveCandidate[];
  }> {
  const { version, rows, sourceRevision } = await loadRetrospectivePopulation(manager, scope, definition);
  const integrity = compiledValidationBundleSha256(version.compiled_bundle) === version.compiled_sha256;
  const selected = { ...version.compiled_bundle,
    rules: version.compiled_bundle.rules.filter((rule) => rule.ruleId === definition.criterionId) };
  const settings = await manager.query<Array<{ language: string }>>(
    `select language from app_identity.agency_settings where organization_id=$1`, [scope.organizationId]);
  const candidates: RetrospectiveCandidate[] = [];
  for (const row of rows) {
    let outcome: RetrospectiveCandidate["outcome"] = "no-match";
    let findingCount = 0;
    let failureCode: string | null = null;
    if (row.catalog_release_id !== version.catalog_release_id ||
      version.compiled_bundle.catalogReleaseId !== version.catalog_release_id) {
      outcome = "incompatible"; failureCode = "catalog";
    } else if (!integrity) { outcome = "failed"; failureCode = "integrity"; }
    else {
      try {
        const document = await encounterDocument(manager as EntityManager, row.report_id, true,
          Number(row.amendment_sequence));
        const evaluated = evaluateValidationBundleSafely(selected, document, "review",
          { timestamp: new Date().toISOString(), language: settings[0]?.language ?? "en" });
        findingCount = evaluated.findings.length;
        if (evaluated.failures.length) { outcome = "failed";
          failureCode = evaluated.failures[0]!.code; }
        else if (findingCount) outcome = "match";
      } catch { outcome = "failed"; failureCode = "runtime"; }
    }
    candidates.push({ ...row, outcome, findingCount, failureCode });
  }
  const reports = candidates.map((row) => ({ reportId: row.report_id,
    reportingDate: row.reporting_date, outcome: row.outcome,
    existing: row.existing_item_version !== null, findingCount: row.findingCount,
    failureCode: row.failureCode }));
  const preview: ReviewRetrospectivePreview = { definition,
    scope: { organizationId: scope.organizationId, reports: "all" },
    sourceRevision, revision: digest([sourceRevision, reports]), total: reports.length,
    matches: reports.filter((row) => row.outcome === "match").length,
    newItems: reports.filter((row) => row.outcome === "match" && !row.existing).length,
    existingItems: reports.filter((row) => row.existing).length,
    failed: reports.filter((row) => row.outcome === "failed").length,
    incompatible: reports.filter((row) => row.outcome === "incompatible").length,
    reports };
  return { preview, candidates };
}

export async function retrospectiveRunStatus(manager: Pick<EntityManager, "query">,
  scope: ReviewScope, id: string): Promise<ReviewRetrospectiveRun> {
  requireRetrospectiveAdmin(scope);
  if (!uuid.test(id)) throw new BadRequestException("Invalid retrospective Review run");
  const [run] = await manager.query<Array<{ criterion_id: string; validation_version_id: string;
    date_from: string; date_to: string; dataset: "real" | "synthetic"; created_at: Date | string }>>(`
    select criterion_id,validation_version_id,date_from::text,date_to::text,dataset,created_at
    from clinical.review_retrospective_run where id=$1 and organization_id=$2`,
  [id, scope.organizationId]);
  if (!run) throw new NotFoundException("Retrospective Review run is unavailable");
  const [counts] = await manager.query<Array<Record<string, string>>>(`
    select count(*)::text total,
      count(*) filter (where work.state='complete')::text complete,
      count(*) filter (where report.preview_outcome <> 'incompatible'
        and work.state is distinct from 'complete' and work.state is distinct from 'failed')::text pending,
      count(*) filter (where work.state='failed' or report.preview_outcome='failed' and work.id is null)::text failed,
      count(*) filter (where report.preview_outcome='incompatible')::text incompatible,
      count(*) filter (where report.preview_outcome='match')::text matches,
      count(*) filter (where report.preview_existing)::text existing_items,
      count(*) filter (where report.preview_outcome='match' and not report.preview_existing)::text new_items
    from clinical.review_retrospective_report report
    left join clinical.review_work work on work.id=report.work_id
    where report.run_id=$1 and report.organization_id=$2`, [id, scope.organizationId]);
  return { id, definition: { criterionId: run.criterion_id,
    validationVersionId: run.validation_version_id, from: run.date_from, to: run.date_to,
    dataset: run.dataset }, createdAt: new Date(run.created_at).toISOString(),
    total: Number(counts?.total ?? 0), complete: Number(counts?.complete ?? 0),
    pending: Number(counts?.pending ?? 0), failed: Number(counts?.failed ?? 0),
    incompatible: Number(counts?.incompatible ?? 0), matches: Number(counts?.matches ?? 0),
    existingItems: Number(counts?.existing_items ?? 0), newItems: Number(counts?.new_items ?? 0) };
}
