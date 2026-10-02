import { compiledValidationBundleSha256, evaluateValidationBundleSafely, reviewPriorityOfRule,
  type CompiledValidationBundle, type ValidationFinding } from "@open-triage/contracts";
import type { DataSource, EntityManager } from "typeorm";
import { encounterDocument } from "../reports/encounter-document.persistence.js";

const MAX_BATCH = 100;
type Work = { id: string; organization_id: string; report_id: string; signed_snapshot_id: string;
  signed_revision: string | number; amendment_sequence: number; attempts: number; validation_version_id: string;
  catalog_release_id: string; };
type Version = { compiled_bundle: CompiledValidationBundle; compiled_sha256: string; catalog_release_id: string };

/** Discover work from committed signatures; signing never waits for this worker. */
export async function discoverReviewWork(manager: EntityManager, limit = MAX_BATCH): Promise<number> {
  const rows = await manager.query<Array<{ id: string }>>(`
    with candidates as (
      select r.organization_id, r.id report_id, s.id signed_snapshot_id,
        coalesce((select max(a.sequence) from clinical.amendment a where a.report_id = r.id), 0) amendment_sequence,
        s.validation_version_id
      from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id
      where r.status = 'signed' and s.validation_version_id is not null
        and not exists (select 1 from clinical.review_work prior
          where prior.report_id = r.id and prior.signed_snapshot_id = s.id
            and prior.amendment_sequence = coalesce((select max(a.sequence) from clinical.amendment a
              where a.report_id = r.id), 0) and prior.validation_version_id = s.validation_version_id)
      order by s.signed_at, s.id limit $1
    )
    insert into clinical.review_work
      (organization_id, report_id, signed_snapshot_id, amendment_sequence, validation_version_id)
    select organization_id, report_id, signed_snapshot_id, amendment_sequence, validation_version_id
    from candidates on conflict do nothing returning id`, [limit]);
  return rows.length;
}

/** One locked work row is completed atomically with its immutable evidence and queue projection. */
export async function processReviewWork(database: DataSource, limit = 25): Promise<{ processed: number; failed: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new RangeError("Invalid Review batch size");
  let processed = 0;
  let failed = 0;
  await database.transaction(async (manager) => { await discoverReviewWork(manager, limit); });
  for (let index = 0; index < limit; index += 1) {
    try {
      const didWork = await database.transaction(async (manager) => {
        const work = (await manager.query<Work[]>(`
          select w.*, s.signed_revision, r.catalog_release_id
          from clinical.review_work w join clinical.signed_snapshot s on s.id = w.signed_snapshot_id
          join clinical.report r on r.id = w.report_id
          where w.state in ('pending', 'failed') and w.next_attempt_at <= now() and w.attempts < 12
          order by w.next_attempt_at, w.id limit 1 for update of w skip locked`))[0];
        if (!work) return false;
        const evaluationTime = new Date().toISOString();
        const version = (await manager.query<Version[]>(`
          select compiled_bundle, compiled_sha256, catalog_release_id from validation.version
          where id = $1 and organization_id = $2 and status = 'published'`,
        [work.validation_version_id, work.organization_id]))[0];
        let findings: ValidationFinding[] = [];
        let failures: Array<{ validationVersionId: string; ruleId: string; executionTarget: 'review'; code: string; message: string }> = [];
        if (!version || version.catalog_release_id !== work.catalog_release_id ||
            version.compiled_bundle.catalogReleaseId !== work.catalog_release_id) {
          failures = [{ validationVersionId: work.validation_version_id, ruleId: 'bundle', executionTarget: 'review',
            code: 'compatibility', message: 'The published rule catalog is incompatible with the signed report' }];
        } else if (compiledValidationBundleSha256(version.compiled_bundle) !== version.compiled_sha256) {
          failures = [{ validationVersionId: work.validation_version_id, ruleId: 'bundle', executionTarget: 'review',
            code: 'integrity', message: 'The published review bundle failed its integrity check' }];
        } else {
          try {
            const document = await encounterDocument(manager, work.report_id, true);
            const settings = await manager.query<Array<{ language: string }>>(
              `select language from app_identity.agency_settings where organization_id=$1`, [work.organization_id]);
            const result = evaluateValidationBundleSafely(version.compiled_bundle, document, 'review',
              { timestamp: evaluationTime, language: settings[0]?.language ?? 'en' });
            findings = result.findings;
            failures = result.failures.map((failure) => ({ ...failure, executionTarget: 'review' as const }));
          } catch {
            failures = [{ validationVersionId: work.validation_version_id, ruleId: 'bundle', executionTarget: 'review',
              code: 'runtime', message: 'The signed report could not be evaluated' }];
          }
        }
        const outcome = failures.length ? 'failed' : findings.length ? 'findings' : 'passed';
        const evaluation = (await manager.query<Array<{ id: string }>>(`
          insert into clinical.review_evaluation
            (work_id,attempt,organization_id,report_id,signed_snapshot_id,signed_revision,amendment_sequence,
             validation_version_id,validation_compiled_sha256,evaluated_at,outcome,findings,failures)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
          on conflict (work_id,attempt) do nothing returning id`,
        [work.id, Number(work.attempts) + 1, work.organization_id, work.report_id, work.signed_snapshot_id, work.signed_revision,
          work.amendment_sequence, work.validation_version_id, version?.compiled_sha256 ?? '0'.repeat(64),
          evaluationTime, outcome, JSON.stringify(findings), JSON.stringify(failures)]))[0];
        if (evaluation && version) {
          const byCriterion = new Map<string, ValidationFinding[]>();
          for (const finding of findings) byCriterion.set(finding.ruleId,
            [...(byCriterion.get(finding.ruleId) ?? []), finding]);
          for (const [criterionId, matches] of byCriterion) {
            const rule = version.compiled_bundle.rules.find((candidate) => candidate.ruleId === criterionId);
            if (!rule) continue;
            const item = (await manager.query<Array<{ id: string }>>(`
              insert into clinical.review_item (organization_id,report_id,criterion_id,priority,first_matched_at)
              values ($1,$2,$3,$4,$5)
              on conflict (organization_id,report_id,criterion_id) do update
                set priority=excluded.priority, updated_at=now() returning id`,
            [work.organization_id, work.report_id, criterionId, reviewPriorityOfRule(rule), evaluationTime]))[0]!;
            await manager.query(`insert into clinical.review_item_evidence
              (organization_id,item_id,evaluation_id,findings) values ($1,$2,$3,$4::jsonb)
              on conflict (item_id,evaluation_id) do nothing`,
            [work.organization_id, item.id, evaluation.id, JSON.stringify(matches)]);
          }
        }
        await manager.query(`update clinical.review_work set state=$2, attempts=attempts+1,
          last_error=$3, completed_at=$4, next_attempt_at=case when $2='failed'
            then now()+interval '5 minutes' else next_attempt_at end where id=$1`,
        [work.id, outcome === 'failed' ? 'failed' : 'complete', failures.length ? JSON.stringify(failures) : null,
          outcome === 'failed' ? null : evaluationTime]);
        return true;
      });
      if (!didWork) break;
      processed += 1;
    } catch (error) {
      failed += 1;
      throw error;
    }
  }
  return { processed, failed };
}
