import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { SYNTHETIC_DEMO_FIXTURE, compileValidationRule, compiledValidationBundleSha256 } from "@open-triage/contracts";
import pg from "pg";
import { AppModule } from "../dist/app.module.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { encounterDocument } from "../dist/reports/encounter-document.persistence.js";
import { routeDispatchAssignment } from "../dist/dispatch/dispatch-assignment.projection.js";
import {
  DEMO_CLINICIAN_PASSWORD,
  DEMO_CLINICIAN_USERNAME,
  ClinicianSessionService
} from "../dist/sessions/clinician-session.service.js";
import { AccountService } from "../dist/identity/account.service.js";
import { AdminService } from "../dist/admin/admin.service.js";
import { UserProvisioningService } from "../dist/admin/user-provisioning.service.js";
import { UserLifecycleService } from "../dist/admin/user-lifecycle.service.js";
import { UserRoleAssignmentService } from "../dist/admin/user-role-assignment.service.js";
import { SessionAdministrationService } from "../dist/admin/session-administration.service.js";
import { RolePackageService } from "../dist/admin/role-package.service.js";
import { OwnershipTransferService } from "../dist/admin/ownership-transfer.service.js";
import { CatalogAuthoringService } from "../dist/admin/catalog-authoring.service.js";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";
import { AmendReportService } from "../dist/reports/amend-report.service.js";
import { SignReportService } from "../dist/reports/sign-report.service.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;
process.env.PATIENT_KEY_INSTALLATION_ID ??= "91000000-0000-4000-8000-000000000001";
process.env.PATIENT_KEY_VERSION ??= "1";
process.env.PATIENT_KEY_SECRET_BASE64 ??= Buffer.alloc(32, 0x31).toString("base64");

if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for the API PostgreSQL integration suite");
}

const integrationTest = databaseUrl ? test : test.skip;

async function ensureFoundation(client) {
  const existing = await client.query("select to_regclass('forms.form_version') as form_version");
  if (!existing.rows[0].form_version) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8");
    await client.query(migration);
  }
  const identitySessions = await client.query("select to_regclass('app_identity.app_session') as app_session");
  if (!identitySessions.rows[0].app_session) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/20260906193136_identity_sessions.sql"), "utf8");
    await client.query(migration);
  }
  const catalogDrafts = await client.query("select to_regclass('catalog.authoring_draft') as authoring_draft");
  if (!catalogDrafts.rows[0].authoring_draft) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/20260906210000_catalog_authoring.sql"), "utf8");
    await client.query(migration);
  }
  const codeListConfiguration = await client.query("select to_regclass('catalog.value_set_option_configuration') as configuration");
  if (!codeListConfiguration.rows[0].configuration) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/20260906230000_code_list_authoring.sql"), "utf8");
    await client.query(migration);
  }
  const inlineCodeListConfiguration = await client.query("select to_regclass('catalog.element_option_configuration') as configuration");
  if (!inlineCodeListConfiguration.rows[0].configuration) {
    const migration = await readFile(path.join(repoRoot,
      "supabase/migrations/20260908114126_catalog_requiredness_and_inline_options.sql"), "utf8");
    await client.query(migration);
  }
  const formRevision = await client.query(`select 1 from information_schema.columns
    where table_schema='forms' and table_name='form_version' and column_name='revision'`);
  if (!formRevision.rows[0]) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/20260907010000_form_authoring.sql"), "utf8");
    await client.query(migration);
  }
  const agencyDefault = await client.query("select to_regclass('forms.agency_stationary_default') as agency_default");
  if (!agencyDefault.rows[0].agency_default) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/20260907020000_form_activation_default.sql"), "utf8");
    await client.query(migration);
  }
  const reportPinValidator = await client.query(
    "select to_regprocedure('clinical.validate_report_configuration_pin()') as validator"
  );
  if (!reportPinValidator.rows[0].validator) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260907030000_preserve_report_configuration_pins.sql"),
      "utf8"
    );
    await client.query(migration);
  }
  const versionDisplayNames = await client.query(`select 1 from information_schema.columns
    where table_schema='forms' and table_name='form_version' and column_name='display_name'`);
  if (!versionDisplayNames.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260908144514_version_display_names.sql"),
      "utf8"
    );
    await client.query(migration);
  }
  const roleAuthorization = await client.query("select to_regclass('app_identity.role') as role");
  if (!roleAuthorization.rows[0].role) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911164417_role_resolved_authorization.sql"), "utf8"
    );
    await client.query(migration);
  }
  const installationOwner = await client.query("select to_regclass('app_identity.installation_owner') as owner");
  if (!installationOwner.rows[0].owner) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911171505_single_installation_owner.sql"), "utf8"
    );
    await client.query(migration);
  }
  const temporaryCredentialExpiry = await client.query(`select 1 from information_schema.columns
    where table_schema='app_identity' and table_name='local_credential'
      and column_name='temporary_password_expires_at'`);
  if (!temporaryCredentialExpiry.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911180000_expiring_temporary_credentials.sql"), "utf8"
    );
    await client.query(migration);
  }
  const userLifecycleRevision = await client.query(`select 1 from information_schema.columns
    where table_schema='app_identity' and table_name='app_user' and column_name='revision'`);
  if (!userLifecycleRevision.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911220000_safe_user_lifecycle.sql"), "utf8"
    );
    await client.query(migration);
  }
  const customRoleAuthoring = await client.query(
    "select to_regprocedure('app_identity.prevent_protected_role_shadow()') as validator"
  );
  if (!customRoleAuthoring.rows[0].validator) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911200000_custom_role_authoring.sql"), "utf8"
    );
    await client.query(migration);
  }
  const roleVersionPresentation = await client.query(`select 1 from information_schema.columns
    where table_schema='app_identity' and table_name='role_version' and column_name='display_name'`);
  if (!roleVersionPresentation.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911230000_role_retirement_history.sql"), "utf8"
    );
    await client.query(migration);
  }
  const recentReauthentication = await client.query(`select 1 from information_schema.columns
    where table_schema='app_identity' and table_name='app_session' and column_name='reauthenticated_at'`);
  if (!recentReauthentication.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911231000_role_assignment_reauthentication.sql"), "utf8"
    );
    await client.query(migration);
  }
  const sessionActivity = await client.query(`select 1 from information_schema.columns
    where table_schema='app_identity' and table_name='app_session' and column_name='last_activity_at'`);
  if (!sessionActivity.rows[0]) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911240000_session_administration.sql"), "utf8"
    );
    await client.query(migration);
  }
  const portableRoleActions = await client.query(`select pg_get_constraintdef(oid) definition
    from pg_constraint where conname = 'authorization_event_action_check'
      and conrelid = 'app_identity.authorization_event'::regclass`);
  if (!portableRoleActions.rows[0]?.definition.includes("role.package_import")) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911250000_portable_role_packages.sql"), "utf8"
    );
    await client.query(migration);
  }
  const ownershipTransfer = await client.query("select to_regclass('app_identity.ownership_transfer') as transfer");
  if (!ownershipTransfer.rows[0].transfer) {
    const migration = await readFile(
      path.join(repoRoot, "supabase/migrations/20260911260000_ownership_transfer_nominations.sql"), "utf8"
    );
    await client.query(migration);
  }
  await client.query(`alter table app_identity.authentication_event drop constraint authentication_event_action_check,
    add constraint authentication_event_action_check check (action in (
      'account.provision', 'account.reset_password', 'account.identity_change', 'account.disable',
      'account.reactivate', 'account.roles_change', 'authentication.sign_in',
      'authentication.password_change', 'authentication.reauthenticate', 'authentication.sign_out',
      'authentication.session_revoke'
    ))`);
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  if (!release.rows[0]) {
    await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/load-nemsis-catalog.mjs")], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });
  }
}

function singleClientDataSource(client) {
  const manager = { query: async (sql, parameters) => {
    const result = await client.query(sql, parameters);
    // Match TypeORM's PostgreSQL QueryRunner contract. Direct mutations expose
    // [returnedRows, affectedRowCount], while SELECT and CTE statements expose rows.
    return /^\s*(insert|update|delete)\b/i.test(sql)
      ? [result.rows, result.rowCount ?? 0]
      : result.rows;
  } };
  return {
    manager,
    query: manager.query,
    transaction: async (isolationOrWork, optionalWork) => {
      const work = optionalWork ?? isolationOrWork;
      await client.query("begin");
      try {
        const result = await work(manager);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  };
}

async function ensureSyntheticOwner(client) {
  const existing = await client.query(
    "select user_id from app_identity.installation_owner where organization_id = $1",
    [SYNTHETIC_DEMO_FIXTURE.organizationId]
  );
  if (existing.rows[0]) return existing.rows[0].user_id;
  const owner = await new AccountService(singleClientDataSource(client)).bootstrapOwner({
    organizationId: SYNTHETIC_DEMO_FIXTURE.organizationId,
    username: `integration.synthetic.owner.${randomUUID()}`,
    displayName: "Synthetic integration owner",
    temporaryPassword: "Temporary!Synthetic-Owner-253",
    clinician: false,
    operator: { operatorId: "integration-synthetic-setup", osAccount: "test", host: "localhost" }
  });
  return owner.userId;
}

integrationTest("portable role packages round-trip atomically with immediate authority and preserved assignments", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const organizationId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Portable roles', 'UTC')",
    [organizationId]);
  const owner = await accounts.bootstrapOwner({ organizationId, username: `portable.owner.${randomUUID()}`,
    displayName: "Portable Owner", clinician: false, temporaryPassword: "Temporary!Portable-Owner-253",
    operator: { operatorId: "integration-portable-owner", osAccount: "test", host: "localhost" } });
  const temporary = await sessions.create({ username: owner.username, password: "Temporary!Portable-Owner-253" });
  const active = await sessions.changePassword(temporary.sessionToken, {
    currentPassword: "Temporary!Portable-Owner-253", newPassword: "Permanent!Portable-Owner-253",
    csrfToken: temporary.session.csrfToken
  });
  await sessions.reauthenticate(active.sessionToken, active.session.csrfToken, "Permanent!Portable-Owner-253");
  const packages = new RolePackageService(database, sessions);
  const roleId = randomUUID();
  const firstVersionId = randomUUID();
  const secondVersionId = randomUUID();
  const firstPackage = { schema: "open-triage.custom-roles", schemaVersion: "1.0.0", roles: [{
    id: roleId, currentVersionId: firstVersionId, versions: [{ id: firstVersionId, version: 1,
      displayName: "Portable Dispatch", description: null, capabilityKeys: ["users:read"] }] }] };
  assert.equal((await packages.import(active.sessionToken, firstPackage)).createdRoleCount, 1);
  const assigneeId = randomUUID();
  await client.query(`insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Portable assignee')`,
    [assigneeId, organizationId]);
  await client.query(`insert into app_identity.user_role_assignment
    (organization_id, user_id, role_id, assigned_by) values ($1, $2, $3, $4)`,
  [organizationId, assigneeId, roleId, owner.userId]);
  const secondPackage = { ...firstPackage, roles: [{ ...firstPackage.roles[0], currentVersionId: secondVersionId,
    versions: [...firstPackage.roles[0].versions, { id: secondVersionId, version: 2,
      displayName: "Portable Dispatch", description: "Portable update",
      capabilityKeys: ["users:read", "users:write"] }] }] };
  const preview = await packages.preview(active.sessionToken, secondPackage);
  assert.deepEqual(preview.capabilityChanges, [{ roleId, added: ["users:write"], removed: [], affectedAssigneeCount: 1 }]);
  await packages.import(active.sessionToken, secondPackage);
  assert.equal((await client.query(`select count(*)::integer count from app_identity.user_role_assignment
    where organization_id = $1 and user_id = $2 and role_id = $3 and ended_at is null`,
  [organizationId, assigneeId, roleId])).rows[0].count, 1);
  assert.equal((await client.query(
    "select app_identity.user_has_capability($1, $2, 'users:write') allowed", [assigneeId, organizationId]
  )).rows[0].allowed, true);
  const exported = await packages.export(active.sessionToken);
  assert.deepEqual(exported.roles.find(({ id }) => id === roleId), secondPackage.roles[0]);
  assert.equal((await packages.preview(active.sessionToken, exported)).unchangedRoleCount, exported.roles.length);
  const audits = await client.query(`select action, details from app_identity.authorization_event
    where organization_id = $1 and action like 'role.package_%' order by id`, [organizationId]);
  assert.ok(audits.rows.some(({ action }) => action === "role.package_import"));
  assert.doesNotMatch(JSON.stringify(audits.rows), /Portable Dispatch|Portable update|users:write|assigneeId/i);
});

integrationTest("provisioned local accounts require password replacement and use durable revocable sessions", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const organizationId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Local identity', 'UTC')", [organizationId]);

  const installationOwner = await accounts.bootstrapOwner({
    organizationId, username: `owner.${randomUUID()}`, displayName: "Installation Owner",
    clinician: false, temporaryPassword: "Temporary!Password-253",
    operator: { operatorId: "integration-owner-bootstrap", osAccount: "test", host: "localhost" }
  });
  const ownerTemporary = await sessions.create({ username: installationOwner.username, password: "Temporary!Password-253" });
  const ownerSession = await sessions.changePassword(ownerTemporary.sessionToken, {
    currentPassword: "Temporary!Password-253", newPassword: "Permanent!Owner-Password-253",
    csrfToken: ownerTemporary.session.csrfToken
  });
  const administratorRole = await client.query(
    "select id from app_identity.role where organization_id = $1 and system_key = 'administrator'", [organizationId]
  );
  const provisioningNow = new Date();
  await sessions.reauthenticate(ownerSession.sessionToken, ownerSession.session.csrfToken,
    "Permanent!Owner-Password-253", provisioningNow);
  const provisioned = await new UserProvisioningService(database, sessions).provision(ownerSession.sessionToken, {
    username: `admin.${randomUUID()}`, displayName: "Recoverable Administrator",
    roleIds: [administratorRole.rows[0].id], temporaryPassword: "Temporary!Password-253",
    temporaryPasswordHours: 1, note: "Integration provisioning"
  }, provisioningNow);
  const credential = await client.query(
    "select username, password_verifier, must_change_password, temporary_password_expires_at from app_identity.local_credential where user_id = $1",
    [provisioned.userId]
  );
  assert.equal(credential.rows[0].must_change_password, true);
  assert.doesNotMatch(credential.rows[0].password_verifier, /Temporary!Password-253/);
  assert.equal(new Date(credential.rows[0].temporary_password_expires_at).toISOString(),
    provisioned.temporaryPasswordExpiresAt);

  const beforeExpiry = new Date(credential.rows[0].temporary_password_expires_at.getTime() - 1);
  const boundarySession = await sessions.create({ username: provisioned.username, password: "Temporary!Password-253" }, beforeExpiry);
  assert.equal(boundarySession.session.expiresAt, credential.rows[0].temporary_password_expires_at.toISOString());
  await assert.rejects(sessions.create({ username: provisioned.username, password: "Temporary!Password-253" },
    credential.rows[0].temporary_password_expires_at), UnauthorizedException);

  const limited = await sessions.create({ username: provisioned.username, password: "Temporary!Password-253" });
  assert.equal(limited.session.passwordChangeRequired, true);
  assert.equal(limited.session.accessToken, undefined);
  assert.ok(limited.session.capabilities.includes("admin-dashboard:read"));
  await assert.rejects(sessions.get(limited.sessionToken), /password change is required/i);

  const active = await sessions.changePassword(limited.sessionToken, {
    currentPassword: "Temporary!Password-253", newPassword: "Permanent!Password-253",
    csrfToken: limited.session.csrfToken
  });
  assert.equal(active.session.passwordChangeRequired, false);
  await assert.rejects(sessions.get(limited.sessionToken), UnauthorizedException);
  assert.equal((await sessions.get(active.sessionToken)).organization.id, organizationId);
  assert.equal((await sessions.requireCapability(active.sessionToken, "admin-dashboard:read")).user.id, provisioned.userId);
  const clinicianRole = await client.query(
    "select id from app_identity.role where organization_id = $1 and system_key = 'clinician'", [organizationId]
  );
  const clinician = await new UserProvisioningService(database, sessions).provision(active.sessionToken, {
    username: `clinician.${randomUUID()}`, displayName: "Clinician Assigned During Creation",
    roleIds: [clinicianRole.rows[0].id], temporaryPassword: "Temporary!Clinician-253"
  });
  assert.deepEqual(clinician.roleIds, [clinicianRole.rows[0].id]);
  const unassigned = await new UserProvisioningService(database, sessions).provision(active.sessionToken, {
    username: `unassigned.${randomUUID()}`, displayName: "Clinician Assigned Later",
    roleIds: [], temporaryPassword: "Temporary!Unassigned-253"
  });
  const assigned = await new UserRoleAssignmentService(database, sessions).replace(active.sessionToken,
    unassigned.userId, { expectedRevision: 1, roleIds: [clinicianRole.rows[0].id] });
  assert.deepEqual(assigned.addedRoles.map(({ id }) => id), [clinicianRole.rows[0].id]);
  await assert.rejects(sessions.get(active.sessionToken, new Date(active.session.expiresAt)), UnauthorizedException);
  await assert.rejects(sessions.end(active.sessionToken, "forged-csrf"), /CSRF/);
  await sessions.end(active.sessionToken, active.session.csrfToken);
  await assert.rejects(sessions.get(active.sessionToken), UnauthorizedException);

  const beforeReset = await sessions.create({ username: provisioned.username, password: "Permanent!Password-253" });
  await assert.rejects(sessions.create({ username: provisioned.username, password: "wrong password value" }), UnauthorizedException);
  await accounts.resetUserPassword(provisioned.userId, "Reset!Temporary-Password-253",
    { operatorId: "integration-user-recovery", osAccount: "test", host: "localhost" });
  await assert.rejects(sessions.get(beforeReset.sessionToken), UnauthorizedException);
  const reset = await sessions.create({ username: provisioned.username, password: "Reset!Temporary-Password-253" });
  assert.equal(reset.session.passwordChangeRequired, true);
  assert.deepEqual(await accounts.resetOwnerPassword(organizationId, "Reset!Owner-Password-253",
    { operatorId: "integration-owner-recovery", osAccount: "test", host: "localhost" }),
  { organizationId, userId: installationOwner.userId });
  await client.query("update app_identity.app_user set active = false, deactivated_at = now() where id = $1", [provisioned.userId]);
  await assert.rejects(sessions.get(reset.sessionToken, new Date(), true), UnauthorizedException);
  await assert.rejects(sessions.create({ username: provisioned.username, password: "Reset!Temporary-Password-253" }), UnauthorizedException);

  const audit = await client.query(
    "select action, result, details::text from app_identity.authentication_event where target_user_id = $1 order by id",
    [provisioned.userId]
  );
  assert.ok(audit.rows.some(({ action, result }) => action === "authentication.password_change" && result === "succeeded"));
  assert.ok(audit.rows.some(({ action }) => action === "account.reset_password"));
  assert.ok(audit.rows.every(({ details }) => !/Password-253|token|csrf/i.test(details)));
  const operatorAudit = await client.query(`select command,target_organization_id,target_user_id,
    operator_id,os_account,host,result from app_identity.operator_identity_event
    where target_organization_id = $1 order by id`, [organizationId]);
  assert.ok(operatorAudit.rows.some((event) => event.command === "user.reset_password"
    && event.target_user_id === provisioned.userId && event.operator_id === "integration-user-recovery"
    && event.os_account === "test" && event.host === "localhost" && event.result === "succeeded"));
  assert.ok(operatorAudit.rows.some((event) => event.command === "owner.reset_password"
    && event.target_user_id === installationOwner.userId && event.operator_id === "integration-owner-recovery"
    && event.os_account === "test" && event.host === "localhost" && event.result === "succeeded"));
  assert.doesNotMatch(JSON.stringify(operatorAudit.rows), /Reset!|password_verifier|token|csrf|secret/i);
  await assert.rejects(client.query("update app_identity.authentication_event set result = 'failed' where target_user_id = $1", [provisioned.userId]));
});

