import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { createPasswordVerifier, verifyPassword } from "../dist/identity/password.js";
import { bearerToken, SESSION_COOKIE } from "../dist/sessions/clinician-session.controller.js";
import { ClinicianSessionService, coarseDeviceLabel } from "../dist/sessions/clinician-session.service.js";
import { validateChangePassword, validateReauthenticate } from "../dist/sessions/clinician-session.validation.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");

function instrumentedDataSource(respond) {
  const events = [];
  const manager = { query: async (sql, parameters = []) => {
    const statement = { connection: "transaction-connection", sql: sql.replace(/\s+/g, " ").trim(), parameters };
    events.push(statement);
    if (statement.sql.includes("select * from app_identity.group_authentication_policy")) return [{ group_id: parameters[0], revision: 1, maximum_session_hours: 12, temporary_password_hours: 72, account_attempt_limit: 20, network_attempt_limit: 60 }];
    if (statement.sql.includes("from app_identity.production_workflow_rollout")) return [{group_id: statement.parameters[0], revision:1, enabled_at:null}];
    return respond(statement);
  } };
  return {
    events,
    dataSource: {
      manager: { query: async () => { throw new Error("non-transaction manager must not be used"); } },
      query: async () => { throw new Error("pooled DataSource.query must not be used inside an account operation"); },
      transaction: async (work) => {
        events.push({ connection: "transaction-connection", sql: "begin" });
        try {
          const result = await work(manager);
          events.push({ connection: "transaction-connection", sql: "commit" });
          return result;
        } catch (error) {
          events.push({ connection: "transaction-connection", sql: "rollback" });
          throw error;
        }
      }
    }
  };
}

test("local password verifiers are salted, one-way, and reject the wrong password", async () => {
  const first = await createPasswordVerifier("A strong password! 253");
  const second = await createPasswordVerifier("A strong password! 253");
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /A strong password/);
  assert.equal(await verifyPassword("A strong password! 253", first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword("A strong password! 253", "malformed"), false);
});

test("cookie credentials take precedence and malformed authorization is rejected", () => {
  assert.equal(bearerToken("Bearer legacy", `${SESSION_COOKIE}=opaque-cookie; other=value`), "opaque-cookie");
  assert.equal(bearerToken("Bearer legacy"), "legacy");
  assert.throws(() => bearerToken(undefined), UnauthorizedException);
});

