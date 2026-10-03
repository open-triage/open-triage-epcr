import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewService } from '../dist/review/review.service.js';

const session = (capabilities, user = 'person-a', organization = 'agency-a') => ({
  user: { id: user }, organization: { id: organization }, capabilities,
});

test('attention counts are request-time scoped, dataset separated, and administrator data is gated', async () => {
  const calls = [];
  let current = session(['review:self', 'review:identifying']);
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('unavailable_assignees')) return [{ total: '4', assignments: '1', responses: '2',
      reopened: '3', unavailable_assignees: '4' }];
    if (sql.includes('from clinical.review_criterion_route where')) return [{ total: '5' }];
    if (sql.includes('count(distinct failures.report_id)')) return [{ total: '6' }];
    throw Error(`Unexpected query: ${sql}`);
  } };
  const service = new ReviewService(database, { get: async () => current });
  const own = await service.attention('token', 'real');
  assert.equal(own.total, 4);
  assert.equal(own.assignments, 1);
  assert.equal(own.responses, 2);
  assert.equal(own.reopened, 3);
  assert.equal(own.unavailableAssignees, undefined);
  assert.deepEqual(calls[0].params, ['agency-a', false, false, 'person-a']);
  assert.match(calls[0].sql, /i\.organization_id=\$1 and r\.organization_id=\$1 and r\.synthetic=\$2/);
  assert.match(calls[0].sql, /\(\$3::boolean or r\.documenting_user_id=\$4\)/);
  assert.match(calls[0].sql, /i\.assignee_id=\$4 and i\.status<>'completed'/);
  assert.match(calls[0].sql, /r\.documenting_user_id=\$4 and i\.status='awaiting-clinician'/);
  assert.match(calls[0].sql, /c\.item_version > coalesce/);
  assert.match(calls[0].sql, /i\.reopened and i\.status<>'completed'/);
  current = session(['review:all', 'review:admin', 'review:identifying', 'clinical:demo'], 'person-b', 'agency-b');
  const admin = await service.attention('token');
  assert.equal(admin.dataset, 'synthetic');
  assert.deepEqual([admin.unavailableAssignees, admin.unavailableRoutes, admin.processingFailures], [4, 5, 6]);
  assert.deepEqual(calls[1].params, ['agency-b', true, true, 'person-b']);
  assert.deepEqual(calls[3].params, ['agency-b', true, true, 'person-b']);
  current = session(['review:self', 'review:admin']);
  assert.equal((await service.attention('token')).unavailableAssignees, undefined);
  assert.match(calls.at(-1).sql, /filter \(where false\)::text responses/);
  current = session([]);
  await assert.rejects(service.attention('token'), { status: 403 });
});

test('attention queue uses the same report scope and rejects administrative filters after revocation', async () => {
  const calls = [];
  let current = session(['review:all', 'review:admin', 'review:identifying']);
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return sql.includes('count(*)::text total') ? [{ total: '0' }] : [];
  } };
  const service = new ReviewService(database, { get: async () => current });
  for (const [kind, clause] of [
    ['assignments', "i.assignee_id=$4 and i.status<>'completed'"],
    ['responses', "r.documenting_user_id=$4 and i.status='awaiting-clinician'"],
    ['reopened', "i.assignee_id=$4 and i.reopened and i.status<>'completed'"],
    ['unavailable-assignees', 'i.assignee_id is null and i.recovery_reason is not null'],
  ]) {
    await service.queue('token', { dataset: 'real', attention: kind });
    const pair = calls.splice(0);
    assert.equal(pair.length, 3);
    for (const call of pair) {
      assert.match(call.sql, /i\.organization_id=\$1 and r\.organization_id=\$1 and r\.synthetic=\$2/);
      assert.match(call.sql, /\(\$3::boolean or r\.documenting_user_id=\$4\)/);
      assert.ok(call.sql.includes(clause));
    }
  }
  current = session(['review:self']);
  await assert.rejects(service.queue('token', { attention: 'unavailable-assignees' }), { status: 403 });
  await assert.rejects(service.queue('token', { attention: 'unknown' }), { status: 400 });
  current = session([]);
  await assert.rejects(service.queue('token', { attention: 'responses' }), { status: 403 });
});

test('processing backlog applies the same report scope to both failed and unevaluated rows', async () => {
  const calls = [];
  const service = new ReviewService({ async query(sql, params) { calls.push({ sql, params }); return []; } },
    { get: async () => session(['review:all', 'review:admin']) });
  assert.deepEqual((await service.backlog('token', 'synthetic')).work, []);
  assert.deepEqual(calls[0].params, ['agency-a', true, true, 'person-a']);
  assert.equal((calls[0].sql.match(/\(\$3::boolean or r\.documenting_user_id=\$4\)/g) ?? []).length, 2);
});
