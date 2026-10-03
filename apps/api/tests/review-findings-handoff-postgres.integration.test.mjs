import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ReviewService } from '../dist/review/review.service.js';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
integrationTest('runtime role starts review through findings and reassigns with immutable history', async (t) => {
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
  await client.query(`update clinical.review_item set assignee_id=$2,status='new',
    outcome_option_id=null,outcome_revision=null where id=$1`, [fixture.id,fixture.reviewer_id]);
  const target = (await service.reviewers('token', fixture.id, 'synthetic')).find((user) => user.id !== fixture.reviewer_id);
  if (!target) { t.skip('Requires a second eligible reviewer in the fixture organization'); return; }
  const item = await service.item('token', fixture.id, 'synthetic');
  const comment = { commandId: randomUUID(), expectedVersion: item.version,
    dataset: 'synthetic', kind: 'finding', body: 'Fictional integration finding.' };
  const saved = await service.addComment('token', fixture.id, comment, 'csrf');
  assert.equal(saved.status, 'in-review');
  assert.equal(saved.progressHistory.at(-1).status, 'in-review');
  assert.ok(saved.comments.some((entry) => entry.kind === 'finding' && entry.body === comment.body));
  await service.addComment('token', fixture.id, comment, 'csrf');
  const forward = { commandId: randomUUID(), expectedVersion: saved.version, dataset: 'synthetic', assigneeId: target.id };
  const assigned = await service.assign('token', fixture.id, forward, 'csrf', true);
  assert.equal(assigned.status, 'in-review'); assert.equal(assigned.assigneeId, target.id);
  assert.equal(assigned.version, item.version + 2);
  await service.assign('token', fixture.id, forward, 'csrf', true);
  assert.equal((await client.query('select count(*)::integer count from clinical.review_assignment_history where command_id=$1', [forward.commandId])).rows[0].count, 1);
  assert.equal((await client.query('select count(*)::int count from clinical.review_progress_history where command_id=$1', [forward.commandId])).rows[0].count, 0);
  // Reopening preserves the completion audit while resetting the current outcome.
  session.capabilities.push('review:admin');
  const outcome = await service.configureOutcome('token', { commandId: randomUUID(), label: 'Reviewed',
    meaning: 'Fictional completed review.', active: true }, 'csrf');
  session.user.id = target.id;
  const started = assigned;
  const completed = await service.progress('token', fixture.id, { commandId: randomUUID(),
    expectedVersion: started.version, dataset: 'synthetic', status: 'completed', outcomeOptionId: outcome.id }, 'csrf');
  const completionHistory = completed.progressHistory.find((event) => event.status === 'completed');
  const reopen = { commandId: randomUUID(), expectedVersion: completed.version,
    dataset: 'synthetic', assigneeId: target.id };
  const reopened = await service.assign('token', fixture.id, reopen, 'csrf');
  assert.equal(reopened.status, 'in-review'); assert.equal(reopened.reopened, true);
  assert.equal(reopened.assigneeId, target.id); assert.equal(reopened.outcome, null);
  assert.equal(reopened.version, completed.version + 1);
  assert.deepEqual(reopened.progressHistory.find((event) => event.status === 'completed'), completionHistory);
  assert.equal(reopened.progressHistory.at(-1).reason, 'reopened-by-assignment');
  await service.assign('token', fixture.id, reopen, 'csrf');
  assert.equal((await client.query('select count(*)::integer count from clinical.review_progress_history where command_id=$1',
    [reopen.commandId])).rows[0].count, 1);
  const report = await service.report('token', fixture.report_id, 'synthetic');
  assert.ok(report.document && report.clinicalForm);
  const form = (await client.query(`select fv.canonical_definition from clinical.report r
    join forms.form_version fv on fv.id=r.form_version_id where r.id=$1`, [fixture.report_id])).rows[0];
  assert.deepEqual(report.clinicalForm.definition, form.canonical_definition);
});