test("session device labels deliberately collapse identifying user-agent detail", () => {
  assert.equal(coarseDeviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.1.9"), "Chrome on Windows");
  assert.equal(coarseDeviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) AppleWebKit Safari/604.1"), "Safari on iOS");
  assert.equal(coarseDeviceLabel("private-client-build/8877"), "Other browser on Other OS");
});

test("password replacement validates a strong new secret and a CSRF proof", () => {
  assert.deepEqual(validateChangePassword({
    currentPassword: "temporary password", newPassword: "replacement password!", csrfToken: "csrf-proof"
  }), { currentPassword: "temporary password", newPassword: "replacement password!", csrfToken: "csrf-proof" });
  assert.throws(() => validateChangePassword({ currentPassword: "old", newPassword: "short", csrfToken: "csrf" }), /12/);
  assert.throws(() => validateChangePassword({ currentPassword: "old", newPassword: "long enough password" }), /CSRF/);
});

test("reauthentication validation accepts only a current password", () => {
  assert.deepEqual(validateReauthenticate({ currentPassword: "current password" }),
    { currentPassword: "current password" });
  assert.throws(() => validateReauthenticate({}), /current password/);
  assert.throws(() => validateReauthenticate({ currentPassword: "password", elevationToken: "forged" }),
    /current password/);
});

test("temporary credentials sign in only before expiry and cannot outlive their replacement window", async () => {
  const password = "Temporary password 42!";
  const verifier = await createPasswordVerifier(password);
  const expiresAt = new Date("2026-09-10T11:00:00.000Z");
  const account = {
    user_id: "user-id", display_name: "New User", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    password_verifier: verifier, must_change_password: true,
    temporary_password_expires_at: expiresAt, credential_version: "1"
  };
  function serviceAtBoundary() {
    const events = [];
    const query = async (sql, parameters = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      events.push({ sql: normalized, parameters });
      if (normalized.includes("from app_identity.production_workflow_rollout")) return [{group_id: parameters[0],revision:1,enabled_at:null}];
      if (normalized.includes("select * from app_identity.group_authentication_policy")) return [{ group_id: parameters[0], revision: 1, maximum_session_hours: 12, temporary_password_hours: 72, account_attempt_limit: 20, network_attempt_limit: 60 }];
      if (normalized.startsWith("select u.id as user_id")) return [account];
      if (normalized.startsWith("insert into app_identity.app_session")) return [{ id: "session-id" }];
      if (normalized.startsWith("select capability.key as capability_key")) return [{ capability_key: "clinical:document" }];
      return [];
    };
    return { events, sessions: new ClinicianSessionService({ query, manager: { query }, transaction: work => work({ query }) }) };
  }
  const before = serviceAtBoundary();
  const rawUserAgent = "Mozilla/5.0 (Windows NT 10.0; identifying-build/8877) Chrome/142.0.1.9";
  const limited = await before.sessions.create({ username: "new.user", password },
    new Date("2026-09-10T10:59:59.999Z"), rawUserAgent);
  assert.equal(limited.session.passwordChangeRequired, true);
  assert.equal(limited.session.expiresAt, expiresAt.toISOString());
  assert.equal("password_verifier" in limited.session, false);
  const insertion = before.events.find(({ sql }) => sql.startsWith("insert into app_identity.app_session"));
  assert.equal(insertion.parameters[6], "Chrome on Windows");
  assert.equal(insertion.parameters.includes(rawUserAgent), false);

  const boundary = serviceAtBoundary();
  await assert.rejects(boundary.sessions.create({ username: "new.user", password }, expiresAt), UnauthorizedException);
  assert.equal(boundary.events.some(({ sql }) => sql.startsWith("insert into app_identity.app_session")), false);
});

test("password replacement commits credential, revocation, audits, and its replacement session on one connection", async () => {
  const currentPassword = "Temporary password 42!";
  const csrfToken = "csrf-proof";
  const verifier = await createPasswordVerifier(currentPassword);
  const now = new Date("2026-09-10T10:00:00.000Z");
  const sessionRow = {
    session_id: "old-session", created_at: now, expires_at: new Date("2026-09-10T22:00:00.000Z"),
    csrf_sha256: digest(csrfToken), session_credential_version: "1", revoked_at: null,
    user_id: "user-id", display_name: "Clinician", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    must_change_password: true, temporary_password_expires_at: new Date("2026-09-10T12:00:00.000Z"),
    credential_version: "1", capabilities: ["clinical:document"]
  };
  const credentialRow = { ...sessionRow, password_verifier: verifier };
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select csrf_sha256")) return [{ csrf_sha256: digest(csrfToken) }];
    if (sql.startsWith("select s.id as session_id")) return [sessionRow];
    if (sql.startsWith("select c.password_verifier")) return [credentialRow];
    if (sql.startsWith("update app_identity.local_credential")) return [[{ credential_version: "2" }], 1];
    if (sql.startsWith("insert into app_identity.app_session")) return [[{ id: "replacement-session" }], 1];
    if (sql.startsWith("select capability.key as capability_key")) return [{ capability_key: "clinical:document" }];
    return [];
  });

  const created = await new ClinicianSessionService(dataSource).changePassword("old-token", {
    currentPassword, newPassword: "Permanent password 84!", csrfToken
  }, now);

  assert.equal(created.session.passwordChangeRequired, false);
  assert.deepEqual(created.session.capabilities, ["clinical:document"]);
  assert.equal(created.session.workspaceAvailable, true);
  assert.equal(events[0].sql, "begin");
  assert.equal(events.at(-1).sql, "commit");
  assert.deepEqual(new Set(events.map(({ connection }) => connection)), new Set(["transaction-connection"]));
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.local_credential")));
  assert.ok(events.some(({ sql }) => sql.includes("revocation_reason = 'password_change'")));
  assert.equal(events.find(({ sql }) => sql.startsWith("insert into app_identity.app_session")).parameters[3], "2");
  assert.deepEqual(events.filter(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"))
    .map(({ parameters }) => parameters[2]), ["authentication.password_change", "authentication.sign_in"]);
});

