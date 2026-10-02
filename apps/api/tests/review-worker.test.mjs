import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { compiledValidationBundleSha256 } from '@open-triage/contracts';
import { processReviewWork } from '../dist/review/review-worker.js';

function fixture({ incompatible = false, route = 'unassigned', eligible = true, allAccess = true,
  independent = false } = {}) {
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
    documenting_user_id: randomUUID(),
    signed_snapshot_id: snapshot, signed_revision: 3, amendment_sequence: 0,
    validation_version_id: version, catalog_release_id: catalog, attempts: 0 };
  const calls = [];
  const namedReviewerId = randomUUID();
  let state = 'pending';
  const manager = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('from app_identity.organization')) return [{ id: params[0] }];
    if (sql.includes('from clinical.review_criterion_route where route=')) return [];
    if (sql.includes('from clinical.report r') && sql.includes('review_overdue_policy')) return [];
    if (sql.includes('from clinical.review_item i join clinical.report r') && sql.includes('eligibility_checked_at')) return [];
    if (sql.includes('from clinical.review_criterion_route where organization_id=')) return route === 'unassigned'
      ? [] : [{ route, named_user_id: route === 'named' ? namedReviewerId : null,
        independent_review: independent }];
    if (sql.includes('from app_identity.app_user u')) return eligible
      ? [{ id: params[1], display_name: 'Reviewer', all_access: allAccess, self_access: true }] : [];
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
    if (/insert into clinical\.review_item\s*\(/.test(sql)) return [{ id: randomUUID() }];
    if (sql.includes('insert into clinical.review_assignment_history')) return [];
    if (sql.includes('insert into clinical.review_item_evidence')) return [];
    if (sql.includes('update clinical.review_work')) { state = params[1] === 'complete' ? 'complete' : 'failed'; return []; }
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  const database = { transaction: async (isolation, callback) => (typeof isolation === "function" ? isolation : callback)(manager) };
  return { database, calls, rules, work, namedReviewerId, get state() { return state; } };
}

test('bounded worker creates separate criterion items and immutable evidence once', async () => {
  const value = fixture();
  assert.deepEqual(await processReviewWork(value.database, 2), { processed: 1, failed: 0 });
  assert.equal(value.state, 'complete');
  const itemWrites = value.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql));
  assert.equal(itemWrites.length, 2);
  assert.deepEqual(itemWrites.map(({ params }) => params[2]), value.rules.map(({ ruleId }) => ruleId));
  assert.deepEqual(itemWrites.map(({ params }) => params[3]), ['high', 'low']);
  const evidenceWrites = value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_item_evidence'));
  assert.equal(evidenceWrites.length, 2);
  assert.equal(JSON.parse(evidenceWrites[0].params[4]).length, 2);
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
  assert.equal(value.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql)).length, 0);
});

for (const route of ['unassigned', 'author', 'named']) {
  test(`signed matching report follows ${route} criterion routing`, async () => {
    const value = fixture({ route });
    await processReviewWork(value.database, 1);
    const writes = value.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql));
    const expected = route === 'author' ? value.work.documenting_user_id
      : route === 'named' ? value.namedReviewerId : null;
    assert.equal(writes.length, 2);
    assert.ok(writes.every(({ params }) => params[5] === expected));
    assert.equal(value.calls.filter(({ sql }) => sql.includes('insert into clinical.review_assignment_history')).length,
      expected ? 2 : 0);
  });
}

test('ineligible configured reviewer leaves new work unassigned with an administrative indicator', async () => {
  const value = fixture({ route: 'named', eligible: false });
  await processReviewWork(value.database, 1);
  const writes = value.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql));
  assert.ok(writes.every(({ params }) => params[5] === null && params[6] === 'configured-assignee-ineligible'));
});

test('author routing accepts review-self while named routing requires organization-wide access', async () => {
  const author = fixture({ route: 'author', allAccess: false });
  await processReviewWork(author.database, 1);
  assert.ok(author.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql))
    .every(({ params }) => params[5] === author.work.documenting_user_id));
  const named = fixture({ route: 'named', allAccess: false });
  await processReviewWork(named.database, 1);
  assert.ok(named.calls.filter(({ sql }) => /insert into clinical\.review_item\s*\(/.test(sql))
    .every(({ params }) => params[5] === null && params[6] === 'configured-assignee-ineligible'));
});