integrationTest("session administration identifies current devices, contains individual sessions, and resets stale access", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const administration = new SessionAdministrationService(database, sessions);
  const organizationId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Session administration', 'UTC')", [organizationId]);
  const owner = await accounts.bootstrapOwner({ organizationId, username: `owner.${randomUUID()}`,
    displayName: "Session Owner", clinician: false, temporaryPassword: "Temporary!Owner-Password-253",
    operator: { operatorId: "session-integration", osAccount: "test", host: "localhost" } });
  const ownerTemporary = await sessions.create({ username: owner.username, password: "Temporary!Owner-Password-253" },
    new Date(), "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0.1.9");
  const ownerSession = await sessions.changePassword(ownerTemporary.sessionToken, {
    currentPassword: "Temporary!Owner-Password-253", newPassword: "Permanent!Owner-Password-253",
    csrfToken: ownerTemporary.session.csrfToken
  }, new Date(), "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0.1.9");
  const ownerView = await administration.list(ownerSession.sessionToken, owner.userId);
  assert.equal(ownerView.items.length, 1);
  assert.equal(ownerView.items[0].current, true);
  assert.equal(ownerView.items[0].deviceLabel, "Chrome on Windows");
  assert.equal("sourceIp" in ownerView.items[0] || "geolocation" in ownerView.items[0], false);
  await assert.rejects(administration.revoke(ownerSession.sessionToken, owner.userId, ownerView.items[0].id, {}),
    ConflictException);

  const clinicianRole = await client.query(
    "select id from app_identity.role where organization_id = $1 and system_key = 'clinician'", [organizationId]
  );
  const target = await new UserProvisioningService(database, sessions).provision(ownerSession.sessionToken, {
    username: `medic.${randomUUID()}`, displayName: "Session Medic", roleIds: [clinicianRole.rows[0].id],
    temporaryPassword: "Temporary!Medic-Password-253", temporaryPasswordHours: 72
  });
  const targetTemporary = await sessions.create({ username: target.username, password: "Temporary!Medic-Password-253" },
    new Date(), "Mozilla/5.0 (X11; Linux x86_64) Firefox/145.0");
  const firstTargetSession = await sessions.changePassword(targetTemporary.sessionToken, {
    currentPassword: "Temporary!Medic-Password-253", newPassword: "Permanent!Medic-Password-253",
    csrfToken: targetTemporary.session.csrfToken
  }, new Date(), "Mozilla/5.0 (X11; Linux x86_64) Firefox/145.0");
  const secondTargetSession = await sessions.create({ username: target.username, password: "Permanent!Medic-Password-253" },
    new Date(), "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) AppleWebKit Safari/604.1");
  const targetView = await administration.list(ownerSession.sessionToken, target.userId);
  assert.equal(targetView.items.length, 2);
  assert.ok(targetView.items.every(({ current }) => !current));
  assert.deepEqual(new Set(targetView.items.map(({ deviceLabel }) => deviceLabel)),
    new Set(["Firefox on Linux", "Safari on iOS"]));

  const contained = await administration.revoke(ownerSession.sessionToken, target.userId, targetView.items[0].id, {});
  assert.equal(contained.alreadyRevoked, false);
  assert.equal((await administration.revoke(ownerSession.sessionToken, target.userId, targetView.items[0].id, {})).alreadyRevoked, true);
  const reset = await administration.resetCredential(ownerSession.sessionToken, target.userId, {
    expectedRevision: 1, temporaryPassword: "Reset!Medic-Password-253", temporaryPasswordHours: 24
  });
  assert.equal(reset.revision, 2);
  assert.equal(reset.active, true);
  assert.equal(reset.sessionsRevoked, 1);
  await assert.rejects(sessions.get(firstTargetSession.sessionToken), UnauthorizedException);
  await assert.rejects(sessions.get(secondTargetSession.sessionToken), UnauthorizedException);
  assert.equal((await sessions.create({ username: target.username,
    password: "Reset!Medic-Password-253" })).session.passwordChangeRequired, true);

  const audits = await client.query(`select action, details::text from app_identity.authentication_event
    where target_user_id = $1 and action in ('authentication.session_revoke', 'account.reset_password') order by id`,
  [target.userId]);
  assert.deepEqual(audits.rows.map(({ action }) => action), ["authentication.session_revoke", "account.reset_password"]);
  assert.doesNotMatch(JSON.stringify(audits.rows), /password_verifier|token_sha256|csrf_sha256|source.?ip|geolocation|patient|Reset!Medic/i);
});

integrationTest("user lifecycle is atomic, permanently reserves names, revokes sessions, preserves credentials, and rejects stale concurrent writes", async (t) => {
  const firstClient = new pg.Client({ connectionString: databaseUrl });
  const secondClient = new pg.Client({ connectionString: databaseUrl });
  await Promise.all([firstClient.connect(), secondClient.connect()]);
  t.after(() => Promise.all([firstClient.end(), secondClient.end()]));
  await ensureFoundation(firstClient);
  const firstDatabase = singleClientDataSource(firstClient);
  const secondDatabase = singleClientDataSource(secondClient);
  const accounts = new AccountService(firstDatabase);
  const ownerSessions = new ClinicianSessionService(firstDatabase);
  const organizationId = randomUUID();
  await firstClient.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Lifecycle', 'UTC')", [organizationId]);
  const owner = await accounts.bootstrapOwner({ organizationId, username: `lifecycle.owner.${randomUUID()}`,
    displayName: "Lifecycle Owner", clinician: false, temporaryPassword: "Temporary!Owner-Lifecycle-253",
    operator: { operatorId: "integration-lifecycle-owner", osAccount: "test", host: "localhost" } });
  const ownerTemporary = await ownerSessions.create({ username: owner.username, password: "Temporary!Owner-Lifecycle-253" });
  const ownerSession = await ownerSessions.changePassword(ownerTemporary.sessionToken, {
    currentPassword: "Temporary!Owner-Lifecycle-253", newPassword: "Permanent!Owner-Lifecycle-253",
    csrfToken: ownerTemporary.session.csrfToken
  });
  const clinicianRole = (await firstClient.query(
    "select id from app_identity.role where organization_id = $1 and system_key = 'clinician'", [organizationId]
  )).rows[0].id;
  const originalUsername = `lifecycle.user.${randomUUID()}`;
  const renamedUsername = `lifecycle.renamed.${randomUUID()}`;
  const target = await new UserProvisioningService(firstDatabase, ownerSessions).provision(ownerSession.sessionToken, {
    username: originalUsername, displayName: "Lifecycle User", roleIds: [clinicianRole],
    temporaryPassword: "Temporary!Lifecycle-User-253", temporaryPasswordHours: 2, note: "Lifecycle integration"
  });
  const targetSessions = new ClinicianSessionService(firstDatabase);
  const targetTemporary = await targetSessions.create({ username: originalUsername, password: "Temporary!Lifecycle-User-253" });
  const targetActive = await targetSessions.changePassword(targetTemporary.sessionToken, {
    currentPassword: "Temporary!Lifecycle-User-253", newPassword: "Permanent!Lifecycle-User-253",
    csrfToken: targetTemporary.session.csrfToken
  });
  const verifierBefore = (await firstClient.query(
    "select password_verifier, credential_version from app_identity.local_credential where user_id = $1", [target.userId]
  )).rows[0];

  const lifecycle = new UserLifecycleService(firstDatabase, ownerSessions);
  const disabled = await lifecycle.update(ownerSession.sessionToken, target.userId, {
    expectedRevision: 1, username: renamedUsername, displayName: "Lifecycle Renamed", roleIds: [clinicianRole],
    active: false, note: "Planned leave"
  });
  assert.equal(disabled.sessionsRevoked, 1);
  assert.equal(disabled.revision, 2);
  await assert.rejects(targetSessions.get(targetActive.sessionToken), UnauthorizedException);
  await assert.rejects(targetSessions.create({ username: originalUsername, password: "Permanent!Lifecycle-User-253" }), UnauthorizedException);
  await assert.rejects(targetSessions.create({ username: renamedUsername, password: "Permanent!Lifecycle-User-253" }), UnauthorizedException);
  const retained = await firstClient.query(`select role_id from app_identity.user_role_assignment
    where user_id = $1 and ended_at is null`, [target.userId]);
  assert.deepEqual(retained.rows.map(({ role_id }) => role_id), [clinicianRole]);

  const reactivated = await lifecycle.update(ownerSession.sessionToken, target.userId, {
    expectedRevision: 2, username: renamedUsername, displayName: "Lifecycle Renamed", roleIds: [clinicianRole],
    active: true, note: "Return to duty"
  });
  assert.deepEqual(reactivated.restoredRoles.map(({ id }) => id), [clinicianRole]);
  assert.equal(reactivated.freshLoginRequired, true);
  const verifierAfter = (await firstClient.query(
    "select password_verifier, credential_version from app_identity.local_credential where user_id = $1", [target.userId]
  )).rows[0];
  assert.deepEqual(verifierAfter, verifierBefore);
  assert.equal((await targetSessions.create({ username: renamedUsername, password: "Permanent!Lifecycle-User-253" })).session.user.id,
    target.userId);
  await assert.rejects(targetSessions.create({ username: originalUsername, password: "Permanent!Lifecycle-User-253" }), UnauthorizedException);
  await assert.rejects(new UserProvisioningService(firstDatabase, ownerSessions).provision(ownerSession.sessionToken, {
    username: originalUsername, displayName: "Username Reuse", roleIds: [],
    temporaryPassword: "Temporary!Username-Reuse-253", temporaryPasswordHours: 1
  }), /reserved/i);

  const update = (database, displayName) => new UserLifecycleService(database,
    new ClinicianSessionService(database)).update(ownerSession.sessionToken, target.userId, {
      expectedRevision: 3, username: renamedUsername, displayName, roleIds: [clinicianRole], active: true,
      note: "Concurrent edit"
    });
  const concurrent = await Promise.allSettled([
    update(firstDatabase, "Concurrent One"), update(secondDatabase, "Concurrent Two")
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
  assert.match(String(concurrent.find(({ status }) => status === "rejected").reason), /changed after it was loaded/);
  assert.equal((await firstClient.query("select revision from app_identity.app_user where id = $1", [target.userId])).rows[0].revision, "4");
  const audit = await firstClient.query(`select action, note, details from app_identity.authentication_event
    where target_user_id = $1 and action in ('account.disable', 'account.reactivate', 'account.identity_change') order by id`,
  [target.userId]);
  assert.deepEqual(audit.rows.map(({ action }) => action), ["account.disable", "account.reactivate", "account.identity_change"]);
  assert.doesNotMatch(JSON.stringify(audit.rows), /password|verifier|token|csrf|secret/i);
});

integrationTest("concurrent owner bootstrap leaves exactly one fully privileged protected owner", async (t) => {
  const firstClient = new pg.Client({ connectionString: databaseUrl });
  const secondClient = new pg.Client({ connectionString: databaseUrl });
  await Promise.all([firstClient.connect(), secondClient.connect()]);
  t.after(() => Promise.all([firstClient.end(), secondClient.end()]));
  await ensureFoundation(firstClient);
  const organizationId = randomUUID();
  await firstClient.query(`insert into app_identity.organization (id, name, deployment_timezone)
    values ($1, 'Concurrent owner bootstrap', 'UTC')`, [organizationId]);
  const preSetupAdmin = await new AccountService(singleClientDataSource(firstClient)).provision({
    organizationId, username: `pre.setup.${randomUUID()}`, displayName: "Pre-setup administrator",
    role: "administrator", temporaryPassword: "Temporary!Password-pre-setup"
  });
  assert.equal((await firstClient.query(
    "select app_identity.user_has_capability($1, $2, 'admin-dashboard:read') allowed",
    [preSetupAdmin.userId, organizationId])).rows[0].allowed, false);
  assert.equal((await firstClient.query(
    "select app_identity.user_has_capability($1, $2, 'clinical:document') allowed",
    [preSetupAdmin.userId, organizationId])).rows[0].allowed, false);
  const input = (suffix) => ({
    organizationId, username: `owner.${suffix}.${randomUUID()}`, displayName: `Owner ${suffix}`,
    temporaryPassword: `Temporary!Password-${suffix}-253`, clinician: false,
    operator: { operatorId: `integration-${suffix}`, osAccount: "test", host: "localhost" }
  });
  const attempts = await Promise.allSettled([
    new AccountService(singleClientDataSource(firstClient)).bootstrapOwner(input("one")),
    new AccountService(singleClientDataSource(secondClient)).bootstrapOwner(input("two"))
  ]);
  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);

  const owner = (await firstClient.query(`select owner_record.user_id
    from app_identity.installation_owner owner_record where organization_id = $1`, [organizationId])).rows[0];
  assert.ok(owner.user_id);
  assert.equal((await firstClient.query(`select app_identity.user_has_capability($1, $2, 'admin-dashboard:read') allowed`,
    [owner.user_id, organizationId])).rows[0].allowed, true);
  assert.equal((await firstClient.query(`select app_identity.user_has_capability($1, $2, 'clinical:document') allowed`,
    [owner.user_id, organizationId])).rows[0].allowed, true);
  assert.equal((await firstClient.query(`select app_identity.user_has_capability($1, $2, 'clinical:demo') allowed`,
    [owner.user_id, organizationId])).rows[0].allowed, true);
  assert.equal((await firstClient.query(`select count(*)::integer count
    from app_identity.user_role_assignment where organization_id = $1 and user_id = $2 and ended_at is null`,
    [organizationId, owner.user_id])).rows[0].count, 0);
  assert.equal((await firstClient.query(`select count(*)::integer count from app_identity.installation_owner
    where organization_id = $1`, [organizationId])).rows[0].count, 1);
  assert.deepEqual((await firstClient.query(`select result from app_identity.operator_identity_event
    where target_organization_id = $1 order by id`, [organizationId])).rows.map(({ result }) => result).sort(),
  ["failed", "succeeded"]);

  await assert.rejects(firstClient.query("delete from app_identity.installation_owner where organization_id = $1",
    [organizationId]), /cannot be removed/);
  await assert.rejects(firstClient.query("update app_identity.app_user set active = false where id = $1",
    [owner.user_id]), /cannot be disabled/);
  await assert.rejects(firstClient.query("delete from app_identity.local_credential where user_id = $1",
    [owner.user_id]), /credential cannot be removed/);
});

integrationTest("ownership moves only after an eligible nominee independently accepts", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const transfers = new OwnershipTransferService(database, sessions);
  const organizationId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Transfer test', 'UTC')",
    [organizationId]);
  const owner = await accounts.bootstrapOwner({ organizationId, username: `owner.${randomUUID()}`,
    displayName: "Transfer Owner", temporaryPassword: "Temporary!Owner-Transfer-253", clinician: false,
    operator: { operatorId: "integration-owner-transfer", osAccount: "test", host: "localhost" } });
  const nominee = await accounts.provision({ organizationId, username: `nominee.${randomUUID()}`,
    displayName: "Transfer Nominee", role: "administrator", temporaryPassword: "Temporary!Nominee-Transfer-253" });
  const ownerTemporary = await sessions.create({ username: owner.username, password: "Temporary!Owner-Transfer-253" });
  const ownerSession = await sessions.changePassword(ownerTemporary.sessionToken, {
    currentPassword: "Temporary!Owner-Transfer-253", newPassword: "Permanent!Owner-Transfer-253",
    csrfToken: ownerTemporary.session.csrfToken
  });
  const nomineeTemporary = await sessions.create({ username: nominee.username, password: "Temporary!Nominee-Transfer-253" });
  const nomineeSession = await sessions.changePassword(nomineeTemporary.sessionToken, {
    currentPassword: "Temporary!Nominee-Transfer-253", newPassword: "Permanent!Nominee-Transfer-253",
    csrfToken: nomineeTemporary.session.csrfToken
  });
  await sessions.reauthenticate(ownerSession.sessionToken, ownerSession.session.csrfToken,
    "Permanent!Owner-Transfer-253");
  const pending = await transfers.initiate(ownerSession.sessionToken, { nomineeUserId: nominee.userId });
  assert.equal(pending.transfer.status, "pending");
  assert.equal((await client.query("select user_id from app_identity.installation_owner where organization_id = $1",
    [organizationId])).rows[0].user_id, owner.userId);
  await sessions.reauthenticate(nomineeSession.sessionToken, nomineeSession.session.csrfToken,
    "Permanent!Nominee-Transfer-253");
  const accepted = await transfers.accept(nomineeSession.sessionToken);
  assert.equal(accepted.owner.id, nominee.userId);
  assert.equal((await client.query("select count(*)::integer count from app_identity.installation_owner where organization_id = $1",
    [organizationId])).rows[0].count, 1);
  assert.equal((await client.query(`select count(*)::integer count
    from app_identity.user_role_assignment where organization_id = $1 and user_id = $2 and ended_at is null`,
  [organizationId, nominee.userId])).rows[0].count, 0);
  assert.equal((await client.query(`select app_identity.user_has_capability($1, $2, 'clinical:demo') allowed`,
    [nominee.userId, organizationId])).rows[0].allowed, true);
});

