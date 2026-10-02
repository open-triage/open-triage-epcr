import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ReviewService } from '../dist/review/review.service.js';

const organization = randomUUID(), report = randomUUID(), itemId = randomUUID();
const clinician = randomUUID(), reviewer = randomUUID(), outsider = randomUUID();
const signedAt = '2026-10-02T08:00:00Z';

function fixture() {
  const item = { version: 2, status: 'awaiting-clinician', assignee_id: reviewer,
    documenting_user_id: clinician, independent_review: true };
  const comments = [];
  const queries = [];
  let session = { user: { id: reviewer }, organization: { id: organization },
    capabilities: ['review:all', 'review:identifying'] };
  let eligible = true;
  const manager = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes('for update of i')) {
      if (params[1] !== organization || (params[4] !== clinician && !params[3])) return [];
      return [{ ...item, version: String(item.version) }];
    }
    if (sql.includes('from app_identity.app_user u')) return eligible
      ? [{ id: reviewer, display_name: 'Reviewer', all_access: true, self_access: false }] : [];
    if (sql.includes('from clinical.review_comment') && sql.includes('command_id=$2'))
      return comments.filter((entry) => entry.command_id === params[1]);
    if (sql.includes('update clinical.review_item set version=version+1')) {
      item.version++; return [];
    }
    if (sql.includes('insert into clinical.review_comment')) {
      comments.push({ id: randomUUID(), item_id: params[1], command_id: params[2],
        actor_id: params[3], item_version: params[4], body: params[5] }); return [];
    }
    throw Error(`Unexpected query: ${sql}`);
  } };
  let tail = Promise.resolve();
  const database = { transaction: async (work) => {
    const prior = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await work(manager); } finally { release(); }
  } };
  const service = new ReviewService(database, { get: async () => session,
    assertCsrf: async (_token, csrf) => { if (csrf !== 'csrf') throw Error('CSRF'); } });
  service.item = async () => ({ version: item.version, status: item.status, assigneeId: item.assignee_id,
    comments: comments.map((entry) => ({ body: entry.body, actorId: entry.actor_id })) });
  return { service, item, comments, queries,
    session(value) { session = value; }, eligible(value) { eligible = value; } };
}

test('assigned reviewer and clinician exchange attributable comments without workflow authority changes', async () => {
  const value = fixture();
  const reviewerCommand = { commandId: randomUUID(), expectedVersion: 2, dataset: 'real',
    body: 'Please clarify the timeline.' };
  const requested = await value.service.addComment('token', itemId, reviewerCommand, 'csrf');
  assert.equal(requested.status, 'awaiting-clinician');
  assert.equal(requested.version, 3);
  assert.equal(requested.assigneeId, reviewer);
  assert.deepEqual(requested.comments, [{ body: reviewerCommand.body, actorId: reviewer }]);
  value.session({ user: { id: clinician }, organization: { id: organization },
    capabilities: ['review:self', 'review:identifying'] });
  const response = await value.service.addComment('token', itemId, { commandId: randomUUID(),
    expectedVersion: 3, dataset: 'real', body: 'The event occurred after arrival.' }, 'csrf');
  assert.deepEqual(response.comments.map((entry) => entry.actorId), [reviewer, clinician]);
  assert.equal(response.status, 'awaiting-clinician');
  assert.equal(value.comments.length, 2);
  assert.equal(value.queries.filter(({ sql }) => sql.includes('insert into clinical.review_comment')).length, 2);
});

test('comment replay is single-write and concurrent stale responses recover by refreshing', async () => {
  const value = fixture();
  const first = { commandId: randomUUID(), expectedVersion: 2, dataset: 'real', body: 'First' };
  const second = { commandId: randomUUID(), expectedVersion: 2, dataset: 'real', body: 'Second' };
  const results = await Promise.allSettled([
    value.service.addComment('token', itemId, first, 'csrf'),
    value.service.addComment('token', itemId, second, 'csrf'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const accepted = value.comments[0].command_id === first.commandId ? first : second;
  assert.equal((await value.service.addComment('token', itemId, accepted, 'csrf')).version, 3);
  assert.equal(value.comments.length, 1);
  const rejected = accepted === first ? second : first;
  await value.service.addComment('token', itemId, { ...rejected, expectedVersion: 3 }, 'csrf');
  assert.equal(value.comments.length, 2);
});

test('identifying, report scope, and current reviewer eligibility gate writes', async () => {
  const value = fixture();
  const command = { commandId: randomUUID(), expectedVersion: 2, dataset: 'real', body: 'Sensitive' };
  value.session({ user: { id: reviewer }, organization: { id: organization }, capabilities: ['review:all'] });
  await assert.rejects(value.service.addComment('token', itemId, command, 'csrf'), { status: 403 });
  value.session({ user: { id: outsider }, organization: { id: organization },
    capabilities: ['review:self', 'review:identifying'] });
  await assert.rejects(value.service.addComment('token', itemId, command, 'csrf'), { status: 404 });
  value.session({ user: { id: reviewer }, organization: { id: organization },
    capabilities: ['review:all', 'review:identifying'] });
  value.eligible(false);
  await assert.rejects(value.service.addComment('token', itemId, command, 'csrf'), { status: 403 });
  assert.equal(value.comments.length, 0);
});

test('item detail withholds discussion text without identifying access but keeps status and outcome', async () => {
  const queries = [];
  let identifying = false;
  let itemStatus = 'awaiting-clinician';
  const database = { async query(sql) {
    queries.push(sql);
    if (sql.includes('from clinical.review_item i join clinical.report r')) return [{
      id: itemId, report_id: report, criterion_id: randomUUID(), kind: 'criterion', priority: 'high',
      status: itemStatus, assignee_id: reviewer, version: '3', recovery_reason: null,
      first_matched_at: signedAt, deadline_at: null, deadline_source: null,
      resolution_reason: null, reporting_date: '2026-10-02', signed_at: signedAt,
      findings: [], outcome_option_id: null, outcome_revision: null, outcome_label: null,
      outcome_meaning: null, documenting_user_id: clinician,
    }];
    if (sql.includes('from clinical.review_assignment_history') ||
      sql.includes('from clinical.review_progress_history') ||
      sql.includes('from clinical.review_amendment_decision')) return [];
    if (sql.includes('from clinical.review_comment c')) return [{ id: randomUUID(), actor_id: reviewer,
      display_name: 'Reviewer', body: 'Patient name here', item_version: '3', recorded_at: signedAt }];
    throw Error(`Unexpected query: ${sql}`);
  } };
  const service = new ReviewService(database, { get: async () => ({ user: { id: clinician },
    organization: { id: organization }, capabilities: identifying
      ? ['review:self', 'review:identifying'] : ['review:self'] }) });
  const restricted = await service.item('token', itemId, 'real');
  assert.equal(restricted.status, 'awaiting-clinician');
  assert.equal(restricted.commentsRestricted, true);
  assert.deepEqual(restricted.comments, []);
  assert.equal(queries.some((sql) => sql.includes('from clinical.review_comment c')), false);
  identifying = true;
  const permitted = await service.item('token', itemId, 'real');
  assert.equal(permitted.commentsRestricted, false);
  assert.equal(permitted.comments[0].body, 'Patient name here');
  itemStatus = 'in-review';
  const reopened = await service.item('token', itemId, 'real');
  assert.equal(reopened.status, 'in-review');
  assert.equal(reopened.comments[0].body, 'Patient name here');
});