test("successful reauthentication records five-minute server-side assurance without issuing a token", async () => {
  const currentPassword = "Current password 42!";
  const csrfToken = "csrf-proof";
  const verifier = await createPasswordVerifier(currentPassword);
  const now = new Date("2026-09-10T10:00:00.000Z");
  const sessionRow = {
    session_id: "session", created_at: new Date("2026-09-10T09:00:00.000Z"),
    expires_at: new Date("2026-09-10T22:00:00.000Z"), csrf_sha256: digest(csrfToken),
    session_credential_version: "1", revoked_at: null, user_id: "user-id", display_name: "Owner", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    must_change_password: false, temporary_password_expires_at: null, credential_version: "1"
  };
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select csrf_sha256")) return [{ csrf_sha256: digest(csrfToken) }];
    if (sql.startsWith("select s.id as session_id")) return [sessionRow];
    if (sql.startsWith("select capability.key as capability_key")) return [{ capability_key: "roles:assign" }];
    if (sql.startsWith("select c.password_verifier")) return [{ ...sessionRow, password_verifier: verifier }];
    return [];
  });
  const result = await new ClinicianSessionService(dataSource)
    .reauthenticate("session-token", csrfToken, currentPassword, now);
  assert.deepEqual(result, { reauthenticatedUntil: "2026-09-10T10:05:00.000Z" });
  assert.equal(Object.keys(result).some((key) => /token/i.test(key)), false);
  const assurance = events.find(({ sql }) => sql.startsWith("update app_identity.app_session set reauthenticated_at"));
  assert.deepEqual(assurance.parameters.slice(1), [now]);
  assert.equal(events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event")).parameters[2],
    "authentication.reauthenticate");
  assert.equal(events.at(-1).sql, "commit");
});

test("active zero-role users receive a clear session result but cannot enter a workspace", async () => {
  const now = new Date("2026-09-10T10:00:00.000Z");
  const row = {
    session_id: "session-id", created_at: now, expires_at: new Date("2026-09-10T22:00:00.000Z"),
    csrf_sha256: digest("csrf"), session_credential_version: "1", revoked_at: null,
    user_id: "user-id", display_name: "Unprovisioned", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    must_change_password: false, credential_version: "1"
  };
  const query = async (sql) => sql.includes("from app_identity.production_workflow_rollout") ? [{group_id:"group",revision:1,enabled_at:null}] :
    sql.replace(/\s+/g, " ").trim().startsWith("select s.id as session_id") ? [row] : [];
  const dataSource = { manager: { query }, query };
  const sessions = new ClinicianSessionService(dataSource);

  const current = await sessions.get("token", now, true);
  assert.deepEqual(current.capabilities, []);
  assert.equal(current.workspaceAvailable, false);
  await assert.rejects(sessions.get("token", now), /No workspace role/);
});

test("capabilities are resolved from the current active role version on every request", async () => {
  const now = new Date("2026-09-10T10:00:00.000Z");
  const row = {
    session_id: "session-id", created_at: now, expires_at: new Date("2026-09-10T22:00:00.000Z"),
    csrf_sha256: digest("csrf"), session_credential_version: "1", revoked_at: null,
    user_id: "user-id", display_name: "Role User", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    must_change_password: false, credential_version: "1"
  };
  let capability = "catalog:read";
  const statements = [];
  const dataSource = { manager: { query: async () => [] }, query: async (sql) => {
    if (sql.includes("from app_identity.production_workflow_rollout")) return [{group_id:"group",revision:1,enabled_at:null}];
    const normalized = sql.replace(/\s+/g, " ").trim();
    statements.push(normalized);
    if (normalized.startsWith("select s.id as session_id")) return [row];
    if (normalized.startsWith("select capability.key as capability_key")) return [{ capability_key: capability }];
    return [];
  } };
  dataSource.manager.query = dataSource.query;
  const sessions = new ClinicianSessionService(dataSource);

  assert.deepEqual((await sessions.get("token", now)).capabilities, ["catalog:read"]);
  capability = "forms:read";
  assert.deepEqual((await sessions.get("token", now)).capabilities, ["forms:read"]);
  assert.equal(statements.filter((sql) => sql.startsWith("select capability.key as capability_key")).length, 2);
  assert.ok(statements.every((sql) => !sql.includes("user_capability")));
});

