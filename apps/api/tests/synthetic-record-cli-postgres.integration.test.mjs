import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { generateRecords, transactionDatabase } from '../../../scripts/generate-synthetic-records.mjs';
import { AssignedCallsService } from '../dist/calls/assigned-calls.service.js';
import { agencyUserContext, eligibleAgencyUsers } from '../../../scripts/lib/synthetic-record-users.mjs';
import { require as tsRequire } from 'tsx/cjs/api';
import { DraftReportService } from '../dist/reports/draft-report.service.js';
import { encounterDocument } from '../dist/reports/encounter-document.persistence.js';
import { validationProblems } from '@open-triage/contracts/synthetic-record-generator';

test('CLI generates varied signed records, validates drafts, rolls back dry runs and protects existing calls', {
  skip: !process.env.DATABASE_URL,
}, async t => {
  // One physical connection owns every query, including auth and service writes.
  // No pool or second DataSource can commit outside this outer rollback.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const generatedIds = [];
  await client.connect();
  await client.query('begin');
  try {
    const manager = { query: async (sql, parameters) => (await client.query(sql, parameters)).rows };
    const [active] = await manager.query(`select active.*,fv.form_id from app_identity.active_configuration_bundle active
      join forms.form_version fv on fv.id=active.form_version_id where active.organization_id=$1`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    if (!active) { t.skip('Requires the bootstrapped local demo agency'); return; }
    const [actor] = await manager.query('select user_id from app_identity.local_credential where username=$1', [SYNTHETIC_DEMO_FIXTURE.username]);
    if (!actor) { t.skip('Requires the bootstrapped demo clinician'); return; }
    const unitId = randomUUID();
    await manager.query(`insert into app_identity.operational_unit(id,organization_id,call_sign,name,default_form_id,synthetic)
      values($1,$2,$3,'Rollback synthetic CLI test',$4,true)`, [unitId, active.organization_id, `TEST-${unitId}`, active.form_id]);
    await manager.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',
      [active.organization_id, unitId, actor.user_id]);
    // Real services and SQL, including savepoint rollbacks, nested inside a final
    // rollback so this test never leaves generated reports or fixture accounts.
    let savepoint = 0;
    const db = { ...transactionDatabase(manager), transaction: async (...args) => {
      const name = `synthetic_test_${++savepoint}`;
      await manager.query(`savepoint ${name}`);
      try { const result = await args.at(-1)(manager); await manager.query(`release savepoint ${name}`); return result; }
      catch (error) { await manager.query(`rollback to savepoint ${name}`); await manager.query(`release savepoint ${name}`); throw error; }
    } };
    const options = { agency: active.organization_id, username: SYNTHETIC_DEMO_FIXTURE.username,
      unit: unitId, count: 8, from: '2026-09-01', to: '2026-09-30', status: 'signed', seed: 'integration', dryRun: false };
    const events = [];
    const result = await generateRecords(db, options, event => {
      events.push(event);
      if (event.event === 'record') generatedIds.push(event.reportId);
    });
    assert.equal(result.generated, 8);
    const ids = events.filter(event => event.event === 'record').map(event => event.reportId);
    const reports = await manager.query(`select r.*,s.signed_at from clinical.report r
      join clinical.signed_snapshot s on s.report_id=r.id where r.id=any($1::uuid[])`, [ids]);
    assert.equal(reports.length, 8);
    assert.ok(reports.every(report => report.synthetic && report.status === 'signed' &&
      report.form_version_id === active.form_version_id && report.catalog_release_id === active.catalog_release_id &&
      report.validation_version_id === active.validation_version_id && report.synthetic_generated_by === actor.user_id));
    assert.ok(reports.every(report => !report.expires_at || new Date(report.expires_at) > new Date()));
    const times = await manager.query(`select report_id,min(value_datetime) as first,max(value_datetime) as last
      from clinical.element_occurrence where report_id=any($1::uuid[]) and element_id like 'eTimes.%'
      and tombstoned_at is null group by report_id`, [ids]);
    assert.ok(times.every(row => new Date(row.first) >= new Date('2026-09-01T00:00:00Z') && new Date(row.last) < new Date('2026-10-01T00:00:00Z')));
    const codes = await manager.query(`select element_id,count(distinct code)::int as variety from clinical.element_occurrence
      where report_id=any($1::uuid[]) and value_kind='coded' and tombstoned_at is null group by element_id`, [ids]);
    assert.ok(codes.filter(row => row.variety > 1).length > 5, 'several fields must vary across the batch');
    const draftEvents = [];
    await generateRecords(db, { ...options, count: 1, status: 'draft' }, event => draftEvents.push(event));
    const draftId = draftEvents.find(event => event.event === 'record').reportId;
    assert.equal((await manager.query('select status from clinical.report where id=$1', [draftId]))[0].status, 'draft');
    assert.equal((await manager.query('select id from clinical.signed_snapshot where report_id=$1', [draftId])).length, 0);
    const dryEvents = [];
    await generateRecords(db, { ...options, count: 2, dryRun: true }, event => dryEvents.push(event));
    const dryIds = dryEvents.filter(event => event.event === 'record').map(event => event.reportId);
    assert.equal((await manager.query('select id from clinical.report where id=any($1::uuid[])', [dryIds])).length, 0);
    assert.equal((await manager.query('select id from clinical.call_assignment where report_id=any($1::uuid[])', [dryIds])).length, 0);
    await assert.rejects(generateRecords(db, { ...options, agency: randomUUID(), count: 1 }, () => {}), /No matching active agency users/);

    const secondId = randomUUID(), inactiveId = randomUUID(), unprivilegedId = randomUUID(), endedId = randomUUID();
    for (const [id, enabled, hasRole, ended] of [[secondId, true, true, false], [inactiveId, false, true, false],
      [unprivilegedId, true, false, false], [endedId, true, true, true]]) {
      await manager.query(`insert into app_identity.app_user(id,organization_id,display_name,active,synthetic)
        values($1,$2,'Rollback CLI distribution test',$3,true)`, [id, active.organization_id, enabled]);
      await manager.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',
        [active.organization_id, unitId, id]);
      if (hasRole) await manager.query(`insert into app_identity.user_role_assignment
        (organization_id,user_id,role_id,assigned_by,note,ended_at,ended_by)
        select $1,$2,id,$3,'Rollback CLI distribution test',case when $4 then now() else null end,
          case when $4 then $3::uuid else null end
        from app_identity.role where organization_id=$1 and system_key='demo'`,
      [active.organization_id, id, actor.user_id, ended]);
    }
    const candidates = await eligibleAgencyUsers(manager, active.organization_id, { unitId });
    assert.deepEqual(new Set(candidates.map(user => user.id)), new Set([actor.user_id, secondId]));
    const randomEvents = [];
    await generateRecords(db, { ...options, username: undefined, count: 12, seed: 'random-users' }, event => {
      randomEvents.push(event);
      if (event.event === 'record') generatedIds.push(event.reportId);
    });
    const randomRecords = randomEvents.filter(event => event.event === 'record');
    assert.deepEqual(new Set(randomRecords.map(record => record.userId)), new Set([actor.user_id, secondId]));
    assert.ok(randomRecords.every(record => record.unitId === unitId));
    const randomReports = await manager.query(`select r.documenting_user_id,r.synthetic_generated_by,s.signer_id
      from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id where r.id=any($1::uuid[])`,
    [randomRecords.map(record => record.reportId)]);
    assert.equal(randomReports.length, 12);
    assert.ok(randomReports.every(report => report.documenting_user_id === report.synthetic_generated_by &&
      report.documenting_user_id === report.signer_id));
    const secondContext = agencyUserContext(db, active.organization_id, candidates.find(user => user.id === secondId));
    await manager.query('update app_identity.app_user set active=false where id=$1', [secondId]);
    await assert.rejects(secondContext.sessions.requireCapability(secondContext.sessionToken, 'clinical:demo'), /no longer has/);
    await assert.rejects(generateRecords(db, { ...options, username: undefined, unit: randomUUID(), count: 1 }, () => {}), /No matching active agency users/);

    const { sessions, session, sessionToken } = agencyUserContext(db, active.organization_id, candidates.find(user => user.id === actor.user_id));
    const pending = await new AssignedCallsService(db, sessions).generateSynthetic(sessionToken, session.csrfToken, unitId);
    await assert.rejects(generateRecords(db, { ...options, count: 1 }, () => {}), /already has an unopened synthetic call/);
    await assert.rejects(generateRecords(db, { ...options, username: undefined, count: 1 }, () => {}), /No matching active agency users/);
    const [untouched] = await manager.query('select status,report_id from clinical.call_assignment where id=$1', [pending.assignment.id]);
    assert.deepEqual(untouched, { status: 'assigned', report_id: null });

    await t.test('browser Populate shares the CLI engine and persists through the ordinary demo save queue', async () => {
      const { populateSyntheticRecord } = tsRequire('../../web/app/populate-synthetic-record.ts', import.meta.url);
      const { encounterDocumentToDraftMutations, draftMutationDelta, recoveryMutationBatches } = tsRequire('../../web/app/draft-report.ts', import.meta.url);
      const { clearStationaryDemoData } = tsRequire('../../web/app/stationary-demo-data.ts', import.meta.url);
      const { report } = await new AssignedCallsService(db, sessions).open(sessionToken, pending.assignment.id);
      generatedIds.push(report.id);
      const populate = source => populateSyntheticRecord(source, report.clinicalForm);
      const mutations = (source, previous) => encounterDocumentToDraftMutations(report.id, source, previous,
        report.clinicalForm.customFields, report.clinicalForm.customGroups);
      const original = structuredClone(report.document);
      const populated = populate(report.document);
      assert.deepEqual(report.document, original);
      let revision = report.revision;
      const save = async (before, after) => {
        const previous = mutations(before);
        for (const batch of recoveryMutationBatches(draftMutationDelta(mutations(after, previous), previous), previous)) {
          if (!batch.groups.length && !batch.occurrences.length) continue;
          const saved = await new DraftReportService(db, sessions).save(sessionToken, report.id, {
            commandId: randomUUID(), expectedRevision: revision, authorId: session.user.id, ...batch,
          }, session.csrfToken);
          revision = saved.revision;
        }
      };
      await save(original, populated);
      const persisted = await encounterDocument(manager, report.id);
      assert.deepEqual(validationProblems(report.clinicalForm.validation.bundle, persisted, new Date().toISOString()), []);
      const originalValues = original.groups.flatMap(group => group.instances.flatMap(instance =>
        instance.elements.flatMap(element => element.values)));
      const persistedValues = persisted.groups.flatMap(group => group.instances.flatMap(instance =>
        instance.elements.flatMap(element => element.values)));
      for (const value of originalValues) assert.deepEqual(persistedValues.find(item => item.occurrenceId === value.occurrenceId), value);
      await save(persisted, populate(persisted));
      const refreshed = await encounterDocument(manager, report.id);
      await save(refreshed, clearStationaryDemoData(refreshed));
      const cleared = await encounterDocument(manager, report.id);
      const remainingValues = cleared.groups.flatMap(group => group.instances.flatMap(instance =>
        instance.elements.flatMap(element => element.values)));
      assert.deepEqual(new Set(remainingValues.map(value => value.occurrenceId)), new Set(originalValues.map(value => value.occurrenceId)));
    });
  } finally {
    await client.query('rollback');
    try {
      const { rows } = await client.query('select id from clinical.report where id=any($1::uuid[])', [generatedIds]);
      assert.deepEqual(rows, [], 'the outer transaction must leave zero generated reports');
    } finally { await client.end(); }
  }
});
