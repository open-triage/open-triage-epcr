import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { UnauthorizedException } from "@nestjs/common";
import pg from "pg";
import { AppModule } from "../dist/app.module.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";
import { routeDispatchAssignment } from "../dist/dispatch/dispatch-assignment.projection.js";
import {
  DEMO_CLINICIAN_PASSWORD,
  DEMO_CLINICIAN_USERNAME,
  ClinicianSessionService
} from "../dist/sessions/clinician-session.service.js";
import { AccountService } from "../dist/identity/account.service.js";
import { AdminService } from "../dist/admin/admin.service.js";
import { CatalogAuthoringService } from "../dist/admin/catalog-authoring.service.js";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";

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
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  if (!release.rows[0]) {
    await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/load-nemsis-catalog.mjs")], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });
  }
}

integrationTest("provisioned local accounts require password replacement and use durable revocable sessions", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = { query: async (sql, parameters) => (await client.query(sql, parameters)).rows };
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const organizationId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Local identity', 'UTC')", [organizationId]);

  const provisioned = await accounts.provision({
    organizationId, username: `owner.${randomUUID()}`, displayName: "Installation Owner",
    role: "owner", temporaryPassword: "Temporary!Password-253"
  });
  const credential = await client.query(
    "select username, password_verifier, must_change_password from app_identity.local_credential where user_id = $1",
    [provisioned.userId]
  );
  assert.equal(credential.rows[0].must_change_password, true);
  assert.doesNotMatch(credential.rows[0].password_verifier, /Temporary!Password-253/);

  const limited = await sessions.create({ username: provisioned.username, password: "Temporary!Password-253" });
  assert.equal(limited.session.passwordChangeRequired, true);
  assert.equal(limited.session.accessToken, undefined);
  assert.ok(limited.session.capabilities.includes("installation:administer"));
  await assert.rejects(sessions.get(limited.sessionToken), /password change is required/i);

  const active = await sessions.changePassword(limited.sessionToken, {
    currentPassword: "Temporary!Password-253", newPassword: "Permanent!Password-253",
    csrfToken: limited.session.csrfToken
  });
  assert.equal(active.session.passwordChangeRequired, false);
  await assert.rejects(sessions.get(limited.sessionToken), UnauthorizedException);
  assert.equal((await sessions.get(active.sessionToken)).organization.id, organizationId);
  assert.equal((await sessions.requireCapability(active.sessionToken, "installation:administer")).user.id, provisioned.userId);
  await assert.rejects(sessions.get(active.sessionToken, new Date(active.session.expiresAt)), UnauthorizedException);
  await assert.rejects(sessions.end(active.sessionToken, "forged-csrf"), /CSRF/);
  await sessions.end(active.sessionToken, active.session.csrfToken);
  await assert.rejects(sessions.get(active.sessionToken), UnauthorizedException);

  const beforeReset = await sessions.create({ username: provisioned.username, password: "Permanent!Password-253" });
  await assert.rejects(sessions.create({ username: provisioned.username, password: "wrong password value" }), UnauthorizedException);
  await accounts.resetPassword(provisioned.username, "Reset!Temporary-Password-253");
  await assert.rejects(sessions.get(beforeReset.sessionToken), UnauthorizedException);
  const reset = await sessions.create({ username: provisioned.username, password: "Reset!Temporary-Password-253" });
  assert.equal(reset.session.passwordChangeRequired, true);
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
  await assert.rejects(client.query("update app_identity.authentication_event set result = 'failed' where target_user_id = $1", [provisioned.userId]));
});

