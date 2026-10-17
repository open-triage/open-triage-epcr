import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { applyMigrations, readMigrations } from "../scripts/migrate.mjs";

if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const integration = process.env.DATABASE_URL ? test : test.skip;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

integration("consolidated audit migration preserves existing evidence and roles while establishing final permissions and UUIDs", async t => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const name = `audit_logs_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  let created = false;
  t.after(async () => {
    await client.end();
    try { if (created) await admin.query(`drop database ${name} with (force)`); }
    finally { await admin.end(); }
  });
  await admin.query(`create database ${name}`); created = true;
  await client.connect();
  const migrations = await readMigrations(fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)));
  const migration = migrations.find(row => row.name === "audit_logs");
  assert.ok(migration);
  await applyMigrations(client, migrations.filter(row => row.version < migration.version), { info() {} });
  const agency = randomUUID(), owner = randomUUID(), auditor = randomUUID(), reader = randomUUID(), superuser = randomUUID();
  const customRole = randomUUID(), customVersion = randomUUID();
  await client.query("begin");
  await client.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Audit upgrade fixture','UTC')", [agency]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$5,'Owner'),($2,$5,'Auditor'),($3,$5,'Reader'),($4,$5,'Super user')`, [owner,auditor,reader,superuser,agency]);
  await client.query("insert into app_identity.installation_owner(user_id,established_by_operator_id) values($1,'audit-upgrade-test')", [owner]);
  await client.query(`insert into app_identity.role(id,organization_id,display_name,current_version_id)
    values($1,$2,'Custom reader',$3)`, [customRole,agency,customVersion]);
  await client.query(`insert into app_identity.role_version(id,organization_id,role_id,version) values($1,$2,$3,1)`, [customVersion,agency,customRole]);
  await client.query(`insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key)
    values($1,$2,$3,'users:read')`, [agency,customRole,customVersion]);
  await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
    values($1,$2,$3,$4)`, [agency,reader,customRole,owner]);
  for (const user of [auditor,superuser]) await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
    select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='administrator'`, [agency,user,owner]);
  await client.query("insert into app_identity.installation_superadmin(user_id,established_by_operator_id) values($1,'audit-upgrade-test')", [superuser]);
  await client.query("commit");
  const originalAuth = (await client.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result)
    values($1,$2,'authentication.sign_in','succeeded') returning *`, [agency,auditor])).rows[0];
  const originalFeedback = (await client.query(`insert into feedback.submission
    (reference_code,submission_type,original_description,organization_id,actor_id,organization_display_name,actor_display_name,idempotency_key)
    values('AUDITSQUASHA','bug','Preserved evidence',$1,$2,'Audit upgrade fixture','Auditor',$3) returning *`,
  [agency,auditor,randomUUID()])).rows[0];
  const originalNativeUuid = (await client.query(`insert into clinical.review_amendment_policy_history
    (organization_id,command_id,actor_id,clearance,policy_version) values($1,$2,$3,'confirm',1) returning *`, [agency,randomUUID(),auditor])).rows[0];
  const beforeVersions = (await client.query("select * from app_identity.role_version order by id")).rows;
  const beforeGrants = (await client.query("select * from app_identity.role_version_capability order by role_version_id,capability_key")).rows;
  const beforeAssignments = (await client.query("select * from app_identity.user_role_assignment order by id")).rows;
  const protectedRoles = (await client.query(`select r.id,r.current_version_id,v.version from app_identity.role r
    join app_identity.role_version v on v.id=r.current_version_id where r.protected and r.system_key in ('administrator','demo')`)).rows;

  await applyMigrations(client,migrations,{ info() {} });
  const strip = ({ audit_id, ...evidence }) => evidence;
  const afterAuth = (await client.query("select * from app_identity.authentication_event where id=$1", [originalAuth.id])).rows[0];
  const afterFeedback = (await client.query("select * from feedback.submission where id=$1", [originalFeedback.id])).rows[0];
  assert.deepEqual(strip(afterAuth),originalAuth); assert.deepEqual(strip(afterFeedback),originalFeedback);
  assert.match(afterAuth.audit_id,uuid); assert.match(afterFeedback.audit_id,uuid);
  assert.notEqual(afterAuth.audit_id,afterFeedback.audit_id);
  assert.deepEqual((await client.query("select * from clinical.review_amendment_policy_history where id=$1", [originalNativeUuid.id])).rows[0],originalNativeUuid);
  assert.deepEqual((await client.query("select * from app_identity.role_version where id=any($1::uuid[]) order by id",[beforeVersions.map(row=>row.id)])).rows,beforeVersions);
  assert.deepEqual((await client.query("select * from app_identity.role_version_capability where role_version_id=any($1::uuid[]) order by role_version_id,capability_key",[beforeVersions.map(row=>row.id)])).rows,beforeGrants);
  assert.deepEqual((await client.query("select * from app_identity.user_role_assignment order by id")).rows,beforeAssignments);
  assert.equal((await client.query("select count(*)::int n from app_identity.role_version")).rows[0].n,beforeVersions.length+protectedRoles.length);
  for (const role of protectedRoles) {
    const current = (await client.query(`select v.* from app_identity.role r join app_identity.role_version v on v.id=r.current_version_id where r.id=$1`,[role.id])).rows[0];
    assert.equal(current.version,role.version+1);
    const grants=(await client.query("select capability_key from app_identity.role_version_capability where role_version_id=$1",[current.id])).rows.map(row=>row.capability_key);
    assert.deepEqual(grants.sort(),[...beforeGrants.filter(row=>row.role_version_id===role.current_version_id).map(row=>row.capability_key),"audit:read","audit:identifying"].sort());
  }
  assert.equal((await client.query("select current_version_id from app_identity.role where id=$1",[customRole])).rows[0].current_version_id,customVersion);
  assert.equal((await client.query("select count(*)::int n from app_identity.capability where key='audit:read-identifying'")).rows[0].n,0);
  assert.deepEqual((await client.query("select prerequisite_key from app_identity.capability_prerequisite where capability_key='audit:identifying'")).rows,[{ prerequisite_key:"audit:read" }]);
  await client.query("set role open_triage_api_runtime");
  const can = async(user,key)=>(await client.query("select app_identity.user_has_capability($1,$2,$3) allowed",[user,agency,key])).rows[0].allowed;
  assert.equal(await can(auditor,"audit:identifying"),true);
  for (const user of [owner,superuser,reader]) assert.equal(await can(user,"audit:identifying"),false);
  for (const user of [owner,superuser,auditor]) assert.equal(await can(user,"audit:read"),true);
  assert.equal(await can(reader,"audit:read"),false);
  await client.query("reset role");
  await assert.rejects(client.query("update app_identity.role_version_capability set capability_key=capability_key where role_version_id=$1",[customVersion]),/append-only/);
  await assert.rejects(client.query("update app_identity.capability_prerequisite set prerequisite_key=prerequisite_key where capability_key='audit:identifying'"),/append-only/);
  await assert.rejects(client.query("update app_identity.authentication_event set audit_id=gen_random_uuid() where id=$1",[originalAuth.id]));
  await client.query("begin");
  const invalidVersion=randomUUID();
  await client.query("insert into app_identity.role_version(id,organization_id,role_id,version) values($1,$2,$3,2)",[invalidVersion,agency,customRole]);
  await client.query("insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) values($1,$2,$3,'audit:identifying')",[agency,customRole,invalidVersion]);
  await assert.rejects(client.query("set constraints all immediate"),/missing capability prerequisites/);
  await client.query("rollback");

  await client.query("begin");
  await client.query("set local role open_triage_api_runtime");
  await client.query("select set_config('open_triage.audit_organization_id',$1,true)",[agency]);
  const nextAuth=(await client.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result)
    values($1,$2,'authentication.sign_in','failed') returning audit_id`,[agency,auditor])).rows[0];
  assert.match(nextAuth.audit_id,uuid); assert.notEqual(nextAuth.audit_id,afterAuth.audit_id);
  const inspection=(await client.query(`insert into clinical_audit.audit_read_event
    (organization_id,actor_id,category,from_time,to_time,returned_count,inspection_kind,inspected_source,inspected_event_id,inspected_event_uuid)
    values($1,$2,'feedback',now(),now()+interval '1 second',1,'payload','feedback.submission',$3::text,$3::uuid) returning *`,[agency,auditor,afterFeedback.audit_id])).rows[0];
  assert.match(inspection.audit_id,uuid); assert.equal(inspection.inspected_event_uuid,afterFeedback.audit_id);
  for (const table of ["offline_recovery.event","offline_recovery.key_lifecycle_event","offline_recovery.report_recovery_event"]) await client.query(`select audit_id from ${table} limit 1`);
  await client.query("commit");
  await assert.rejects(client.query("update clinical_audit.audit_read_event set returned_count=returned_count"),/append-only/);
  const freshAgency=randomUUID();
  await client.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Fresh audit agency','UTC')",[freshAgency]);
  for (const system of ["administrator","demo"]) {
    const grants=(await client.query(`select capability_key from app_identity.role r join app_identity.role_version_capability c on c.role_version_id=r.current_version_id
      where r.organization_id=$1 and r.system_key=$2`,[freshAgency,system])).rows.map(row=>row.capability_key);
    assert.ok(grants.includes("audit:read")); assert.ok(grants.includes("audit:identifying"));
  }
  const repeated=[];
  await applyMigrations(client,migrations,{ info(message) { if(message.startsWith("Applying migration")) repeated.push(message); } });
  assert.deepEqual(repeated,[]);
  assert.deepEqual((await client.query("select * from app_identity.authentication_event where id=$1",[originalAuth.id])).rows[0],afterAuth);
  assert.deepEqual((await client.query("select * from clinical_audit.audit_read_event where id=$1",[inspection.id])).rows[0],inspection);
});
