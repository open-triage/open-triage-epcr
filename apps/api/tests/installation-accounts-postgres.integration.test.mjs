import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { readMigrations, applyMigrations } from '../../../packages/database/scripts/migrate.mjs';
import { runIdentityAccountCli } from '../dist/identity/identity-account.cli.js';
import { ClinicianSessionService } from '../dist/sessions/clinician-session.service.js';
import { OrganizationsService } from '../dist/admin/organizations.service.js';
import { eligibleAgencyUsers } from '../../../scripts/lib/synthetic-record-users.mjs';
import { agencyRequest } from '../dist/sessions/agency-context.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
integration('installation accounts bootstrap, authenticate and recover without any agency', async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
  const name = `installation_identity_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database ${name}`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const db = new DataSource({ type:'postgres', url:url.toString() });
  const runtime = new DataSource({ type:'postgres', url:url.toString(), extra:{options:'-c role=open_triage_api_runtime'} });
  const client = new pg.Client({connectionString:url.toString()}); await client.connect();
  try {
    await applyMigrations(client, await readMigrations(fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))), { info() {} });
    await db.initialize(); await runtime.initialize();
    const password='Installation-Temporary-42!';
    const dependencies={readPassword:async()=>password,osAccount:'test',host:'localhost'};
    const owner=await runIdentityAccountCli(db,['bootstrap-owner','--username','install.owner','--display-name','Owner','--operator-id','test'],dependencies);
    const superadmin=await runIdentityAccountCli(db,['create-superadmin','--username','install.admin','--display-name','Administrator','--operator-id','test'],dependencies);
    assert.equal((await client.query('select count(*)::int n from app_identity.organization')).rows[0].n,0);
    assert.deepEqual((await client.query('select distinct organization_id,account_scope from app_identity.app_user')).rows,[{organization_id:null,account_scope:'installation'}]);
    const sessions=new ClinicianSessionService(runtime);
    const directory=new OrganizationsService(runtime,sessions);
    const login=await agencyRequest.run({origin:'http://localhost:3000'},()=>sessions.create({username:'install.owner',password}));
    assert.equal(login.session.organization,null);
    assert.equal(login.session.installationOwner,true);
    assert.equal(login.session.passwordChangeRequired,true);
    const changed=await sessions.changePassword(login.sessionToken,{currentPassword:password,newPassword:'Installation-Permanent-84!',csrfToken:login.session.csrfToken});
    assert.equal(changed.session.organization,null);
    assert.equal((await sessions.getAuthenticated(changed.sessionToken)).installationOwner,true);
    assert.deepEqual((await directory.list(changed.sessionToken)).agencies,[]);
    await assert.rejects(sessions.requireCapability(changed.sessionToken,'clinical:document'),/Select an agency/);
    await sessions.reauthenticate(changed.sessionToken,changed.session.csrfToken,'Installation-Permanent-84!');
    const agency=randomUUID();
    await client.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'First agency','UTC')",[agency]);
    assert.deepEqual(await eligibleAgencyUsers(runtime,agency),[]);
    const selected=await sessions.switchAgency(changed.sessionToken,agency);
    assert.equal(selected.organization.id,agency);
    assert.equal(selected.homeOrganizationId,undefined);
    assert.ok(selected.capabilities.includes('clinical:document'));
    assert.equal((await client.query('select organization_id from app_identity.app_user where id=$1',[owner.userId])).rows[0].organization_id,null);
    await client.query('update app_identity.organization set active=false where id=$1',[agency]);
    await assert.rejects(sessions.get(changed.sessionToken),/ended/);
    const portal=await sessions.create({username:'install.owner',password:'Installation-Permanent-84!'});
    assert.equal(portal.session.organization,null);
    await sessions.end(portal.sessionToken,portal.session.csrfToken);
    await runIdentityAccountCli(db,['reset-owner','--operator-id','test'],dependencies);
    const reset=await sessions.create({username:'install.owner',password});
    assert.equal(reset.session.passwordChangeRequired,true);
    await runIdentityAccountCli(db,['reset-user','--user-id',superadmin.userId,'--operator-id','test'],dependencies);
    assert.equal((await sessions.create({username:'install.admin',password})).session.organization,null);
    await assert.rejects(client.query("update app_identity.app_user set active=false where id=$1",[owner.userId]),/owner cannot/);
    const staff=randomUUID();await client.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Staff')",[staff,agency]);
    await assert.rejects(client.query(`insert into app_identity.local_credential(user_id,username,password_verifier)
      select $1,'install.owner',password_verifier from app_identity.local_credential where user_id=$2`,[staff,owner.userId]),/globally reserved/);
    await assert.rejects(client.query("insert into app_identity.app_user(display_name) values('Unscoped staff')"),/Staff accounts/);
    // Hosted ordinary accounts need a registered agency host. Internal service
    // calls without request context must not stand in for browser login tests.
    await client.query('update app_identity.organization set active=true where id=$1',[agency]);
    await client.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password)
      select $1,'hosted.staff',password_verifier,false from app_identity.local_credential where user_id=$2`,[staff,owner.userId]);
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='clinician'`,[agency,staff,owner.userId]);
    const hostedLogin = origin => agencyRequest.run({origin},()=>sessions.create({username:'hosted.staff',password}));
    await assert.rejects(hostedLogin('http://localhost:3000'),/username or password/);
    await assert.rejects(hostedLogin('https://agency.example.test'),/No active agency/);
    await client.query("update app_identity.organization set hostname='agency.example.test' where id=$1",[agency]);
    const hosted = await hostedLogin('https://agency.example.test');
    assert.equal(hosted.session.organization.id,agency);
    await agencyRequest.run({origin:'https://agency.example.test'},async()=>{
      assert.equal((await sessions.get(hosted.sessionToken)).user.id,staff);
      await sessions.end(hosted.sessionToken,hosted.session.csrfToken);
    });

  } finally {
    if(runtime.isInitialized)await runtime.destroy();if(db.isInitialized)await db.destroy();await client.end();
    await admin.query(`drop database ${name} with (force)`);await admin.end();
  }
});