integrationTest("authorized Admin context resolves only the session organization's active configuration", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const admin = new AdminService(database, sessions);
  const organizationId = randomUUID();
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const unitId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Admin shell', 'UTC')", [organizationId]);
  const owner = await accounts.bootstrapOwner({
    organizationId, username: `admin.${randomUUID()}`, displayName: "Installation Owner",
    clinician: false, temporaryPassword: "Temporary!Password-254",
    operator: { operatorId: "integration-owner-bootstrap", osAccount: "test", host: "localhost" }
  });
  const temporary = await sessions.create({ username: owner.username, password: "Temporary!Password-254" });
  const active = await sessions.changePassword(temporary.sessionToken, {
    currentPassword: "Temporary!Password-254", newPassword: "Permanent!Password-254",
    csrfToken: temporary.session.csrfToken
  });
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1' limit 1");
  await client.query(`insert into app_identity.agency_demographic_version
    (organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,
     definition_sha256,effective_from,created_by)
    values ($1,$2,1,'INTEGRATION-AGENCY','INTEGRATION-AGENCY-ID','00',$3,now(),$4)`,
  [organizationId, release.rows[0].id, "c".repeat(64), owner.userId]);
  const activeFormDefinition = { schemaVersion: 1, sections: [
    { key: "dispatch", fields: [{ key: "dispatch-complaint", source: { kind: "nemsis", elementId: "eDispatch.01" } }] },
    { key: "patient", fields: [{ key: "patient-name", source: { kind: "nemsis", elementId: "ePatient.01" } }] },
    { key: "situation", fields: [{ key: "situation-date", source: { kind: "nemsis", elementId: "eSituation.01" } }] }
  ] };
  const activeFormDigest = canonicalDefinitionSha256(activeFormDefinition);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, 'stationary', 'Agency Stationary')", [formId, organizationId]);
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
     change_note, created_by, published_by, published_at)
    values ($1, $2, $3, 3, 'published', $4::jsonb, $5, 'Admin shell fixture', $6, $6, now())`,
  [formVersionId, formId, release.rows[0].id, JSON.stringify(activeFormDefinition), activeFormDigest, owner.userId]);
  await client.query(`insert into app_identity.operational_unit
    (id, organization_id, call_sign, name, default_form_id)
    values ($1, $2, 'ADMIN-254', 'Admin shell unit', $3)`, [unitId, organizationId, formId]);
  await client.query(`insert into forms.agency_stationary_default
    (organization_id, form_version_id, activated_by) values ($1, $2, $3)`, [organizationId, formVersionId, owner.userId]);

  const context = await admin.context(active.sessionToken);
  assert.equal(context.owner.id, owner.userId);
  assert.equal(context.organization.id, organizationId);
  assert.deepEqual(context.activeConfiguration, {
    catalog: { id: release.rows[0].id, name: "NEMSIS 3.5.1", standard: "NEMSIS", version: "3.5.1" },
    stationaryForm: { id: formVersionId, formId, name: "Agency Stationary", version: 3 }
  });

  const manager = { query: async (sql, parameters) => (await client.query(sql, parameters)).rows };
  const transactionalDatabase = {
    manager,
    query: manager.query,
    transaction: async (_isolation, work) => {
      await client.query("begin");
      try { const result = await work(manager); await client.query("commit"); return result; }
      catch (error) { await client.query("rollback"); throw error; }
    }
  };
  const activationForms = new FormAuthoringService(transactionalDatabase, sessions, {});
  const activation = await activationForms.activate(active.sessionToken, formVersionId, { changeNote: "Confirm agency default" });
  assert.equal(activation.formVersionId, formVersionId);
  assert.equal(activation.previousFormVersionId, formVersionId);
  const activationAudit = await client.query(`select action,actor_id,form_version_id,catalog_release_id,
    previous_form_version_id,change_note,content_sha256 from app_identity.configuration_event
    where organization_id=$1 order by id desc limit 1`, [organizationId]);
  assert.deepEqual(activationAudit.rows[0], { action: "form.activate", actor_id: owner.userId,
    form_version_id: formVersionId, catalog_release_id: release.rows[0].id,
    previous_form_version_id: formVersionId, change_note: "Confirm agency default",
    content_sha256: activeFormDigest });
  await assert.rejects(client.query("update app_identity.configuration_event set change_note='changed' where organization_id=$1",
    [organizationId]));
  const auditedFormDraft = await activationForms.clone(active.sessionToken, {
    catalogReleaseId: release.rows[0].id, displayName: "Integration form draft"
  });
  const savedAuditedFormDraft = await activationForms.save(active.sessionToken, auditedFormDraft.id, {
    expectedRevision: auditedFormDraft.revision, displayName: "Integration form draft", definition: auditedFormDraft.definition
  });
  await assert.rejects(activationForms.delete(active.sessionToken, auditedFormDraft.id, {
    expectedRevision: auditedFormDraft.revision
  }), /revision is stale/i);
  await activationForms.delete(active.sessionToken, auditedFormDraft.id, { expectedRevision: savedAuditedFormDraft.revision });
  const formDraftAudit = await client.query(`select action,form_version_id,details
    from app_identity.configuration_event
    where organization_id=$1 and action like 'form.draft_%' order by id`, [organizationId]);
  assert.deepEqual(formDraftAudit.rows.map(({ action, form_version_id, details }) => ({
    action, form_version_id, revision: details.revision,
    deletedFormVersionId: details.deletedFormVersionId ?? null
  })), [
    { action: "form.draft_create", form_version_id: null, revision: 1, deletedFormVersionId: null },
    { action: "form.draft_save", form_version_id: null, revision: 2, deletedFormVersionId: null },
    { action: "form.draft_delete", form_version_id: null, revision: 2, deletedFormVersionId: auditedFormDraft.id }
  ]);
  const authoring = new CatalogAuthoringService(transactionalDatabase, sessions);
  const draft = await authoring.cloneActive(active.sessionToken, {
    sourceVersionId: release.rows[0].id, displayName: "Integration catalog"
  });
  assert.equal(draft.revision, 1);
  const changedElement = draft.definition.elements[0];
  const changedList = draft.definition.codeLists.find((list) => list.classification !== "inline");
  assert.ok(changedList, "the NEMSIS catalog should expose a recommended list");
  const changedInlineList = draft.definition.codeLists.find((list) => list.elementIds.includes("eAirway.03"));
  assert.ok(changedInlineList, "eAirway.03 should expose its inline enumeration by element identifier");
  const disabledValue = changedList.values[0];
  const disabledInlineValue = changedInlineList.values[0];
  const customText = { id: randomUUID(), namespace: "org.integration.ems", slug: `Note${randomUUID().replaceAll("-", "")}`,
    title: "Local note", definition: "A locally requested clinical note.", datatype: "string", recurrence: "single",
    usage: "Required", constraints: { minLength: 2, maxLength: 100 }, identifying: false };
  const identifyingText = { ...customText, id: randomUUID(), slug: `Private${randomUUID().replaceAll("-", "")}`,
    title: "Private note", identifying: true };
  const binaryElement = { ...customText, id: randomUUID(), slug: `Binary${randomUUID().replaceAll("-", "")}`,
    title: "Local binary", datatype: "binary", constraints: {}, identifying: true };
  const otherElement = { ...customText, id: randomUUID(), slug: `Other${randomUUID().replaceAll("-", "")}`,
    title: "Other result", datatype: "other", constraints: { minLength: 2, maxLength: 100 } };
  const customGroup = { id: randomUUID(), namespace: "org.integration.ems",
    slug: `ResultGroup${randomUUID().replaceAll("-", "")}`, title: "Grouped result", recurrence: "multiple" };
  const groupedText = { ...customText, id: randomUUID(), slug: `GroupedNote${randomUUID().replaceAll("-", "")}`,
    title: "Grouped note", usage: "Optional", groupDefinitionId: customGroup.id };
  const localValue = { code: `LOCAL-${randomUUID()}`, codeSystem: "Local identity", label: "Locally managed choice",
    sourceLabel: "Locally managed choice", category: null, enabled: true, nemsisCode: disabledValue.code };
  const changedDefinition = { ...draft.definition, customElements: [customText, identifyingText, binaryElement, otherElement, groupedText],
    customGroups: [customGroup], elements: draft.definition.elements.map((element) =>
    element.elementId === changedElement.elementId ? { ...element, label: `${element.label} (agency label)` } : element),
    codeLists: draft.definition.codeLists.map((list) => list.listId === changedList.listId ? { ...list,
      values: [localValue, ...list.values.map((value) => value.code === disabledValue.code && value.codeSystem === disabledValue.codeSystem
        ? { ...value, label: `${value.label} (agency label)`, enabled: false } : value)],
      defaultValue: null } : list.listId === changedInlineList.listId
      ? { ...list, values: list.values.map((value) => value.code === disabledInlineValue.code && value.codeSystem === disabledInlineValue.codeSystem
        ? { ...value, label: `${value.label} (agency label)`, enabled: false } : value) } : list) };
  const saved = await authoring.save(active.sessionToken, draft.id, { expectedRevision: 1, displayName: "Integration catalog", definition: changedDefinition });
  await assert.rejects(authoring.save(active.sessionToken, draft.id, { expectedRevision: 1, displayName: "Integration catalog", definition: changedDefinition }),
    /revision is stale/i);
  const validation = await authoring.validate(active.sessionToken, draft.id);
  assert.equal(validation.valid, true);
  assert.equal(validation.projectionsVerified, true);
  const published = await authoring.publish(active.sessionToken, draft.id, {
    expectedRevision: saved.revision, definitionSha256: saved.definitionSha256,
    displayName: "Integration catalog",
    changeNote: "Agency validation acceptance journey"
  });
  assert.equal(published.projectionsVerified, true);
  const publishedDataModel = await client.query(
    "select provenance->>'dataModelVersion' as version, display_name from catalog.release where id=$1",
    [published.id]
  );
  assert.equal(publishedDataModel.rows[0].version, "3.5.1");
  assert.equal(publishedDataModel.rows[0].display_name, "Integration catalog");
  const publishedCustom = await client.query(`select ced.id,ced.identifying,ced.definition->>'usage' as usage
    from forms.custom_element_definition ced where ced.id=$1`, [customText.id]);
  assert.deepEqual(publishedCustom.rows, [{ id: customText.id, identifying: false, usage: "Required" }]);
  const elementLabels = await client.query(`select
    (select name from catalog.element_definition where release_id=$1 and element_id=$3) source_label,
    (select name from catalog.element_definition where release_id=$2 and element_id=$3) published_label`,
  [release.rows[0].id, published.id, changedElement.elementId]);
  assert.equal(elementLabels.rows[0].source_label, changedElement.label);
  assert.equal(elementLabels.rows[0].published_label, `${changedElement.label} (agency label)`);
  const carriedDemographics = await client.query(`select catalog_release_id,dagency_01,dagency_02,dagency_04,created_by
    from app_identity.agency_demographic_version
    where organization_id=$1 and catalog_release_id=$2`, [organizationId, published.id]);
  assert.deepEqual(carriedDemographics.rows, [{
    catalog_release_id: published.id,
    dagency_01: "INTEGRATION-AGENCY",
    dagency_02: "INTEGRATION-AGENCY-ID",
    dagency_04: "00",
    created_by: owner.userId
  }]);
  const sourceCode = await client.query(`select o.display, coalesce(c.enabled, true) enabled from catalog.value_set_option o
    left join catalog.value_set_option_configuration c using (release_id, value_set_id, code_system, code)
    where o.release_id=$1 and o.value_set_id=$2 and o.code_system=$3 and o.code=$4`,
  [release.rows[0].id, changedList.listId, disabledValue.codeSystem, disabledValue.code]);
  const publishedCodes = await client.query(`select o.code, o.display, c.enabled, c.sort_order, c.is_default
    from catalog.value_set_option o join catalog.value_set_option_configuration c using (release_id, value_set_id, code_system, code)
    where o.release_id=$1 and o.value_set_id=$2 and ((o.code_system=$3 and o.code=$4) or o.code=$5) order by c.sort_order`,
  [published.id, changedList.listId, disabledValue.codeSystem, disabledValue.code, localValue.code]);
  assert.equal(sourceCode.rows[0].display, disabledValue.label);
  assert.equal(sourceCode.rows[0].enabled, true);
  assert.deepEqual(publishedCodes.rows, [
    { code: localValue.code, display: localValue.label, enabled: true, sort_order: 0, is_default: false },
    { code: disabledValue.code, display: `${disabledValue.label} (agency label)`, enabled: false, sort_order: 1, is_default: false }
  ]);
  const publishedInlineCode = await client.query(`select o.display,c.enabled,c.sort_order
    from catalog.element_option o join catalog.element_option_configuration c
      using (release_id,element_id,source_kind,code_system,code)
    where o.release_id=$1 and o.element_id='eAirway.03' and o.code_system=$2 and o.code=$3`,
  [published.id, disabledInlineValue.codeSystem, disabledInlineValue.code]);
  assert.deepEqual(publishedInlineCode.rows[0], {
    display: `${disabledInlineValue.label} (agency label)`, enabled: false, sort_order: 0
  });
  await assert.rejects(client.query("update catalog.element_definition set name='mutated' where release_id=$1 and element_id=$2",
    [published.id, changedElement.elementId]), /immutable/);
  await assert.rejects(client.query(`insert into catalog.element_option
    (release_id, element_id, source_kind, code, display, code_system) values ($1,$2,'inline','late-code','Late','')`,
    [published.id, changedElement.elementId]), /sealed and immutable/);
  await assert.rejects(client.query("update catalog.value_set_option set display='mutated' where release_id=$1 and value_set_id=$2",
    [published.id, changedList.listId]), /immutable/);
  await assert.rejects(client.query("update catalog.value_set_option_configuration set enabled=true where release_id=$1 and value_set_id=$2",
    [published.id, changedList.listId]), /immutable/);
  await assert.rejects(client.query("update catalog.element_option_configuration set enabled=true where release_id=$1 and element_id='eAirway.03'",
    [published.id]), /immutable/);
  const event = await client.query("select result, change_note from catalog.publication_event where release_id=$1", [published.id]);
  assert.deepEqual(event.rows[0], { result: "succeeded", change_note: "Agency validation acceptance journey" });

  const forms = new FormAuthoringService(transactionalDatabase, sessions,
    new FormPublicationService(transactionalDatabase));
  const formDraft = await forms.clone(active.sessionToken, {
    catalogReleaseId: published.id, displayName: "Agency Stationary validation draft"
  });
  assert.equal(formDraft.catalogReleaseId, published.id);
  assert.equal(formDraft.clonedFromId, formVersionId);
  assert.deepEqual({ ...formDraft.definition, sections: formDraft.definition.sections.map((section) => ({ ...section,
    fields: section.fields.map(({ choicePolicy: _choicePolicy, ...field }) => field) })) }, activeFormDefinition);
  assert.deepEqual(formDraft.diagnostics, []);
  const customChoices = await forms.searchCatalog(active.sessionToken, formDraft.id,
    { query: customText.slug.toLowerCase() });
  assert.ok(customChoices.items.some((item) => item.customElementDefinitionId === customText.id));
  const editedFormDefinition = { ...formDraft.definition,
    sections: [{ ...formDraft.definition.sections[2], fields: [...formDraft.definition.sections[2].fields,
      { key: "local-note", source: { kind: "custom", elementDefinitionId: customText.id } },
      { key: "private-note", source: { kind: "custom", elementDefinitionId: identifyingText.id } },
      { key: "local-binary", source: { kind: "custom", elementDefinitionId: binaryElement.id } },
      { key: "local-other", source: { kind: "custom", elementDefinitionId: otherElement.id } }] },
    formDraft.definition.sections[0],
    { key: "custom-results", name: "Custom results", fields: [{ key: "grouped-note",
      source: { kind: "custom", elementDefinitionId: groupedText.id, groupDefinitionId: customGroup.id } }] }] };
  const formSaved = await forms.save(active.sessionToken, formDraft.id, {
    expectedRevision: formDraft.revision, definition: editedFormDefinition
  });
  assert.equal(formSaved.revision, formDraft.revision + 1);
  assert.deepEqual(formSaved.definition.sections.map(({ key }) => key), ["situation", "dispatch", "custom-results"]);
  const persistedFormDraft = await forms.current(active.sessionToken);
  assert.deepEqual(persistedFormDraft.definition.sections.map(({ key }) => key), ["situation", "dispatch", "custom-results"]);
  assert.equal(persistedFormDraft.definition.sections.some(({ key }) => key === "patient"), false);
  await assert.rejects(forms.save(active.sessionToken, formDraft.id, {
    expectedRevision: formDraft.revision, definition: formDraft.definition
  }), /revision is stale/i);
  const sourceAfterClone = await client.query(`select catalog_release_id,canonical_definition,status
    from forms.form_version where id=$1`, [formVersionId]);
  assert.deepEqual(sourceAfterClone.rows[0], {
    catalog_release_id: release.rows[0].id, canonical_definition: activeFormDefinition, status: "published"
  });
  await assert.rejects(client.query("update forms.form_version set canonical_definition='{}' where id=$1", [formVersionId]),
    /immutable/);
  const customPublishedForm = await forms.publish(active.sessionToken, formDraft.id, {
    expectedRevision: formSaved.revision, definitionSha256: formSaved.definitionSha256,
    displayName: "Agency Stationary validation draft", changeNote: "Add local note"
  });
  const projectedCustom = await client.query(`select custom_element_definition_id,analytical_repeatable
    from forms.form_field where form_version_id=$1 and stable_key='local-note'`, [customPublishedForm.id]);
  assert.deepEqual(projectedCustom.rows, [{ custom_element_definition_id: customText.id, analytical_repeatable: false }]);
  const groupedField = (await client.query(`select id,custom_element_definition_id,custom_group_definition_id
    from forms.form_field where form_version_id=$1 and stable_key='grouped-note'`, [customPublishedForm.id])).rows[0];
  assert.deepEqual({ element: groupedField.custom_element_definition_id, group: groupedField.custom_group_definition_id },
    { element: groupedText.id, group: customGroup.id });
  assert.equal((await client.query(`select s.stable_key from forms.form_field f
    join forms.form_section s on s.id=f.section_id
    where f.form_version_id=$1 and f.stable_key='grouped-note'`, [customPublishedForm.id])).rows[0].stable_key, "custom-results");
  const reportId = randomUUID(); const incidentId = randomUUID(); const patientId = randomUUID();
  await client.query("insert into clinical.incident(id,organization_id) values ($1,$2)", [incidentId, organizationId]);
  await client.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key)
    values ($1,$2,'unknown',$3)`, [patientId, organizationId, randomUUID().replaceAll("-", "").repeat(2)]);
  const demographics = (await client.query(`select id from app_identity.agency_demographic_version
    where organization_id=$1 and catalog_release_id=$2 order by version desc limit 1`, [organizationId, published.id])).rows[0];
  await client.query(`insert into clinical.report
    (id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,
     catalog_release_id,documenting_user_id,form_definition_sha256,catalog_artifact_sha256)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [reportId, organizationId, incidentId, patientId,
    demographics.id, customPublishedForm.id, published.id, owner.userId, customPublishedForm.definitionSha256,
    published.definitionSha256]);
  const clinician = new DraftReportService(transactionalDatabase, { requireCapability: async () =>
    ({ organization: { id: organizationId }, user: { id: owner.userId } }) });
  const groupId = randomUUID();
  const customGroupInstanceId = randomUUID();
  const groupedOccurrenceId = randomUUID();
  const fields = [customText, identifyingText, binaryElement, otherElement].map((item) => ({ id: randomUUID(),
    elementId: `${item.namespace}.${item.slug}`, groupInstanceId: groupId, ordinal: 0,
    value: item.datatype === "binary" ? { kind: "binary", value: "AAEC/w==" }
      : { kind: "text", value: item.identifying ? "Private response" : item.datatype === "other" ? "Other response" : "Public response" } }));
  await assert.rejects(clinician.save("session", reportId, {
    commandId: randomUUID(), expectedRevision: 0, authorId: owner.userId,
    occurrences: [{ ...fields[0], value: { kind: "text", value: "x" } }]
  }), /published text constraints/);
  await assert.rejects(clinician.save("session", reportId, {
    commandId: randomUUID(), expectedRevision: 0, authorId: owner.userId,
    occurrences: [{ ...fields[2], value: { kind: "binary", value: "AAEC/w=" } }]
  }), /base64/);
  const documented = await clinician.save("session", reportId, {
    commandId: randomUUID(), expectedRevision: 0, authorId: owner.userId,
    groups: [{ id: groupId, groupId: "PatientCareReportGroup", ordinal: 0 },
      { id: customGroupInstanceId, groupId: `${customGroup.namespace}.${customGroup.slug}`,
        customGroupDefinitionId: customGroup.id, parentGroupInstanceId: groupId, ordinal: 0 }],
    occurrences: [...fields, { id: groupedOccurrenceId, elementId: `${groupedText.namespace}.${groupedText.slug}`,
      formFieldId: groupedField.id, groupInstanceId: customGroupInstanceId, ordinal: 0,
      value: { kind: "text", value: "Pinned grouped response" } }]
  });
  assert.equal(documented.revision, 1);
  const correctedGroupedValue = "Corrected grouped response";
  const corrected = await clinician.save("session", reportId, {
    commandId: randomUUID(), expectedRevision: documented.revision, authorId: owner.userId,
    occurrences: [{ id: groupedOccurrenceId, elementId: `${groupedText.namespace}.${groupedText.slug}`,
      formFieldId: groupedField.id, groupInstanceId: customGroupInstanceId, ordinal: 0,
      value: { kind: "text", value: correctedGroupedValue } }]
  });
  assert.equal(corrected.revision, 2);
  const reopened = await clinician.get("session", reportId);
  assert.deepEqual(reopened.groups.filter(({ id }) => id === customGroupInstanceId)
    .map(({ id, parentGroupInstanceId, groupId: key, customGroupDefinitionId, sourceKind }) =>
      ({ id, parentGroupInstanceId, groupId: key, customGroupDefinitionId, sourceKind })), [{
    id: customGroupInstanceId, parentGroupInstanceId: groupId,
    groupId: `${customGroup.namespace}.${customGroup.slug}`, customGroupDefinitionId: customGroup.id,
    sourceKind: "custom"
  }]);
  assert.deepEqual(reopened.occurrences.filter(({ id }) => id === groupedOccurrenceId)
    .map(({ id, groupInstanceId, elementIdentityId, elementId, formFieldId, valueText }) =>
      ({ id, groupInstanceId, elementIdentityId, elementId, formFieldId, valueText })), [{
    id: groupedOccurrenceId, groupInstanceId: customGroupInstanceId, elementIdentityId: groupedText.id,
    elementId: `${groupedText.namespace}.${groupedText.slug}`, formFieldId: groupedField.id,
    valueText: correctedGroupedValue
  }]);
  assert.ok(reopened.occurrences.some(({ elementId, valueBinary, identifying }) =>
    elementId === `${binaryElement.namespace}.${binaryElement.slug}` && valueBinary === "AAEC/w==" && identifying));
  assert.ok(reopened.occurrences.some(({ elementId, valueText }) =>
    elementId === `${otherElement.namespace}.${otherElement.slug}` && valueText === "Other response"));
  assert.deepEqual(reopened.occurrences.filter(({ elementId }) => elementId.startsWith("org.integration.ems."))
    .filter(({ elementId }) => [customText, identifyingText].some((item) => elementId === `${item.namespace}.${item.slug}`))
    .map(({ elementId, identifying, valueText }) => ({ elementId, identifying, valueText }))
    .sort((a, b) => a.valueText.localeCompare(b.valueText)), [
      { elementId: `${identifyingText.namespace}.${identifyingText.slug}`, identifying: true, valueText: "Private response" },
      { elementId: `${customText.namespace}.${customText.slug}`, identifying: false, valueText: "Public response" }
    ]);
  const recoveredDocument = await encounterDocument(transactionalDatabase.manager, reportId);
  assert.deepEqual(recoveredDocument.groups.find(({ id }) => id === `${customGroup.namespace}.${customGroup.slug}`)?.instances
    .map(({ instanceId, parentInstanceId, elements }) => ({ instanceId, parentInstanceId,
      elements: elements.map(({ id, values }) => ({ id, values: values.map(({ occurrenceId, kind, value }) =>
        ({ occurrenceId, kind, value })) })) })), [{
    instanceId: customGroupInstanceId, parentInstanceId: groupId,
    elements: [{ id: `${groupedText.namespace}.${groupedText.slug}`,
      values: [{ occurrenceId: groupedOccurrenceId, kind: "scalar", value: correctedGroupedValue }] }]
  }]);
  assert.ok(recoveredDocument.groups.find(({ id }) => id === "PatientCareReportGroup")?.instances[0]?.elements
    .some(({ id, values }) => id === `${customText.namespace}.${customText.slug}` && values[0]?.kind === "scalar" && values[0].value === "Public response"));
  assert.ok(recoveredDocument.groups.find(({ id }) => id === "PatientCareReportGroup")?.instances[0]?.elements
    .some(({ id, values }) => id === `${binaryElement.namespace}.${binaryElement.slug}` && values[0]?.kind === "scalar" && values[0].value === "AAEC/w=="));
  assert.ok(recoveredDocument.groups.find(({ id }) => id === "PatientCareReportGroup")?.instances[0]?.elements
    .some(({ id, values }) => id === `${otherElement.namespace}.${otherElement.slug}` && values[0]?.kind === "scalar" && values[0].value === "Other response"));
  const revisedFormDraft = await forms.clone(active.sessionToken, {
    catalogReleaseId: published.id, sourceVersionId: customPublishedForm.id, displayName: "Form without grouped results"
  });
  const revisedForm = await forms.save(active.sessionToken, revisedFormDraft.id, {
    expectedRevision: revisedFormDraft.revision,
    definition: { ...revisedFormDraft.definition,
      sections: revisedFormDraft.definition.sections.filter(({ key }) => key !== "custom-results") }
  });
  const publishedRevision = await forms.publish(active.sessionToken, revisedFormDraft.id, {
    expectedRevision: revisedForm.revision, definitionSha256: revisedForm.definitionSha256,
    displayName: "Form without grouped results", changeNote: "Historical report readability regression"
  });
  assert.notEqual(publishedRevision.id, customPublishedForm.id);
  const historical = await clinician.get("session", reportId);
  assert.equal(historical.formVersionId, customPublishedForm.id);
  assert.equal(historical.occurrences.find(({ id }) => id === groupedOccurrenceId)?.valueText, correctedGroupedValue);
  const historicalDocument = await encounterDocument(transactionalDatabase.manager, reportId);
  assert.equal(historicalDocument.groups.find(({ id }) => id === `${customGroup.namespace}.${customGroup.slug}`)
    ?.instances[0]?.elements[0]?.values[0]?.kind, "scalar");
  const analyticalColumns = await client.query(`select table_schema,column_name from information_schema.columns
    where table_name='epcr' and table_schema in ('analytics_private','analytics_pseudonymous')
      and column_name in ('additional_elements','additional_identifying_elements')`);
  assert.ok(analyticalColumns.rows.some(({ table_schema, column_name }) =>
    table_schema === "analytics_private" && column_name === "additional_identifying_elements"));
  assert.equal(analyticalColumns.rows.some(({ table_schema, column_name }) =>
    table_schema === "analytics_pseudonymous" && column_name === "additional_identifying_elements"), false);
});

integrationTest("a catalog-bound Validation draft publishes immutably and activates against its compatible form", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = singleClientDataSource(client);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const sectionId = randomUUID();
  await client.query("insert into app_identity.organization(id,name,deployment_timezone) values ($1,'Validation integration','UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user(id,organization_id,display_name) values ($1,$2,'Validation administrator')",
    [userId, organizationId]);
  const release = (await client.query("select id from catalog.release where standard='NEMSIS' and version='3.5.1' limit 1")).rows[0];
  const element = (await client.query(`select element_id,element_identity_id from catalog.element_definition
    where release_id=$1 order by element_id limit 1`, [release.id])).rows[0];
  const definition = { schemaVersion: 1, sections: [{ key: "required", fields: [
    { key: element.element_id, source: { kind: "nemsis", elementId: element.element_id } }
  ] }] };
  const digest = canonicalDefinitionSha256(definition);
  await client.query("insert into forms.form(id,organization_id,slug,name) values ($1,$2,'stationary','Stationary')", [formId, organizationId]);
  await client.query(`insert into forms.form_version(id,form_id,catalog_release_id,version,status,canonical_definition,
    definition_sha256,created_by) values ($1,$2,$3,1,'draft',$4::jsonb,$5,$6)`,
  [formVersionId, formId, release.id, JSON.stringify(definition), digest, userId]);
  await client.query("insert into forms.form_section(id,form_version_id,stable_key,position) values ($1,$2,'required',0)",
    [sectionId, formVersionId]);
  await client.query(`insert into forms.form_field(form_version_id,section_id,stable_key,position,source_kind,
    catalog_element_identity_id,analytical_repeatable) values ($1,$2,$3,0,'nemsis',$4,false)`,
  [formVersionId, sectionId, element.element_id, element.element_identity_id]);
  await client.query(`update forms.form_version set status='published',change_note='fixture',published_by=$2,published_at=now()
    where id=$1`, [formVersionId, userId]);
  await client.query(`insert into forms.agency_stationary_default(organization_id,form_version_id,activated_by)
    values ($1,$2,$3)`, [organizationId, formVersionId, userId]);
  const sessions = { requireCapability: async () => ({ organization: { id: organizationId }, user: { id: userId } }) };
  const validations = new ValidationAuthoringService(database, sessions);
  const created = await validations.create("session", { catalogReleaseId: release.id, displayName: "Required fields" });
  const authored = await validations.createRule("session", created.id, {
    expectedRevision: created.revision, name: "Integration reference rule", enabled: true, severity: "error",
    executionTargets: ["live", "sign"], primaryTargetElementId: element.element_id,
    message: "The integration element is required", source: `require present("${element.element_id}")`
  });
  const prepared = await validations.save("session", authored.id, {
    expectedRevision: authored.revision, displayName: authored.displayName,
    rules: authored.rules.map((rule) => rule.name === "Integration reference rule" ? rule : { ...rule, enabled: false })
  });
  const checked = await validations.validate("session", prepared.id);
  assert.equal(checked.valid, true);
  const published = await validations.publish("session", prepared.id, {
    expectedRevision: prepared.revision, displayName: prepared.displayName, changeNote: "Architecture-reviewed first rule"
  });
  const activated = await validations.activate("session", published.id, {
    formVersionId, catalogReleaseId: release.id, changeNote: "Activate first required rule"
  });
  assert.equal(activated.formVersionId, formVersionId);
  assert.equal(activated.catalogReleaseId, release.id);
  assert.equal(activated.formDefinitionSha256, digest);
  await assert.rejects(client.query("update validation.version set display_name='mutated' where id=$1", [published.id]),
    /published validation versions are immutable/);
  assert.equal((await client.query("select validation_version_id from validation.active_version where organization_id=$1",
    [organizationId])).rows[0].validation_version_id, published.id);
  assert.match(published.sourceSha256, /^[a-f0-9]{64}$/);

  const cloned = await validations.clone("session", published.id, {
    catalogReleaseId: release.id, displayName: "Revised required fields"
  });
  assert.equal(cloned.clonedFromId, published.id);
  assert.equal(cloned.diagnostics.some(({ severity }) => severity === "error"), false);
  const custom = cloned.rules.find(({ name }) => name === "Integration reference rule");
  assert.ok(custom);
  const revisedRules = cloned.rules.map((rule) => rule.id === custom.id
    ? { ...rule, name: "Historical integration reference", enabled: false, executionTargets: ["review"] }
    : rule);
  const saved = await validations.save("session", cloned.id, {
    expectedRevision: cloned.revision, displayName: cloned.displayName, rules: revisedRules
  });
  await assert.rejects(validations.save("session", cloned.id, {
    expectedRevision: cloned.revision, displayName: cloned.displayName, rules: revisedRules
  }), ConflictException);
  const republished = await validations.publish("session", saved.id, {
    expectedRevision: saved.revision, displayName: saved.displayName, changeNote: "Retire integration reference"
  });
  const immutable = await client.query(`select source_sha256,compiled_sha256,cloned_from_id
    from validation.version where id=$1`, [republished.id]);
  assert.deepEqual(immutable.rows[0], {
    source_sha256: republished.sourceSha256, compiled_sha256: republished.compiledSha256, cloned_from_id: published.id
  });
  const history = await validations.history("session");
  const revisionEvent = history.find(({ destinationVersionId, action }) =>
    destinationVersionId === republished.id && action === "validation.publish");
  assert.equal(revisionEvent.actorId, userId);
  assert.equal(revisionEvent.changeNote, "Retire integration reference");
  assert.deepEqual(revisionEvent.ruleChanges.disablements, [{ ruleId: custom.id }]);
  assert.deepEqual(revisionEvent.ruleChanges.executionTargetChanges,
    [{ ruleId: custom.id, before: ["live", "sign"], after: ["review"] }]);

  const agencyVersionId = randomUUID();
  await client.query(`insert into app_identity.agency_demographic_version
    (id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,
     definition_sha256,effective_from,created_by)
    values ($1,$2,$3,1,'BUNDLE-AGENCY','BUNDLE-ID','00',$4,now(),$5)`,
  [agencyVersionId, organizationId, release.id, "d".repeat(64), userId]);
  const createPinnedReport = async (pins) => {
    const incidentId = randomUUID();
    const patientId = randomUUID();
    const reportId = randomUUID();
    await client.query("insert into clinical.incident(id,organization_id) values ($1,$2)", [incidentId, organizationId]);
    await client.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key)
      values ($1,$2,'unknown',$3)`, [patientId, organizationId, randomUUID().replaceAll("-", "").repeat(2)]);
    await client.query(`insert into clinical.report
      (id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,
       catalog_release_id,validation_version_id,documenting_user_id,form_definition_sha256,
       catalog_artifact_sha256,validation_compiled_sha256)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [reportId, organizationId, incidentId, patientId, agencyVersionId, pins.formVersionId,
      pins.catalogReleaseId, pins.validationVersionId, userId, pins.formDefinitionSha256,
      pins.catalogArtifactSha256, pins.validationCompiledSha256]);
    return reportId;
  };
  const firstReportId = await createPinnedReport(activated);

  const revisedActivation = await validations.activate("session", republished.id, {
    formVersionId, catalogReleaseId: release.id, changeNote: "Activate reviewed retirement"
  });
  const secondReportId = await createPinnedReport(revisedActivation);
  assert.notEqual(revisedActivation.validationCompiledSha256, activated.validationCompiledSha256);
  const firstPinsAfterChange = (await client.query(`select form_version_id,catalog_release_id,validation_version_id,
    form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256
    from clinical.report where id=$1`, [firstReportId])).rows[0];
  assert.deepEqual(firstPinsAfterChange, {
    form_version_id: formVersionId, catalog_release_id: release.id, validation_version_id: published.id,
    form_definition_sha256: activated.formDefinitionSha256,
    catalog_artifact_sha256: activated.catalogArtifactSha256,
    validation_compiled_sha256: activated.validationCompiledSha256,
  });
  await assert.rejects(client.query("update clinical.report set validation_compiled_sha256=$2 where id=$1",
    [firstReportId, revisedActivation.validationCompiledSha256]), /artifact pins are immutable/);

  await assert.rejects(validations.activate("session", published.id, {
    formVersionId, catalogReleaseId: randomUUID(), changeNote: "Mismatched catalog"
  }), /published and bound/);
  assert.equal((await client.query(`select validation_version_id from app_identity.active_configuration_bundle
    where organization_id=$1`, [organizationId])).rows[0].validation_version_id, republished.id);
  await assert.rejects(client.query(`update app_identity.active_configuration_bundle
    set validation_compiled_sha256=$2 where organization_id=$1`, [organizationId, "f".repeat(64)]), /intact/);

  const rolledBack = await validations.activate("session", published.id, {
    formVersionId, catalogReleaseId: release.id, changeNote: "Rollback to first reviewed bundle"
  });
  assert.equal(rolledBack.previousValidationVersionId, republished.id);
  assert.equal(rolledBack.validationVersionId, published.id);
  const thirdReportId = await createPinnedReport(rolledBack);
  const futurePins = await client.query(`select id,validation_version_id,validation_compiled_sha256
    from clinical.report where id=any($1::uuid[]) order by id`, [[secondReportId, thirdReportId]]);
  assert.equal(futurePins.rows.find(({ id }) => id === secondReportId).validation_version_id, republished.id);
  assert.equal(futurePins.rows.find(({ id }) => id === thirdReportId).validation_version_id, published.id);
  const activationAudit = (await client.query(`select actor_id,change_note,previous_form_version_id,
    previous_catalog_release_id,previous_validation_version_id,form_version_id,catalog_release_id,
    validation_version_id,details from app_identity.configuration_event
    where organization_id=$1 and action='configuration.activate' order by id desc limit 1`, [organizationId])).rows[0];
  assert.equal(activationAudit.actor_id, userId);
  assert.equal(activationAudit.change_note, "Rollback to first reviewed bundle");
  assert.equal(activationAudit.previous_validation_version_id, republished.id);
  assert.deepEqual(activationAudit.details.to, { formVersionId, catalogReleaseId: release.id,
    validationVersionId: published.id });

  const otherOrganizationId = randomUUID();
  const otherUserId = randomUUID();
  await client.query("insert into app_identity.organization(id,name,deployment_timezone) values ($1,'Other Validation integration','UTC')",
    [otherOrganizationId]);
  await client.query("insert into app_identity.app_user(id,organization_id,display_name) values ($1,$2,'Other administrator')",
    [otherUserId, otherOrganizationId]);
  const isolated = new ValidationAuthoringService(database, { requireCapability: async () =>
    ({ organization: { id: otherOrganizationId }, user: { id: otherUserId } }) });
  await assert.rejects(isolated.clone("session", published.id, {
    catalogReleaseId: release.id, displayName: "Cross-organization clone"
  }), /was not found/);
  assert.deepEqual(await isolated.history("session"), []);
});

integrationTest("dispatch projection routes by call sign and quarantines unknown agency units", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await ensureFoundation(client);
  await client.query("begin");
  t.after(async () => {
    try { await client.query("rollback"); } finally { await client.end(); }
  });

  const organizationId = randomUUID();
  const userId = randomUUID();
  const formId = randomUUID();
  const unitId = randomUUID();
  const otherUnitId = randomUUID();
  const [source, cancellationSource] = await Promise.all([
    readFile(path.join(repoRoot, "packages/contracts/examples/dispatch/synthetic-assignment-01.json"), "utf8").then(JSON.parse),
    readFile(path.join(repoRoot, "packages/contracts/examples/dispatch/synthetic-cancellation.json"), "utf8").then(JSON.parse)
  ]);
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Dispatch routing', 'UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Dispatcher')", [userId, organizationId]);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, $3, 'Dispatch form')",
    [formId, organizationId, `dispatch-${organizationId}`]);
  await client.query(`insert into app_identity.operational_unit
    (id, organization_id, call_sign, name, default_form_id)
    values ($1, $2, 'SYNTHETIC-MEDIC-7', 'Medic 7', $3),
           ($4, $2, 'SYNTHETIC-MEDIC-8', 'Medic 8', $3)`,
  [unitId, organizationId, formId, otherUnitId]);

  const dispatchWriter = {
    query: async (sql, parameters) => (await client.query(sql, parameters)).rows
  };
  const route = (canonical) => routeDispatchAssignment(dispatchWriter, {
    organizationId,
    sourceId: "vendor-a",
    sourceBytes: Buffer.from(JSON.stringify(canonical)),
    canonical,
    validationStatus: "applied",
    findings: []
  });
  const routed = await route(source);
  const assignment = (await client.query(`
    select ca.unit_id, ca.dispatch_source_record_id, ca.response_number, ca.vehicle_number,
           ca.dispatch_revision, dr.status as receipt_status, ou.call_sign
    from clinical.call_assignment ca
    join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
    join app_identity.operational_unit ou on ou.id = ca.unit_id
    where ca.id = $1
  `, [routed.assignmentId])).rows[0];
  assert.deepEqual(assignment, {
    unit_id: unitId,
    dispatch_source_record_id: source.sourceRecordId,
    response_number: "SYN-20260903-001-1",
    vehicle_number: "SYNTHETIC-VEHICLE-7",
    dispatch_revision: "1",
    receipt_status: "applied",
    call_sign: "SYNTHETIC-MEDIC-7"
  });

  const unknown = structuredClone(source);
  unknown.messageId = randomUUID();
  unknown.sourceRecordId = "SYNTHETIC-UNKNOWN-RESPONSE";
  const callSign = unknown.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find(({ id }) => id === "eResponse.14");
  callSign.values[0].value = "SYNTHETIC-UNKNOWN-UNIT";
  const quarantined = await route(unknown);
  assert.equal(quarantined.status, "quarantined");
  assert.equal((await client.query("select count(*)::integer as count from clinical.call_assignment where dispatch_source_record_id = $1",
    [unknown.sourceRecordId])).rows[0].count, 0);
  assert.equal((await client.query("select status from clinical.dispatch_receipt where id = $1",
    [quarantined.receipt.id])).rows[0].status, "quarantined");

  const invalidReassignment = structuredClone(source);
  invalidReassignment.messageId = randomUUID();
  invalidReassignment.revision = 2;
  invalidReassignment.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find(({ id }) => id === "eResponse.14").values[0].value = "SYNTHETIC-MEDIC-8";
  await assert.rejects(route(invalidReassignment), /cancellation and a new sourceRecordId/);

  const cancellation = structuredClone(cancellationSource);
  cancellation.messageId = randomUUID();
  cancellation.revision = 2;
  await route(cancellation);
  const reassigned = structuredClone(source);
  reassigned.messageId = randomUUID();
  reassigned.sourceRecordId = "SYNTHETIC-SOURCE-RECORD-0002";
  reassigned.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find(({ id }) => id === "eResponse.04").values[0].value = "SYN-20260903-001-2";
  reassigned.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find(({ id }) => id === "eResponse.14").values[0].value = "SYNTHETIC-MEDIC-8";
  await route(reassigned);
  const responseHistory = await client.query(`
    select status, incident_id, response_number, unit_id
    from clinical.call_assignment
    where organization_id = $1 and call_number = 'SYN-20260903-001'
    order by response_number
  `, [organizationId]);
  assert.equal(responseHistory.rows.length, 2);
  assert.equal(responseHistory.rows[0].status, "canceled");
  assert.equal(responseHistory.rows[1].status, "assigned");
  assert.equal(responseHistory.rows[0].incident_id, responseHistory.rows[1].incident_id);
  assert.equal(responseHistory.rows[1].unit_id, otherUnitId);
});

async function seedDraft(client, organizationId, userId, definition) {
  const formId = randomUUID();
  const versionId = randomUUID();
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  const digest = canonicalDefinitionSha256(definition);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, $3, 'Publication test')",
    [formId, organizationId, `publication-${formId}`]);
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
    values ($1, $2, $3, 1, $4::jsonb, $5, $6)`,
    [versionId, formId, release.rows[0].id, JSON.stringify(definition), digest, userId]);
  return { formId, versionId, digest };
}

