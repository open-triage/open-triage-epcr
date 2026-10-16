import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readMigrations, applyMigrations } from '../../../packages/database/scripts/migrate.mjs';
import { AccountService } from '../dist/identity/account.service.js';
import { ClinicianSessionService } from '../dist/sessions/clinician-session.service.js';
import { AuthenticationPolicyService } from '../dist/authentication/authentication-policy.service.js';
import { beginAuthenticationAttempt } from '../dist/sessions/authentication-throttle.js';
import { localPolicy } from '../dist/authentication/local-policy.js';
const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
integration('real local sessions inherit policy, expire, retain recovery, deny unrelated groups and share sibling limits', async () => {
  const name = `group_auth_${randomUUID().replaceAll('-','')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect(); await admin.query(`create database ${name}`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  const manager = { query: async (sql,parameters) => (await pool.query(sql,parameters)).rows };
  const database = { manager, query: manager.query, transaction: async work => {
    const client = await pool.connect(); try { await client.query('begin'); const result = await work({ query: async (sql,parameters) => (await client.query(sql,parameters)).rows }); await client.query('commit'); return result; } catch(error) { await client.query('rollback'); throw error; } finally { client.release(); }
  } };
  try {
    const client = await pool.connect(); try {
      const migrations = await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url)));
      const newMigration = migrations.find(m => m.version === '20261013115819');
      assert.ok(newMigration, "Group policy migration must exist");
      // Build the historical schema prefix, so later migrations can depend on this one.
      await applyMigrations(client, migrations.filter(m => m.version < newMigration.version), { info() {} });
      const legacyRoot = randomUUID(), legacyChild = randomUUID();
      await client.query(`insert into app_identity.organization(id,name,deployment_timezone) values ($1,'Legacy root','UTC')`, [legacyRoot]);
      await client.query(`insert into app_identity.organization(id,name,deployment_timezone,parent_organization_id,shift_session_duration_hours) values ($1,'Legacy child','UTC',$2,24)`, [legacyChild,legacyRoot]);
      await assert.rejects(applyMigrations(client,migrations,{info(){}}),error => /Conflicting legacy authentication settings/.test(error.cause?.message));
      await client.query('update app_identity.organization set shift_session_duration_hours=14 where id=$1',[legacyChild]);
      await client.query('insert into app_identity.agency_settings(organization_id) values ($1),($2) on conflict do nothing',[legacyRoot,legacyChild]);
      await client.query('update app_identity.agency_settings set authentication_account_attempt_limit=10 where organization_id=$1',[legacyChild]);
      await assert.rejects(applyMigrations(client,migrations,{info(){}}),error => /Conflicting legacy authentication settings/.test(error.cause?.message));
      // Explicit operator decision: strictest common policy, recorded in deployment change record.
      await client.query('update app_identity.agency_settings set authentication_account_attempt_limit=10 where organization_id=$1',[legacyRoot]);
      await applyMigrations(client,migrations,{info(){}});
      assert.equal((await localPolicy(manager,legacyChild)).accountAttemptsPer15Minutes,10);
    } finally { client.release(); }
    const root = randomUUID(), sibling = randomUUID(), foreign = randomUUID();
    await manager.query(`insert into app_identity.organization(id,name,deployment_timezone) values ($1,'Root','UTC'),($2,'Other','UTC')`, [root,foreign]);
    await manager.query(`insert into app_identity.organization(id,name,deployment_timezone,parent_organization_id,shift_session_duration_hours) values ($1,'Child','UTC',$2,24)`,[sibling,root]);
    const accountService = new AccountService(database);
    const owner = await accountService.bootstrapOwner({ username: 'owner', displayName: 'Owner', temporaryPassword: 'Personal password 42!', operator: { operatorId:'test',osAccount:'test',host:'test' } });
    const medic = await accountService.provision({ organizationId:root,username:'medic',displayName:'Medic',role:'administrator',temporaryPassword:'Personal password 42!' });
    await manager.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=any($1::uuid[])',[[owner.userId,medic.userId]]);
    await manager.query('update app_identity.group_authentication_policy set maximum_session_hours=2,temporary_password_hours=3,account_attempt_limit=3 where group_id=$1',[root]);
    assert.equal((await localPolicy(manager,sibling)).maximumSessionHours,2);
    assert.equal((await localPolicy(manager,foreign)).maximumSessionHours,14);
    const sessions = new ClinicianSessionService(database);
    const now = new Date();
    const created = await sessions.create({username:'medic',password:'Personal password 42!'},now);
    assert.equal(Date.parse(created.session.expiresAt)-now.getTime(),7200000);
    await sessions.get(created.sessionToken,new Date(now.getTime()+7199999));
    await assert.rejects(sessions.get(created.sessionToken,new Date(now.getTime()+7200000)),/ended/);
    const policies = new AuthenticationPolicyService(database,sessions);
    await policies.update(created.sessionToken,{expectedRevision:1,maximumSessionHours:2,temporaryPasswordHours:3,accountAttemptsPer15Minutes:3,networkAttemptsPer5Minutes:60});
    await sessions.switchAgency(created.sessionToken,sibling);
    const inherited = await policies.get(created.sessionToken); assert.equal(inherited.groupId,root); assert.equal(inherited.inherited,true);
    await assert.rejects(sessions.switchAgency(created.sessionToken,foreign),/not available/);
    const recovery = await sessions.create({username:'owner',password:'Personal password 42!'},now);
    assert.equal(Date.parse(recovery.session.expiresAt)-now.getTime(),43200000);
    const beforeSwitch = recovery.session.expiresAt;
    const recoveryChild = await sessions.switchAgency(recovery.sessionToken,sibling); assert.equal(recoveryChild.expiresAt,beforeSwitch);
    const temporary = await accountService.provision({organizationId:root,username:'temporary',displayName:'Temporary',role:'clinician',temporaryPassword:'Personal password 42!'});
    const expiry = (await manager.query('select temporary_password_expires_at from app_identity.local_credential where user_id=$1',[temporary.userId]))[0].temporary_password_expires_at;
    assert.ok(expiry.getTime()-Date.now() <= 10800000 && expiry.getTime()-Date.now() > 10700000);
    await assert.rejects(sessions.create({username:'temporary',password:'Personal password 42!'},new Date(expiry.getTime())),/incorrect/);
    const one = await beginAuthenticationAttempt(manager,'medic',undefined,now,{organizationId:root});
    const two = await beginAuthenticationAttempt(manager,'medic',undefined,now,{organizationId:sibling});
    assert.ok(one && two); assert.equal(one.buckets[0].keyDigest,two.buckets[0].keyDigest);
    assert.equal(await beginAuthenticationAttempt(manager,'medic',undefined,now,{organizationId:root}),undefined);
  } finally { await pool.end(); await admin.query(`drop database ${name}`); await admin.end(); }
});
