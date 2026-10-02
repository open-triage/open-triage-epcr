import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ReviewService } from '../dist/review/review.service.js';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
integrationTest('runtime role saves findings and forwards a synthetic review with immutable history', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  await client.query('set local role open_triage_api_runtime');
  const fixture = (await client.query(`select i.id,i.organization_id,i.report_id,u.id reviewer_id
    from clinical.review_item i join clinical.report r on r.id=i.report_id
    join app_identity.app_user u on u.organization_id=i.organization_id and u.active
    join app_identity.local_credential c on c.user_id=u.id and c.username='demo'
    where r.synthetic and r.status='signed' and i.status<>'completed' order by i.id limit 1`)).rows[0];
  if (!fixture) { t.skip('Requires a seeded synthetic demonstration review'); return; }
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const database = { manager, query: manager.query,
    transaction: async (level, callback) => (typeof level === 'function' ? level : callback)(manager) };
  const session = { user: { id: fixture.reviewer_id }, organization: { id: fixture.organization_id },
    capabilities: ['review:all', 'review:identifying', 'clinical:demo'] };
  const service = new ReviewService(database, { get: async () => session,
    assertCsrf: async (_token, csrf) => assert.equal(csrf, 'csrf') });
  await client.query(`update clinical.review_item set assignee_id=$2,status='in-review',
    outcome_option_id=null,outcome_revision=null where id=$1`, [fixture.id,fixture.reviewer_id]);
  const target = (await service.reviewers('token', fixture.id, 'synthetic')).find((user) => user.id !== fixture.reviewer_id);
  if (!target) { t.skip('Requires a second eligible reviewer in the fixture organization'); return; }
  const item = await service.item('token', fixture.id, 'synthetic');
  const comment = { commandId: randomUUID(), expectedVersion: item.version,
    dataset: 'synthetic', kind: 'finding', body: 'Fictional integration finding.' };
  const saved = await service.addComment('token', fixture.id, comment, 'csrf');
  assert.ok(saved.comments.some((entry) => entry.kind === 'finding' && entry.body === comment.body));
  await service.addComment('token', fixture.id, comment, 'csrf');
  const forward = { commandId: randomUUID(), expectedVersion: saved.version, dataset: 'synthetic', assigneeId: target.id };
  const assigned = await service.assign('token', fixture.id, forward, 'csrf', true);
  assert.equal(assigned.status, 'new'); assert.equal(assigned.assigneeId, target.id);
  assert.equal(assigned.version, item.version + 2);
  await service.assign('token', fixture.id, forward, 'csrf', true);
  assert.equal((await client.query('select count(*)::integer count from clinical.review_assignment_history where command_id=$1', [forward.commandId])).rows[0].count, 1);
  assert.deepEqual((await client.query('select status,reason from clinical.review_progress_history where command_id=$1', [forward.commandId])).rows,
    [{ status: 'new', reason: 'forwarded-for-review' }]);
  const report = await service.report('token', fixture.report_id, 'synthetic');
  assert.ok(report.document && report.clinicalForm);
  const form = (await client.query(`select fv.canonical_definition from clinical.report r
    join forms.form_version fv on fv.id=r.form_version_id where r.id=$1`, [fixture.report_id])).rows[0];
  assert.deepEqual(report.clinicalForm.definition, form.canonical_definition);
});
