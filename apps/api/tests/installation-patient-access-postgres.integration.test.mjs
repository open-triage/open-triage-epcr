import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { ClinicianSessionService } from '../dist/sessions/clinician-session.service.js';
import { UserLifecycleService } from '../dist/admin/user-lifecycle.service.js';
import { SessionAdministrationService } from '../dist/admin/session-administration.service.js';
import { createPasswordVerifier } from '../dist/identity/password.js';
import { readMigrations, applyMigrations } from '../../../packages/database/scripts/migrate.mjs';
import { AdminService } from '../dist/admin/admin.service.js';
import { ReviewService } from '../dist/review/review.service.js';
import { eligibleReviewers } from '../dist/review/review-assignment.js';

if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for patient-access integration tests');
}
const integration = process.env.DATABASE_URL ? test : test.skip;
integration('installation patient-data ceiling overrides role grants across agency families', async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const name = `patient_access_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database ${name}`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  const runtime = new DataSource({ type: 'postgres', url: url.toString(), extra: { options: '-c role=open_triage_api_runtime' } });
  try {
    await client.connect();
    await applyMigrations(client, await readMigrations(fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))), { info() {} });
    const root = randomUUID(), child = randomUUID(), other = randomUUID();
    const owner = randomUUID(), superuser = randomUUID(), reviewer = randomUUID();
    await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
      values ($1,'First family','UTC'),($2,'Other family','UTC')`, [root, other]);
    await client.query(`insert into app_identity.organization(id,name,parent_organization_id,deployment_timezone)
      values ($1,'Child agency',$2,'UTC')`, [child, root]);
    await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
      values ($1,$4,'Owner'),($2,$4,'Super user'),($3,$4,'Reviewer')`, [owner, superuser, reviewer, root]);
    await client.query(`insert into app_identity.installation_owner(user_id,established_by_operator_id)
      values ($1,'patient-access-test')`, [owner]);
    // Grant broad roles BEFORE promotion, so existing assignments cannot defeat
    // the ceiling. A regular reviewer must retain their explicit clinical role.
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,subject,id,$2 from app_identity.role cross join unnest($3::uuid[]) subject
      where organization_id=$1 and system_key in ('administrator','review-administrator')`,
      [root, owner, [superuser, reviewer]]);
    await client.query(`insert into app_identity.installation_superadmin(user_id,established_by_operator_id)
      values ($1,'patient-access-test')`, [superuser]);
    // New grants after promotion, including outside the original family, are
    // subject to the same ceiling as the assignments that predate promotion.
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,subject,id,$2 from app_identity.role cross join unnest($3::uuid[]) subject
      where organization_id=$1 and system_key='administrator'`, [other, owner, [owner, superuser]]);
    await client.query('set constraints all immediate');
    await client.query("select analytics_private.ensure_partitions(date '2026-10-01', date '2026-10-02')");
    for (const agency of [root, child, other]) {
      for (const user of [owner, superuser, reviewer]) {
        for (const synthetic of [false, true]) {
          await client.query(`insert into analytics_private.epcr
            (reporting_date,reporting_date_source,report_id,incident_id,organization_id,
             agency_demographic_version_id,patient_key,patient_key_version,form_version_id,
             form_version,catalog_release_id,catalog_version,signed_snapshot_id,
             signed_snapshot_sha256,signed_at,projector_version,projected_at,documenting_user_id,synthetic)
            values ('2026-10-01','signing-time',$1,$2,$3,$4,$5,1,$6,1,$7,'3.5.1',$8,
              repeat('a',64),now(),'1.1.0',now(),$9,$10)`,
          [randomUUID(),randomUUID(),agency,randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID(),user,synthetic]);
        }
      }
    }
    await client.query('set role open_triage_api_runtime');
    const query = async (sql, params) => (await client.query(sql, params)).rows;
    const can = async (user, agency, capability) => (await query(
      'select app_identity.user_has_capability($1,$2,$3) allowed', [user, agency, capability]))[0].allowed;
    const denied = ['review:all', 'review:admin', 'review:identifying'];
    const database = { query: async (sql, params) => sql.includes('projection_health')
      ? [{ observed_at: new Date(), oldest_backlog_age_seconds: null, persistent_failure_count: 0,
        retrying_count: 0, stale_run_count: 0, last_run_status: 'succeeded',
        is_read_only_replica: false, replay_lag_seconds: null }] : query(sql, params) };
    database.transaction = async (_level, work) => work(database);
    for (const user of [owner, superuser]) {
      for (const agency of [root, child, other]) {
        for (const capability of denied) assert.equal(await can(user, agency, capability), false, `${user}: ${agency}: ${capability}`);
        for (const capability of ['clinical:document','review:self','users:write','roles:assign','settings:write']) {
          assert.equal(await can(user, agency, capability), true, capability);
        }
        assert.equal(await can(user, agency, 'unknown:capability'), false);
        const capabilities = (await query(`select key from app_identity.capability
          where app_identity.user_has_capability($1,$2,key)`, [user, agency])).map(row => row.key);
        const current = { user: { id: user }, organization: { id: agency }, capabilities,
          installationOwner: user === owner, installationSuperadmin: true };
        const service = new ReviewService(database, { get: async () => current });
        const context = await new AdminService(database, { get: async () => current }).context('token');
        assert.ok(context.panels.includes('users'), 'Administration remains available');
        assert.equal(context.dashboard.signedReports, 0);
        assert.equal(context.dashboard.availableCalls, 0);
        for (const dataset of ['real', 'synthetic']) {
          const result = await service.volume('token', dataset, '2026-10-01', '2026-10-01');
          assert.equal(result.population.scope, 'own');
          assert.equal(result.total, 1, 'Counts must exclude other clinicians in the same agency');
          assert.equal(result.sources.length, 1, 'Exports must exclude other clinicians');
        }
        const candidates = await eligibleReviewers({ query }, agency, reviewer);
        assert.ok(!candidates.some(candidate => candidate.id === user), 'Cannot be assigned another clinician’s report');
        const own = await eligibleReviewers({ query }, agency, user);
        assert.ok(own.some(candidate => candidate.id === user && !candidate.all_access), 'Own reports remain eligible');
      }
    }
    for (const agency of [root, child]) {
      assert.equal(await can(reviewer, agency, 'review:all'), true);
      assert.equal(await can(reviewer, agency, 'review:admin'), true);
    }
    assert.equal(await can(reviewer, other, 'review:all'), false);
    // Exercise real runtime sessions against the production Demo role as well as
    // reviewer permissions. Both have review:admin, which installation accounts
    // deliberately lack, while user administration must remain available.
    await client.query('reset role');
    const demo = randomUUID(), password = 'User administration fixture 42!';
    await client.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Demo account')", [demo, root]);
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='demo'`, [root,demo,owner]);
    const verifier = await createPasswordVerifier(password);
    for (const user of [owner,superuser,reviewer,demo]) {
      await client.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password)
        values($1,$2,$3,false)`, [user,`fixture.${user}`,verifier]);
    }
    await runtime.initialize();
    const sessions = new ClinicianSessionService(runtime);
    const lifecycle = new UserLifecycleService(runtime,sessions);
    const credentials = new SessionAdministrationService(runtime,sessions);
    for (const user of [owner,superuser]) {
      const login = await sessions.create({username:`fixture.${user}`,password});
      for (const agency of [root,child]) {
        await sessions.switchAgency(login.sessionToken,agency);
        for (const target of [reviewer,demo]) {
          const [before] = await runtime.query('select revision,display_name from app_identity.app_user where id=$1',[target]);
          const command = { expectedRevision:Number(before.revision), username:`fixture.${target}`,displayName:before.display_name,active:true };
          const saved = await lifecycle.update(login.sessionToken,target,command);
          assert.equal(saved.revision,command.expectedRevision+1,'Save user succeeds even without changing fields');
          const reset = await credentials.resetCredential(login.sessionToken,target,{
            expectedRevision:saved.revision,temporaryPassword:password,temporaryPasswordHours:72
          });
          assert.equal(reset.revision,saved.revision+1,'credential management uses the same installation authority');
          for (const capability of denied) assert.equal(await can(user,agency,capability),false,'account management never grants patient access');
        }
      }
      await sessions.switchAgency(login.sessionToken,other);
      const [before] = await runtime.query('select revision from app_identity.app_user where id=$1',[demo]);
      await assert.rejects(lifecycle.update(login.sessionToken,demo,{expectedRevision:Number(before.revision),username:`fixture.${demo}`,displayName:'Out of scope',active:true}),error=>error.getStatus?.()===404);
    }

  } finally {
    if (runtime.isInitialized) await runtime.destroy();
    await client.end();
    await admin.query(`drop database ${name} with (force)`);
    await admin.end();
  }
});