test("a late password replacement audit failure rolls back credentials, revocations, and the replacement session", async () => {
  const currentPassword = "Temporary password 42!";
  const csrfToken = "csrf-proof";
  const verifier = await createPasswordVerifier(currentPassword);
  const now = new Date("2026-09-10T10:00:00.000Z");
  const sessionRow = {
    session_id: "old-session", created_at: now, expires_at: new Date("2026-09-10T22:00:00.000Z"),
    csrf_sha256: digest(csrfToken), session_credential_version: "1", revoked_at: null,
    user_id: "user-id", display_name: "Clinician", active: true,
    organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
    must_change_password: true, temporary_password_expires_at: new Date("2026-09-10T12:00:00.000Z"),
    credential_version: "1", capabilities: ["clinical:document"]
  };
  const failure = new Error("sign-in audit failed");
  const { dataSource, events } = instrumentedDataSource(({ sql, parameters }) => {
    if (sql.startsWith("select csrf_sha256")) return [{ csrf_sha256: digest(csrfToken) }];
    if (sql.startsWith("select s.id as session_id")) return [sessionRow];
    if (sql.startsWith("select c.password_verifier")) return [{ ...sessionRow, password_verifier: verifier }];
    if (sql.startsWith("update app_identity.local_credential")) return [{ credential_version: "2" }];
    if (sql.startsWith("insert into app_identity.app_session")) return [{ id: "replacement-session" }];
    if (sql.startsWith("insert into app_identity.authentication_event") && parameters[2] === "authentication.sign_in") throw failure;
    return [];
  });

  await assert.rejects(new ClinicianSessionService(dataSource).changePassword("old-token", {
    currentPassword, newPassword: "Permanent password 84!", csrfToken
  }, now), (error) => error === failure);
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.local_credential")));
  assert.ok(events.some(({ sql }) => sql.includes("revocation_reason = 'password_change'")));
  assert.ok(events.some(({ sql }) => sql.startsWith("insert into app_identity.app_session")));
  assert.equal(events.at(-1).sql, "rollback");
  assert.equal(events.some(({ sql }) => sql === "commit"), false);
});

test("sign-out revocation and audit commit together and roll back together", async () => {
  const csrfToken = "csrf-proof";
  const respond = (failAudit) => ({ sql }) => {
    if (sql.startsWith("select csrf_sha256")) return [{ csrf_sha256: digest(csrfToken) }];
    if (sql.includes("from app_identity.app_session s")) return [{ session_id: "session-id", user_id: "user-id",
      organization_id: "organization-id", organization_name: "Test", display_name: "User", active: true,
      created_at: new Date(), expires_at: new Date(Date.now()+3600000), credential_version: "1", session_credential_version: "1" }];
    if (sql.startsWith("update app_identity.app_session")) {
      return [{ id: "session-id", user_id: "user-id", organization_id: "organization-id" }];
    }
    if (failAudit && sql.startsWith("insert into app_identity.authentication_event")) throw new Error("audit failed");
    return [];
  };

  const committed = instrumentedDataSource(respond(false));
  await new ClinicianSessionService(committed.dataSource).end("session-token", csrfToken);
  assert.equal(committed.events.at(-1).sql, "commit");
  assert.deepEqual(new Set(committed.events.map(({ connection }) => connection)), new Set(["transaction-connection"]));

  const rolledBack = instrumentedDataSource(respond(true));
  await assert.rejects(new ClinicianSessionService(rolledBack.dataSource).end("session-token", csrfToken), /audit failed/);
  assert.equal(rolledBack.events.at(-1).sql, "rollback");
  assert.equal(rolledBack.events.some(({ sql }) => sql === "commit"), false);
});

