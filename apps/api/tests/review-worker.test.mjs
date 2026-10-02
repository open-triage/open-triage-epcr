import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { compiledValidationBundleSha256 } from '@open-triage/contracts';
import { processReviewWork } from '../dist/review/review-worker.js';

function fixture({ incompatible = false } = {}) {
  const organization = randomUUID(), report = randomUUID(), snapshot = randomUUID();
  const version = randomUUID(), catalog = randomUUID(), workId = randomUUID();
  const rules = [randomUUID(), randomUUID()].map((ruleId, index) => ({
    schemaVersion: 1, languageVersion: '1.0.0', ruleId, validationVersionId: version,
    name: `Criterion ${index}`, enabled: true, severity: 'warning', reviewPriority: index ? 'low' : 'high',
    executionTargets: ['review'], primaryTarget: { elementId: `eTest.0${index + 1}` },
    ...(index === 0 ? { scope: { groupId: 'eTestSection', iteration: 'each' } } : {}),
    message: `Review criterion ${index}`, assertion: { operator: 'constant', value: false },
    references: { elementIds: [], codes: [] },
  }));
  const bundle = { schemaVersion: 1, languageVersion: '1.0.0', validationVersionId: version,
    catalogReleaseId: catalog, rules };
  const work = { id: workId, organization_id: organization, report_id: report,
    signed_snapshot_id: snapshot, signed_revision: 3, amendment_sequence: 0,
    validation_version_id: version, catalog_release_id: catalog, attempts: 0 };
  const calls = [];
  let state = 'pending';
  const manager = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('insert into clinical.review_work')) return [{ id: workId }];
    if (sql.includes('from clinical.review_work w join clinical.signed_snapshot')) return state === 'pending' ? [work] : [];
    if (sql.includes('from validation.version')) return [{ compiled_bundle: bundle,
      compiled_sha256: compiledValidationBundleSha256(bundle),
      catalog_release_id: incompatible ? randomUUID() : catalog }];
    if (sql.includes('from app_identity.agency_settings')) return [{ language: 'en' }];
    if (sql.includes('select r.id, r.created_at')) return [{ id: report,
      created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T09:00:00Z',
      form_id: randomUUID(), form_version: 1, catalog_standard: 'NEMSIS',
      catalog_version: '3.5.1', catalog_dataset: 'EMSDataSet' }];
    if (sql.includes('from clinical.group_instance')) return [
      { id: randomUUID(), parent_group_instance_id: null, group_id: 'eTestSection', ordinal: 0, documented_time: null, correlation_id: null },
      { id: randomUUID(), parent_group_instance_id: null, group_id: 'eTestSection', ordinal: 1, documented_time: null, correlation_id: null },
    ];
    if (sql.includes('from clinical.element_occurrence') || sql.includes('from clinical.amendment a')) return [];
    if (sql.includes('insert into clinical.review_evaluation')) return [{ id: randomUUID() }];
    if (sql.includes('insert into clinical.review_item (')) return [{ id: randomUUID() }];
    if (sql.includes('insert into clinical.review_item_evidence')) return [];
    if (sql.includes('update clinical.review_work')) { state = params[1] === 'complete' ? 'complete' : 'failed'; return []; }
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  const database = { transaction: async (isolation, callback) => (typeof isolation === "function" ? isolation : callback)(manager) };
  return { database, calls, rules, get state() { return state; } };
}

test('bounded worker creates separate criterion items and immutable evidence once', async () => {
  const value = fixture();
  assert.deepEqual(await processReviewWork(value.database, 2), { processed: 1, failed: 0 });
  assert.equal(value.state, 'complete');
  const itemWrites = value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_item ('));
  assert.equal(itemWrites.length, 2);
  assert.deepEqual(itemWrites.map(({ params }) => params[2]), value.rules.map(({ ruleId }) => ruleId));
  assert.deepEqual(itemWrites.map(({ params }) => params[3]), ['high', 'low']);
  const evidenceWrites = value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_item_evidence'));
  assert.equal(evidenceWrites.length, 2);
  assert.equal(JSON.parse(evidenceWrites[0].params[3]).length, 2);
  assert.equal(value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_evaluation')).length, 1);
  assert.deepEqual(await processReviewWork(value.database, 2), { processed: 0, failed: 0 });
});

test('catalog incompatibility is recorded as a failed evaluation without creating queue items', async () => {
  const value = fixture({ incompatible: true });
  assert.deepEqual(await processReviewWork(value.database, 1), { processed: 1, failed: 0 });
  assert.equal(value.state, 'failed');
  const evaluation = value.calls.find(({ sql }) => sql.includes('insert into clinical.review_evaluation'));
  assert.equal(evaluation.params[10], 'failed');
  assert.equal(JSON.parse(evaluation.params[12])[0].code, 'compatibility');
  assert.equal(value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_item (')).length, 0);
});