integrationTest("authorized Admin context resolves only the session organization's active configuration", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  const database = { query: async (sql, parameters) => (await client.query(sql, parameters)).rows };
  const accounts = new AccountService(database);
  const sessions = new ClinicianSessionService(database);
  const admin = new AdminService(database, sessions);
  const organizationId = randomUUID();
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const unitId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Admin shell', 'UTC')", [organizationId]);
  const owner = await accounts.provision({
    organizationId, username: `admin.${randomUUID()}`, displayName: "Installation Owner",
    role: "owner", temporaryPassword: "Temporary!Password-254"
  });
  const temporary = await sessions.create({ username: owner.username, password: "Temporary!Password-254" });
  const active = await sessions.changePassword(temporary.sessionToken, {
    currentPassword: "Temporary!Password-254", newPassword: "Permanent!Password-254",
    csrfToken: temporary.session.csrfToken
  });
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1' limit 1");
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
    catalog: { id: release.rows[0].id, standard: "NEMSIS", version: "3.5.1" },
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
  const authoring = new CatalogAuthoringService(transactionalDatabase, sessions);
  const draft = await authoring.cloneActive(active.sessionToken);
  assert.equal(draft.revision, 1);
  const changedElement = draft.definition.elements[0];
  const changedList = draft.definition.codeLists[0];
  assert.ok(changedList, "the NEMSIS catalog should expose a recommended list");
  const disabledValue = changedList.values[0];
  const localValue = { code: `LOCAL-${randomUUID()}`, codeSystem: "Local identity", label: "Locally managed choice",
    sourceLabel: "Locally managed choice", category: null, enabled: true };
  const changedDefinition = { ...draft.definition, elements: draft.definition.elements.map((element) =>
    element.elementId === changedElement.elementId ? { ...element, agencyRequired: !element.agencyRequired } : element),
    codeLists: draft.definition.codeLists.map((list) => list.listId === changedList.listId ? { ...list,
      values: [localValue, ...list.values.map((value) => value.code === disabledValue.code && value.codeSystem === disabledValue.codeSystem
        ? { ...value, label: `${value.label} (agency label)`, enabled: false } : value)],
      defaultValue: { code: localValue.code, codeSystem: localValue.codeSystem } } : list) };
  const saved = await authoring.save(active.sessionToken, draft.id, { expectedRevision: 1, definition: changedDefinition });
  await assert.rejects(authoring.save(active.sessionToken, draft.id, { expectedRevision: 1, definition: changedDefinition }),
    /revision is stale/i);
  const validation = await authoring.validate(active.sessionToken, draft.id);
  assert.equal(validation.valid, true);
  assert.equal(validation.projectionsVerified, true);
  const published = await authoring.publish(active.sessionToken, draft.id, {
    expectedRevision: saved.revision, definitionSha256: saved.definitionSha256,
    changeNote: "Agency validation acceptance journey"
  });
  assert.equal(published.projectionsVerified, true);
  const requiredness = await client.query(`select
    (select agency_required from catalog.element_definition where release_id=$1 and element_id=$3) source_required,
    (select agency_required from catalog.element_definition where release_id=$2 and element_id=$3) published_required`,
  [release.rows[0].id, published.id, changedElement.elementId]);
  assert.equal(requiredness.rows[0].source_required, null);
  assert.equal(requiredness.rows[0].published_required, !changedElement.agencyRequired);
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
    { code: localValue.code, display: localValue.label, enabled: true, sort_order: 0, is_default: true },
    { code: disabledValue.code, display: `${disabledValue.label} (agency label)`, enabled: false, sort_order: 1, is_default: false }
  ]);
  await assert.rejects(client.query("update catalog.element_definition set name='mutated' where release_id=$1 and element_id=$2",
    [published.id, changedElement.elementId]), /immutable/);
  await assert.rejects(client.query(`insert into catalog.element_option
    (release_id, element_id, source_kind, code, display, code_system) values ($1,$2,'inline','late-code','Late','')`,
    [published.id, changedElement.elementId]), /sealed and immutable/);
  await assert.rejects(client.query("update catalog.value_set_option set display='mutated' where release_id=$1 and value_set_id=$2",
    [published.id, changedList.listId]), /immutable/);
  await assert.rejects(client.query("update catalog.value_set_option_configuration set enabled=true where release_id=$1 and value_set_id=$2",
    [published.id, changedList.listId]), /immutable/);
  const event = await client.query("select result, change_note from catalog.publication_event where release_id=$1", [published.id]);
  assert.deepEqual(event.rows[0], { result: "succeeded", change_note: "Agency validation acceptance journey" });

  const forms = new FormAuthoringService(transactionalDatabase, sessions);
  const formDraft = await forms.clone(active.sessionToken, { catalogReleaseId: published.id });
  assert.equal(formDraft.catalogReleaseId, published.id);
  assert.equal(formDraft.clonedFromId, formVersionId);
  assert.deepEqual(formDraft.definition, activeFormDefinition);
  assert.deepEqual(formDraft.diagnostics, []);
  const editedFormDefinition = { ...formDraft.definition,
    sections: [formDraft.definition.sections[2], formDraft.definition.sections[0]] };
  const formSaved = await forms.save(active.sessionToken, formDraft.id, {
    expectedRevision: formDraft.revision, definition: editedFormDefinition
  });
  assert.equal(formSaved.revision, formDraft.revision + 1);
  assert.deepEqual(formSaved.definition.sections.map(({ key }) => key), ["situation", "dispatch"]);
  const persistedFormDraft = await forms.current(active.sessionToken);
  assert.deepEqual(persistedFormDraft.definition.sections.map(({ key }) => key), ["situation", "dispatch"]);
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
    capabilities: ["installation:administer"]
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
    locales: [{ locale: "en-US", translations: { title: "Clinical form" } }],
    sections: [{
      key: "clinical",
      presentation: { title: "Clinical" },
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
    assert.deepEqual(payload.projections, { sections: 1, fields: 2, rules: 1, locales: 1 });
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
      (select count(*)::integer from forms.form_rule where form_version_id = $1) as rules,
      (select count(*)::integer from forms.form_locale where form_version_id = $1) as locales
      from forms.form_version where id = $1`, [draft.versionId]);
    assert.deepEqual(state.rows[0], { status: "draft", sections: 0, fields: 0, rules: 0, locales: 0 });
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

integrationTest("the seeded clinician retrieves the server-authoritative demo unit assignment", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/bootstrap-synthetic-installation.mjs"), "--settings", path.join(repoRoot, "packages/contracts/config/installation.synthetic-demo.json")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const signIn = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DEMO_CLINICIAN_USERNAME, password: DEMO_CLINICIAN_PASSWORD })
  });
  assert.equal(signIn.status, 201);
  const session = await signIn.json();
  const sessionCookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(signIn.headers.get("set-cookie") ?? "", /HttpOnly.*Secure.*SameSite=Strict/i);
  assert.equal(session.accessToken, undefined);
  const response = await fetch(`${baseUrl}/calls/assigned`, {
    headers: { cookie: sessionCookie }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.assignedCalls.length, 1);
  assert.match(payload.assignedCalls[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...payload.assignedCalls[0], id: undefined }, {
    id: undefined,
    callNumber: "SYN-20260903-001",
    unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "SYNTHETIC-MEDIC-7" },
    dispatchedAt: "2026-08-15T13:14:00.000Z",
    dispatchReason: "Chest Pain (Non-Traumatic)",
    dispatchPriority: { code: "2305003", display: "Emergent" },
    chiefComplaint: null,
    agencyTimeZone: "UTC",
    status: "assigned"
  });
  assert.deepEqual(payload.canceledAssignmentIds, []);

  try {
    await client.query("update clinical.call_assignment set status = 'canceled' where id = $1", [payload.assignedCalls[0].id]);
    const canceled = await fetch(`${baseUrl}/calls/assigned`, {
      headers: { cookie: sessionCookie }
    });
    const canceledPayload = await canceled.json();
    assert.deepEqual(canceledPayload.assignedCalls, []);
    assert.deepEqual(canceledPayload.canceledAssignmentIds, [payload.assignedCalls[0].id]);
  } finally {
    await client.query("update clinical.call_assignment set status = 'assigned' where id = $1", [payload.assignedCalls[0].id]);
  }
});

integrationTest("assignment opening is idempotent, creator-owned, form-pinned, and advances the demo", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/bootstrap-synthetic-installation.mjs"), "--settings", path.join(repoRoot, "packages/contracts/config/installation.synthetic-demo.json")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const signIn = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DEMO_CLINICIAN_USERNAME, password: DEMO_CLINICIAN_PASSWORD })
  });
  const session = await signIn.json();
  const sessionCookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
  const assignmentId = (await client.query(`
    select id from clinical.call_assignment
    where organization_id = '32000000-0000-4000-8000-000000000001'
      and dispatch_source_id = 'synthetic-bootstrap'
      and status = 'assigned'
  `)).rows[0].id;
  const latestBeforeOpen = (await client.query(`
    select fv.id from forms.form_version fv
    join app_identity.operational_unit ou on ou.default_form_id = fv.form_id
    where ou.id = '32000000-0000-4000-8000-000000000010' and fv.status = 'published'
    order by fv.version desc limit 1
  `)).rows[0].id;
  let opened;
  try {
    const requestOpen = async () => {
      const response = await fetch(`${baseUrl}/calls/${assignmentId}/open`, {
        method: "POST",
        headers: { cookie: sessionCookie, "x-csrf-token": session.csrfToken }
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    opened = await requestOpen();
    const retry = await requestOpen();
    assert.equal(retry.report.id, opened.report.id);
    assert.deepEqual(retry.report.document, opened.report.document);
    assert.equal(retry.replacementAssignment, null);
    assert.equal(opened.report.documentingUserId, session.user.id);
    assert.equal(opened.report.formVersionId, latestBeforeOpen);
    assert.equal(opened.report.document.modelVersion, "1.1.0");
    assert.equal(opened.report.document.encounter.id, opened.report.id);
    assert.equal(opened.report.document.groups.find(({ id }) => id === "eRecordSection")
      .instances[0].elements.find(({ id }) => id === "eRecord.01").values[0].value,
      `PCR-${opened.report.id}`);
    assert.equal(opened.replacementAssignment.callNumber, "SYN-20260903-002");
    assert.equal(opened.replacementAssignment.dispatchedAt, "2026-08-15T13:29:00.000Z");
    const generatedDispatch = (await client.query(`
      select ca.response_number, ca.dispatch_source_record_id, dr.source_payload
      from clinical.call_assignment ca
      join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
      where ca.id = $1
    `, [opened.replacementAssignment.id])).rows[0];
    const generatedElement = (id) => generatedDispatch.source_payload.groups.flatMap((group) => group.instances)
      .flatMap((instance) => instance.elements).find((element) => element.id === id).values[0].value;
    assert.equal(generatedDispatch.response_number, "SYN-20260903-002-1");
    assert.equal(generatedDispatch.dispatch_source_record_id, "SYNTHETIC-SOURCE-RECORD-0002");
    assert.equal(generatedElement("eResponse.03"), "SYN-20260903-002");
    assert.equal(generatedElement("eResponse.04"), "SYN-20260903-002-1");
    assert.equal(generatedElement("eTimes.02"), "2026-08-15T09:28:52-04:00");
    assert.equal(generatedElement("eTimes.03"), "2026-08-15T09:29:00-04:00");

    const state = (await client.query(`
      select ca.status, ca.report_id, r.documenting_user_id, r.form_version_id,
        (select count(*)::integer from clinical.report where incident_id = ca.incident_id) as reports,
        (select count(*)::integer from clinical.patient where id = r.patient_id) as patients,
        (select count(*)::integer from clinical.element_occurrence
         where report_id = r.id and element_id = 'eRecord.01') as pcr_numbers
      from clinical.call_assignment ca join clinical.report r on r.id = ca.report_id
      where ca.id = $1
    `, [assignmentId])).rows[0];
    assert.deepEqual(state, {
      status: "opened", report_id: opened.report.id, documenting_user_id: session.user.id,
      form_version_id: latestBeforeOpen, reports: 1, patients: 1, pcr_numbers: 1
    });

    const reopenedResponse = await fetch(`${baseUrl}/reports/${opened.report.id}/reopen`, {
      method: "POST", headers: { authorization: `Bearer ${session.accessToken}` }
    });
    assert.equal(reopenedResponse.status, 200);
    const reopened = await reopenedResponse.json();
    assert.deepEqual(reopened.report.document, opened.report.document);
    assert.deepEqual(reopened.dispatchPriority, { code: "2305003", display: "Emergent" });

    const openCallsResponse = await fetch(`${baseUrl}/reports/open`, {
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    assert.equal(openCallsResponse.status, 200);
    const openCalls = await openCallsResponse.json();
    assert.deepEqual(openCalls.openCalls.find(({ reportId }) => reportId === opened.report.id)?.dispatchPriority,
      { code: "2305003", display: "Emergent" });

    const laterVersionId = randomUUID();
    const laterDefinition = { schemaVersion: 1, sections: [{
      key: "replacement", presentation: { title: "Replacement configuration" }, fields: []
    }] };
    await client.query(`
      insert into forms.form_version
        (id, form_id, catalog_release_id, version, status, canonical_definition,
         definition_sha256, change_note, created_by, published_by, published_at,
         publication_acknowledgements)
      select $1, fv.form_id, fv.catalog_release_id,
             (select max(version) + 1 from forms.form_version where form_id = fv.form_id),
             'published', $3::jsonb, repeat('f', 64),
             'Published after assignment opening', fv.created_by, fv.created_by, now(), '{}'
      from forms.form_version fv where fv.id = $2
    `, [laterVersionId, latestBeforeOpen, JSON.stringify(laterDefinition)]);
    await client.query(`update forms.agency_stationary_default
      set form_version_id = $2, activated_by = $3, activated_at = now()
      where organization_id = $1`, [session.organization.id, laterVersionId, session.user.id]);

    const reopenedAfterActivationResponse = await fetch(`${baseUrl}/reports/${opened.report.id}/reopen`, {
      method: "POST", headers: { cookie: sessionCookie }
    });
    assert.equal(reopenedAfterActivationResponse.status, 200);
    const reopenedAfterActivation = await reopenedAfterActivationResponse.json();
    assert.equal(reopenedAfterActivation.report.formVersionId, latestBeforeOpen);
    assert.equal(reopenedAfterActivation.report.catalogReleaseId, opened.report.catalogReleaseId);
    assert.deepEqual(reopenedAfterActivation.report.clinicalForm, opened.report.clinicalForm);
    assert.deepEqual(reopenedAfterActivation.report.document, opened.report.document);
    await assert.rejects(client.query("update clinical.report set form_version_id = $2 where id = $1",
      [opened.report.id, laterVersionId]), /identity and pinned configuration are immutable/);
  } finally {
    await client.query(`update forms.agency_stationary_default
      set form_version_id = $2, activated_by = $3, activated_at = now()
      where organization_id = $1`, [session.organization.id, latestBeforeOpen, session.user.id]);
    if (opened) {
      await client.query("begin");
      try {
        const replacement = await client.query("select incident_id from clinical.call_assignment where id = $1", [opened.replacementAssignment.id]);
        await client.query("update clinical.call_assignment set status = 'assigned', report_id = null where id = $1", [assignmentId]);
        await client.query("delete from clinical.call_assignment where id = $1", [opened.replacementAssignment.id]);
        const patient = await client.query("select patient_id from clinical.report where id = $1", [opened.report.id]);
        await client.query("delete from clinical.report where id = $1", [opened.report.id]);
        if (patient.rows[0]) await client.query("delete from clinical.patient where id = $1", [patient.rows[0].patient_id]);
        if (replacement.rows[0]) await client.query("delete from clinical.incident where id = $1", [replacement.rows[0].incident_id]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  }
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
        where e.release_id = $1 and e.base_datatype = 'string' order by e.element_id limit 1) as text_id,
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

  const app = await NestFactory.create(AppModule, { logger: false });
  const integrationAccessToken = "draft-api-owner-token";
  app.get(ClinicianSessionService).get = (token) => {
    assert.equal(token, integrationAccessToken);
    return {
      accessToken: integrationAccessToken,
      user: { id: userId, displayName: "Clinician" },
      organization: { id: organizationId, name: "Draft API" },
      startedAt: "2026-09-03T08:00:00.000Z",
      expiresAt: "2026-09-03T22:00:00.000Z"
    };
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
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
  };

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
      occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id, ordinal: 0,
        value: { kind: "text", value: "disjoint-a" } }]
    }),
    saveMerge({
      commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "disjoint-b",
      clientTime: clientTime(2),
      occurrences: [{ id: mergeOccurrenceB, elementId: ids.text_id, ordinal: 1,
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
      clientTime: clientTime(10), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
        value: { kind: "text", value: "collision-older" } }] },
    { commandId: randomUUID(), expectedRevision: 2, authorId: userId, deviceId: "collision-newer",
      clientTime: clientTime(20), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
        value: { kind: "text", value: "collision-newer" } }] }
  ];
  const collisions = await Promise.all(collisionCommands.map(saveMerge));
  assert.deepEqual(collisions.map(({ response }) => response.status), [201, 201]);
  assert.deepEqual(collisions.map(({ payload }) => payload.revision).sort((a, b) => a - b), [3, 4]);
  assert.equal((await client.query("select value_text from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].value_text, "collision-newer");

  const mergeDeleteCommand = {
    commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "delete-newer",
    clientTime: clientTime(40), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id, tombstone: true }]
  };
  const editDelete = await Promise.all([
    saveMerge({
      commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "edit-older",
      clientTime: clientTime(30), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
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
    clientTime: clientTime(50), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
      value: { kind: "text", value: "resurrected" } }]
  });
  assert.equal(resurrected.response.status, 201, JSON.stringify(resurrected.payload));
  assert.equal(resurrected.payload.revision, 7);

  await saveMerge({
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "skew-base",
    clientTime: clientTime(60), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
      value: { kind: "text", value: "sane-base" } }]
  });
  const futureCommand = {
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "future-clock",
    clientTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
      value: { kind: "text", value: "future-clock" } }]
  };
  await saveMerge(futureCommand);
  const afterSkew = await saveMerge({
    commandId: randomUUID(), expectedRevision: 7, authorId: userId, deviceId: "sane-after-skew",
    clientTime: clientTime(70), occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id,
      value: { kind: "text", value: "sane-after-skew" } }]
  });
  assert.equal(afterSkew.payload.revision, 10);
  assert.equal((await client.query("select value_text from clinical.element_occurrence where id = $1",
    [mergeOccurrenceA])).rows[0].value_text, "sane-after-skew");

  const tieTime = clientTime(80);
  await saveMerge({
    commandId: randomUUID(), expectedRevision: 10, authorId: userId, deviceId: "tie-first", clientTime: tieTime,
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id, value: { kind: "text", value: "tie-first" } }]
  });
  const tieSecondCommand = {
    commandId: randomUUID(), expectedRevision: 10, authorId: userId, deviceId: "tie-second", clientTime: tieTime,
    occurrences: [{ id: mergeOccurrenceA, elementId: ids.text_id, value: { kind: "text", value: "tie-second" } }]
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

  const sign = (body) => request(`/reports/${reportId}/sign`, "POST", body);
  const missingRequired = await sign({
    commandId: randomUUID(), expectedRevision: 5, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(missingRequired.response.status, 422, JSON.stringify(missingRequired.payload));
  assert.ok(missingRequired.payload.findings.some((finding) => finding.code === "form.required"));
  assert.ok(missingRequired.payload.findings.some((finding) => finding.code === "form.conditional-required"));
  const rejectedState = (await client.query(`select status, revision,
      (select count(*)::integer from clinical.signed_snapshot where report_id = $1) as snapshots,
      (select count(*)::integer from clinical.validation_finding where report_id = $1) as findings
    from clinical.report where id = $1`, [reportId])).rows[0];
  assert.deepEqual({ status: rejectedState.status, revision: rejectedState.revision, snapshots: rejectedState.snapshots },
    { status: "draft", revision: "5", snapshots: 0 });
  assert.ok(rejectedState.findings >= 2);

  const requiredOccurrenceId = randomUUID();
  const secondRequiredOccurrenceId = randomUUID();
  const requiredSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 5, authorId: userId,
    occurrences: [{ id: requiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, ordinal: 0, value: { kind: "text", value: "required" } }]
  });
  assert.equal(requiredSaved.response.status, 201, JSON.stringify(requiredSaved.payload));
  const duplicateSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 6, authorId: userId,
    occurrences: [{ id: secondRequiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, ordinal: 1, value: { kind: "text", value: "duplicate" } }]
  });
  assert.equal(duplicateSaved.response.status, 201, JSON.stringify(duplicateSaved.payload));
  const invalidCardinality = await sign({
    commandId: randomUUID(), expectedRevision: 7, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidCardinality.response.status, 422, JSON.stringify(invalidCardinality.payload));
  assert.ok(invalidCardinality.payload.findings.some((finding) => finding.code === "catalog.cardinality"));
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
    where report_id = $1 and element_id = $2 and tombstoned_at is null`, [reportId, ids.coded_id])).rows[0];
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
    assert.equal(rolledBackSign.response.status, 500);
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
  const signed = await sign(signCommand);
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
  await client.query(`create function clinical.integration_reject_amendment_audit()
    returns trigger language plpgsql as $$ begin
      if new.device_id = 'force-amendment-rollback' then raise exception 'forced amendment rollback'; end if;
      return new;
    end; $$;
    create trigger integration_reject_amendment_audit before insert on clinical_audit.event
    for each row execute function clinical.integration_reject_amendment_audit()`);
  try {
    const rolledBackAmendment = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
    assert.equal(rolledBackAmendment.response.status, 500);
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
  const amended = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
  assert.equal(amended.response.status, 201, JSON.stringify(amended.payload));
  assert.equal(amended.payload.amendmentSequence, 1);
  assert.equal(amended.payload.changeCount, 3);
  assert.equal(amended.payload.reason, amendmentCommand.reason);
  assert.match(amended.payload.canonicalSha256, /^[a-f0-9]{64}$/);
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
  const replayedAmendment = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
  assert.equal(replayedAmendment.response.status, 201);
  assert.deepEqual(replayedAmendment.payload, amended.payload);
  const staleAmendment = await request(`/reports/${reportId}/amendments`, "POST", {
    ...amendmentCommand, commandId: randomUUID(), changes: [
      { action: "replace", targetElementOccurrenceId: requiredOccurrenceId, value: { kind: "text", value: "stale" } }
    ]
  });
  assert.equal(staleAmendment.response.status, 409);
  assert.equal((await client.query("select count(*)::integer as count from clinical.amendment where report_id = $1", [reportId])).rows[0].count, 1);
  await assert.rejects(client.query("update clinical.amendment set reason = 'mutated' where id = $1", [amended.payload.amendmentId]),
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
