import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readMigrations, applyMigrations } from '../../../packages/database/scripts/migrate.mjs';
import { beginAuthenticationAttempt, finishAuthenticationAttempt } from '../dist/sessions/authentication-throttle.js';
import { AgencySettingsService } from '../dist/admin/agency-settings.service.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

integration('Postgres enforces agency defaults, live policy changes, and atomic shared-login limits', async () => {
  const scratchName = `login_limits_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${scratchName}`);
  const scratchUrl = new URL(process.env.DATABASE_URL);
  scratchUrl.pathname = `/${scratchName}`;
  const pool = new pg.Pool({ connectionString: scratchUrl.toString(), max: 12 });
  const manager = { query: async (sql, parameters) => (await pool.query(sql, parameters)).rows };
  const organizationIds = [randomUUID(), randomUUID()];
  const userIds = [randomUUID(), randomUUID()];
  const usernames = userIds.map(id => `limit-test-${id}`);
  const priorSecret = process.env.AUTH_RATE_LIMIT_SECRET_BASE64;
  process.env.AUTH_RATE_LIMIT_SECRET_BASE64 = randomBytes(32).toString('base64');
  const attempt = async (username, source = '203.0.113.41') => {
    const result = await beginAuthenticationAttempt(manager, username, source, now);
    return result;
  };
  const now = new Date();
  try {
    const migrationClient = await pool.connect();
    try {
      await applyMigrations(migrationClient, await readMigrations(fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))), { info() {} });
    } finally { migrationClient.release(); }
    for (let index = 0; index < 2; index++) {
      await pool.query(`insert into app_identity.organization (id,name,deployment_timezone)
        values ($1,'Fictional login-limit test','UTC')`, [organizationIds[index]]);
      await pool.query('insert into app_identity.agency_settings (organization_id) values ($1) on conflict do nothing', [organizationIds[index]]);
      await pool.query(`insert into app_identity.app_user (id,organization_id,display_name,synthetic)
        values ($1,$2,'Fictional login-limit test',true)`, [userIds[index], organizationIds[index]]);
      await pool.query(`insert into app_identity.local_credential (user_id,username,password_verifier,must_change_password)
        values ($1,$2,'scrypt$test-only-never-authenticated',false)`, [userIds[index], usernames[index]]);
    }
    const defaults = (await pool.query(`select authentication_account_attempt_limit as account,
      authentication_network_attempt_limit as network from app_identity.agency_settings where organization_id=$1`, [organizationIds[0]])).rows[0];
    assert.deepEqual(defaults, { account: 20, network: 60 });
    for (const column of ['authentication_account_attempt_limit', 'authentication_network_attempt_limit']) {
      for (const invalid of [0, 1001]) {
        await assert.rejects(pool.query(`update app_identity.agency_settings set ${column}=$2 where organization_id=$1`,
          [organizationIds[0], invalid]), error => error.code === '23514');
      }
    }
    const catalogId = randomUUID();
    await pool.query(`insert into catalog.release
      (id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance)
      values ($1,'Test','1','EMSDataSet','1',$2,'{}')`, [catalogId, 'a'.repeat(64)]);
    await pool.query(`insert into app_identity.agency_demographic_version
      (organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by)
      values ($1,$2,1,'TEST','TEST','36',$3,now(),$4)`, [organizationIds[0], catalogId, 'b'.repeat(64), userIds[0]]);
    const database = { ...manager, transaction: async work => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await work({ query: async (sql, parameters) => (await client.query(sql, parameters)).rows });
        await client.query('commit');
        return result;
      } catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    } };
    const settings = new AgencySettingsService(database, { requireCapability: async (_token, capability) => {
      assert.ok(['settings:read', 'settings:write'].includes(capability));
      return { organization: { id: organizationIds[0] }, user: { id: userIds[0] } };
    } });
    const before = await settings.get('test-session');
    const saved = await settings.update('test-session', {
      expectedRevision: before.revision, language: before.language, appearance: before.appearance,
      reportMediaAllowanceBytes: before.reportMediaAllowanceBytes, imageMediaLimitBytes: before.imageMediaLimitBytes,
      demographics: before.demographics,
      authenticationLimits: { accountAttemptsPer15Minutes: 50, networkAttemptsPer5Minutes: 75 },
    });
    assert.deepEqual(saved.authenticationLimits, { accountAttemptsPer15Minutes: 50, networkAttemptsPer5Minutes: 75 });
    const audit = (await pool.query(`select old_authentication_account_attempt_limit as old_account,
      new_authentication_account_attempt_limit as new_account, old_authentication_network_attempt_limit as old_network,
      new_authentication_network_attempt_limit as new_network
      from app_identity.agency_settings_change_event where organization_id=$1`, [organizationIds[0]])).rows;
    assert.deepEqual(audit, [{ old_account: 20, new_account: 50, old_network: 60, new_network: 75 }]);
    const admitted = await Promise.all(Array.from({ length: 50 }, () => attempt(usernames[0])));
    assert.equal(admitted.filter(Boolean).length, 50);
    await Promise.all(admitted.map(result => finishAuthenticationAttempt(manager, result, true, now)));
    assert.equal(await attempt(usernames[0]), undefined, 'the 51st attempt is blocked');
    await pool.query(`update app_identity.agency_settings set authentication_account_attempt_limit=100 where organization_id=$1`, [organizationIds[0]]);
    const raised = await attempt(usernames[0]);
    assert.ok(raised, 'an increase applies in the same window');
    const accountKey = raised.buckets.find(bucket => bucket.scope === 'account').keyDigest;
    assert.equal((await pool.query('select attempt_count from app_identity.authentication_throttle where scope=$1 and key_digest=$2',
      ['account', accountKey])).rows[0].attempt_count, 52, 'the update does not reset successful or blocked attempts');
    const otherAgency = await Promise.all(Array.from({ length: 21 }, () => attempt(usernames[1])));
    assert.equal(otherAgency.filter(Boolean).length, 20, 'another agency retains its default account policy');
    await pool.query(`update app_identity.agency_settings set authentication_network_attempt_limit=52 where organization_id=$1`, [organizationIds[0]]);
    assert.equal(await attempt(usernames[0]), undefined, 'lowering the network policy applies without resetting its counter');
    assert.ok(await attempt(usernames[0], '203.0.113.42'), 'a different network has its own allowance');
  } finally {
    await pool.end();
    try { await admin.query(`drop database ${scratchName}`); } finally { await admin.end(); }
    if (priorSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET_BASE64;
    else process.env.AUTH_RATE_LIMIT_SECRET_BASE64 = priorSecret;
  }
});
