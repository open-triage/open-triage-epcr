import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { readMigrations, applyMigrations } from "../../../packages/database/scripts/migrate.mjs";
import { AccountService } from "../dist/identity/account.service.js";
import { ClinicianSessionService } from "../dist/sessions/clinician-session.service.js";
import { OrganizationsService } from "../dist/admin/organizations.service.js";
import { agencyRequest } from "../dist/sessions/agency-context.js";
import { reviewScope, reviewTargetScope } from "../dist/review/review-scope.js";
import { ReviewService } from "../dist/review/review.service.js";
import { CatalogAuthoringService } from "../dist/admin/catalog-authoring.service.js";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import { localPolicy } from "../dist/authentication/local-policy.js";
import { AgencySettingsService } from "../dist/admin/agency-settings.service.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import { OwnershipTransferService } from "../dist/admin/ownership-transfer.service.js";

import { runIdentityAccountCli } from '../dist/identity/identity-account.cli.js';
import { beginAuthenticationAttempt } from '../dist/sessions/authentication-throttle.js';
import { UserProvisioningService } from '../dist/admin/user-provisioning.service.js';
import { UserRoleReadService } from '../dist/admin/user-role-read.service.js';
import { SessionAdministrationService } from '../dist/admin/session-administration.service.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
integration("isolated agencies share staff only within their parent group; owner manages all agencies", async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const name = `multi_org_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create database ${name}`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() }); await client.connect();
  const database = new DataSource({ type: "postgres", url: url.toString(), extra: { options: "-c role=open_triage_api_runtime" } });
  const priorSecret = process.env.AUTH_RATE_LIMIT_SECRET_BASE64;
  process.env.AUTH_RATE_LIMIT_SECRET_BASE64 = randomBytes(32).toString("base64");
  try {
    const migrations = await readMigrations(fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)));
    await applyMigrations(client, migrations, { info() {} });
    const root = randomUUID(), catalog = randomUUID();
    await client.query("insert into app_identity.organization(id,name,deployment_timezone) values ($1,'Owner agency','UTC')", [root]);
    await client.query(`insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance,sealed)
      values ($1,'Test','1','EMSDataSet','1',$2,'{}',false)`, [catalog, "a".repeat(64)]);
    const elementIdentity = randomUUID();
    await client.query("insert into catalog.element_identity(id,namespace,canonical_key) values ($1,'NEMSIS','eResponse.03')", [elementIdentity]);
    await client.query(`insert into catalog.element_definition(release_id,element_id,element_identity_id,section,name,description,
      national,state,usage,source_datatype,base_datatype,group_path,min_occurs,max_occurs,unbounded,nillable,
      supports_not_values,supports_pertinent_negatives,definition)
      values ($1,'eResponse.03',$2,'eResponse','Incident number','Incident number',false,false,'Optional','string','string',
        '{}',0,1,false,false,false,false,'{}')`, [catalog, elementIdentity]);
    await client.query("update catalog.release set sealed=true where id=$1", [catalog]);
    // Owner bootstrap is an operator action. All subsequent application calls use
    // the restricted API role, including agency creation and its seed triggers.
    const operatorDb = new DataSource({ type: "postgres", url: url.toString() }); await operatorDb.initialize();
    const password = "Synthetic!Agency-Password-42";
    const owner = await new AccountService(operatorDb).bootstrapOwner({ username: "owner",
      displayName: "Owner", temporaryPassword: password,
      operator: { operatorId: "test", osAccount: "test", host: "localhost" } });
    await client.query("update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1", [owner.userId]);
    // Replaying migrations preserves the installation owner and its global reservation.
    await applyMigrations(client, migrations, { info() {} });
    assert.equal((await client.query("select user_id from app_identity.global_username_reservation where username='owner'")).rows[0].user_id, owner.userId);
    await operatorDb.destroy();
    await database.initialize();
    const sessions = new ClinicianSessionService(database);
    const agencies = new OrganizationsService(database, sessions);
    const ownerLogin = await sessions.create({ username: "owner", password });
    assert.equal(ownerLogin.session.installationOwner, true);
    const create = (name, parentOrganizationId, hostname) => agencies.create(ownerLogin.sessionToken, {
      name, parentOrganizationId, hostname, timeZone: "Europe/Stockholm", catalogReleaseId: catalog,
      agencyUniqueStateId: name, agencyNumber: name, stateCode: "TEST",
    });
    const rootAgency = await create("Agency A", null, "agency-a.example.test");
    const child = await create("Child A", rootAgency.id, "child-a.example.test");
    const other = await create("Agency B", null, "agency-b.example.test");
    const ownerSession = await sessions.switchAgency(ownerLogin.sessionToken, other.id);
    assert.equal(ownerSession.organization.id, other.id);
    assert.ok(ownerSession.capabilities.includes("users:write"));
    assert.equal(ownerSession.agencies.length, 4);
    const forms = new FormAuthoringService(database, sessions, new FormPublicationService(database));
    const catalogs = new CatalogAuthoringService(database, sessions);
    assert.ok((await catalogs.versions(ownerLogin.sessionToken)).some((release) => release.id === catalog));
    const firstForm = await forms.clone(ownerLogin.sessionToken, { catalogReleaseId: catalog, displayName: "First agency form" });
    assert.equal(firstForm.catalogReleaseId, catalog);
    assert.equal((await forms.current(ownerLogin.sessionToken)).id, firstForm.id);
    await sessions.switchAgency(ownerLogin.sessionToken, rootAgency.id);
    assert.equal(await forms.current(ownerLogin.sessionToken), null, "draft forms are private to their agency");
    const staff = randomUUID();
    await client.query("insert into app_identity.app_user(id,organization_id,display_name) values ($1,$2,'Shared clinician')", [staff, rootAgency.id]);
    // Copy only the test password verifier; staff remain a distinct account.
    await client.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password)
      select $1,'staff',password_verifier,false from app_identity.local_credential where user_id=$2`, [staff, owner.userId]);
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='clinician'`, [rootAgency.id, staff, owner.userId]);
    const allowed = async (organization) => (await client.query("select app_identity.user_has_capability($1,$2,'clinical:document') allowed", [staff, organization])).rows[0].allowed;
    assert.equal(await allowed(rootAgency.id), true);
    assert.equal(await allowed(child.id), true);
    assert.equal(await allowed(other.id), false);
    const staffLogin = await agencyRequest.run({ origin: "https://child-a.example.test" }, () => sessions.create({ username: "staff", password }));
    assert.equal(staffLogin.session.organization.id, child.id);
    assert.deepEqual(new Set(staffLogin.session.agencies.map((agency) => agency.id)), new Set([rootAgency.id, child.id]));
    await assert.rejects(agencies.list(staffLogin.sessionToken), /installation owner/);
    await assert.rejects(sessions.switchAgency(staffLogin.sessionToken, other.id), /not available/);
    await assert.rejects(agencyRequest.run({ origin: "https://agency-b.example.test" }, () => sessions.create({ username: "staff", password })), /incorrect/);
    await assert.rejects(agencyRequest.run({ origin: "https://agency-b.example.test" }, () => sessions.get(staffLogin.sessionToken)), /ended/);
    await assert.rejects(agencyRequest.run({ origin: "https://child-a.example.test", organizationId: other.id }, () => sessions.get(staffLogin.sessionToken)), /ended/);
    await assert.rejects(create("Duplicate host", null, child.hostname), /already assigned/);
    await assert.rejects(create("Grandchild", child.id, "grandchild.example.test"), /active parent/);
    await assert.rejects(client.query("update app_identity.organization set parent_organization_id=$2 where id=$1", [other.id, rootAgency.id]), /cannot be moved/);
    await assert.rejects(client.query("update app_identity.app_user set organization_id=$2 where id=$1", [staff, other.id]), /cannot be moved/);
    const rootSession = await sessions.switchAgency(staffLogin.sessionToken, rootAgency.id);
    const shared = reviewScope({ ...rootSession, capabilities: ["review:all", "review:identifying"] });
    assert.deepEqual(new Set(shared.organizationIds), new Set([rootAgency.id, child.id]));
    assert.deepEqual(reviewScope({ ...staffLogin.session, capabilities: ["review:all"] }).organizationIds, [child.id]);
    await assert.rejects(reviewTargetScope(database.manager, shared, randomUUID()), /not found in scope/);
    const review = new ReviewService(database, sessions);
    const itemIds = [];
    for (const agency of [rootAgency, child, other]) {
      await sessions.switchAgency(ownerLogin.sessionToken, agency.id);
      const form = await forms.clone(ownerLogin.sessionToken, { catalogReleaseId: catalog, displayName: `${agency.name} form` });
      await forms.publish(ownerLogin.sessionToken, form.id, { expectedRevision: form.revision,
        definitionSha256: form.definitionSha256, displayName: `${agency.name} form`, changeNote: "Synthetic test form" });
      const incident = randomUUID(), patient = randomUUID(), report = randomUUID();
      await client.query("insert into clinical.incident(id,organization_id) values ($1,$2)", [incident, agency.id]);
      await client.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key) values ($1,$2,'unknown',$3)", [patient, agency.id, randomBytes(32).toString("hex")]);
      await client.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,
        form_version_id,catalog_release_id,documenting_user_id)
        select $1,$2,$3,$4,id,$5,$6,$7 from app_identity.agency_demographic_version where organization_id=$2`,
      [report, agency.id, incident, patient, form.id, catalog, owner.userId]);
      const item = (await client.query(`insert into clinical.review_item(organization_id,report_id,criterion_id,priority,
        first_matched_at,kind,deadline_basis_at,deadline_source,deadline_at)
        values ($1,$2,clinical.review_overdue_criterion_id($1),'high',now(),'overdue-unsigned',now(),'report-created',now()) returning id`, [agency.id, report])).rows[0];
      itemIds.push(item.id);
    }
    await sessions.switchAgency(ownerLogin.sessionToken, rootAgency.id);
    const groupQueue = await review.queue(ownerLogin.sessionToken, { dataset: "real" });
    assert.equal(groupQueue.total, 2);
    assert.deepEqual(new Set(groupQueue.items.map((item) => item.id)), new Set(itemIds.slice(0, 2)));
    const childItem = await review.item(ownerLogin.sessionToken, itemIds[1], "real");
    assert.equal(childItem.id, itemIds[1]);
    await assert.rejects(review.item(ownerLogin.sessionToken, itemIds[2], "real"), /not found in scope/);
    await assert.rejects(review.claim(ownerLogin.sessionToken, itemIds[1], {
      commandId: randomUUID(), expectedVersion: childItem.version, dataset: "real"
    }, ownerLogin.session.csrfToken), /Review-all access is required/);
    assert.equal((await client.query("select count(*)::int n from clinical.review_assignment_history where item_id=$1", [itemIds[1]])).rows[0].n, 0);
    // Group-wide clinical review requires an ordinary account with that role;
    // installation authority cannot claim reports, including its own reports.
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
      select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='reviewer'`,
      [rootAgency.id, staff, owner.userId]);
    await review.claim(staffLogin.sessionToken, itemIds[1], { commandId: randomUUID(), expectedVersion: childItem.version, dataset: "real" }, staffLogin.session.csrfToken);
    const assignment = (await client.query("select organization_id,actor_id from clinical.review_assignment_history where item_id=$1", [itemIds[1]])).rows[0];
    assert.equal(assignment.organization_id, child.id);
    assert.equal(assignment.actor_id, staff);
    await sessions.switchAgency(ownerLogin.sessionToken, child.id);
    assert.equal((await review.queue(ownerLogin.sessionToken, { dataset: "real" })).total, 1);
    // Starting configurations are published copies owned by the destination; all
    // activation checks run before agency creation commits.
    await sessions.switchAgency(ownerLogin.sessionToken, other.id);
    const sourceForm = (await forms.versions(ownerLogin.sessionToken))[0];
    const validations = new ValidationAuthoringService(database, sessions);
    const sourceRule = { id: randomUUID(), name: "Incident check", enabled: false, severity: "error",
      executionTargets: ["sign"], primaryTargetElementId: "eResponse.03", message: "Incident required",
      source: 'assert present("eResponse.03")' };
    const validationDraft = await validations.create(ownerLogin.sessionToken,
      { catalogReleaseId: catalog, displayName: "Starting rules" }, { importedRules: [sourceRule] });
    const publishedValidation = await validations.publish(ownerLogin.sessionToken, validationDraft.id,
      { expectedRevision: validationDraft.revision, displayName: "Starting rules", changeNote: "Fixture" });
    // Agency publication remains eligible even when it is not a baseline import.
    const catalogDraft = await catalogs.cloneActive(ownerLogin.sessionToken, { sourceVersionId: catalog, displayName: "Published agency catalog" });
    await client.query("update catalog.authoring_draft set published_release_id=$2,published_at=now() where id=$1", [catalogDraft.id, catalog]);
    const orphanCatalog = randomUUID();
    await client.query(`insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance,sealed,display_name)
      select $1,standard,'orphan-agency-fixture',dataset,artifact_schema_version,artifact_sha256,$2::jsonb,true,'Integration catalog'
      from catalog.release where id=$3`, [orphanCatalog, JSON.stringify({ organizationId: randomUUID(), sourceReleaseId: catalog }), catalog]);
    const beforeStarting = await agencies.list(ownerLogin.sessionToken);
    assert.ok(beforeStarting.catalogs.some(({ id }) => id === catalog), "published agency catalogs must be selectable");
    assert.ok(!beforeStarting.catalogs.some(({ id }) => id === orphanCatalog), "orphaned integration catalogs must be excluded");
    const startingCommand = { name: "Configured agency", parentOrganizationId: null, hostname: null,
      timeZone: "Europe/Stockholm", catalogReleaseId: catalog, agencyUniqueStateId: "START", agencyNumber: "START", stateCode: "36",
      settings: { language: "sv", regionalFormat: "sv-SE", timeZone: "Europe/Stockholm", syntheticRetentionHours: 48,
        reportMediaAllowanceBytes: 80 * 1024 * 1024, imageMediaLimitBytes: 8 * 1024 * 1024,
        appearance: { ...DEFAULT_AGENCY_APPEARANCE, brandText: "Configured brand", helperText: "Agency credentials only.", pwaName: "Configured app" },
        demographics: { agencyUniqueStateId: "START", agencyNumber: "START", stateCode: "36", stateDisplay: "New York", stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null } },
      startingFormVersionId: sourceForm.id, startingValidationVersionId: publishedValidation.id };
    await assert.rejects(agencies.create(staffLogin.sessionToken, startingCommand), /installation owner/);
    await assert.rejects(agencies.create(ownerLogin.sessionToken, { ...startingCommand, catalogReleaseId: orphanCatalog }), /available published catalog/);
    await assert.rejects(agencies.create(ownerLogin.sessionToken, { ...startingCommand, settings: { ...startingCommand.settings, authenticationLimits: { accountAttemptsPer15Minutes: 25, networkAttemptsPer5Minutes: 70 } } }), /Authentication/, "agency creation cannot bypass personal authentication for group policy changes");
    const configured = await agencies.create(ownerLogin.sessionToken, startingCommand);
    assert.equal((await sessions.get(ownerLogin.sessionToken)).organization.id, other.id, "creation must not switch the browser session");
    const [bundle] = (await client.query("select * from app_identity.active_configuration_bundle where organization_id=$1", [configured.id])).rows;
    assert.ok(bundle);
    assert.notEqual(bundle.form_version_id, sourceForm.id);
    assert.notEqual(bundle.validation_version_id, publishedValidation.id);
    const [copied] = (await client.query("select organization_id,source_rule from validation.version where id=$1", [bundle.validation_version_id])).rows;
    assert.equal(copied.organization_id, configured.id);
    assert.ok(!JSON.stringify(copied.source_rule).includes(sourceRule.id), "rule identities must be newly allocated");
    let directory = await agencies.list(ownerLogin.sessionToken);
    assert.deepEqual(directory.forms.find(({ id }) => id === sourceForm.id).activatedByAgencies, [{ id: configured.id, name: configured.name }]);
    assert.deepEqual(directory.validations.find(({ id }) => id === publishedValidation.id).activatedByAgencies, [{ id: configured.id, name: configured.name }]);
    assert.equal(directory.catalogs[0].id, catalog, "active catalogs sort first");
    assert.deepEqual(directory.catalogs.find(({ id }) => id === catalog).activatedByAgencies, [{ id: configured.id, name: configured.name }]);
    assert.ok(directory.activeConfigurations.some(({ organizationId }) => organizationId === configured.id));
    const incompatible = await validations.create(ownerLogin.sessionToken,
      { catalogReleaseId: catalog, displayName: "Incompatible rules" }, { importedRules: [{ ...sourceRule, id: randomUUID(), enabled: true }] });
    const incompatiblePublished = await validations.publish(ownerLogin.sessionToken, incompatible.id,
      { expectedRevision: incompatible.revision, displayName: "Incompatible rules", changeNote: "Fixture" });
    await assert.rejects(agencies.create(ownerLogin.sessionToken,
      { ...startingCommand, name: "Must roll back", startingValidationVersionId: incompatiblePublished.id }), /Confirm removal/);
    assert.equal((await client.query("select count(*)::int total from app_identity.organization where name='Must roll back'")).rows[0].total, 0);
    await assert.rejects(agencies.create(ownerLogin.sessionToken,
      { ...startingCommand, startingFormVersionId: randomUUID() }), /published against/);
    await sessions.switchAgency(ownerLogin.sessionToken, configured.id);
    const createdSettings = await new AgencySettingsService(database, sessions).get(ownerLogin.sessionToken);
    assert.equal(createdSettings.language, "sv");
    assert.equal(createdSettings.regionalFormat, "sv-SE");
    assert.equal(createdSettings.timeZone, "Europe/Stockholm");
    assert.equal(createdSettings.syntheticRetentionHours, 48);
    assert.equal(createdSettings.reportMediaAllowanceBytes, 80 * 1024 * 1024);
    assert.equal(createdSettings.imageMediaLimitBytes, 8 * 1024 * 1024);
    assert.equal(createdSettings.authenticationLimits.accountAttemptsPer15Minutes, 20);
    assert.equal(createdSettings.appearance.brandText, "Configured brand");
    await client.query("update app_identity.group_authentication_policy set account_attempt_limit=50,network_attempt_limit=90 where group_id=$1", [configured.id]);
    const configuredChild = await agencies.create(ownerLogin.sessionToken, { ...startingCommand, name: "Configured child", parentOrganizationId: configured.id, startingFormVersionId: null, startingValidationVersionId: null });
    assert.equal((await localPolicy(database.manager, configuredChild.id)).accountAttemptsPer15Minutes,50, "ordinary child creation retains its ancestor policy");
    assert.equal((await localPolicy(database.manager, configured.id)).networkAttemptsPer5Minutes,90);
    assert.equal(createdSettings.demographics.stateDisplay, "New York");
    assert.equal(createdSettings.demographics.version, 1, "creation writes the complete initial demographic version");
    const replacement = await forms.clone(ownerLogin.sessionToken, { catalogReleaseId: catalog, displayName: "Replacement" });
    const replacementPublished = await forms.publish(ownerLogin.sessionToken, replacement.id,
      { expectedRevision: replacement.revision, definitionSha256: replacement.definitionSha256, displayName: "Replacement", changeNote: "Fixture" });
    await validations.activate(ownerLogin.sessionToken, bundle.validation_version_id,
      { formVersionId: replacementPublished.id, catalogReleaseId: catalog, changeNote: "Fixture replacement" });
    directory = await agencies.list(ownerLogin.sessionToken);
    assert.deepEqual(directory.forms.find(({ id }) => id === sourceForm.id).activatedByAgencies, [], "usage must follow current activation");
    await sessions.switchAgency(ownerLogin.sessionToken, other.id);
    await client.query(`update app_identity.user_role_assignment set ended_at=now(),ended_by=$2
      where user_id=$1 and ended_at is null`, [staff, owner.userId]);
    assert.equal(await allowed(child.id), false);
    await assert.rejects(sessions.get(staffLogin.sessionToken), /No workspace role/);
    await sessions.switchAgency(ownerLogin.sessionToken, child.id);
    const childProvisioning = new UserProvisioningService(database, sessions);
    const familyUser = await childProvisioning.provision(ownerLogin.sessionToken, {
      username: 'family-user', displayName: 'Family user', temporaryPassword: password, roleIds: [],
    });
    assert.equal((await client.query('select organization_id from app_identity.app_user where id=$1', [familyUser.userId])).rows[0].organization_id, rootAgency.id);
    const users = new UserRoleReadService(database, sessions);
    assert.ok((await users.users(ownerLogin.sessionToken, {})).items.some(user => user.id === familyUser.userId));
    await sessions.switchAgency(ownerLogin.sessionToken, rootAgency.id);
    assert.ok((await users.users(ownerLogin.sessionToken, {})).items.some(user => user.id === familyUser.userId));
    await assert.rejects(childProvisioning.provision(ownerLogin.sessionToken, {
      username: 'family-user', displayName: 'Duplicate', temporaryPassword: password, roleIds: [],
    }), /reserved/);
    await sessions.switchAgency(ownerLogin.sessionToken, other.id);
    assert.equal((await users.users(ownerLogin.sessionToken, {})).items.some(user => user.id === familyUser.userId), false);
    // Equal usernames in independent families must select different accounts,
    // while sibling agencies share the root identity and its reservations.
    const accounts = new AccountService(database);
    const duplicate = await accounts.provision({ organizationId: other.id, username: 'STAFF', displayName: 'Other staff',
      role: 'clinician', temporaryPassword: 'Other!Agency-Password-42' });
    await assert.rejects(accounts.provision({ organizationId: child.id, username: 'staff', displayName: 'Duplicate',
      role: 'clinician', temporaryPassword: password }), /reserved/);
    const otherLogin = await agencyRequest.run({ origin: 'https://agency-b.example.test' },
      () => sessions.create({ username: 'staff', password: 'Other!Agency-Password-42' }));
    assert.equal(otherLogin.session.user.id, duplicate.userId);
    await assert.rejects(agencyRequest.run({ origin: 'https://agency-b.example.test' },
      () => sessions.create({ username: 'staff', password })), /incorrect/);
    await assert.rejects(agencyRequest.run({ origin: 'http://localhost:3000' },
      () => sessions.create({ username: 'staff', password })), /incorrect/);
    await assert.rejects(sessions.create({ username: 'staff', password }), /incorrect/, 'internal lookup must reject ambiguity');
    await client.query("update app_identity.local_credential set username='renamed-staff' where user_id=$1", [duplicate.userId]);
    await assert.rejects(accounts.provision({ organizationId: other.id, username: 'staff', displayName: 'Reused',
      role: 'clinician', temporaryPassword: password }), /reserved/);
    // Account throttles follow identities; one family's failures do not block another.
    const throttleA = await beginAuthenticationAttempt(database.manager, 'staff', undefined, new Date(), { organizationId: child.id });
    const throttleB = await beginAuthenticationAttempt(database.manager, 'renamed-staff', undefined, new Date(), { organizationId: other.id });
    assert.notEqual(throttleA.buckets.find(b => b.scope === 'account').keyDigest, throttleB.buckets.find(b => b.scope === 'account').keyDigest);
    const throttleRoot = await beginAuthenticationAttempt(database.manager, 'staff', undefined, new Date(), { organizationId: rootAgency.id });
    assert.equal(throttleA.buckets.find(b => b.scope === 'account').keyDigest, throttleRoot.buckets.find(b => b.scope === 'account').keyDigest);
    // The operator CLI creates additional administrators without replacing the owner.
    const operatorConnection = new DataSource({ type: 'postgres', url: url.toString() });
    await operatorConnection.initialize();
    try {
      const cliOptions = name => ['create-superadmin', '--username', name,
        '--display-name', 'Superadmin', '--operator-id', 'test-operator'];
      const dependencies = { readPassword: async () => password, osAccount: 'test', host: 'localhost' };
      const ordinaryInput = (organizationId, username) => ({ organizationId, username, displayName: 'Race', role: 'clinician', temporaryPassword: password });
      const sameFamily = await Promise.allSettled([
        accounts.provision(ordinaryInput(rootAgency.id, 'family-race')),
        accounts.provision(ordinaryInput(child.id, 'family-race')),
      ]);
      assert.equal(sameFamily.filter(result => result.status === 'fulfilled').length, 1);
      const independent = await Promise.allSettled([
        accounts.provision(ordinaryInput(rootAgency.id, 'independent-race')),
        accounts.provision(ordinaryInput(other.id, 'independent-race')),
      ]);
      assert.equal(independent.filter(result => result.status === 'fulfilled').length, 2);
      const globalRace = await Promise.allSettled([
        runIdentityAccountCli(operatorConnection, cliOptions('global-race'), dependencies),
        accounts.provision(ordinaryInput(rootAgency.id, 'global-race')),
      ]);
      assert.equal(globalRace.filter(result => result.status === 'fulfilled').length, 1);
      const superadmin = await runIdentityAccountCli(operatorConnection, cliOptions('Global.Admin'), dependencies);
      assert.equal(superadmin.username, 'global.admin');
      await assert.rejects(runIdentityAccountCli(operatorConnection, cliOptions('GLOBAL.ADMIN'), dependencies), /reserved/);
      await assert.rejects(runIdentityAccountCli(operatorConnection, cliOptions('staff'), dependencies), /reserved/);
      await assert.rejects(accounts.provision({ organizationId: rootAgency.id, username: 'global.admin', displayName: 'Collision',
        role: 'clinician', temporaryPassword: password }), /globally reserved/);
      await assert.rejects(accounts.provision({ organizationId: other.id, username: 'owner', displayName: 'Collision',
        role: 'clinician', temporaryPassword: password }), /globally reserved/);
      await assert.rejects(database.query('insert into app_identity.installation_superadmin(user_id,established_by_operator_id) values ($1,\'test\')', [staff]), /permission denied/);
      const signIn = () => agencyRequest.run({ origin: 'http://localhost:3000' },
        () => sessions.create({ username: 'global.admin', password }));
      const temporary = await signIn();
      assert.equal(temporary.session.passwordChangeRequired, true);
      await client.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1', [superadmin.userId]);
      const administrator = await signIn();
      assert.equal(administrator.session.installationOwner, false);
      assert.equal(administrator.session.installationSuperadmin, true);
      assert.ok(administrator.session.agencies.some(a => a.id === child.id));
      await agencyRequest.run({ origin: 'http://localhost:3000' }, async () => {
        assert.ok((await agencies.list(administrator.sessionToken)).agencies.length >= 4);
        await sessions.switchAgency(administrator.sessionToken, rootAgency.id);
        assert.ok((await sessions.get(administrator.sessionToken)).capabilities.includes('users:write'));
      });
      // Ordinary agency administrators cannot take over a superadmin via password reset.
      await sessions.switchAgency(ownerLogin.sessionToken, other.id);
      await assert.rejects(new SessionAdministrationService(database, sessions).resetCredential(ownerLogin.sessionToken,
        superadmin.userId, { expectedRevision: 1, temporaryPassword: password }), /operator CLI|not found/);
      const audit = await client.query("select result from app_identity.operator_identity_event where command='superadmin.create'");
      assert.ok(audit.rows.some(row => row.result === 'succeeded'));
      assert.ok(audit.rows.some(row => row.result === 'failed'));
      assert.equal((await client.query('select user_id from app_identity.installation_owner')).rows[0].user_id, owner.userId);
    } finally { await operatorConnection.destroy(); }

    const browserOwner = await agencyRequest.run({ origin: "https://child-a.example.test" }, () => sessions.create({ username: "owner", password }));
    await sessions.switchAgency(browserOwner.sessionToken, other.id);
    await agencies.update(ownerLogin.sessionToken, rootAgency.id, { name: rootAgency.name, hostname: rootAgency.hostname, active: false, expectedRevision: rootAgency.revision });
    assert.equal((await client.query("select app_identity.user_can_access_organization($1,$2) allowed", [owner.userId, child.id])).rows[0].allowed, false);
    assert.ok((await agencies.list(ownerLogin.sessionToken)).agencies.some((agency) => agency.id === rootAgency.id && !agency.active));
    await assert.rejects(sessions.get(browserOwner.sessionToken), /ended/);

    // The existing nomination/acceptance workflow transfers installation-wide
    // authority, while historical audit memberships remain valid.
    await sessions.switchAgency(ownerLogin.sessionToken, root);
    const successor = await new AccountService(database).provision({ organizationId: root, username: "successor",
      displayName: "Successor", role: "administrator", temporaryPassword: password });
    await client.query("update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1", [successor.userId]);
    const successorLogin = await sessions.create({ username: "successor", password });
    await sessions.reauthenticate(ownerLogin.sessionToken, ownerLogin.session.csrfToken, password);
    const transfers = new OwnershipTransferService(database, sessions);
    await transfers.initiate(ownerLogin.sessionToken, { nomineeUserId: successor.userId });
    await sessions.reauthenticate(successorLogin.sessionToken, successorLogin.session.csrfToken, password);
    await transfers.accept(successorLogin.sessionToken);
    assert.equal((await sessions.switchAgency(successorLogin.sessionToken, other.id)).installationOwner, true);
    assert.equal((await client.query("select app_identity.user_can_access_organization($1,$2) allowed", [owner.userId, other.id])).rows[0].allowed, false);
    assert.equal((await client.query("select count(*)::int total from app_identity.organization_user where user_id=$1 and organization_id=$2", [owner.userId, other.id])).rows[0].total, 1);
    await assert.rejects(agencies.list(ownerLogin.sessionToken), /No workspace role|owner|session has ended/);
  } finally {
    if (database.isInitialized) await database.destroy();
    if (priorSecret === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET_BASE64; else process.env.AUTH_RATE_LIMIT_SECRET_BASE64 = priorSecret;
    await client.end(); await admin.query(`drop database ${name} with (force)`); await admin.end();
  }
});