integrationTest('administrator reopens a completed review by assigning its current reviewer without losing history', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const report = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    where r.status='signed' limit 1`)).rows[0];
  if (!report) return t.skip('Requires a signed report');
  const id = randomUUID(), dataset = report.synthetic ? 'synthetic' : 'real';
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,first_matched_at)
    values ($1,$2,$3,$4,'high',now())`, [id,report.organization_id,report.id,randomUUID()]);
  await client.query('set local role open_triage_api_runtime');
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const database = { manager, query: manager.query, transaction: async (work) => work(manager) };
  const session = { user: { id: report.documenting_user_id }, organization: { id: report.organization_id },
    capabilities: ['review:all','review:admin','clinical:demo'] };
  const service = new ReviewService(database, { get: async () => session,
    assertCsrf: async (_token, csrf) => assert.equal(csrf,'csrf') });
  const reviewers = await service.reviewers('token',id,dataset);
  const author = reviewers.find((user) => user.id === report.documenting_user_id);
  if (author) assert.equal(author.documentingClinician, true);
  const reviewer = reviewers[0];
  if (!reviewer) return t.skip('Requires an eligible reviewer');
  const outcome = await service.configureOutcome('token', { commandId: randomUUID(), label: 'Reviewed',
    meaning: 'Fictional final outcome before reopening.', active: true }, 'csrf');
  const assigned = await service.assign('token',id,{ commandId: randomUUID(), expectedVersion: 0,
    dataset,assigneeId: reviewer.id },'csrf');
  assert.equal(assigned.status,'in-review');
  assert.equal(assigned.progressHistory.at(-1).status,'in-review');
  session.user.id = reviewer.id;
  const started = assigned;
  const completed = await service.progress('token',id,{ commandId: randomUUID(),expectedVersion: started.version,
    dataset,status: 'completed',outcomeOptionId: outcome.id },'csrf');
  const command = { commandId: randomUUID(),expectedVersion: completed.version,dataset,assigneeId: reviewer.id };
  session.capabilities = ['review:all','clinical:demo'];
  await assert.rejects(service.assign('token',id,command,'csrf'), { status: 403 });
  session.capabilities.push('review:admin');
  const reopened = await service.assign('token',id,command,'csrf');
  assert.equal(reopened.status,'in-review'); assert.equal(reopened.reopened,true);
  assert.equal(reopened.assigneeId,reviewer.id); assert.equal(reopened.outcome,null);
  assert.equal(reopened.version,completed.version+1);
  assert.deepEqual(reopened.progressHistory.slice(0,-1),completed.progressHistory);
  assert.equal(reopened.progressHistory.at(-1).reason,'reopened-by-assignment');
  await service.assign('token',id,command,'csrf');
  assert.equal((await client.query(`select count(*)::int count from clinical.review_progress_history
    where command_id=$1`,[command.commandId])).rows[0].count,1);
  await assert.rejects(service.assign('token',id,{ ...command,commandId: randomUUID() },'csrf'),{ status: 409 });
  session.capabilities.push('review:identifying');
  const awaiting = await service.progress('token',id,{ commandId: randomUUID(),expectedVersion: reopened.version,
    dataset,status: 'awaiting-clinician' },'csrf');
  const comment = { commandId: randomUUID(),expectedVersion: awaiting.version,dataset,body: 'Response received.' };
  const resumed = await service.addComment('token',id,comment,'csrf');
  assert.equal(resumed.status,'in-review');
  assert.equal(resumed.progressHistory.at(-1).status,'in-review');
  await service.addComment('token',id,comment,'csrf');
  assert.equal((await service.item('token',id,dataset)).version,resumed.version);
});

integrationTest('new reviews accept an explicit outcome or awaiting status without a start action', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const report = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    where r.status='signed' limit 1`)).rows[0];
  if (!report) return t.skip('Requires a signed report');
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const service = new ReviewService({ manager, query: manager.query, transaction: async (work) => work(manager) }, {
    get: async () => ({ user: { id: report.documenting_user_id }, organization: { id: report.organization_id },
      capabilities: ['review:all','review:admin','review:identifying','clinical:demo'] }),
    assertCsrf: async () => {},
  });
  const dataset = report.synthetic ? 'synthetic' : 'real';
  await client.query('set local role open_triage_api_runtime');
  const outcome = await service.configureOutcome('token', { commandId: randomUUID(), label: 'Reviewed',
    meaning: 'Fictional review.', active: true }, 'csrf');
  for (const status of ['completed','awaiting-clinician']) {
    const id = randomUUID();
    await client.query(`insert into clinical.review_item
      (id,organization_id,report_id,criterion_id,priority,first_matched_at,assignee_id)
      values ($1,$2,$3,$4,'high',now(),$5)`,
    [id,report.organization_id,report.id,randomUUID(),report.documenting_user_id]);
    const command = { commandId: randomUUID(), expectedVersion: 0, dataset, status,
      ...(status === 'completed' ? { outcomeOptionId: outcome.id } : {}) };
    const saved = await service.progress('token',id,command,'csrf');
    assert.equal(saved.status,status); assert.equal(saved.version,1);
    assert.equal(saved.progressHistory.length,1);
    await service.progress('token',id,command,'csrf');
    assert.equal((await service.item('token',id,dataset)).version,1);
    if (status === 'completed') {
      const comment = await service.addComment('token',id,{ commandId: randomUUID(), expectedVersion: 1,
        dataset, body: 'Completed review discussed.' },'csrf');
      assert.equal(comment.status,'completed');
      assert.deepEqual(comment.outcome,saved.outcome);
      assert.equal(comment.progressHistory.length,1);
    }
  }
});