integrationTest("form publication is atomic, catalog-aware, projected, and immutable through the public API", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);

  const organizationId = randomUUID();
  const userId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Publication API', 'UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Publisher')", [userId, organizationId]);

  const app = await NestFactory.create(AppModule, { logger: false });
  app.get(ClinicianSessionService).requireCapability = async () => ({
    user: { id: userId, displayName: "Publisher" }, organization: { id: organizationId, name: "Publication API" },
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    capabilities: ["admin-dashboard:read"]
  });
  app.get(ClinicianSessionService).assertCsrf = async () => {};
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  async function publish(versionId, body) {
    const response = await fetch(`${baseUrl}/form-versions/${versionId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer publication-owner", "x-csrf-token": "csrf" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    return { response, payload };
  }

  const catalogElements = await client.query(`
    select element_id from catalog.analytics_element_mapping
    where release_id = (select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1')
    order by element_id limit 2
  `);
  const [firstElement, secondElement] = catalogElements.rows.map((row) => row.element_id);
  const validDefinition = {
    schemaVersion: 1,
    sections: [{
      key: "clinical",
      fields: [
        { key: "first", source: { kind: "nemsis", elementId: firstElement }, required: true },
        {
          key: "second",
          source: { kind: "nemsis", elementId: secondElement },
          rules: [{ kind: "visibility", expression: { operator: "exists", field: "first" } }]
        }
      ]
    }]
  };

  await t.test("publishes canonical content and matching searchable projections", async () => {
    const draft = await seedDraft(client, organizationId, userId, validDefinition);
    const { response, payload } = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Initial publication",
      definitionSha256: draft.digest
    });
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.deepEqual(payload.projections, { sections: 1, fields: 2, rules: 1 });
    const event = await client.query(`select action,actor_id,form_version_id,catalog_release_id,change_note,content_sha256
      from app_identity.configuration_event where form_version_id=$1`, [draft.versionId]);
    assert.equal(event.rows[0].action, "form.publish");
    assert.equal(event.rows[0].actor_id, userId);
    assert.equal(event.rows[0].change_note, "Initial publication");
    assert.equal(event.rows[0].content_sha256, draft.digest);

    const stored = await client.query(`
      select fv.status, fv.catalog_release_id, fv.canonical_definition,
             array_agg(ff.stable_key order by ff.position) as field_keys
      from forms.form_version fv
      join forms.form_section fs on fs.form_version_id = fv.id
      join forms.form_field ff on ff.section_id = fs.id
      where fv.id = $1
      group by fv.id
    `, [draft.versionId]);
    assert.equal(stored.rows[0].status, "published");
    assert.deepEqual(stored.rows[0].canonical_definition, validDefinition);
    assert.deepEqual(stored.rows[0].field_keys, ["first", "second"]);

    await assert.rejects(client.query(
      "update forms.form_version set canonical_definition = '{}' where id = $1", [draft.versionId]),
      (error) => error.code === "P0001");
    await assert.rejects(client.query(
      "update forms.form_field set stable_key = 'changed' where form_version_id = $1", [draft.versionId]),
      (error) => error.code === "P0001");

    const retry = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Retry",
      definitionSha256: draft.digest
    });
    assert.equal(retry.response.status, 201);
    const conflict = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Conflicting retry",
      definitionSha256: "f".repeat(64)
    });
    assert.equal(conflict.response.status, 409);
  });

  await t.test("rejects unknown elements and invalid rules without partial projections", async () => {
    const invalidDefinitions = [
      {
        schemaVersion: 1,
        sections: [{ key: "unknown", fields: [{ key: "missing", source: { kind: "nemsis", elementId: "eUnknown.999" } }] }]
      },
      {
        schemaVersion: 1,
        sections: [{ key: "rules", fields: [{
          key: "known", source: { kind: "nemsis", elementId: firstElement },
          rules: [{ kind: "visibility", expression: { operator: "equals", field: "missing", value: true } }]
        }] }]
      }
    ];
    for (const definition of invalidDefinitions) {
      const draft = await seedDraft(client, organizationId, userId, definition);
      const result = await publish(draft.versionId, {
        publishedBy: userId,
        changeNote: "Must fail",
        definitionSha256: draft.digest
      });
      assert.equal(result.response.status, 422);
      const state = await client.query(`
        select fv.status,
          (select count(*)::integer from forms.form_section where form_version_id = fv.id) as sections,
          (select count(*)::integer from forms.form_field where form_version_id = fv.id) as fields
        from forms.form_version fv where fv.id = $1
      `, [draft.versionId]);
      assert.deepEqual(state.rows[0], { status: "draft", sections: 0, fields: 0 });
    }
  });

  await t.test("rolls back relational projections when the final publication write fails", async () => {
    const draft = await seedDraft(client, organizationId, userId, validDefinition);
    await client.query(`
      create or replace function forms.integration_reject_publication()
      returns trigger language plpgsql as $$
      begin
        if new.change_note = 'force rollback' then raise exception 'forced integration failure'; end if;
        return new;
      end;
      $$;
      create trigger integration_reject_publication
      before update on forms.form_version
      for each row execute function forms.integration_reject_publication();
    `);
    try {
      const result = await publish(draft.versionId, {
        publishedBy: userId,
        changeNote: "force rollback",
        definitionSha256: draft.digest
      });
      assert.equal(result.response.status, 500);
    } finally {
      await client.query("drop trigger integration_reject_publication on forms.form_version");
      await client.query("drop function forms.integration_reject_publication()");
    }
    const state = await client.query(`select status,
      (select count(*)::integer from forms.form_section where form_version_id = $1) as sections,
      (select count(*)::integer from forms.form_field where form_version_id = $1) as fields,
      (select count(*)::integer from forms.form_rule where form_version_id = $1) as rules
      from forms.form_version where id = $1`, [draft.versionId]);
    assert.deepEqual(state.rows[0], { status: "draft", sections: 0, fields: 0, rules: 0 });
  });

  await t.test("rejects a custom clinical repeating group without exactly its one date-time field", async () => {
    const timeElementId = randomUUID();
    const textElementId = randomUUID();
    const groupId = randomUUID();
    await client.query(`insert into catalog.element_identity (id, namespace, canonical_key) values
      ($1, 'integration', $3), ($2, 'integration', $4)`,
      [timeElementId, textElementId, `integration.time-${timeElementId}`, `integration.text-${textElementId}`]);
    await client.query(`insert into forms.custom_element_definition
      (id, organization_id, namespace, slug, title, base_datatype, identifying, definition) values
      ($1, $3, 'integration', $4, 'Clinical time', 'dateTime', false, '{}'),
      ($2, $3, 'integration', $5, 'Clinical text', 'string', false, '{}')`,
      [timeElementId, textElementId, organizationId, `time-${timeElementId}`, `text-${textElementId}`]);
    await client.query(`insert into forms.custom_group_definition
      (id, organization_id, namespace, slug, temporal_kind, clinical_time_element_id, definition)
      values ($1, $2, 'integration', $3, 'clinical', $4, '{}')`,
      [groupId, organizationId, `group-${groupId}`, timeElementId]);
    const definition = {
      schemaVersion: 1,
      sections: [{ key: "custom", fields: [{
        key: "custom-text",
        source: { kind: "custom", elementDefinitionId: textElementId, groupDefinitionId: groupId }
      }] }]
    };
    const draft = await seedDraft(client, organizationId, userId, definition);
    const result = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Must fail",
      definitionSha256: draft.digest
    });
    assert.equal(result.response.status, 422);
    assert.match(JSON.stringify(result.payload), /exactly its declared clinical date-time element/);
    const state = await client.query(`select status,
      (select count(*)::integer from forms.form_section where form_version_id = $1) as sections
      from forms.form_version where id = $1`, [draft.versionId]);
    assert.deepEqual(state.rows[0], { status: "draft", sections: 0 });
  });
});

integrationTest("the idempotent demo installation authenticates with its exact role", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
    values ($1, 'Demonstration EMS', 'UTC') on conflict (id) do nothing`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
  await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/bootstrap-synthetic-installation.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const signIn = (username) => fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: DEMO_CLINICIAN_PASSWORD })
  });
  await ensureSyntheticOwner(client);
  const demo = await signIn(DEMO_CLINICIAN_USERNAME);
  const demoSession = await demo.json();
  assert.equal(demo.status, 201);
  assert.deepEqual(demoSession.capabilities, [
    "admin-dashboard:read", "catalog:read", "catalog:write", "clinical:demo", "clinical:document",
    "forms:read", "forms:write", "roles:read", "settings:read", "users:read", "validation:read", "validation:write",
  ]);
  assert.equal(demoSession.passwordChangeRequired, false);
  assert.equal(demoSession.capabilities.includes("catalog:publish"), false);
  assert.equal(demoSession.capabilities.includes("forms:publish"), false);
  assert.equal(demoSession.capabilities.includes("roles:assign"), false);
});


