import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ReviewService } from '../dist/review/review.service.js';

function fixture() {
  const organization = randomUUID(), reviewer = randomUUID(), next = randomUUID(), author = randomUUID(), id = randomUUID();
  let actor = reviewer, capabilities = ['review:all'], eligible = true;
  const state = { version: 2, status: 'in-review', assignee_id: reviewer, documenting_user_id: author, independent_review: true };
  const assignments = [], progress = [];
  const manager = { async query(sql, params) {
    if (sql.includes('from app_identity.organization')) return [{ id: organization }];
    if (sql.includes('for update of i')) return [{ ...state, version: String(state.version) }];
    if (sql.includes('from clinical.review_assignment_history')) return assignments.filter((entry) => entry.command_id === params[1]);
    if (sql.includes('from app_identity.app_user u')) return eligible && params[1] !== author ? [{ id: params[1], all_access: true }] : [];
    if (sql.includes('update clinical.review_item')) { state.assignee_id = params[1]; state.version++; if (sql.includes("status='new'")) state.status = 'new'; return []; }
    if (sql.includes('insert into clinical.review_assignment_history')) {
      assignments.push({ item_id: params[1], command_id: params[2], actor_id: params[3], assignee_id: params[4], previous_assignee_id: params[5], item_version: params[6], action: 'assigned', reason: params[7] }); return [];
    }
    if (sql.includes('insert into clinical.review_progress_history')) { progress.push(params); return []; }
    throw Error(`Unexpected query ${sql}`);
  } };
  const service = new ReviewService({ transaction: (work) => work(manager) }, {
    get: async () => ({ user: { id: actor }, organization: { id: organization }, capabilities }),
    assertCsrf: async (_token, csrf) => { assert.equal(csrf, 'csrf'); },
  });
  service.item = async () => ({ id, assigneeId: state.assignee_id, status: state.status, version: state.version });
  const command = { commandId: randomUUID(), expectedVersion: 2, dataset: 'real', assigneeId: next };
  return { service, id, state, command, reviewer, author, assignments, progress,
    actor(value, caps = ['review:all']) { actor = value; capabilities = caps; }, eligible(value) { eligible = value; } };
}

test('assigned reviewer forwards active work once with assignment and progress audits', async () => {
  const value = fixture();
  const result = await value.service.assign('token', value.id, value.command, 'csrf', true);
  assert.equal(result.assigneeId, value.command.assigneeId);
  assert.equal(result.status, 'new'); assert.equal(result.version, 3);
  await value.service.assign('token', value.id, value.command, 'csrf', true);
  assert.equal(value.assignments.length, 1); assert.equal(value.progress.length, 1);
  assert.equal(value.assignments[0].previous_assignee_id, value.reviewer);
  assert.equal(value.assignments[0].reason, 'forwarded-for-review');
  await assert.rejects(value.service.assign('token', value.id, value.command, 'csrf'), { status: 403 });
});

test('handoff rejects outsiders, completed work, stale versions, ineligible targets and self assignment', async () => {
  for (const change of [
    (v) => v.actor(randomUUID()),
    (v) => { v.state.status = 'completed'; },
    (v) => { v.command.expectedVersion = 1; },
    (v) => v.eligible(false),
    (v) => { v.command.assigneeId = v.reviewer; },
    (v) => { v.command.assigneeId = v.author; },
    (v) => { v.command.assigneeId = null; },
    (v) => v.actor(v.reviewer, ['review:self']),
  ]) {
    const value = fixture(); change(value);
    await assert.rejects(value.service.assign('token', value.id, value.command, 'csrf', true));
    assert.equal(value.assignments.length, 0); assert.equal(value.state.version, 2);
  }
});

test('administrator can forward an active review assigned to another reviewer', async () => {
  const value = fixture(); value.actor(randomUUID(), ['review:all', 'review:admin']);
  await value.service.assign('token', value.id, value.command, 'csrf', true);
  assert.equal(value.state.status, 'new'); assert.equal(value.assignments.length, 1);
});

test('assignment badges count scoped review items before assignment filtering and pagination', async () => {
  const calls = [];
  const service = new ReviewService({ async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('count(*)::text \"all\"')) return [{ all: '7', mine: '4', unassigned: '2' }];
    if (sql.includes('count(*)')) return [{ total: '4' }];
    return [];
  } }, { get: async () => ({ user: { id: randomUUID() }, organization: { id: randomUUID() }, capabilities: ['review:self'] }) });
  const response = await service.queue('token', { assignment: 'mine', priority: 'high', search: 'Oxygen', page: '2' });
  assert.deepEqual(response.assignmentCounts, { all: 7, mine: 4, unassigned: 2 });
  assert.equal(response.total, response.assignmentCounts.mine);
  const badge = calls.find((call) => call.sql.includes('count(*)::text \"all\"'));
  const where = badge.sql.slice(badge.sql.indexOf('where i.organization_id'));
  assert.match(where, /r.documenting_user_id=\$4/);
  assert.match(where, /r.synthetic=\$2/);
  assert.match(where, /i.priority=\$6/);
  assert.doesNotMatch(where, /and i.assignee_id=\$4|limit \$11|offset \$12/);
  assert.equal(badge.params[9], 'Oxygen');
});