integration('upgrade detaches existing installation accounts while preserving history and global usernames', async () => {
  const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
  const name=`installation_upgrade_${randomUUID().replaceAll('-','')}`;await admin.query(`create database ${name}`);
  const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
  const client=new pg.Client({connectionString:url.toString()});await client.connect();
  try {
    const migrations=await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url)));
    await applyMigrations(client,migrations.filter(m=>m.version<'20261012154216'),{info(){}});
    const agency=randomUUID(),owner=randomUUID(),superadmin=randomUUID();
    await client.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Legacy agency','UTC')",[agency]);
    await client.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$3,'Owner'),($2,$3,'Superadmin')",[owner,superadmin,agency]);
    // A valid verifier comes from the same password implementation as the CLI.
    const {createPasswordVerifier}=await import('../dist/identity/password.js');
    const verifier=await createPasswordVerifier('Upgrade-Password-42!');
    await client.query("insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,'legacy.owner',$3,false),($2,'legacy.admin',$3,false)",[owner,superadmin,verifier]);
    await client.query("insert into app_identity.installation_owner(organization_id,user_id,established_by_operator_id) values($1,$2,'upgrade-test')",[agency,owner]);
    await client.query("insert into app_identity.installation_superadmin(user_id,established_by_operator_id) values($1,'upgrade-test')",[superadmin]);
    await client.query(`insert into app_identity.ownership_transfer(organization_id,nominated_by,nominee_user_id,expires_at)
      values($1,$2,$3,now()+interval '72 hours')`,[agency,owner,superadmin]);
    await applyMigrations(client,migrations,{info(){}});
    assert.equal((await client.query("select count(*)::int n from app_identity.ownership_transfer_event where action='owner.transfer.cancel' and details->>'reason'='installation_identity_upgrade'")).rows[0].n,1);
    assert.equal((await client.query("select count(*)::int n from app_identity.app_user where organization_id is null and account_scope='installation'")).rows[0].n,2);
    assert.equal((await client.query('select count(*)::int n from app_identity.organization_user where organization_id=$1',[agency])).rows[0].n,2);
    await client.query("update app_identity.local_credential set username='renamed.owner' where user_id=$1",[owner]);
    assert.deepEqual((await client.query('select username from app_identity.global_username_reservation where user_id=$1 order by username',[owner])).rows.map(r=>r.username),['legacy.owner','renamed.owner']);
    await client.query('update app_identity.organization set active=false where id=$1',[agency]);
    const runtime=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime'}});await runtime.initialize();
    try {
      const sessions=new ClinicianSessionService(runtime);
      const login=await sessions.create({username:'renamed.owner',password:'Upgrade-Password-42!'});
      assert.equal(login.session.organization,null);assert.equal(login.session.installationOwner,true);
      await sessions.end(login.sessionToken,login.session.csrfToken);
    } finally {await runtime.destroy();}
  } finally {await client.end();await admin.query(`drop database ${name} with (force)`);await admin.end();}
});