integrationTest("draft report commands save, replay, and reconcile concurrent target edits with audit lineage", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);

  const organizationId = randomUUID();
  const userId = randomUUID();
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const agencyVersionId = randomUUID();
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  const releaseId = release.rows[0].id;
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Draft API', 'UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Clinician')", [userId, organizationId]);
  await client.query(`insert into app_identity.agency_demographic_version
    (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
     definition_sha256, effective_from, created_by)
    values ($1, $2, $3, 1, 'DRAFT-AGENCY', 'DRAFT-UNIT', '00', $4, now() - interval '1 day', $5)`,
  [agencyVersionId, organizationId, releaseId, "a".repeat(64), userId]);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, $3, 'Draft command form')",
    [formId, organizationId, `draft-${formId}`]);
  const selected = await client.query(`
    select
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
        where e.release_id = $1 and e.base_datatype = 'string' and e.max_occurs = 1
        order by e.element_id limit 1) as text_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
        where e.release_id = $1 and e.base_datatype = 'string' and e.max_occurs is null
        order by e.element_id limit 1) as repeatable_text_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
        where e.release_id = $1 and e.base_datatype = 'dateTime' order by e.element_id limit 1) as datetime_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1
        and e.definition #>> '{valueSource,kind}' = 'inline-enumerated'
        and (e.definition #>> '{valueSource,exhaustive}')::boolean
        order by e.element_id limit 1) as coded_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1 and exists
        (select 1 from catalog.element_option o where o.release_id = e.release_id and o.element_id = e.element_id and o.source_kind = 'not-value') order by e.element_id limit 1) as null_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1 and exists
        (select 1 from catalog.element_option o where o.release_id = e.release_id and o.element_id = e.element_id and o.source_kind = 'pertinent-negative') order by e.element_id limit 1) as negative_id,
      (select group_id from catalog.group_definition where release_id = $1 order by cardinality(path), group_id limit 1) as group_id
  `, [releaseId]);
  const ids = selected.rows[0];
  for (const [key, value] of Object.entries(ids)) assert.ok(value, `catalog fixture requires ${key}`);
  const option = async (elementId, sourceKind) => (await client.query(`select code, display, code_system from catalog.element_option
    where release_id = $1 and element_id = $2 and source_kind = $3 order by code limit 1`,
  [releaseId, elementId, sourceKind])).rows[0];
  const coded = await option(ids.coded_id, "inline");
  assert.ok(coded, "catalog fixture requires an inline coded value");
  const notValue = await option(ids.null_id, "not-value");
  const negative = await option(ids.negative_id, "pertinent-negative");
  const signingSectionId = randomUUID();
  const presentFieldId = randomUUID();
  const requiredFieldId = randomUUID();
  const requiredElement = (await client.query(`select e.element_id, e.element_identity_id,
      (m.analytical_location = 'repeatable') as analytical_repeatable
    from catalog.element_definition e join catalog.analytics_element_mapping m
      on m.release_id = e.release_id and m.element_id = e.element_id
    where e.release_id = $1 and e.base_datatype = 'string' and e.max_occurs = 1
      and e.element_id <> $2 order by e.element_id limit 1`, [releaseId, ids.text_id])).rows[0];
  assert.ok(requiredElement, "catalog fixture requires a second singleton text element");
  const presentIdentity = (await client.query(`select element_identity_id,
      (analytical_location = 'repeatable') as analytical_repeatable
    from catalog.analytics_element_mapping where release_id = $1 and element_id = $2`,
  [releaseId, ids.text_id])).rows[0];
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
    values ($1, $2, $3, 1, '{"schemaVersion":1,"sections":[]}', $4, $5)`,
  [formVersionId, formId, releaseId, "d".repeat(64), userId]);
  await client.query(`insert into forms.form_section (id, form_version_id, stable_key, position)
    values ($1, $2, 'signing', 0)`, [signingSectionId, formVersionId]);
  await client.query(`insert into forms.form_field
    (id, form_version_id, section_id, stable_key, position, source_kind,
     catalog_element_identity_id, required, analytical_repeatable)
    values ($1, $3, $4, 'present', 0, 'nemsis', $5, false, $6),
           ($2, $3, $4, 'required-when-present', 1, 'nemsis', $7, true, $8)`,
  [presentFieldId, requiredFieldId, formVersionId, signingSectionId,
    presentIdentity.element_identity_id, presentIdentity.analytical_repeatable,
    requiredElement.element_identity_id, requiredElement.analytical_repeatable]);
  await client.query(`insert into forms.form_rule
    (form_version_id, target_field_id, rule_kind, expression)
    values ($1, $2, 'requiredness', '{"operator":"exists","field":"present"}')`,
  [formVersionId, requiredFieldId]);
  await client.query(`update forms.form_version set status = 'published', change_note = 'Signing fixture',
    published_by = $2, published_at = now() where id = $1`, [formVersionId, userId]);
  await client.query(`insert into forms.agency_stationary_default
    (organization_id, form_version_id, activated_by) values ($1, $2, $3)`, [organizationId, formVersionId, userId]);
  const validationRuleId = randomUUID();
  const conditionalValidationRuleId = randomUUID();
  const maximumValidationRuleId = randomUUID();
  const validationVersionId = randomUUID();
  const validationSources = [{ id: validationRuleId, name: "Required field", enabled: true, severity: "error",
    executionTargets: ["sign"], primaryTargetElementId: requiredElement.element_id,
    message: "The required field is missing", source: `require present("${requiredElement.element_id}")` },
  { id: conditionalValidationRuleId, name: "Conditional field", enabled: true, severity: "error",
    executionTargets: ["sign"], primaryTargetElementId: requiredElement.element_id,
    message: "The conditional field is missing",
    source: `when present("${ids.text_id}")\nrequire present("${requiredElement.element_id}")` },
  { id: maximumValidationRuleId, name: "Required field maximum", enabled: true, severity: "error",
    executionTargets: ["sign"], primaryTargetElementId: requiredElement.element_id,
    message: "The required field permits one occurrence",
    source: `require maximum("${requiredElement.element_id}", 1)` }];
  const validationCatalog = { elements: [ids.text_id, requiredElement.element_id].map((elementId) => ({
    elementId, label: elementId, baseDatatype: "string", groupPath: [], intrinsicOccurrence: { min: 0, max: 1 }
  })), groups: [], codes: [] };
  const compiledRules = validationSources.map((rule) => {
    const result = compileValidationRule(rule, validationVersionId, validationCatalog);
    assert.ok(result.compiled, JSON.stringify(result.diagnostics));
    return result.compiled;
  });
  const validationBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId,
    catalogReleaseId: releaseId, rules: compiledRules };
  const validationDigest = compiledValidationBundleSha256(validationBundle);
  const catalogDigest = (await client.query("select artifact_sha256 from catalog.release where id=$1", [releaseId])).rows[0].artifact_sha256;
  await client.query(`insert into validation.rule_identity(id,organization_id,created_by)
    values ($1,$4,$5),($2,$4,$5),($3,$4,$5)`,
    [validationRuleId, conditionalValidationRuleId, maximumValidationRuleId, organizationId, userId]);
  await client.query(`insert into validation.version
    (id,organization_id,catalog_release_id,rule_id,version,status,display_name,source_rule,
     compiled_bundle,compiled_sha256,change_note,created_by,published_by,published_at,source_sha256)
    values ($1,$2,$3,$4,1,'published','Draft API policy',$5::jsonb,$6::jsonb,$7,
      'Draft API fixture',$8,$8,now(),$9)`,
  [validationVersionId, organizationId, releaseId, validationRuleId,
    JSON.stringify(validationSources), JSON.stringify(validationBundle), validationDigest, userId, "f".repeat(64)]);
  await client.query(`insert into app_identity.active_configuration_bundle
    (organization_id,form_version_id,catalog_release_id,validation_version_id,
     form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,activated_by,change_note)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'Draft API fixture')`,
  [organizationId, formVersionId, releaseId, validationVersionId, "d".repeat(64), catalogDigest, validationDigest, userId]);
  await client.query(`insert into validation.active_version
    (organization_id,validation_version_id,form_version_id,activated_by,change_note)
    values ($1,$2,$3,$4,'Draft API fixture')`, [organizationId, validationVersionId, formVersionId, userId]);

  const app = await NestFactory.create(AppModule, { logger: false });
  const integrationAccessToken = "draft-api-owner-token";
  const clinicianSessions = app.get(ClinicianSessionService);
  clinicianSessions.get = (token) => {
    assert.equal(token, integrationAccessToken);
    return {
      accessToken: integrationAccessToken,
      user: { id: userId, displayName: "Clinician" },
      organization: { id: organizationId, name: "Draft API" },
      capabilities: ["clinical:document"],
      startedAt: "2026-09-03T08:00:00.000Z",
      expiresAt: "2026-09-03T22:00:00.000Z"
    };
  };
  const integrationCsrfToken = "draft-api-csrf-token";
  clinicianSessions.assertCsrf = async (token, csrfToken) => {
    assert.equal(token, integrationAccessToken);
    assert.equal(csrfToken, integrationCsrfToken);
  };
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const request = async (path, method, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: {
        authorization: `Bearer ${integrationAccessToken}`,
        "x-csrf-token": integrationCsrfToken,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
  };
  const amendments = app.get(AmendReportService);

  const reportId = randomUUID();
  const createCommand = {
    commandId: randomUUID(), reportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown"
  };
  const created = await request("/reports", "POST", createCommand);
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.revision, 0);
  assert.equal(created.payload.formVersionId, formVersionId);
  assert.equal(created.payload.agencyDemographicVersionId, agencyVersionId);
  assert.equal(created.payload.catalogReleaseId, releaseId);

  const recoveryHandle = randomUUID();
  const registeredEnvelope = await request(`/reports/${reportId}/protected-key-envelope`, "POST", {
    schemaVersion: 1,
    recoveryHandle,
    reportKeyBase64: Buffer.alloc(32, 0x41).toString("base64")
  });
  assert.equal(registeredEnvelope.response.status, 201, JSON.stringify(registeredEnvelope.payload));
  assert.equal(registeredEnvelope.payload.recoveryHandle, recoveryHandle);

  const createRetry = await request("/reports", "POST", createCommand);
  assert.equal(createRetry.response.status, 201);
  assert.deepEqual(createRetry.payload, created.payload);
  const changedRetry = await request("/reports", "POST", { ...createCommand, patientIdentityState: "temporary" });
  assert.equal(changedRetry.response.status, 409);
  const secondCreate = await request("/reports", "POST", { ...createCommand, commandId: randomUUID() });
  assert.equal(secondCreate.response.status, 201);
  assert.equal(secondCreate.payload.id, reportId);
  assert.equal((await client.query("select count(*)::integer as count from clinical.report where id = $1", [reportId])).rows[0].count, 1);

  const groupInstanceId = randomUUID();
  const textOccurrenceId = randomUUID();
  const ordinals = new Map();
  const nextOrdinal = (elementId) => {
    const ordinal = ordinals.get(elementId) ?? 0;
    ordinals.set(elementId, ordinal + 1);
    return ordinal;
  };
  const firstSave = {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "offline-unit-7",
    clientTime: "2026-08-30T14:00:00-04:00",
    groups: [{ id: groupInstanceId, groupId: ids.group_id, ordinal: 0, correlationId: "offline-group-1" }],
    occurrences: [
      { id: textOccurrenceId, elementId: ids.text_id, ordinal: nextOrdinal(ids.text_id), value: { kind: "text", value: "initial" } },
      { id: randomUUID(), elementId: ids.datetime_id, ordinal: nextOrdinal(ids.datetime_id), value: {
        kind: "datetime", value: "2026-08-30T14:03:04-04:00", utcOffsetMinutes: -240, precision: "second"
      } },
      { id: randomUUID(), elementId: ids.coded_id, ordinal: nextOrdinal(ids.coded_id), value: {
        kind: "coded", code: coded.code, ...(coded.code_system ? { codeSystem: coded.code_system } : {}), display: coded.display
      } },
      { id: randomUUID(), elementId: ids.null_id, ordinal: nextOrdinal(ids.null_id), value: {
        kind: "null", absenceCode: notValue.code, display: notValue.display
      } },
      { id: randomUUID(), elementId: ids.negative_id, ordinal: nextOrdinal(ids.negative_id), value: {
        kind: "pertinent-negative", absenceCode: negative.code, display: negative.display
      } },
      { id: randomUUID(), elementId: ids.text_id, ordinal: 1, groupInstanceId, value: { kind: "absent" } }
    ]
  };
  const saved = await request(`/reports/${reportId}/draft-changes`, "POST", firstSave);
  assert.equal(saved.response.status, 201, JSON.stringify(saved.payload));
  assert.equal(saved.payload.revision, 1);
  const saveRetry = await request(`/reports/${reportId}/draft-changes`, "POST", firstSave);
  assert.equal(saveRetry.response.status, 201);
  assert.equal(saveRetry.payload.revision, 1);

  const retrieved = await request(`/reports/${reportId}`, "GET");
  assert.equal(retrieved.response.status, 200);
  assert.equal(retrieved.payload.revision, 1);
  assert.equal(retrieved.payload.groups.length, 1);
  assert.deepEqual(new Set(retrieved.payload.occurrences.map((row) => row.valueKind)),
    new Set(["text", "datetime", "coded", "null", "pertinent-negative", "absent"]));
  assert.equal(retrieved.payload.occurrences.find((row) => row.valueKind === "datetime").valueUtcOffsetMinutes, -240);

  const secondSave = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 1, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "updated" } }]
  });
  assert.equal(secondSave.response.status, 201, JSON.stringify(secondSave.payload));
  assert.equal(secondSave.payload.revision, 2);
  const stored = await client.query(`select
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where report_id = $1) as occurrences,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`, [reportId, textOccurrenceId]);
  assert.deepEqual(stored.rows[0], { changes: 2, occurrences: 6, current_text: "updated" });

  const stale = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 3, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "stale" } }]
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.currentRevision, 2);
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`,
  [reportId, textOccurrenceId])).rows[0], { revision: "2", changes: 2, current_text: "updated" });

  const thirdSave = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 2, authorId: userId, deviceId: "device-a",
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "device-a" } }]
  });
  assert.equal(thirdSave.response.status, 201, JSON.stringify(thirdSave.payload));
  assert.equal(thirdSave.payload.revision, 3);
  const concurrentState = (await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`,
  [reportId, textOccurrenceId])).rows[0];
  assert.deepEqual(concurrentState, {
    revision: "3", changes: 3,
    current_text: "device-a"
  });

  const deleteCommand = {
    commandId: randomUUID(), expectedRevision: 3, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, tombstone: true }]
  };
  const deleted = await request(`/reports/${reportId}/draft-changes`, "POST", deleteCommand);
  assert.equal(deleted.response.status, 201, JSON.stringify(deleted.payload));
  assert.equal(deleted.payload.revision, 4);
  const deleteRetry = await request(`/reports/${reportId}/draft-changes`, "POST", deleteCommand);
  assert.equal(deleteRetry.response.status, 201);
  assert.deepEqual(deleteRetry.payload, deleted.payload);
  const deletedState = (await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as identities,
    (select tombstoned_at is not null from clinical.element_occurrence where id = $2) as tombstoned`,
  [reportId, textOccurrenceId])).rows[0];
  assert.deepEqual(deletedState, { revision: "4", changes: 4, identities: 1, tombstoned: true });

  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select tombstoned_at is not null from clinical.element_occurrence where id = $2) as tombstoned`,
  [reportId, textOccurrenceId])).rows[0], { revision: "4", changes: 4, tombstoned: true });

  await client.query(`
    create function clinical.integration_reject_draft_change()
    returns trigger language plpgsql as $$
    begin
      if new.device_id = 'force-rollback' then raise exception 'forced draft rollback'; end if;
      return new;
    end;
    $$;
    create trigger integration_reject_draft_change
    before insert on clinical.report_change
    for each row execute function clinical.integration_reject_draft_change();
  `);
  const rollbackOccurrenceId = randomUUID();
  const rollbackCommand = {
    commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "force-rollback",
    occurrences: [{ id: rollbackOccurrenceId, elementId: ids.text_id, ordinal: 6,
      value: { kind: "text", value: "must roll back" } }]
  };
  try {
    const rolledBack = await request(`/reports/${reportId}/draft-changes`, "POST", rollbackCommand);
    assert.equal(rolledBack.response.status, 500);
  } finally {
    await client.query("drop trigger integration_reject_draft_change on clinical.report_change");
    await client.query("drop function clinical.integration_reject_draft_change()");
  }
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as occurrences,
    (select count(*)::integer from clinical.command_receipt where idempotency_key = $3) as receipts`,
  [reportId, rollbackOccurrenceId, rollbackCommand.commandId])).rows[0],
  { revision: "4", changes: 4, occurrences: 0, receipts: 0 });

  const retriedAfterRollback = await request(`/reports/${reportId}/draft-changes`, "POST", rollbackCommand);
  assert.equal(retriedAfterRollback.response.status, 201, JSON.stringify(retriedAfterRollback.payload));
  assert.equal(retriedAfterRollback.payload.revision, 5);
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as occurrences,
    (select count(*)::integer from clinical.command_receipt where idempotency_key = $3) as receipts`,
  [reportId, rollbackOccurrenceId, rollbackCommand.commandId])).rows[0],
  { revision: "5", changes: 5, occurrences: 1, receipts: 1 });

  const mergeReportId = randomUUID();
  const mergeCreated = await request("/reports", "POST", {
    commandId: randomUUID(), reportId: mergeReportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown"
  });
  assert.equal(mergeCreated.response.status, 201, JSON.stringify(mergeCreated.payload));
  const mergeOccurrenceA = randomUUID();
  const mergeOccurrenceB = randomUUID();
  const baseClientTime = Date.now() - 10 * 60 * 1000;
  const clientTime = (seconds) => new Date(baseClientTime + seconds * 1000).toISOString();
  const saveMerge = (command) => request(`/reports/${mergeReportId}/draft-changes`, "POST", command);

  const disjoint = await Promise.all([
    saveMerge({
      commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "disjoint-a",
      clientTime: clientTime(1),
      occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id, ordinal: 0,
        value: { kind: "text", value: "disjoint-a" } }]
    }),
    saveMerge({
      commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "disjoint-b",
      clientTime: clientTime(2),
      occurrences: [{ id: mergeOccurrenceB, elementId: ids.repeatable_text_id, ordinal: 1,
        value: { kind: "text", value: "disjoint-b" } }]
    })
  ]);
  assert.deepEqual(disjoint.map(({ response }) => response.status), [201, 201]);
  assert.deepEqual(disjoint.map(({ payload }) => payload.revision).sort((a, b) => a - b), [1, 2]);
  assert.deepEqual((await client.query(`select value_text from clinical.element_occurrence
    where id = any($1::uuid[]) order by value_text`, [[mergeOccurrenceA, mergeOccurrenceB]])).rows,
  [{ value_text: "disjoint-a" }, { value_text: "disjoint-b" }]);

  const collisionCommands = [
    { commandId: randomUUID(), expectedRevision: 2, authorId: userId, deviceId: "collision-older",
      clientTime: clientTime(10), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
        value: { kind: "text", value: "collision-older" } }] },
    { commandId: randomUUID(), expectedRevision: 2, authorId: userId, deviceId: "collision-newer",
      clientTime: clientTime(20), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
        value: { kind: "text", value: "collision-newer" } }] }
  ];
  const collisions = await Promise.all(collisionCommands.map(saveMerge));
  assert.deepEqual(collisions.map(({ response }) => response.status), [201, 201]);
  assert.deepEqual(collisions.map(({ payload }) => payload.revision).sort((a, b) => a - b), [3, 4]);
  assert.equal((await client.query("select value_text from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].value_text, "collision-newer");

  const mergeDeleteCommand = {
    commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "delete-newer",
    clientTime: clientTime(40), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id, tombstone: true }]
  };
  const editDelete = await Promise.all([
    saveMerge({
      commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "edit-older",
      clientTime: clientTime(30), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
        value: { kind: "text", value: "edit-before-delete" } }]
    }),
    saveMerge(mergeDeleteCommand)
  ]);
  assert.deepEqual(editDelete.map(({ response }) => response.status), [201, 201]);
  assert.equal((await client.query("select tombstoned_at is not null as tombstoned from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].tombstoned, true);
  const deleteRetryResult = await saveMerge(mergeDeleteCommand);
  assert.equal(deleteRetryResult.response.status, 201);
  assert.deepEqual(deleteRetryResult.payload, editDelete[1].payload);

  const resurrected = await saveMerge({
    commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "resurrection",
    clientTime: clientTime(50), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
      value: { kind: "text", value: "resurrected" } }]
  });
  assert.equal(resurrected.response.status, 201, JSON.stringify(resurrected.payload));
  assert.equal(resurrected.payload.revision, 7);

  await saveMerge({
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "skew-base",
    clientTime: clientTime(60), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
      value: { kind: "text", value: "sane-base" } }]
  });
  const futureCommand = {
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "future-clock",
    clientTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
      value: { kind: "text", value: "future-clock" } }]
  };
  await saveMerge(futureCommand);
  const afterSkew = await saveMerge({
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "sane-after-skew",
    clientTime: clientTime(70), occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id,
      value: { kind: "text", value: "sane-after-skew" } }]
  });
  assert.equal(afterSkew.payload.revision, 10);
  assert.equal((await client.query("select value_text from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].value_text, "sane-after-skew");

  const tieTime = clientTime(80);
  await saveMerge({
    commandId: randomUUID(), expectedRevision: 10, authorId: userId, deviceId: "tie-first", clientTime: tieTime,
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id, value: { kind: "text", value: "tie-first" } }]
  });
  const tieSecondCommand = {
    commandId: randomUUID(), expectedRevision: 10, authorId: userId, deviceId: "tie-second", clientTime: tieTime,
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.repeatable_text_id, value: { kind: "text", value: "tie-second" } }]
  };
  const tieSecond = await saveMerge(tieSecondCommand);
  const tieRetry = await saveMerge(tieSecondCommand);
  assert.deepEqual(tieRetry.payload, tieSecond.payload);
  assert.equal((await client.query("select value_text from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].value_text, "tie-second");

  const reconciliation = await client.query(`select target_type, target_id, losing_value,
      losing_author_id, losing_device_id, losing_client_time, losing_server_received_time,
      losing_base_revision, winning_revision, winning_idempotency_key, winning_author_id,
      winning_device_id, winning_client_time, winning_server_received_time,
      winning_base_revision, resolution
    from clinical_audit.draft_reconciliation where report_id = $1 order by id`, [mergeReportId]);
  assert.equal(reconciliation.rowCount, 6);
  assert.ok(reconciliation.rows.every((row) => row.target_type === "occurrence" &&
    row.target_id === mergeOccurrenceA && row.losing_author_id === userId &&
    row.winning_author_id === userId && row.losing_device_id && row.losing_client_time instanceof Date &&
    row.losing_server_received_time instanceof Date && Number(row.losing_base_revision) >= 0 &&
    Number(row.winning_revision) > 0 && /^[a-f0-9-]{36}$/.test(row.winning_idempotency_key) &&
    row.winning_device_id && row.winning_client_time instanceof Date &&
    row.winning_server_received_time instanceof Date && Number(row.winning_base_revision) >= 0 &&
    row.losing_value.id === mergeOccurrenceA));
  assert.equal(reconciliation.rows.at(-1).resolution, "server-receipt-order");
  assert.equal(reconciliation.rows.at(-1).winning_device_id, "tie-second");
  const skewAudit = reconciliation.rows.find((row) => row.losing_device_id === "future-clock");
  assert.equal(skewAudit.resolution, "server-receipt-order");
  assert.equal(skewAudit.winning_device_id, "sane-after-skew");
  assert.equal(Number(skewAudit.losing_base_revision), 7);
  await assert.rejects(client.query("update clinical_audit.draft_reconciliation set resolution = resolution where report_id = $1",
    [mergeReportId]), /append-only/);

  const singletonReportId = randomUUID();
  const singletonCreated = await request("/reports", "POST", {
    commandId: randomUUID(), reportId: singletonReportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown"
  });
  assert.equal(singletonCreated.response.status, 201, JSON.stringify(singletonCreated.payload));
  const singletonOlderId = randomUUID();
  const singletonNewerId = randomUUID();
  const singletonOlderCommand = {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "singleton-older",
    clientTime: clientTime(100), occurrences: [{ id: singletonOlderId, elementId: ids.text_id,
      ordinal: 0, value: { kind: "text", value: "singleton-older" } }]
  };
  const singletonNewerCommand = {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "singleton-newer",
    clientTime: clientTime(110), occurrences: [{ id: singletonNewerId, elementId: ids.text_id,
      ordinal: 0, value: { kind: "text", value: "singleton-newer" } }]
  };
  const singletonResults = await Promise.all([
    request(`/reports/${singletonReportId}/draft-changes`, "POST", singletonOlderCommand),
    request(`/reports/${singletonReportId}/draft-changes`, "POST", singletonNewerCommand)
  ]);
  assert.deepEqual(singletonResults.map(({ response }) => response.status), [201, 201]);
  assert.deepEqual(singletonResults.map(({ payload }) => payload.revision).sort((a, b) => a - b), [1, 2]);
  const singletonState = await client.query(`select id, value_text from clinical.element_occurrence
    where report_id = $1 and element_id = $2 and tombstoned_at is null`, [singletonReportId, ids.text_id]);
  assert.equal(singletonState.rowCount, 1);
  assert.equal(singletonState.rows[0].value_text, "singleton-newer");
  assert.ok([singletonOlderId, singletonNewerId].includes(singletonState.rows[0].id));
  const singletonLineage = await client.query(`select reconciliation.target_id,
      reconciliation.losing_value, reconciliation.winning_idempotency_key,
      reconciliation.winning_device_id, reconciliation.resolution,
      state.target_id as state_target_id, state.target_value
    from clinical_audit.draft_reconciliation reconciliation
    join clinical.draft_target_state state
      on state.report_id = reconciliation.report_id
     and state.target_type = reconciliation.target_type
     and state.target_id = reconciliation.target_id
    where reconciliation.report_id = $1`, [singletonReportId]);
  assert.equal(singletonLineage.rowCount, 1);
  assert.equal(singletonLineage.rows[0].target_id, singletonState.rows[0].id);
  assert.equal(singletonLineage.rows[0].state_target_id, singletonState.rows[0].id);
  assert.equal(singletonLineage.rows[0].losing_value.id, singletonOlderId);
  assert.equal(singletonLineage.rows[0].winning_idempotency_key, singletonNewerCommand.commandId);
  assert.equal(singletonLineage.rows[0].winning_device_id, "singleton-newer");
  assert.equal(singletonLineage.rows[0].resolution, "client-time");
  assert.equal(singletonLineage.rows[0].target_value.value.value, "singleton-newer");

  const singletonTieReportId = randomUUID();
  const singletonTieCreated = await request("/reports", "POST", {
    commandId: randomUUID(), reportId: singletonTieReportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown"
  });
  assert.equal(singletonTieCreated.response.status, 201, JSON.stringify(singletonTieCreated.payload));
  const singletonTieFirstId = randomUUID();
  const singletonTieSecondId = randomUUID();
  const singletonTieTime = clientTime(120);
  const singletonTieFirst = await request(`/reports/${singletonTieReportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "singleton-tie-first",
    clientTime: singletonTieTime, occurrences: [{ id: singletonTieFirstId, elementId: ids.text_id,
      ordinal: 0, value: { kind: "text", value: "singleton-tie-first" } }]
  });
  assert.equal(singletonTieFirst.response.status, 201, JSON.stringify(singletonTieFirst.payload));
  const singletonTieSecond = await request(`/reports/${singletonTieReportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "singleton-tie-second",
    clientTime: singletonTieTime, occurrences: [{ id: singletonTieSecondId, elementId: ids.text_id,
      ordinal: 0, value: { kind: "text", value: "singleton-tie-second" } }]
  });
  assert.equal(singletonTieSecond.response.status, 201, JSON.stringify(singletonTieSecond.payload));
  assert.deepEqual((await client.query(`select id, value_text from clinical.element_occurrence
    where report_id = $1 and element_id = $2 and tombstoned_at is null`,
  [singletonTieReportId, ids.text_id])).rows, [{ id: singletonTieFirstId, value_text: "singleton-tie-second" }]);
  assert.deepEqual((await client.query(`select target_id, winning_device_id, resolution
    from clinical_audit.draft_reconciliation where report_id = $1`, [singletonTieReportId])).rows,
  [{ target_id: singletonTieFirstId, winning_device_id: "singleton-tie-second", resolution: "server-receipt-order" }]);

  const cardinalityGuardReportId = randomUUID();
  const cardinalityGuardCreated = await request("/reports", "POST", {
    commandId: randomUUID(), reportId: cardinalityGuardReportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown"
  });
  assert.equal(cardinalityGuardCreated.response.status, 201, JSON.stringify(cardinalityGuardCreated.payload));
  const invalidDraft = await request(`/reports/${cardinalityGuardReportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId,
    occurrences: [
      { id: randomUUID(), elementId: ids.text_id, ordinal: 0, value: { kind: "text", value: "first" } },
      { id: randomUUID(), elementId: ids.text_id, ordinal: 1, value: { kind: "text", value: "second" } }
    ]
  });
  assert.equal(invalidDraft.response.status, 201, JSON.stringify(invalidDraft.payload));
  const guardedReconciliation = await request(`/reports/${cardinalityGuardReportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "guarded-reconciliation",
    clientTime: clientTime(130), occurrences: [{ id: randomUUID(), elementId: ids.text_id,
      ordinal: 0, value: { kind: "text", value: "must-not-commit" } }]
  });
  assert.equal(guardedReconciliation.response.status, 422, JSON.stringify(guardedReconciliation.payload));
  assert.deepEqual((await client.query(`select
      (select revision from clinical.report where id = $1) as revision,
      (select count(*)::integer from clinical.element_occurrence where report_id = $1) as occurrences,
      (select count(*)::integer from clinical.report_change where report_id = $1) as changes`,
  [cardinalityGuardReportId])).rows[0], { revision: "1", occurrences: 2, changes: 1 });

  const sign = (body) => request(`/reports/${reportId}/sign`, "POST", body);
  const missingRequired = await sign({
    commandId: randomUUID(), expectedRevision: 5, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(missingRequired.response.status, 422, JSON.stringify(missingRequired.payload));
  assert.ok(missingRequired.payload.findings.some((finding) => finding.code === "validation.required-element"));
  const rejectedState = (await client.query(`select status, revision,
      (select count(*)::integer from clinical.signed_snapshot where report_id = $1) as snapshots,
      (select count(*)::integer from clinical.validation_finding where report_id = $1) as findings
    from clinical.report where id = $1`, [reportId])).rows[0];
  assert.deepEqual({ status: rejectedState.status, revision: rejectedState.revision, snapshots: rejectedState.snapshots },
    { status: "draft", revision: "5", snapshots: 0 });
  assert.ok(rejectedState.findings >= 1);

  const requiredOccurrenceId = randomUUID();
  const secondRequiredOccurrenceId = randomUUID();
  const requiredSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 5, authorId: userId,
    occurrences: [{ id: requiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, groupInstanceId, ordinal: 0, value: { kind: "text", value: "required" } }]
  });
  assert.equal(requiredSaved.response.status, 201, JSON.stringify(requiredSaved.payload));
  const duplicateSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 6, authorId: userId,
    occurrences: [{ id: secondRequiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, groupInstanceId, ordinal: 1, value: { kind: "text", value: "duplicate" } }]
  });
  assert.equal(duplicateSaved.response.status, 201, JSON.stringify(duplicateSaved.payload));
  const invalidCardinality = await sign({
    commandId: randomUUID(), expectedRevision: 7, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidCardinality.response.status, 422, JSON.stringify(invalidCardinality.payload));
  assert.ok(invalidCardinality.payload.findings.some((finding) => finding.code === "validation.required-element"));
  const removedDuplicate = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 7, authorId: userId,
    occurrences: [{ id: secondRequiredOccurrenceId, elementId: requiredElement.element_id, tombstone: true }]
  });
  assert.equal(removedDuplicate.response.status, 201, JSON.stringify(removedDuplicate.payload));

  await client.query(`update clinical.element_occurrence set
    value_kind = 'integer', value_text = null, value_integer = 42, value_lexical = '42'
    where id = $1`, [requiredOccurrenceId]);
  const invalidCatalog = await sign({
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidCatalog.response.status, 422, JSON.stringify(invalidCatalog.payload));
  assert.ok(invalidCatalog.payload.findings.some((finding) => finding.code === "catalog.datatype"));
  assert.deepEqual((await client.query("select status, revision from clinical.report where id = $1", [reportId])).rows[0],
    { status: "draft", revision: "8" });
  await client.query(`update clinical.element_occurrence set
    value_kind = 'text', value_text = 'required', value_integer = null, value_lexical = null
    where id = $1`, [requiredOccurrenceId]);

  const codedOccurrence = (await client.query(`select id, code from clinical.element_occurrence
    where report_id = $1 and element_id = $2 and value_kind = 'coded' and tombstoned_at is null`,
  [reportId, ids.coded_id])).rows[0];
  await client.query("update clinical.element_occurrence set code = 'INVALID-VALUE-SET-CODE' where id = $1", [codedOccurrence.id]);
  const invalidValueSet = await sign({
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidValueSet.response.status, 422, JSON.stringify(invalidValueSet.payload));
  assert.ok(invalidValueSet.payload.findings.some((finding) => finding.code === "catalog.value-set"));
  assert.deepEqual((await client.query("select status, revision from clinical.report where id = $1", [reportId])).rows[0],
    { status: "draft", revision: "8" });
  await client.query("update clinical.element_occurrence set code = $2 where id = $1", [codedOccurrence.id, codedOccurrence.code]);

  const protectedCiphertextSha256 = "9".repeat(64);
  const ciphertextReceipt = await request(`/reports/${reportId}/protected-ciphertext-receipt`, "POST", {
    schemaVersion: 1,
    recoveryHandle,
    ciphertextRevision: 8,
    ciphertextSha256: protectedCiphertextSha256
  });
  assert.equal(ciphertextReceipt.response.status, 200, JSON.stringify(ciphertextReceipt.payload));
  const ciphertextCheckpoint = await request(`/reports/${reportId}/protected-ciphertext-checkpoint`, "POST", {
    schemaVersion: 1,
    recoveryHandle,
    ciphertextRevision: 8,
    ciphertextSha256: protectedCiphertextSha256
  });
  assert.equal(ciphertextCheckpoint.response.status, 200, JSON.stringify(ciphertextCheckpoint.payload));
  assert.deepEqual(ciphertextCheckpoint.payload, {
    ciphertextRevision: 8,
    ciphertextSha256: protectedCiphertextSha256
  });

  const temperatureOccurrenceId = randomUUID();
  const temperatureDefinition = (await client.query(`select m.element_identity_id,
      (m.analytical_location = 'repeatable') as analytical_repeatable, m.identifying
    from catalog.analytics_element_mapping m
    where m.release_id = $1 and m.element_id = 'eVitals.24'`, [releaseId])).rows[0];
  await client.query(`insert into clinical.element_occurrence
    (id, report_id, catalog_release_id, element_identity_id, element_id, ordinal,
     analytical_repeatable, identifying, value_kind, value_numeric, value_lexical, author_id)
    values ($1, $2, $3, $4, 'eVitals.24', 0, $5, $6, 'numeric', 46, '46.0', $7)`,
  [temperatureOccurrenceId, reportId, releaseId, temperatureDefinition.element_identity_id,
    temperatureDefinition.analytical_repeatable, temperatureDefinition.identifying, userId]);

  await client.query(`create function clinical.integration_reject_signature_audit()
    returns trigger language plpgsql as $$ begin
      if new.device_id = 'force-sign-rollback' then raise exception 'forced signing rollback'; end if;
      return new;
    end; $$;
    create trigger integration_reject_signature_audit before insert on clinical_audit.event
    for each row execute function clinical.integration_reject_signature_audit()`);
  const signCommand = {
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval", version: 1 },
    actorPersona: "clinician", sessionId: "integration-signing", deviceId: "force-sign-rollback",
    clientTime: "2026-08-30T14:30:00-04:00"
  };
  try {
    const rolledBackSign = await sign(signCommand);
    assert.equal(rolledBackSign.response.status, 500, JSON.stringify(rolledBackSign.payload));
  } finally {
    await client.query("drop trigger integration_reject_signature_audit on clinical_audit.event");
    await client.query("drop function clinical.integration_reject_signature_audit()");
  }
  assert.deepEqual((await client.query(`select status,
      (select count(*)::integer from clinical.signed_snapshot where report_id = $1) as snapshots,
      (select count(*)::integer from clinical_audit.event where report_id = $1 and action = 'sign') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = $1 and event_type = 'signed_snapshot') as events,
      (select count(*)::integer from clinical.command_receipt where idempotency_key = $2) as receipts
    from clinical.report where id = $1`, [reportId, signCommand.commandId])).rows[0],
  { status: "draft", snapshots: 0, audits: 0, events: 0, receipts: 0 });

  signCommand.deviceId = "unit-7";
  const signingService = app.get(SignReportService);
  const signingDataSource = signingService.dataSource;
  let signingTransactions = 0;
  signingService.dataSource = {
    transaction: async (...args) => {
      signingTransactions += 1;
      if (signingTransactions === 1) throw { driverError: { code: "40001" } };
      return signingDataSource.transaction(...args);
    },
  };
  let signed;
  try {
    signed = await sign(signCommand);
  } finally {
    signingService.dataSource = signingDataSource;
  }
  assert.equal(signingTransactions, 2);
  assert.equal(signed.response.status, 201, JSON.stringify(signed.payload));
  assert.equal(signed.payload.status, "signed");
  assert.equal(signed.payload.signedRevision, 8);
  assert.match(signed.payload.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(signed.payload.qualityRuleVersion, "clinical-quality-1.0.0");
  assert.equal(signed.payload.normalizationRuleVersion, "clinical-normalization-1.0.0");
  assert.deepEqual(signed.payload.derivedValues, []);
  assert.equal(signed.payload.qualityFindings.length, 1);
  assert.deepEqual({
    sourceOccurrenceId: signed.payload.qualityFindings[0].sourceOccurrenceId,
    code: signed.payload.qualityFindings[0].code,
    observedNumeric: signed.payload.qualityFindings[0].observedNumeric,
    sourceUnitCode: signed.payload.qualityFindings[0].sourceUnitCode
  }, {
    sourceOccurrenceId: temperatureOccurrenceId,
    code: "vital.temperature.unusual",
    observedNumeric: 46,
    sourceUnitCode: "Cel"
  });
  const signedState = (await client.query(`select r.status, r.revision, s.signed_revision,
      s.canonical_sha256, s.signer_id, s.attestation, s.quality_rule_version,
      s.normalization_rule_version, s.quality_findings, s.derived_values,
      (select count(*)::integer from clinical.validation_finding where report_id = r.id) as findings,
      (select count(*)::integer from clinical_audit.event where report_id = r.id and action = 'sign') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = r.id and event_type = 'signed_snapshot') as events
    from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id where r.id = $1`, [reportId])).rows[0];
  assert.deepEqual({
    status: signedState.status, revision: signedState.revision,
    signed_revision: signedState.signed_revision, signer_id: signedState.signer_id,
    attestation: signedState.attestation, findings: signedState.findings,
    audits: signedState.audits, events: signedState.events
  }, {
    status: "signed", revision: "8", signed_revision: "8",
    signer_id: userId, attestation: signCommand.attestation, findings: 0, audits: 1, events: 1
  });
  assert.equal(signedState.canonical_sha256, signed.payload.canonicalSha256);
  assert.equal(signedState.quality_rule_version, signed.payload.qualityRuleVersion);
  assert.equal(signedState.normalization_rule_version, signed.payload.normalizationRuleVersion);
  assert.deepEqual(signedState.quality_findings, signed.payload.qualityFindings);
  assert.deepEqual(signedState.derived_values, signed.payload.derivedValues);
  assert.deepEqual((await client.query(`select state, ciphertext_revision, synchronized_revision,
      ciphertext_sha256 from offline_recovery.report_key_envelope where report_id = $1`, [reportId])).rows[0], {
    state: "completed",
    ciphertext_revision: "8",
    synchronized_revision: "8",
    ciphertext_sha256: protectedCiphertextSha256
  });
  const signRetry = await sign(signCommand);
  assert.equal(signRetry.response.status, 201);
  assert.deepEqual(signRetry.payload, signed.payload);

  const postSignCommand = {
    commandId: randomUUID(), expectedRevision: 7, authorId: userId,
    deviceId: "delayed-mobile-unit-7", clientTime: "2026-08-30T14:29:00-04:00",
    groups: [{ id: groupInstanceId, groupId: ids.group_id, ordinal: 9 }],
    occurrences: [{ id: requiredOccurrenceId, elementId: requiredElement.element_id,
      value: { kind: "text", value: "forbidden" } }]
  };
  const immutableBeforeLateSave = (await client.query(`select r.revision,
      (select ordinal from clinical.group_instance where id = $2) as group_ordinal,
      (select value_text from clinical.element_occurrence where id = $3) as occurrence_value,
      (select count(*)::integer from clinical.report_change where report_id = r.id) as changes,
      (select count(*)::integer from clinical.draft_target_state where report_id = r.id) as target_states,
      (select count(*)::integer from clinical.signed_snapshot where report_id = r.id) as snapshots,
      (select canonical_sha256 from clinical.signed_snapshot where report_id = r.id) as signed_hash,
      (select count(*)::integer from integration.outbox_event where aggregate_id = r.id) as projection_events
    from clinical.report r where r.id = $1`, [reportId, groupInstanceId, requiredOccurrenceId])).rows[0];
  const postSignSave = await request(`/reports/${reportId}/draft-changes`, "POST", postSignCommand);
  assert.equal(postSignSave.response.status, 201, JSON.stringify(postSignSave.payload));
  assert.deepEqual({
    status: postSignSave.payload.status,
    revision: postSignSave.payload.revision,
    signedRevision: postSignSave.payload.signedRevision,
    canonicalSha256: postSignSave.payload.canonicalSha256,
    retainedAuditNoteCount: postSignSave.payload.retainedAuditNoteCount
  }, {
    status: "signed", revision: 8, signedRevision: 8,
    canonicalSha256: signed.payload.canonicalSha256, retainedAuditNoteCount: 2
  });
  assert.match(postSignSave.payload.signedSnapshotId, /^[a-f0-9-]{36}$/);
  const postSignRetry = await request(`/reports/${reportId}/draft-changes`, "POST", postSignCommand);
  assert.equal(postSignRetry.response.status, 201);
  assert.deepEqual(postSignRetry.payload, postSignSave.payload);
  const conflictingPostSignRetry = await request(`/reports/${reportId}/draft-changes`, "POST", {
    ...postSignCommand,
    occurrences: [{ ...postSignCommand.occurrences[0], value: { kind: "text", value: "different retry" } }]
  });
  assert.equal(conflictingPostSignRetry.response.status, 409);

  const lateAttempts = await client.query(`select target_type, target_id, attempted_change,
      author_id, device_id, client_edit_time, server_received_time, expected_revision,
      signed_revision, signed_snapshot_id, signed_canonical_sha256
    from clinical_audit.post_signature_audit_note
    where report_id = $1 order by target_type, target_id`, [reportId]);
  assert.equal(lateAttempts.rowCount, 2);
  assert.deepEqual(new Set(lateAttempts.rows.map((row) => row.target_type)), new Set(["group", "occurrence"]));
  assert.deepEqual(new Set(lateAttempts.rows.map((row) => row.target_id)),
    new Set([groupInstanceId, requiredOccurrenceId]));
  assert.ok(lateAttempts.rows.every((row) => row.author_id === userId &&
    row.device_id === postSignCommand.deviceId && row.client_edit_time instanceof Date &&
    row.server_received_time instanceof Date && Number(row.expected_revision) === 7 &&
    Number(row.signed_revision) === 8 && row.signed_snapshot_id === postSignSave.payload.signedSnapshotId &&
    row.signed_canonical_sha256 === signed.payload.canonicalSha256));
  assert.deepEqual(lateAttempts.rows.find((row) => row.target_type === "occurrence").attempted_change,
    postSignCommand.occurrences[0]);
  assert.deepEqual(lateAttempts.rows.find((row) => row.target_type === "group").attempted_change,
    postSignCommand.groups[0]);
  assert.deepEqual((await client.query(`select r.revision,
      (select ordinal from clinical.group_instance where id = $2) as group_ordinal,
      (select value_text from clinical.element_occurrence where id = $3) as occurrence_value,
      (select count(*)::integer from clinical.report_change where report_id = r.id) as changes,
      (select count(*)::integer from clinical.draft_target_state where report_id = r.id) as target_states,
      (select count(*)::integer from clinical.signed_snapshot where report_id = r.id) as snapshots,
      (select canonical_sha256 from clinical.signed_snapshot where report_id = r.id) as signed_hash,
      (select count(*)::integer from integration.outbox_event where aggregate_id = r.id) as projection_events
    from clinical.report r where r.id = $1`, [reportId, groupInstanceId, requiredOccurrenceId])).rows[0],
  immutableBeforeLateSave);
  await assert.rejects(client.query(`update clinical_audit.post_signature_audit_note
    set attempted_change = attempted_change where report_id = $1`, [reportId]), /append-only/);
  await assert.rejects(client.query("delete from clinical_audit.post_signature_audit_note where report_id = $1", [reportId]),
    /append-only/);
  await assert.rejects(client.query("update clinical.element_occurrence set value_text = 'forbidden' where id = $1", [requiredOccurrenceId]),
    (error) => error.code === "P0001");
  await assert.rejects(client.query("delete from clinical.report where id = $1", [reportId]),
    (error) => error.code === "P0001");

  const signedHash = signed.payload.canonicalSha256;
  const codedBeforeAmendment = (await client.query(`select id, element_id, group_instance_id, ordinal,
      code, code_system, code_display, terminology_version
    from clinical.element_occurrence where id = $1`, [codedOccurrence.id])).rows[0];
  const replacementOccurrenceId = randomUUID();
  const amendmentCommand = {
    commandId: randomUUID(), expectedSequence: 1, authorId: userId,
    reason: "Correct the required response and replace a coded occurrence",
    attestation: { meaning: "author approval of amendment", version: 1 },
    actorPersona: "clinician", sessionId: "integration-amendment", deviceId: "force-amendment-rollback",
    clientTime: "2026-08-30T15:00:00-04:00",
    changes: [
      { action: "replace", targetElementOccurrenceId: requiredOccurrenceId,
        value: { kind: "text", value: "corrected by amendment" } },
      { action: "remove", targetElementOccurrenceId: codedOccurrence.id },
      { action: "add", occurrence: {
        id: replacementOccurrenceId, elementId: codedBeforeAmendment.element_id,
        groupInstanceId: codedBeforeAmendment.group_instance_id, ordinal: codedBeforeAmendment.ordinal,
        value: { kind: "coded", code: codedBeforeAmendment.code,
          codeSystem: codedBeforeAmendment.code_system, display: codedBeforeAmendment.code_display,
          terminologyVersion: codedBeforeAmendment.terminology_version }
      } }
    ]
  };
  const unauthenticatedAmendment = await fetch(`${baseUrl}/reports/${reportId}/amendments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amendmentCommand)
  });
  assert.equal(unauthenticatedAmendment.status, 404);
  const authenticatedAmendment = await fetch(`${baseUrl}/reports/${reportId}/amendments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${integrationAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(amendmentCommand)
  });
  assert.equal(authenticatedAmendment.status, 404);
  assert.deepEqual((await client.query(`select
      (select count(*)::integer from clinical.amendment where report_id = $1) as amendments,
      (select count(*)::integer from clinical_audit.event where report_id = $1 and action = 'amend') as audits`,
  [reportId])).rows[0], { amendments: 0, audits: 0 });

  await client.query(`create function clinical.integration_reject_amendment_audit()
    returns trigger language plpgsql as $$ begin
      if new.device_id = 'force-amendment-rollback' then raise exception 'forced amendment rollback'; end if;
      return new;
    end; $$;
    create trigger integration_reject_amendment_audit before insert on clinical_audit.event
    for each row execute function clinical.integration_reject_amendment_audit()`);
  try {
    await assert.rejects(amendments.amend(reportId, amendmentCommand), /forced amendment rollback/);
  } finally {
    await client.query("drop trigger integration_reject_amendment_audit on clinical_audit.event");
    await client.query("drop function clinical.integration_reject_amendment_audit()");
  }
  assert.deepEqual((await client.query(`select
      (select count(*)::integer from clinical.amendment where report_id = $1) as amendments,
      (select count(*)::integer from clinical.amendment_change ac join clinical.amendment a on a.id = ac.amendment_id where a.report_id = $1) as changes,
      (select count(*)::integer from clinical_audit.event where report_id = $1 and action = 'amend') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = $1 and event_type = 'amendment') as events,
      (select count(*)::integer from clinical.command_receipt where idempotency_key = $2) as receipts`,
  [reportId, amendmentCommand.commandId])).rows[0],
  { amendments: 0, changes: 0, audits: 0, events: 0, receipts: 0 });

  amendmentCommand.deviceId = "unit-7";
  const amended = await amendments.amend(reportId, amendmentCommand);
  assert.equal(amended.amendmentSequence, 1);
  assert.equal(amended.changeCount, 3);
  assert.equal(amended.reason, amendmentCommand.reason);
  assert.match(amended.canonicalSha256, /^[a-f0-9]{64}$/);
  const amendmentState = (await client.query(`select a.sequence, a.author_id, a.reason, a.attestation,
      count(ac.id)::integer as changes,
      (select canonical_sha256 from clinical.signed_snapshot where report_id = a.report_id) as signed_hash,
      (select value_text from clinical.element_occurrence where id = $2) as original_value,
      (select count(*)::integer from clinical.element_occurrence where id = $3) as added_in_original,
      (select count(*)::integer from clinical_audit.event where report_id = a.report_id and action = 'amend') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = a.report_id and event_type = 'amendment') as events
    from clinical.amendment a join clinical.amendment_change ac on ac.amendment_id = a.id
    where a.report_id = $1 group by a.id`, [reportId, requiredOccurrenceId, replacementOccurrenceId])).rows[0];
  assert.deepEqual(amendmentState, {
    sequence: 1, author_id: userId, reason: amendmentCommand.reason,
    attestation: amendmentCommand.attestation, changes: 3, signed_hash: signedHash,
    original_value: "required", added_in_original: 0, audits: 1, events: 1
  });
  const unauthenticatedReplay = await fetch(`${baseUrl}/reports/${reportId}/amendments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amendmentCommand)
  });
  assert.equal(unauthenticatedReplay.status, 404);
  assert.equal((await client.query("select count(*)::integer as count from clinical.amendment where report_id = $1", [reportId])).rows[0].count, 1);

  const replayedAmendment = await amendments.amend(reportId, amendmentCommand);
  assert.deepEqual(replayedAmendment, amended);
  await assert.rejects(amendments.amend(reportId, {
    ...amendmentCommand, commandId: randomUUID(), changes: [
      { action: "replace", targetElementOccurrenceId: requiredOccurrenceId, value: { kind: "text", value: "stale" } }
    ]
  }), (error) => error?.getStatus?.() === 409);
  assert.equal((await client.query("select count(*)::integer as count from clinical.amendment where report_id = $1", [reportId])).rows[0].count, 1);
  await assert.rejects(client.query("update clinical.amendment set reason = 'mutated' where id = $1", [amended.amendmentId]),
    (error) => error.code === "P0001");

  const history = await client.query(`select event_type, report_revision, amendment_sequence,
      actor_id, actor_name, actor_persona, session_id, device_id, client_time, history_timestamp,
      target_type, previous_hash, event_hash
    from clinical_history.report_history where report_id = $1
    order by history_timestamp, history_id`, [reportId]);
  assert.equal(history.rows.filter((row) => row.event_type === "draft-change").length, 8);
  const signHistory = history.rows.find((row) => row.event_type === "sign");
  const amendmentHistory = history.rows.find((row) => row.event_type === "amend");
  assert.deepEqual({
    report_revision: signHistory.report_revision,
    actor_id: signHistory.actor_id,
    actor_name: signHistory.actor_name,
    actor_persona: signHistory.actor_persona,
    session_id: signHistory.session_id,
    device_id: signHistory.device_id,
    target_type: signHistory.target_type,
    previous_hash: signHistory.previous_hash
  }, {
    report_revision: "8",
    actor_id: userId,
    actor_name: "Clinician",
    actor_persona: "clinician",
    session_id: "integration-signing",
    device_id: "unit-7",
    target_type: "signed_snapshot",
    previous_hash: null
  });
  assert.deepEqual({
    report_revision: amendmentHistory.report_revision,
    amendment_sequence: amendmentHistory.amendment_sequence,
    actor_id: amendmentHistory.actor_id,
    target_type: amendmentHistory.target_type,
    previous_hash: amendmentHistory.previous_hash
  }, {
    report_revision: "8",
    amendment_sequence: 1,
    actor_id: userId,
    target_type: "amendment",
    previous_hash: signHistory.event_hash
  });
  assert.ok(signHistory.client_time instanceof Date);
  assert.ok(signHistory.history_timestamp instanceof Date);
  assert.ok(amendmentHistory.history_timestamp instanceof Date);
});