test('transactional authority checks do not acquire incidental activity locks; ordinary reads still record activity without renewing proof or expiry',async()=>{
 const now=new Date('2026-10-13T12:00:00Z'),events=[];
 const row={session_id:'session',user_id:'user',display_name:'Person',organization_id:'agency',organization_name:'Agency',active:true,
  created_at:new Date('2026-10-13T08:00:00Z'),expires_at:new Date('2026-10-13T20:00:00Z'),revoked_at:null,
  session_credential_version:'1',credential_version:'1',must_change_password:false,authentication_source:'local',authentication_valid:true,
  personally_authenticated_at:new Date('2026-10-13T08:00:00Z'),personal_authentication_purpose:'login'};
 const manager={queryRunner:{isTransactionActive:true},query:async(sql,parameters)=>{events.push(sql);if(sql.includes('from app_identity.production_workflow_rollout'))return[{group_id:'group',revision:1,enabled_at:null}];if(sql.includes('select s.id as session_id'))return[row];if(sql.includes('select capability.key'))return[{capability_key:'clinical:document'}];return[];}};
 const service=new ClinicianSessionService({manager});const first=await service.getAuthenticated('token',now,false,manager);
 assert.equal(events.some(sql=>sql.includes('set last_activity_at')),false);
 manager.queryRunner.isTransactionActive=false;const second=await service.getAuthenticated('token',now,false,manager);
 assert.equal(events.filter(sql=>sql.includes('set last_activity_at')).length,1);assert.equal(second.expiresAt,first.expiresAt);assert.equal(second.personallyAuthenticatedAt,first.personallyAuthenticatedAt);
});

test('password-free OIDC authentication rejects missing, null or false validated provenance rather than accepting absent local credentials',async()=>{
 const now=new Date('2026-10-13T12:00:00Z');
 const base={session_id:'session',user_id:'user',display_name:'Person',organization_id:'agency',organization_name:'Agency',active:true,
  created_at:new Date('2026-10-13T08:00:00Z'),expires_at:new Date('2026-10-13T20:00:00Z'),revoked_at:null,
  session_credential_version:null,credential_version:null,must_change_password:false,authentication_source:'oidc'};
 for(const authentication_valid of [undefined,null,false]){
  const manager={query:async(sql)=>sql.includes('select s.id as session_id')?[{...base,authentication_valid}]:[]};
  await assert.rejects(new ClinicianSessionService({manager}).getAuthenticated('token',now,false,manager),UnauthorizedException);
 }
 const manager={query:async(sql)=>sql.includes('select s.id as session_id')?[{...base,authentication_source:'local',authentication_valid:undefined}]:[]};
 await assert.rejects(new ClinicianSessionService({manager}).getAuthenticated('token',now,false,manager),UnauthorizedException);
});

test('live local login stamps verified completion using the database clock, including a crossed grace/checkpoint', async () => {
  const password='Verified completion password 42!',completion=new Date(Date.now()+120000),verifier=await createPasswordVerifier(password),events=[];
  const account={user_id:'user-id',display_name:'Clinician',active:true,organization_id:'organization-id',organization_name:'Agency',shift_session_duration_hours:12,password_verifier:verifier,must_change_password:false,credential_version:'1'};
  const query=async(sql,parameters=[])=>{
    const normalized=sql.replace(/\s+/g,' ').trim();events.push({sql:normalized,parameters});
    if(normalized==='select clock_timestamp() as completed_at')return [{completed_at:completion}];
    if(normalized.startsWith('select u.id as user_id'))return [account];
    if(normalized.includes('from app_identity.production_workflow_rollout'))return[{group_id:'group',revision:1,enabled_at:null}];
    if(normalized.includes('select * from app_identity.group_authentication_policy'))return [{maximum_session_hours:12,temporary_password_hours:72,account_attempt_limit:20,network_attempt_limit:60}];
    if(normalized.startsWith('insert into app_identity.app_session'))return [{id:'session'}];
    if(normalized.startsWith('select capability.key'))return [{capability_key:'clinical:document'}];return [];
  };
  const service=new ClinicianSessionService({query,manager:{query},transaction:work=>work({query})});
  const result=await service.create({username:'clinician',password});
  assert.equal(result.session.startedAt,completion.toISOString());
  const issuance=events.find(e=>e.sql.startsWith('insert into app_identity.app_session'));
  assert.equal(issuance.parameters[4].getTime(),completion.getTime());
  assert.match(issuance.sql,/personally_authenticated_at/);
  assert.equal(result.session.expiresAt,new Date(completion.getTime()+12*3600000).toISOString());
});

