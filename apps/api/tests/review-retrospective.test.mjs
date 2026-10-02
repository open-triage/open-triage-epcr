import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { compiledValidationBundleSha256 } from '@open-triage/contracts';
import { previewRetrospective, validateRetrospectiveDefinition } from '../dist/review/review-retrospective.js';
import { ReviewService } from '../dist/review/review.service.js';

const organization = randomUUID(), actor = randomUUID(), criterion = randomUUID(), second = randomUUID();
const versionId = randomUUID(), catalog = randomUUID();
const scope = { organizationId: organization, userId: actor, reports: 'all', administrator: true,
  identifying: false, defaultDataset: 'real' };
const definition = { criterionId: criterion, validationVersionId: versionId,
  from: '2026-09-01', to: '2026-09-02', dataset: 'real' };
const rules = [criterion, second].map((ruleId) => ({ schemaVersion: 1, languageVersion: '1.0.0',
  ruleId, validationVersionId: versionId, name: 'Historical criterion', enabled: true,
  severity: 'warning', reviewPriority: 'medium', executionTargets: ['review'],
  primaryTarget: { elementId: 'eTest.01' }, message: 'Review finding',
  assertion: { operator: 'constant', value: false }, references: { elementIds: [], codes: [] } }));
const bundle = { schemaVersion: 1, languageVersion: '1.0.0', validationVersionId: versionId,
  catalogReleaseId: catalog, rules };

test('retrospective preview binds published version, inclusive dates, dataset, and outcomes without writes', async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const calls = [];
  const manager = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('from validation.version where')) return [{ id: versionId, rule_id: criterion,
      catalog_release_id: catalog, compiled_bundle: bundle,
      compiled_sha256: compiledValidationBundleSha256(bundle), display_name: 'Historical criterion',
      version: 2, published_at: '2026-09-01T00:00:00Z' }];
    if (sql.includes('from clinical.review_criterion_route')) return [{ version: '3' }];
    if (sql.includes('from clinical.report r join clinical.signed_snapshot')) return [
      { report_id: ids[0], reporting_date: '2026-09-01', signed_snapshot_id: randomUUID(),
        amendment_sequence: '1', catalog_release_id: catalog, existing_item_version: null },
      { report_id: ids[1], reporting_date: '2026-09-02', signed_snapshot_id: randomUUID(),
        amendment_sequence: '0', catalog_release_id: randomUUID(), existing_item_version: '4' },
      { report_id: ids[2], reporting_date: '2026-09-02', signed_snapshot_id: randomUUID(),
        amendment_sequence: '0', catalog_release_id: catalog, existing_item_version: null },
    ];
    if (sql.includes('from app_identity.agency_settings')) return [{ language: 'en' }];
    if (sql.includes('from clinical.report r join forms.form_version')) {
      if (params[0] === ids[2]) return [];
      return [{ id: ids[0], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
        form_id: randomUUID(), form_version: 1, catalog_standard: 'NEMSIS',
        catalog_version: '3.5.1', catalog_dataset: 'EMSDataSet' }];
    }
    if (sql.includes('from clinical.group_instance') || sql.includes('from clinical.element_occurrence') ||
      sql.includes('from clinical.amendment a join')) return [];
    throw Error(`Unexpected SQL: ${sql}`);
  } };
  const { preview } = await previewRetrospective(manager, scope, definition);
  assert.equal(preview.total, 3);
  assert.equal(preview.matches, 1);
  assert.equal(preview.newItems, 1);
  assert.equal(preview.existingItems, 1);
  assert.equal(preview.incompatible, 1);
  assert.equal(preview.failed, 1);
  assert.deepEqual(preview.reports.map((row) => row.outcome), ['match', 'incompatible', 'failed']);
  assert.equal(preview.reports[0].findingCount, 1, 'only selected rule runs');
  assert.deepEqual(calls.find(({ sql }) => sql.includes('from clinical.report r join clinical.signed_snapshot')).params,
    [organization, false, '2026-09-01', '2026-09-02', criterion]);
  assert.ok(calls.every(({ sql }) => !/^\s*(insert|update|delete)/i.test(sql)));
});