test('live local reauthentication uses verified completion and rejects expiry during password verification',async()=>{
  const password='Current completion password 42!',csrf='csrf-proof',verifier=await createPasswordVerifier(password),start=new Date(),completion=new Date(start.getTime()+120000);
  const row={session_id:'session',created_at:start,expires_at:new Date(start.getTime()+60000),csrf_sha256:digest(csrf),session_credential_version:'1',credential_version:'1',user_id:'user-id',display_name:'Clinician',active:true,organization_id:'organization-id',organization_name:'Agency',must_change_password:false};
  const {dataSource,events}=instrumentedDataSource(({sql})=>{
    if(sql==='select clock_timestamp() as completed_at')return [{completed_at:completion}];
    if(sql.startsWith('select csrf_sha256'))return [{csrf_sha256:digest(csrf)}];
    if(sql.startsWith('select s.id as session_id'))return [row];
    if(sql.startsWith('select c.password_verifier'))return [{...row,password_verifier:verifier}];
    if(sql.startsWith('select capability.key'))return [{capability_key:'clinical:document'}];return [];
  });
  await assert.rejects(new ClinicianSessionService(dataSource).reauthenticate('token',csrf,password),/session has ended/);
  assert.equal(events.some(e=>e.sql.startsWith('update app_identity.app_session set reauthenticated_at')),false);
  row.expires_at=new Date(start.getTime()+3600000);
  const result=await new ClinicianSessionService(dataSource).reauthenticate('token',csrf,password);
  assert.equal(result.reauthenticatedUntil,new Date(completion.getTime()+300000).toISOString());
  const proof=events.find(e=>e.sql.startsWith('update app_identity.app_session set reauthenticated_at'));
  assert.equal(proof.parameters[1].getTime(),completion.getTime());assert.doesNotMatch(proof.sql,/expires_at\s*=/);
});

test('shift retries can require a new proof without weakening local or regional command validation',()=>{
 assert.deepEqual(validateReauthenticate({currentPassword:'personal',forcePersonalAuthentication:true}),{currentPassword:'personal',forcePersonalAuthentication:true});
 assert.deepEqual(validateReauthenticate({currentPassword:'',forcePersonalAuthentication:true},true),{currentPassword:'',forcePersonalAuthentication:true});
 for(const flag of [false,'true',1,null])assert.throws(()=>validateReauthenticate({currentPassword:'personal',forcePersonalAuthentication:flag}),/current password/);
 assert.throws(()=>validateReauthenticate({currentPassword:'',forcePersonalAuthentication:true}),/current password/);
 assert.throws(()=>validateReauthenticate({currentPassword:'',forcePersonalAuthentication:true,authenticatedAt:'2099-01-01'},true),/current password/);
});

test('password replacement cannot revive temporary authority that expired during verification',async()=>{
 const password='Temporary crossing password 42!',csrf='csrf-crossing',verifier=await createPasswordVerifier(password),start=new Date(),completion=new Date(start.getTime()+120000);
 const row={session_id:'temporary-session',created_at:start,expires_at:new Date(start.getTime()+3600000),csrf_sha256:digest(csrf),session_credential_version:'1',credential_version:'1',user_id:'user-id',display_name:'Clinician',active:true,organization_id:'organization-id',organization_name:'Agency',must_change_password:true,temporary_password_expires_at:new Date(start.getTime()+60000)};
 const {dataSource,events}=instrumentedDataSource(({sql})=>{
  if(sql==='select clock_timestamp() as completed_at')return [{completed_at:completion}];
  if(sql.startsWith('select csrf_sha256'))return [{csrf_sha256:digest(csrf)}];
  if(sql.startsWith('select s.id as session_id'))return [row];
  if(sql.startsWith('select c.password_verifier'))return [{...row,password_verifier:verifier}];
  if(sql.startsWith('select capability.key'))return [{capability_key:'clinical:document'}];return [];
 });
 await assert.rejects(new ClinicianSessionService(dataSource).changePassword('token',{currentPassword:password,newPassword:'Replacement personal password 43!',csrfToken:csrf}),UnauthorizedException);
 assert.equal(events.some(e=>e.sql.startsWith('update app_identity.local_credential')),false);
 assert.equal(events.some(e=>e.sql.startsWith('insert into app_identity.app_session')),false);
});