test('retrospective preview requires Review administration and all-report scope', async () => {
  for (const reduced of [{ ...scope, administrator: false }, { ...scope, reports: 'own' }])
    await assert.rejects(() => previewRetrospective({ query: async () => { throw Error('unexpected query'); } },
      reduced, definition), { status: 403 });
});

test('retrospective selection rejects invalid and overly broad dates', () => {
  assert.throws(() => validateRetrospectiveDefinition({ ...definition, from: '2026-09-03' }));
  assert.throws(() => validateRetrospectiveDefinition({ ...definition, from: '2025-01-01' }));
  assert.throws(() => validateRetrospectiveDefinition({ ...definition, dataset: 'both' }));
});

test('start rejects changed configuration, replays accepted commands, and rechecks current role', async () => {
  let routeVersion = 1;
  let writes = 0;
  let run = null;
  let canAdmin = true;
  const commandId = randomUUID();
  const query = async (sql, params = []) => {
    if (sql.includes('from validation.version where')) return [{ id: versionId, rule_id: criterion,
      catalog_release_id: catalog, compiled_bundle: bundle,
      compiled_sha256: compiledValidationBundleSha256(bundle), display_name: 'Historical criterion',
      version: 2, published_at: '2026-09-01T00:00:00Z' }];
    if (sql.includes('from clinical.review_criterion_route')) return [{ version: String(routeVersion) }];
    if (sql.includes('from clinical.report r join clinical.signed_snapshot')) return [];
    if (sql.includes('from app_identity.agency_settings')) return [{ language: 'en' }];
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('from clinical.review_retrospective_run') && sql.includes('where organization_id=$1 and command_id=$2'))
      return run ? [{ ...run, date_from: definition.from, date_to: definition.to,
        criterion_id: criterion, validation_version_id: versionId, dataset: 'real' }] : [];
    if (sql.includes('from clinical.review_retrospective_run') && sql.includes('where id=$1'))
      return run ? [{ criterion_id: criterion, validation_version_id: versionId,
        date_from: definition.from, date_to: definition.to, dataset: 'real', created_at: new Date() }] : [];
    if (sql.includes('from clinical.review_retrospective_report report')) return [{ total: '0',
      complete: '0', pending: '0', failed: '0', incompatible: '0', matches: '0',
      existing_items: '0', new_items: '0' }];
    if (sql.includes('insert into clinical.review_retrospective_run')) {
      writes++;
      run = { id: randomUUID(), actor_id: actor, preview_hash: params[8] };
      return [{ id: run.id }];
    }
    throw Error(`Unexpected SQL: ${sql}`);
  };
  const session = () => ({ user: { id: actor }, organization: { id: organization },
    capabilities: canAdmin ? ['review:all', 'review:admin'] : ['review:all'] });
  const sessions = { get: async () => session(), assertCsrf: async (_token, csrf) => {
    if (csrf !== 'csrf') throw Error('Bad CSRF');
  } };
  const manager = { query };
  const database = { manager, query, transaction: async (isolation, callback) =>
    (typeof isolation === 'function' ? isolation : callback)(manager) };
  const service = new ReviewService(database, sessions);
  const original = await service.retrospectivePreview('token', definition);
  routeVersion++;
  await assert.rejects(() => service.startRetrospective('token', { commandId,
    definition, expectedRevision: original.revision }, 'csrf'), { status: 409 });
  assert.equal(writes, 0);
  const fresh = await service.retrospectivePreview('token', definition);
  const accepted = await service.startRetrospective('token', { commandId,
    definition, expectedRevision: fresh.revision }, 'csrf');
  const replayed = await service.startRetrospective('token', { commandId,
    definition, expectedRevision: fresh.revision }, 'csrf');
  assert.equal(accepted.id, replayed.id);
  assert.equal(writes, 1);
  canAdmin = false;
  await assert.rejects(() => service.retrospectiveRun('token', accepted.id), { status: 403 });
});
