import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { grantRoleForTesting } from "./postgres-role-test-helpers.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;
const patientKeyEnvironment = {
  PATIENT_KEY_INSTALLATION_ID: "90000000-0000-4000-8000-000000000001",
  PATIENT_KEY_VERSION: "1",
  PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 0x31).toString("base64")
};

if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for the PostgreSQL integration suite");
}

const integrationTest = databaseUrl ? test : test.skip;

async function rejectsSql(client, sql, params, expectedCode) {
  await client.query("savepoint expected_failure");
  try {
    await assert.rejects(client.query(sql, params), (error) => error.code === expectedCode);
  } finally {
    await client.query("rollback to savepoint expected_failure");
  }
}

async function connectAsRole(role) {
  if (!["open_triage_analyst", "open_triage_identified_analyst"].includes(role)) {
    throw new Error(`Unsupported integration-test role ${role}`);
  }
  const roleClient = new pg.Client({ connectionString: databaseUrl });
  await roleClient.connect();
  await roleClient.query(`set role ${role}`);
  return roleClient;
}

integrationTest("the database foundation runs on a clean PostgreSQL 15+ server", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());

  const version = await client.query("show server_version_num");
  assert.ok(Number(version.rows[0].server_version_num) >= 150000);

  const migrationRunner = path.join(packageRoot, "scripts/migrate.mjs");
  await execFileAsync(process.execPath, [migrationRunner], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  for (const role of [
    "open_triage_analyst",
    "open_triage_api_runtime",
    "open_triage_analytics_health",
    "open_triage_analytics_projector",
    "open_triage_auditor",
    "open_triage_identified_analyst",
    "open_triage_operational",
    "open_triage_operational_audit_writer",
    "open_triage_query_auditor",
    "open_triage_retention"
  ]) {
    await grantRoleForTesting(client, role);
  }

  await t.test("keeps workload database roles inside their approved privilege contracts", async () => {
    await client.query("begin");
    try {
      await client.query("set local role open_triage_api_runtime");
      await client.query("select * from clinical.report limit 0");
      for (const sql of [
        "select * from analytics_private.epcr limit 0",
        "select * from operations.projection_health limit 0",
        "create schema api_escape",
        "create table public.api_escape (id integer)",
        "create function public.api_escape() returns integer language sql as 'select 1'",
        "alter table clinical.report add column api_escape integer",
        "drop table clinical.report",
        "create role api_escape"
      ]) {
        await rejectsSql(client, sql, [], "42501");
      }
      const beforeGrant = await client.query(
        "select relacl::text from pg_class where oid = 'clinical.report'::regclass",
      );
      await client.query("grant select on clinical.report to public");
      const afterGrant = await client.query(
        "select relacl::text from pg_class where oid = 'clinical.report'::regclass",
      );
      assert.deepEqual(afterGrant.rows, beforeGrant.rows, "runtime role must not be able to grant its table privileges");
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    await client.query("begin");
    try {
      await client.query("set local role open_triage_analytics_projector");
      await client.query("select * from clinical.signed_snapshot limit 0");
      await rejectsSql(client, "select * from app_identity.local_credential limit 0", [], "42501");
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    await client.query("begin");
    try {
      await client.query("set local role open_triage_analytics_health");
      await client.query("select * from operations.projection_health limit 0");
      await rejectsSql(client, "select * from clinical.report limit 0", [], "42501");
      await rejectsSql(client, "select * from analytics_private.epcr limit 0", [], "42501");
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    await client.query("begin");
    try {
      await client.query("set local role open_triage_operational_audit_writer");
      await rejectsSql(client, "select * from clinical.report limit 0", [], "42501");
      await rejectsSql(client, "select * from operations.query_audit_event limit 0", [], "42501");
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  await t.test("enforces role-resolved authorization invariants", async () => {
    const capabilityKeys = (await client.query(
      "select key from app_identity.capability order by key"
    )).rows.map(({ key }) => key);
    assert.deepEqual(capabilityKeys, [
      "admin-dashboard:read", "catalog:publish", "catalog:read", "catalog:write",
      "clinical:demo", "clinical:document", "credentials:reset", "forms:publish",
      "forms:read", "forms:write", "roles:assign", "roles:read", "roles:write",
      "sessions:read", "sessions:revoke", "users:read", "users:write"
    ]);
    assert.equal(capabilityKeys.includes("installation:administer"), false);
    assert.equal(capabilityKeys.includes("reports:document"), false);

    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const userId = randomUUID();
    const ownerUserId = randomUUID();
    await client.query("begin");
    try {
      await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
        values ($1, 'Authorization test', 'UTC'), ($2, 'Other authorization test', 'UTC')`,
      [organizationId, otherOrganizationId]);
      await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
        values ($1, $3, 'Authorization user'), ($2, $3, 'Authorization owner')`,
      [userId, ownerUserId, organizationId]);

      const protectedRoles = await client.query(`
        select r.system_key, r.hidden, r.assignable,
          coalesce(array_agg(rvc.capability_key order by rvc.capability_key)
            filter (where rvc.capability_key is not null), '{}') capabilities
        from app_identity.role r
        join app_identity.role_version rv on rv.id = r.current_version_id
        left join app_identity.role_version_capability rvc on rvc.role_version_id = rv.id
        where r.organization_id = $1 and r.protected
        group by r.id order by r.system_key`, [organizationId]);
      assert.equal(protectedRoles.rows.length, 3);
      const administrator = protectedRoles.rows.find(({ system_key }) => system_key === "administrator");
      assert.equal(administrator.capabilities.includes("clinical:document"), true);
      assert.equal(administrator.capabilities.length, 16);
      const demo = protectedRoles.rows.find(({ system_key }) => system_key === "demo");
      assert.deepEqual(demo, { system_key: "demo", hidden: false, assignable: true, capabilities: [
        "admin-dashboard:read", "catalog:read", "catalog:write", "clinical:demo", "clinical:document",
        "forms:read", "forms:write", "roles:read", "users:read"
      ] });
      await client.query(`insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by, note)
        select $1, $2, id, $2, 'Authorization test owner'
        from app_identity.role where organization_id = $1 and system_key = 'administrator'`,
      [organizationId, ownerUserId]);
      await client.query(`insert into app_identity.installation_owner
        (organization_id, user_id, established_by_operator_id) values ($1, $2, 'integration-test')`,
      [organizationId, ownerUserId]);
      const immutableVersionId = (await client.query(`select current_version_id from app_identity.role
        where organization_id = $1 and system_key = 'clinician'`, [organizationId])).rows[0].current_version_id;
      await rejectsSql(client, "update app_identity.role_version set note = 'changed' where id = $1",
        [immutableVersionId], "P0001");
      await rejectsSql(client, `insert into app_identity.user_capability
        (user_id, capability_key, granted_by) values ($1, 'clinical:document', $1)`, [userId], "42P01");

      const foreignRoleId = (await client.query(`select id from app_identity.role
        where organization_id = $1 and system_key = 'clinician'`, [otherOrganizationId])).rows[0].id;
      await rejectsSql(client, `insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by) values ($1, $2, $3, $2)`,
      // The assignment validator rejects the tenant mismatch before the
      // redundant composite foreign key is evaluated.
      [organizationId, userId, foreignRoleId], "P0001");

      const roleId = randomUUID();
      const versionOneId = randomUUID();
      const versionTwoId = randomUUID();
      await client.query(`insert into app_identity.role
        (id, organization_id, display_name, current_version_id) values ($1, $2, 'Immediate role', $3)`,
      [roleId, organizationId, versionOneId]);
      await client.query(`insert into app_identity.role_version (id, organization_id, role_id, version)
        values ($1, $3, $4, 1), ($2, $3, $4, 2)`,
      [versionOneId, versionTwoId, organizationId, roleId]);
      await client.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key)
        values ($1, $2, $4, 'catalog:read'), ($1, $3, $4, 'forms:read')`,
      [organizationId, versionOneId, versionTwoId, roleId]);
      await client.query(`insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by) values ($1, $2, $3, $2)`,
      [organizationId, userId, roleId]);
      assert.equal((await client.query("select app_identity.user_has_capability($1, $2, 'catalog:read') allowed",
        [userId, organizationId])).rows[0].allowed, true);
      await client.query("update app_identity.role set current_version_id = $2 where id = $1", [roleId, versionTwoId]);
      assert.equal((await client.query("select app_identity.user_has_capability($1, $2, 'catalog:read') allowed",
        [userId, organizationId])).rows[0].allowed, false);
      assert.equal((await client.query("select app_identity.user_has_capability($1, $2, 'forms:read') allowed",
        [userId, organizationId])).rows[0].allowed, true);

      // Force the deferred creation audit after the first immutable version and
      // its capabilities exist, then return subsequent checks to deferred mode.
      await client.query("set constraints all immediate");
      const initialActivation = await client.query(`
        select note, details from app_identity.authorization_event
        where organization_id = $1 and action = 'role.version_activate'
          and target_key = $2
      `, [organizationId, versionOneId]);
      assert.equal(initialActivation.rows.length, 1);
      assert.deepEqual(initialActivation.rows[0].details, {
        roleId, priorVersionId: null, version: 1
      });
      assert.equal(JSON.stringify(initialActivation.rows[0].details).includes("Immediate role"), false);
      await rejectsSql(client, "update app_identity.authorization_event set note = 'rewritten' where target_key = $1",
        [versionOneId], "P0001");
      await client.query("set constraints all deferred");

      await rejectsSql(client, `insert into app_identity.role
        (id, organization_id, display_name, current_version_id)
        values ($1, $2, ' Bad  role ', $3)`, [randomUUID(), organizationId, randomUUID()], "23514");
      await rejectsSql(client, `insert into app_identity.role
        (id, organization_id, display_name, current_version_id)
        values ($1, $2, 'Administrator', $3)`, [randomUUID(), organizationId, randomUUID()], "P0001");

      await client.query("savepoint invalid_prerequisite");
      const invalidRoleId = randomUUID();
      const invalidVersionId = randomUUID();
      await client.query(`insert into app_identity.role
        (id, organization_id, display_name, current_version_id) values ($1, $2, 'Invalid role', $3)`,
      [invalidRoleId, organizationId, invalidVersionId]);
      await client.query(`insert into app_identity.role_version (id, organization_id, role_id, version)
        values ($1, $2, $3, 1)`, [invalidVersionId, organizationId, invalidRoleId]);
      await client.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key)
        values ($1, $2, $3, 'users:write')`, [organizationId, invalidVersionId, invalidRoleId]);
      await assert.rejects(client.query("set constraints all immediate"), (error) => error.code === "P0001");
      await client.query("rollback to savepoint invalid_prerequisite");
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("retires roles atomically and reconstructs reactivation without restoring assignments", async () => {
    const organizationId = randomUUID();
    const actorId = randomUUID();
    const assigneeId = randomUUID();
    const roleId = randomUUID();
    const versionOneId = randomUUID();
    const versionTwoId = randomUUID();
    const replacementRoleId = randomUUID();
    const replacementVersionId = randomUUID();
    await client.query("begin");
    try {
      await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
        values ($1, 'Role lifecycle test', 'UTC')`, [organizationId]);
      await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
        values ($1, $3, 'Role author'), ($2, $3, 'Role assignee')`, [actorId, assigneeId, organizationId]);
      await client.query(`insert into app_identity.role
        (id, organization_id, display_name, description, current_version_id, created_by, note)
        values ($1, $2, 'Dispatch Lead', 'Original duty', $3, $4, 'Created')`,
      [roleId, organizationId, versionOneId, actorId]);
      await client.query(`insert into app_identity.role_version
        (id, organization_id, role_id, version, display_name, description, created_by, note)
        values ($1, $2, $3, 1, 'Dispatch Lead', 'Original duty', $4, 'Created')`,
      [versionOneId, organizationId, roleId, actorId]);
      await client.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key) values ($1, $2, $3, 'roles:read')`,
      [organizationId, versionOneId, roleId]);
      const assignmentId = (await client.query(`insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by, note) values ($1, $2, $3, $4, 'Initial duty') returning id`,
      [organizationId, assigneeId, roleId, actorId])).rows[0].id;
      await client.query("set constraints all immediate");
      await client.query("set constraints all deferred");

      const closed = await client.query(`update app_identity.user_role_assignment
        set ended_at = now(), ended_by = $3 where organization_id = $1 and role_id = $2 and ended_at is null
        returning ended_at`, [organizationId, roleId, actorId]);
      await client.query(`update app_identity.role set active = false, assignable = false, note = 'Retired'
        where organization_id = $1 and id = $2`, [organizationId, roleId]);
      await client.query(`insert into app_identity.authorization_event
        (organization_id, actor_id, action, target_type, target_key, note, details)
        values ($1, $2, 'role.deactivate', 'role', $3, 'Retired',
          jsonb_build_object('roleId', $3::text, 'version', 1, 'endedAssignmentCount', 1))`,
      [organizationId, actorId, roleId]);
      await client.query("set constraints all immediate");
      assert.equal((await client.query("select app_identity.user_has_capability($1, $2, 'roles:read') allowed",
        [assigneeId, organizationId])).rows[0].allowed, false);
      await rejectsSql(client, `insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by) values ($1, $2, $3, $4)`,
      [organizationId, assigneeId, roleId, actorId], "P0001");

      await client.query("set constraints all deferred");
      await client.query(`insert into app_identity.role
        (id, organization_id, display_name, current_version_id, created_by) values ($1, $2, 'Dispatch Lead', $3, $4)`,
      [replacementRoleId, organizationId, replacementVersionId, actorId]);
      await client.query(`insert into app_identity.role_version
        (id, organization_id, role_id, version, display_name, created_by)
        values ($1, $2, $3, 1, 'Dispatch Lead', $4)`, [replacementVersionId, organizationId, replacementRoleId, actorId]);
      await client.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key) values ($1, $2, $3, 'roles:read')`,
      [organizationId, replacementVersionId, replacementRoleId]);

      await client.query(`insert into app_identity.role_version
        (id, organization_id, role_id, version, display_name, description, created_by, note)
        values ($1, $2, $3, 2, 'Dispatch Legacy', 'Redefined duty', $4, 'Reactivated')`,
      [versionTwoId, organizationId, roleId, actorId]);
      await client.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key) values ($1, $2, $3, 'users:read')`,
      [organizationId, versionTwoId, roleId]);
      await client.query(`update app_identity.role set display_name = 'Dispatch Legacy', description = 'Redefined duty',
        current_version_id = $3, active = true, assignable = true, note = 'Reactivated'
        where organization_id = $1 and id = $2`, [organizationId, roleId, versionTwoId]);
      await client.query(`insert into app_identity.authorization_event
        (organization_id, actor_id, action, target_type, target_key, note, details)
        values ($1, $2, 'role.reactivate', 'role', $3, 'Reactivated',
          jsonb_build_object('roleId', $3::text, 'priorVersionId', $4::text, 'version', 2))`,
      [organizationId, actorId, roleId, versionOneId]);
      await client.query("set constraints all immediate");

      const history = await client.query(`select version, display_name, description, note
        from app_identity.role_version where role_id = $1 order by version`, [roleId]);
      assert.deepEqual(history.rows, [
        { version: 1, display_name: "Dispatch Lead", description: "Original duty", note: "Created" },
        { version: 2, display_name: "Dispatch Legacy", description: "Redefined duty", note: "Reactivated" }
      ]);
      const intervals = await client.query(`select id, assigned_at, ended_at, assigned_by, ended_by, note
        from app_identity.user_role_assignment where role_id = $1`, [roleId]);
      assert.equal(intervals.rows.length, 1);
      assert.equal(intervals.rows[0].id, assignmentId);
      assert.equal(intervals.rows[0].ended_at.getTime(), closed.rows[0].ended_at.getTime());
      assert.equal(intervals.rows[0].ended_by, actorId);
      assert.equal((await client.query(`select count(*)::integer count from app_identity.user_role_assignment
        where role_id = $1 and ended_at is null`, [roleId])).rows[0].count, 0);
      await rejectsSql(client, "update app_identity.user_role_assignment set note = 'rewritten' where id = $1",
        [assignmentId], "P0001");
      await rejectsSql(client, "delete from app_identity.user_role_assignment where id = $1", [assignmentId], "P0001");
      const events = await client.query(`select action, note, details from app_identity.authorization_event
        where organization_id = $1 and details ->> 'roleId' = $2 order by occurred_at, id`, [organizationId, roleId]);
      assert.deepEqual(events.rows.map(({ action }) => action), ["role.version_activate", "role.deactivate",
        "role.version_activate", "role.reactivate"]);
      assert.equal(JSON.stringify(events.rows).includes("Role assignee"), false);
    } finally {
      await client.query("rollback");
    }
  });

  const loader = path.join(packageRoot, "scripts/load-nemsis-catalog.mjs");
  const loaderEnvironment = { ...process.env, DATABASE_URL: databaseUrl };
  const firstLoad = await execFileAsync(process.execPath, [loader], { env: loaderEnvironment });
  assert.match(firstLoad.stdout, /Loaded NEMSIS 3\.5\.1:/);

  const identitiesBeforeReplay = await client.query(
    "select canonical_key, id from catalog.element_identity where namespace = 'NEMSIS' order by canonical_key"
  );
  const definitionsBeforeReplay = await client.query("select count(*)::integer as count from catalog.element_definition");
  const replay = await execFileAsync(process.execPath, [loader], { env: loaderEnvironment });
  assert.match(replay.stdout, /already loaded with the expected checksum/);
  const identitiesAfterReplay = await client.query(
    "select canonical_key, id from catalog.element_identity where namespace = 'NEMSIS' order by canonical_key"
  );
  const definitionsAfterReplay = await client.query("select count(*)::integer as count from catalog.element_definition");
  assert.deepEqual(identitiesAfterReplay.rows, identitiesBeforeReplay.rows);
  assert.deepEqual(definitionsAfterReplay.rows, definitionsBeforeReplay.rows);

  await t.test("loads the checksummed catalog with complete, unique analytical mappings", async () => {
    const result = await client.query(`
      select
        count(*) filter (where e.group_path @> array['PatientCareReportGroup'])::integer as patient_care_elements,
        count(*) filter (where e.group_path @> array['PatientCareReportGroup'] and m.element_id is not null)::integer as mapped_elements,
        count(distinct m.element_id) filter (where e.group_path @> array['PatientCareReportGroup'])::integer as distinct_mapped_elements,
        count(*) filter (where m.sql_column is not null)::integer as named_columns,
        count(distinct m.sql_column)::integer as distinct_named_columns
      from catalog.element_definition e
      left join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
    `);
    assert.deepEqual(result.rows[0], {
      patient_care_elements: 441,
      mapped_elements: 441,
      distinct_mapped_elements: 441,
      named_columns: 198,
      distinct_named_columns: 198
    });

    const release = await client.query("select artifact_sha256 from catalog.release where standard = 'NEMSIS'");
    assert.match(release.rows[0].artifact_sha256, /^[a-f0-9]{64}$/);
  });

  await t.test("rejects incompatible datatypes while reusing stable element identities", async () => {
    await client.query("begin");
    try {
      const existing = await client.query(`
        select e.element_identity_id, e.base_datatype
        from catalog.element_definition e
        order by e.element_id
        limit 1
      `);
      const incompatible = existing.rows[0].base_datatype === "string" ? "integer" : "string";
      const release = await client.query(`
        insert into catalog.release
          (standard, version, dataset, artifact_schema_version, artifact_sha256, provenance)
        values ('NEMSIS', 'integration-incompatible', 'EMSDataSet', '1', repeat('a', 64), '{}')
        returning id
      `);
      await rejectsSql(client, `
        insert into catalog.element_definition
          (release_id, element_id, element_identity_id, section, name, description, national, state,
           usage, source_datatype, base_datatype, group_path, min_occurs, max_occurs, unbounded,
           nillable, supports_not_values, supports_pertinent_negatives, definition)
        values ($1, 'integration.element', $2, 'integration', 'Integration', 'Integration', false, false,
          'Optional', 'integration', $3, '{}', 0, 1, false, false, false, false, '{}')
      `, [release.rows[0].id, existing.rows[0].element_identity_id, incompatible], "P0001");
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("enforces UUID, typed-value, and immutability constraints", async () => {
    await client.query("begin");
    try {
      const organizationId = "10000000-0000-4000-8000-000000000001";
      const userId = "10000000-0000-4000-8000-000000000002";
      const incidentId = "10000000-0000-4000-8000-000000000003";
      const patientId = "10000000-0000-4000-8000-000000000004";
      const agencyId = "10000000-0000-4000-8000-000000000005";
      const formId = "10000000-0000-4000-8000-000000000006";
      const formVersionId = "10000000-0000-4000-8000-000000000007";
      const reportId = "10000000-0000-4000-8000-000000000008";
      const release = await client.query("select id from catalog.release where standard = 'NEMSIS'");

      await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Integration', 'UTC')", [organizationId]);
      await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Tester')", [userId, organizationId]);
      await rejectsSql(client,
        "insert into clinical.incident (id, organization_id) values ('10000000-0000-5000-8000-000000000099', $1)",
        [organizationId], "23514");
      await client.query("insert into clinical.incident (id, organization_id) values ($1, $2)", [incidentId, organizationId]);
      await client.query(`insert into clinical.patient
        (id, organization_id, identity_state, pseudonymous_key)
        values ($1, $2, 'unknown', repeat('d', 64))`, [patientId, organizationId]);
      await client.query(`insert into app_identity.agency_demographic_version
        (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
         definition_sha256, effective_from, created_by)
        values ($1, $2, $3, 1, 'a', 'b', 'c', repeat('b', 64), now(), $4)`,
        [agencyId, organizationId, release.rows[0].id, userId]);
      await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, 'integration', 'Integration')", [formId, organizationId]);
      await client.query(`insert into forms.form_version
        (id, form_id, catalog_release_id, version, status, canonical_definition,
         definition_sha256, change_note, created_by, published_by, published_at)
        values ($1, $2, $3, 1, 'published', '{}', repeat('c', 64),
          'Integration fixture', $4, $4, now())`,
        [formVersionId, formId, release.rows[0].id, userId]);
      await client.query(`insert into clinical.report
        (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
         form_version_id, catalog_release_id, documenting_user_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [reportId, organizationId, incidentId, patientId, agencyId, formVersionId, release.rows[0].id, userId]);

      const element = await client.query(`
        select m.element_id, m.element_identity_id, m.identifying
        from catalog.analytics_element_mapping m
        where m.release_id = $1 and m.analytical_location = 'wide'
        limit 1
      `, [release.rows[0].id]);
      await rejectsSql(client, `insert into clinical.element_occurrence
        (id, report_id, catalog_release_id, element_identity_id, element_id, analytical_repeatable,
         identifying, value_kind, value_text, value_numeric, author_id)
        values ('20000000-0000-4000-8000-000000000001', $1, $2, $3, $4, false, $5,
          'text', 'one representation', 2, $6)`,
        [reportId, release.rows[0].id, element.rows[0].element_identity_id, element.rows[0].element_id,
          element.rows[0].identifying, userId], "23514");

      await rejectsSql(client, "update catalog.release set provenance = '{\"changed\":true}' where id = $1", [release.rows[0].id], "P0001");
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("retains immutable dispatch receipts with tenant and source isolation", async () => {
    await client.query("begin");
    try {
      const organizationA = "11000000-0000-4000-8000-000000000001";
      const organizationB = "11000000-0000-4000-8000-000000000002";
      const messageId = "12000000-0000-4000-8000-000000000001";
      const otherMessageId = "12000000-0000-4000-8000-000000000002";
      const compact = `{"messageId":"${messageId}","sourceRecordId":"response-1","revision":1,"nested":{"a":1,"b":2}}`;
      const reordered = `{\n  "nested": { "b": 2, "a": 1 },\n  "revision": 1,\n  "sourceRecordId": "response-1",\n  "messageId": "${messageId}"\n}\n`;
      const payload = JSON.parse(compact);
      const finding = [{
        severity: "warning", code: "dispatch.optional", pointer: "/nested",
        message: "Optional value was retained only in the source artifact"
      }];

      await client.query(`insert into app_identity.organization (id, name, deployment_timezone) values
        ($1, 'Dispatch tenant A', 'UTC'), ($2, 'Dispatch tenant B', 'UTC')`,
      [organizationA, organizationB]);
      const insert = async (organizationId, sourceId, bytes, body = payload) => client.query(`
        insert into clinical.dispatch_receipt
          (organization_id, source_id, message_id, source_record_id, source_revision,
           source_bytes, source_payload, findings, status, result)
        values ($1, $2, $3, 'response-1', 1, $4, $5::jsonb, $6::jsonb,
          'applied_with_findings', '{"appliedOccurrences":4}'::jsonb)
        returning id, exact_sha256, canonical_sha256
      `, [organizationId, sourceId, messageId, Buffer.from(bytes), JSON.stringify(body), JSON.stringify(finding)]);

      const tenantA = await insert(organizationA, "vendor-a", compact);
      const tenantB = await insert(organizationB, "vendor-a", reordered);
      const sourceB = await insert(organizationA, "vendor-b", reordered);

      assert.notEqual(tenantA.rows[0].exact_sha256, tenantB.rows[0].exact_sha256);
      assert.equal(tenantA.rows[0].canonical_sha256, tenantB.rows[0].canonical_sha256);
      assert.equal(tenantA.rows[0].canonical_sha256, sourceB.rows[0].canonical_sha256);
      assert.match(tenantA.rows[0].exact_sha256, /^[a-f0-9]{64}$/);
      assert.match(tenantA.rows[0].canonical_sha256, /^[a-f0-9]{64}$/);

      const duplicateMessage = { ...payload, sourceRecordId: "another-response", revision: 2 };
      await rejectsSql(client, `insert into clinical.dispatch_receipt
        (organization_id, source_id, message_id, source_record_id, source_revision,
         source_bytes, source_payload, status)
        values ($1, 'vendor-a', $2, 'another-response', 2, $3, $4::jsonb, 'applied')`,
      [organizationA, messageId, Buffer.from(JSON.stringify(duplicateMessage)), JSON.stringify(duplicateMessage)], "23505");
      const duplicateRevision = { ...payload, messageId: otherMessageId };
      await rejectsSql(client, `insert into clinical.dispatch_receipt
        (organization_id, source_id, message_id, source_record_id, source_revision,
         source_bytes, source_payload, status)
        values ($1, 'vendor-a', $2, 'response-1', 1, $3, $4::jsonb, 'applied')`,
      [organizationA, otherMessageId, Buffer.from(JSON.stringify(duplicateRevision)), JSON.stringify(duplicateRevision)], "23505");
      const mismatchedPayload = { ...payload, nested: { a: 9, b: 2 } };
      await rejectsSql(client, `insert into clinical.dispatch_receipt
        (organization_id, source_id, message_id, source_record_id, source_revision,
         source_bytes, source_payload, status)
        values ($1, 'vendor-a', $2, 'response-2', 1, $3, $4::jsonb, 'applied')`,
      [organizationA, otherMessageId, Buffer.from(compact), JSON.stringify(mismatchedPayload)], "23514");
      const forgedContext = { ...payload, messageId: otherMessageId, sourceRecordId: "response-2", organizationId: organizationB };
      await rejectsSql(client, `insert into clinical.dispatch_receipt
        (organization_id, source_id, message_id, source_record_id, source_revision,
         source_bytes, source_payload, status)
        values ($1, 'vendor-a', $2, 'response-2', 1, $3, $4::jsonb, 'applied')`,
      [organizationA, otherMessageId, Buffer.from(JSON.stringify(forgedContext)), JSON.stringify(forgedContext)], "23514");
      await rejectsSql(client, "update clinical.dispatch_receipt set status = 'applied' where id = $1",
        [tenantA.rows[0].id], "P0001");
      await rejectsSql(client, "delete from clinical.dispatch_receipt where id = $1",
        [tenantA.rows[0].id], "P0001");

      const evidence = await client.query(`
        select organization_id, source_id, source_record_id, source_revision,
          received_at is not null as received, convert_from(source_bytes, 'UTF8') as source_text,
          findings, status, result
        from clinical.dispatch_receipt where id = $1
      `, [tenantA.rows[0].id]);
      assert.deepEqual(evidence.rows[0], {
        organization_id: organizationA,
        source_id: "vendor-a",
        source_record_id: "response-1",
        source_revision: "1",
        received: true,
        source_text: compact,
        findings: finding,
        status: "applied_with_findings",
        result: { appliedOccurrences: 4 }
      });
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("classifies repeating-group time and provisions range partitions", async () => {
    const mappings = await client.query(`
      select resolution, count(*)::integer as count
      from catalog.repeating_group_time_mapping
      group by resolution
    `);
    assert.equal(mappings.rows.reduce((sum, row) => sum + row.count, 0), 34);
    assert.ok(mappings.rows.every((row) => ["element", "inherited", "non-temporal"].includes(row.resolution)));

    const partitions = await client.query(`
      select
        to_regclass('analytics_private.epcr_y' || to_char(current_date, 'YYYY')) is not null as annual,
        to_regclass('analytics_private.epcr_repeatable_element_m' || to_char(current_date, 'YYYYMM')) is not null as monthly
    `);
    assert.deepEqual(partitions.rows[0], { annual: true, monthly: true });
  });

  await t.test("keeps private analytics isolated and grants portable database roles", async () => {
    const grants = await client.query(`
      select
        has_table_privilege('open_triage_analyst', 'analytics.epcr', 'select') as analyst_view,
        has_table_privilege('open_triage_analyst', 'analytics_private.epcr', 'select') as analyst_private,
        has_table_privilege('open_triage_identified_analyst', 'analytics.epcr_identified', 'select') as identified_view,
        has_table_privilege('open_triage_projector', 'analytics_private.epcr', 'insert') as projector_insert,
        has_table_privilege('open_triage_projector', 'integration.projection_run', 'insert') as projector_run_insert,
        has_table_privilege('open_triage_operational', 'operations.projection_health', 'select') as operational_health,
        has_table_privilege('open_triage_operational', 'operations.projection_failures', 'select') as operational_failures,
        not has_table_privilege('open_triage_analyst', 'clinical.dispatch_receipt', 'select') as no_analyst_receipt,
        has_function_privilege('open_triage_retention_executor', 'retention.delete_verified_batch(uuid,uuid)', 'execute') as retention_delete,
        not has_function_privilege('open_triage_operational', 'retention.delete_verified_batch(uuid,uuid)', 'execute') as no_operational_delete,
        to_regclass('auth.users') is null as no_supabase_auth_dependency
    `);
    assert.deepEqual(grants.rows[0], {
      analyst_view: true,
      analyst_private: false,
      identified_view: true,
      projector_insert: true,
      projector_run_insert: true,
      operational_health: true,
      operational_failures: true,
      no_analyst_receipt: true,
      retention_delete: true,
      no_operational_delete: true,
      no_supabase_auth_dependency: true
    });
  });

  await t.test("bootstraps only production-equivalent demonstration accounts and preserves later administration", async () => {
    const bootstrap = path.join(packageRoot, "scripts/bootstrap-synthetic-installation.mjs");
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    await client.query(`insert into app_identity.organization
      (id, name, shift_session_duration_hours, deployment_timezone)
      values ($1, 'Demonstration EMS', 14, 'UTC') on conflict (id) do nothing`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    const first = JSON.parse((await execFileAsync(process.execPath, [bootstrap], { env: environment })).stdout);
    assert.deepEqual(first.createdAccounts, ["demo"]);
    assert.equal(first.ownerConfigured, false);
    const initial = await client.query(`
      select u.id, u.active, u.synthetic, c.username, c.must_change_password,
        c.temporary_password_expires_at, c.password_verifier,
        array_agg(r.system_key order by r.system_key) filter (where a.ended_at is null) roles
      from app_identity.app_user u
      join app_identity.local_credential c on c.user_id = u.id
      join app_identity.user_role_assignment a on a.user_id = u.id
      join app_identity.role r on r.id = a.role_id
      where c.username = 'demo' group by u.id, c.user_id order by c.username
    `);
    assert.deepEqual(initial.rows.map(({ username, active, synthetic, must_change_password,
      temporary_password_expires_at, roles }) => ({ username, active, synthetic, must_change_password,
      temporary_password_expires_at, roles })), [
      { username: "demo", active: true, synthetic: false, must_change_password: false,
        temporary_password_expires_at: null, roles: ["demo"] },
    ]);

    await client.query("update app_identity.local_credential set password_verifier = 'scrypt$administered-verifier' where username = 'demo'");
    await client.query("update app_identity.app_user set active = false where id = $1",
      [SYNTHETIC_DEMO_FIXTURE.userId]);
    await client.query(`update app_identity.user_role_assignment a set ended_at = now(), ended_by = a.user_id
      from app_identity.role r where r.id = a.role_id and a.user_id = $1
        and a.ended_at is null and r.system_key = 'demo'`,
    [SYNTHETIC_DEMO_FIXTURE.userId]);
    const replay = JSON.parse((await execFileAsync(process.execPath, [bootstrap], { env: environment })).stdout);
    assert.deepEqual(replay.createdAccounts, []);
    const administered = await client.query(`select
      (select password_verifier from app_identity.local_credential where username = 'demo') verifier,
      (select active from app_identity.app_user where id = $1) user_active,
      (select count(*)::integer from app_identity.user_role_assignment a join app_identity.role r on r.id = a.role_id
        where a.user_id = $1 and a.ended_at is null and r.system_key = 'demo') demo_roles`,
    [SYNTHETIC_DEMO_FIXTURE.userId]);
    assert.deepEqual(administered.rows[0], {
      verifier: "scrypt$administered-verifier", user_active: false, demo_roles: 0,
    });

    // Restore explicitly for downstream database fixtures, then establish a normal owner.
    await client.query("update app_identity.local_credential set password_verifier = $1 where username = 'demo'",
      [initial.rows[0].password_verifier]);
    await client.query("update app_identity.app_user set active = true where id = $1",
      [SYNTHETIC_DEMO_FIXTURE.userId]);
    await client.query(`insert into app_identity.user_role_assignment
      (organization_id, user_id, role_id, assigned_by, note)
      select $1, $2, role.id, $2, 'Downstream integration setup'
      from app_identity.role role where role.organization_id = $1 and role.system_key = 'demo'
      on conflict (user_id, role_id) where ended_at is null do nothing`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, SYNTHETIC_DEMO_FIXTURE.userId]);
    const syntheticOwnerId = "32000000-0000-4000-8000-000000000099";
    await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
      values ($1, $2, 'Synthetic integration owner')`,
    [syntheticOwnerId, SYNTHETIC_DEMO_FIXTURE.organizationId]);
    await client.query(`insert into app_identity.user_role_assignment
      (organization_id, user_id, role_id, assigned_by, note)
      select $1, $2, id, $2, 'Integration owner setup' from app_identity.role
      where organization_id = $1 and system_key = 'administrator'`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, syntheticOwnerId]);
    await client.query(`insert into app_identity.installation_owner
      (organization_id, user_id, established_by_operator_id) values ($1, $2, 'integration-test')`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, syntheticOwnerId]);

    const afterOwner = JSON.parse((await execFileAsync(process.execPath, [bootstrap], { env: environment })).stdout);
    assert.equal(afterOwner.ownerConfigured, true);

    const releaseId = (await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'")).rows[0].id;
    await client.query(`insert into app_identity.agency_demographic_version
      (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
       definition_sha256, effective_from, created_by)
      values ('32000000-0000-4000-8000-000000000006', $1, $2, 2, 'demo', 'demo', '00', repeat('a',64), now(), $3)`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, releaseId, SYNTHETIC_DEMO_FIXTURE.userId]);
    await client.query(`insert into forms.form (id, organization_id, slug, name)
      values ('32000000-0000-4000-8000-000000000012', $1, 'integration-form', 'Integration form')`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    await client.query(`insert into forms.form_version
      (id, form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
       change_note, created_by, published_by, published_at)
      values ('32000000-0000-4000-8000-000000000011', '32000000-0000-4000-8000-000000000012', $1,
       1, 'published', '{"schemaVersion":1,"sections":[]}', repeat('b',64), 'Integration fixture', $2, $2, now())`,
    [releaseId, SYNTHETIC_DEMO_FIXTURE.userId]);
    await client.query(`update forms.agency_stationary_default
      set form_version_id = '32000000-0000-4000-8000-000000000011',
          activated_by = $2, activated_at = now()
      where organization_id = $1`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, SYNTHETIC_DEMO_FIXTURE.userId]);
    await client.query(`insert into clinical.incident (id, organization_id)
      values ('32000000-0000-4000-8000-00000000000c', $1)`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    await client.query(`insert into clinical.patient
      (id, organization_id, identity_state, pseudonymous_key) values
      ('32000000-0000-4000-8000-00000000000d', $1, 'unknown', repeat('c',64))`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    await client.query(`insert into clinical.report
      (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
       form_version_id, catalog_release_id, documenting_user_id)
      values ('32000000-0000-4000-8000-00000000000e', $1,
       '32000000-0000-4000-8000-00000000000c', '32000000-0000-4000-8000-00000000000d',
       '32000000-0000-4000-8000-000000000006', '32000000-0000-4000-8000-000000000011', $2, $3)`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, releaseId, SYNTHETIC_DEMO_FIXTURE.userId]);
  });

  await t.test("activation cannot rewrite an older report's configuration pins", async () => {
    const reportId = "32000000-0000-4000-8000-00000000000e";
    const original = (await client.query(`select organization_id, incident_id, patient_id,
      agency_demographic_version_id, form_version_id, catalog_release_id, documenting_user_id
      from clinical.report where id = $1`, [reportId])).rows[0];

    await client.query("begin");
    try {
      const nextVersion = await client.query(`insert into forms.form_version
        (form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
         change_note, created_by, published_by, published_at)
        select form_id, catalog_release_id, version + 1, 'published',
          '{"schemaVersion":1,"sections":[]}'::jsonb, repeat('e', 64),
          'Integration activation', created_by, created_by, now()
        from forms.form_version where id = $1 returning id, catalog_release_id`,
      [original.form_version_id]);
      await client.query(`update forms.agency_stationary_default
        set form_version_id = $2, activated_by = $3, activated_at = now()
        where organization_id = $1`,
      [original.organization_id, nextVersion.rows[0].id, original.documenting_user_id]);

      assert.deepEqual((await client.query(`select organization_id, incident_id, patient_id,
        agency_demographic_version_id, form_version_id, catalog_release_id, documenting_user_id
        from clinical.report where id = $1`, [reportId])).rows[0], original);
      await rejectsSql(client, "update clinical.report set form_version_id = $2 where id = $1",
        [reportId, nextVersion.rows[0].id], "P0001");

      await client.query(`update clinical.report set status = 'signed', revision = revision + 1,
        reporting_date = current_date, reporting_date_source = 'signing-time'
        where id = $1`, [reportId]);
      const signed = (await client.query(`select status, form_version_id, catalog_release_id
        from clinical.report where id = $1`, [reportId])).rows[0];
      assert.deepEqual(signed, {
        status: "signed",
        form_version_id: original.form_version_id,
        catalog_release_id: original.catalog_release_id
      });
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("isolates live unsigned work and immutable report history by role", async () => {
    const reportId = "32000000-0000-4000-8000-00000000000e";
    const incidentId = "32000000-0000-4000-8000-00000000000c";
    const clinicianId = SYNTHETIC_DEMO_FIXTURE.userId;
    await client.query("update clinical.incident set operational_state = 'cleared' where id = $1", [incidentId]);
    await client.query(`insert into clinical.report_change
      (report_id, revision, idempotency_key, author_id, device_id, client_time,
       server_received_time, changes)
      values ($1, 1, '41000000-0000-4000-8000-000000000001', $2, 'unit-41',
        '2041-01-02T12:00:00Z', '2041-01-02T12:00:01Z',
        '[{"operation":"replace","path":"eRecord.01"}]')`, [reportId, clinicianId]);

    await client.query("begin");
    try {
      await client.query("set local role open_triage_operational");
      const queue = await client.query(`select report_id, report_status,
        incident_operational_state, work_status, revision, age
        from operations.unsigned_report_work_queue where report_id = $1`, [reportId]);
      assert.equal(queue.rowCount, 1);
      assert.deepEqual({
        report_id: queue.rows[0].report_id,
        report_status: queue.rows[0].report_status,
        incident_operational_state: queue.rows[0].incident_operational_state,
        work_status: queue.rows[0].work_status,
        revision: queue.rows[0].revision
      }, {
        report_id: reportId,
        report_status: "draft",
        incident_operational_state: "cleared",
        work_status: "cleared-unsigned",
        revision: "0"
      });
      assert.ok(queue.rows[0].age);
      await assert.rejects(client.query("select * from clinical_history.report_history limit 1"),
        (error) => error.code === "42501");
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query("set local role open_triage_auditor");
      const history = await client.query(`select event_type, report_revision, actor_id,
        device_id, client_time, history_timestamp, new_value
        from clinical_history.report_history where report_id = $1`, [reportId]);
      assert.equal(history.rowCount, 1);
      assert.deepEqual({
        event_type: history.rows[0].event_type,
        report_revision: history.rows[0].report_revision,
        actor_id: history.rows[0].actor_id,
        device_id: history.rows[0].device_id
      }, {
        event_type: "draft-change",
        report_revision: "1",
        actor_id: clinicianId,
        device_id: "unit-41"
      });
      assert.ok(history.rows[0].client_time instanceof Date);
      assert.ok(history.rows[0].history_timestamp instanceof Date);
      assert.deepEqual(history.rows[0].new_value,
        [{ operation: "replace", path: "eRecord.01" }]);
      await assert.rejects(client.query("select * from operations.unsigned_report_work_queue limit 1"),
        (error) => error.code === "42501");
    } finally {
      await client.query("rollback");
    }

    const analyticalLeak = await client.query(`select
      (select count(*)::integer from analytics.epcr where report_id = $1) as wide,
      (select count(*)::integer from analytics.epcr_repeatable_element where report_id = $1) as repeatable`,
    [reportId]);
    assert.deepEqual(analyticalLeak.rows[0], { wide: 0, repeatable: 0 });

    await client.query("begin");
    try {
      await rejectsSql(client,
        "update clinical.report_change set changes = '[]' where report_id = $1 and revision = 1",
        [reportId], "P0001");
      await rejectsSql(client,
        "delete from clinical.report_change where report_id = $1 and revision = 1",
        [reportId], "P0001");
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("projects one signed report from the outbox into lossless analyst contracts", async (projectionTest) => {
    const ids = {
      report: "36000000-0000-4000-8000-000000000001",
      incident: "36000000-0000-4000-8000-000000000002",
      patient: "36000000-0000-4000-8000-000000000003",
      snapshot: "36000000-0000-4000-8000-000000000004",
      vitalGroup: "36000000-0000-4000-8000-000000000005",
      bloodPressureGroup: "36000000-0000-4000-8000-000000000006",
      historyGroup: "36000000-0000-4000-8000-000000000007",
      insuranceGroup: "36000000-0000-4000-8000-000000000008",
      deviceGroup: "36000000-0000-4000-8000-000000000009",
      waveformGroup: "36000000-0000-4000-8000-00000000000a"
    };
    const organizationId = "32000000-0000-4000-8000-000000000001";
    const administratorId = "32000000-0000-4000-8000-000000000099";
    const clinicianId = SYNTHETIC_DEMO_FIXTURE.userId;
    const agencyVersionId = "32000000-0000-4000-8000-000000000006";
    const formVersionId = "32000000-0000-4000-8000-000000000011";
    const release = await client.query(
      "select id, version from catalog.release where standard = 'NEMSIS' and version = '3.5.1'"
    );
    const releaseId = release.rows[0].id;

    await client.query(
      "insert into clinical.incident (id, organization_id) values ($1, $2)",
      [ids.incident, organizationId]
    );
    await client.query(`insert into clinical.patient
      (id, organization_id, identity_state, pseudonymous_key)
      values ($1, $2, 'known', repeat('6', 64))`, [ids.patient, organizationId]);
    await client.query(`insert into clinical.report
      (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
       form_version_id, catalog_release_id, documenting_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ids.report, organizationId, ids.incident, ids.patient, agencyVersionId,
      formVersionId, releaseId, clinicianId]);

    const groups = [
      [ids.vitalGroup, null, "eVitals.VitalGroup", 2, "vital-correlation"],
      [ids.bloodPressureGroup, ids.vitalGroup, "eVitals.BloodPressureGroup", 3, "bp-correlation"],
      [ids.historyGroup, null, "eHistorySection", 4, "history-correlation"],
      [ids.insuranceGroup, null, "ePayment.InsuranceGroup", 5, "insurance-correlation"],
      [ids.deviceGroup, null, "eDevice.DeviceGroup", 6, "device-correlation"],
      [ids.waveformGroup, ids.deviceGroup, "eDevice.WaveformGroup", 7, "waveform-correlation"]
    ];
    for (const group of groups) {
      await client.query(`insert into clinical.group_instance
        (id, report_id, catalog_release_id, parent_group_instance_id, group_id, ordinal,
         correlation_id, documented_time, documented_utc_offset_minutes, server_received_time, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, '2042-02-03T14:30:00-05:00', -300,
                '2042-02-03T19:31:00Z', $8)`,
      [group[0], ids.report, releaseId, group[1], group[2], group[3], group[4], clinicianId]);
    }

    const elementIds = [
      "eRecord.01", "eDisposition.11", "eExam.01", "ePatient.17", "eTimes.01",
      "eArrest.01", "eDispatch.03", "eDispatch.04", "eDispatch.06", "eVitals.01",
      "eVitals.02", "eVitals.06", "eVitals.07", "eVitals.08", "eVitals.13",
      "eVitals.16", "eHistory.01", "ePayment.60", "eDevice.02", "eDevice.05"
    ];
    const definitions = await client.query(`select
      m.element_id, m.element_identity_id, m.analytical_location, m.identifying, e.base_datatype
      from catalog.analytics_element_mapping m
      join catalog.element_definition e
        on e.release_id = m.release_id and e.element_id = m.element_id
      where m.release_id = $1 and m.element_id = any($2::text[])`, [releaseId, elementIds]);
    assert.equal(definitions.rowCount, elementIds.length);
    assert.deepEqual(
      [...new Set(definitions.rows.map((row) => row.base_datatype))].sort(),
      ["binary", "date", "dateTime", "decimal", "integer", "string"]
    );
    const definitionById = new Map(definitions.rows.map((row) => [row.element_id, row]));
    let occurrenceSequence = 0x10;
    async function addOccurrence(elementId, groupInstanceId, ordinal, values) {
      const definition = definitionById.get(elementId);
      const id = `36000000-0000-4000-8000-${occurrenceSequence.toString(16).padStart(12, "0")}`;
      occurrenceSequence += 1;
      const entries = Object.entries(values);
      const columns = entries.map(([column]) => column);
      const parameters = entries.map((_, index) => `$${index + 11}`);
      await client.query(`insert into clinical.element_occurrence
        (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id,
         ordinal, analytical_repeatable, identifying, author_id, ${columns.join(", ")})
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${parameters.join(", ")})`,
      [id, ids.report, releaseId, groupInstanceId, definition.element_identity_id, elementId,
        ordinal, definition.analytical_location === "repeatable", definition.identifying,
        clinicianId, ...entries.map(([, value]) => value)]);
    }

    await addOccurrence("eRecord.01", null, 0, { value_kind: "text", value_text: "PCR-2042-0001" });
    await addOccurrence("eDisposition.11", null, 0,
      { value_kind: "integer", value_integer: 2, value_lexical: "+002" });
    await addOccurrence("eExam.01", null, 0,
      { value_kind: "numeric", value_numeric: "82.50", value_lexical: "82.50" });
    await addOccurrence("ePatient.17", null, 0,
      { value_kind: "date", value_date: "1985-07-01", value_precision: "month" });
    await addOccurrence("eTimes.01", null, 0, {
      value_kind: "datetime", value_datetime: "2042-02-03T14:00:00-05:00",
      value_utc_offset_minutes: -300, value_precision: "minute"
    });
    await addOccurrence("eArrest.01", null, 0, {
      value_kind: "coded", code: "3001003", code_system: "urn:nemsis:3.5.1",
      code_display: "No", terminology_version: "3.5.1"
    });
    await addOccurrence("eDispatch.03", null, 0,
      { value_kind: "null", absence_code: "7701003", absence_display: "Not Recorded" });
    await addOccurrence("eDispatch.04", null, 0,
      { value_kind: "pertinent-negative", absence_code: "8801019", absence_display: "Denied" });
    await addOccurrence("eDispatch.06", null, 0, { value_kind: "absent" });

    await addOccurrence("eVitals.01", ids.vitalGroup, 0, {
      value_kind: "datetime", value_datetime: "2042-02-03T14:25:00-05:00",
      value_utc_offset_minutes: -300, value_precision: "minute",
      documented_time: "2042-02-03T14:30:15-05:00", documented_utc_offset_minutes: -300,
      documented_precision: "second", server_received_time: "2042-02-03T19:31:00Z"
    });
    await addOccurrence("eVitals.02", ids.vitalGroup, 0, {
      value_kind: "coded", code: "9925004", code_system: "urn:nemsis:3.5.1",
      code_display: "Patient Assisted", terminology_version: "3.5.1",
      correlation_id: "element-correlation"
    });
    await addOccurrence("eVitals.06", ids.bloodPressureGroup, 0, {
      value_kind: "integer", value_integer: 118, value_lexical: "0118",
      documented_time: "2042-02-03T14:30:16-05:00", documented_utc_offset_minutes: -300,
      documented_precision: "second", server_received_time: "2042-02-03T19:31:01Z"
    });
    await addOccurrence("eVitals.07", ids.bloodPressureGroup, 0,
      { value_kind: "null", absence_code: "7701003", absence_display: "Not Recorded" });
    await addOccurrence("eVitals.08", ids.bloodPressureGroup, 0,
      { value_kind: "pertinent-negative", absence_code: "8801019", absence_display: "Denied" });
    await addOccurrence("eVitals.13", ids.vitalGroup, 0, { value_kind: "absent" });
    await addOccurrence("eVitals.16", ids.vitalGroup, 0,
      { value_kind: "numeric", value_numeric: "14.000", value_lexical: "14.000",
        source_attributes: { ETCO2Type: "3340005" } });
    await addOccurrence("eHistory.01", ids.historyGroup, 0,
      { value_kind: "text", value_text: "Language barrier" });
    await addOccurrence("ePayment.60", ids.insuranceGroup, 0,
      { value_kind: "date", value_date: "2042-12-31", value_precision: "day" });
    await addOccurrence("eDevice.02", ids.deviceGroup, 0, {
      value_kind: "datetime", value_datetime: "2042-02-03T14:24:00-05:00",
      value_utc_offset_minutes: -300, value_precision: "minute"
    });
    await addOccurrence("eDevice.05", ids.waveformGroup, 0,
      { value_kind: "binary", value_binary: Buffer.from([0, 1, 2, 255]) });

    const draftProjection = await client.query(`select
      (select count(*)::integer from analytics_private.epcr where report_id = $1) as wide,
      (select count(*)::integer from analytics_private.epcr_repeatable_element where report_id = $1) as repeatable,
      (select count(*)::integer from integration.outbox_event where aggregate_id = $1) as events`, [ids.report]);
    assert.deepEqual(draftProjection.rows[0], { wide: 0, repeatable: 0, events: 0 });

    await client.query("begin");
    try {
      await client.query(`update clinical.report
        set status = 'signed', revision = 20, reporting_date = '2042-02-03',
            reporting_date_source = 'service-date'
        where id = $1`, [ids.report]);
      await client.query(`insert into clinical.signed_snapshot
        (id, report_id, signed_revision, form_version_id, catalog_release_id, signer_id,
         signed_at, canonical_sha256, attestation)
        values ($1, $2, 20, $3, $4, $5, '2042-02-03T20:00:00Z', repeat('a', 64),
                '{"statement":"integration projection"}')`,
      [ids.snapshot, ids.report, formVersionId, releaseId, clinicianId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    const queued = await client.query(`select event_type, payload, processed_at
      from integration.outbox_event where aggregate_id = $1`, [ids.report]);
    assert.equal(queued.rowCount, 1);
    assert.equal(queued.rows[0].event_type, "signed_snapshot");
    assert.deepEqual(queued.rows[0].payload, { sourceId: ids.snapshot });
    assert.equal(queued.rows[0].processed_at, null);

    const projector = path.join(packageRoot, "scripts/project-analytics.mjs");
    const projection = await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_BATCH_SIZE: "100" }
    });
    assert.deepEqual(JSON.parse(projection.stdout), {
      event: "analytics_projection_run", mode: "queue", status: "succeeded",
      processedCount: 1, failedCount: 0, checkedCount: 1
    });

    const wide = await client.query(`select
      tableoid::regclass::text as partition, reporting_date::text, reporting_date_source,
      report_id, incident_id, patient_key, patient_key_version, form_version_id, form_version,
      catalog_release_id, catalog_version, signed_snapshot_id, signed_snapshot_sha256, signed_at,
      amendment_count, effective_amendment_sequence, projector_version, projected_at,
      erecord_01, edisposition_11, edisposition_11_lexical, eexam_01, eexam_01_lexical,
      epatient_17::text, epatient_17_precision, etimes_01, etimes_01_precision,
      etimes_01_utc_offset_minutes, earrest_01, earrest_01_display, earrest_01_system,
      earrest_01_terminology_version, element_statuses, quality_flags, quality_rule_version,
      quality_findings, derived_values, normalization_rule_version
      from analytics_private.epcr where report_id = $1`, [ids.report]);
    assert.equal(wide.rowCount, 1);
    assert.deepEqual({
      partition: wide.rows[0].partition,
      reporting_date: wide.rows[0].reporting_date,
      reporting_date_source: wide.rows[0].reporting_date_source,
      erecord_01: wide.rows[0].erecord_01,
      edisposition_11: wide.rows[0].edisposition_11,
      edisposition_11_lexical: wide.rows[0].edisposition_11_lexical,
      eexam_01: wide.rows[0].eexam_01,
      eexam_01_lexical: wide.rows[0].eexam_01_lexical,
      epatient_17: wide.rows[0].epatient_17,
      epatient_17_precision: wide.rows[0].epatient_17_precision,
      etimes_01_precision: wide.rows[0].etimes_01_precision,
      etimes_01_utc_offset_minutes: wide.rows[0].etimes_01_utc_offset_minutes,
      earrest_01: wide.rows[0].earrest_01,
      earrest_01_display: wide.rows[0].earrest_01_display,
      earrest_01_system: wide.rows[0].earrest_01_system,
      earrest_01_terminology_version: wide.rows[0].earrest_01_terminology_version
    }, {
      partition: "analytics_private.epcr_y2042",
      reporting_date: "2042-02-03",
      reporting_date_source: "service-date",
      erecord_01: "PCR-2042-0001",
      edisposition_11: "2",
      edisposition_11_lexical: "+002",
      eexam_01: "82.50",
      eexam_01_lexical: "82.50",
      epatient_17: "1985-07-01",
      epatient_17_precision: "month",
      etimes_01_precision: "minute",
      etimes_01_utc_offset_minutes: -300,
      earrest_01: "3001003",
      earrest_01_display: "No",
      earrest_01_system: "urn:nemsis:3.5.1",
      earrest_01_terminology_version: "3.5.1"
    });
    assert.equal(wide.rows[0].etimes_01.toISOString(), "2042-02-03T19:00:00.000Z");
    assert.deepEqual(wide.rows[0].element_statuses, {
      "eDispatch.03": { kind: "null", code: "7701003", display: "Not Recorded" },
      "eDispatch.04": { kind: "pertinent-negative", code: "8801019", display: "Denied" },
      "eDispatch.06": { kind: "absent", code: null, display: null }
    });
    assert.equal(wide.rows[0].signed_snapshot_id, ids.snapshot);
    assert.equal(wide.rows[0].signed_snapshot_sha256, "a".repeat(64));
    assert.equal(wide.rows[0].form_version_id, formVersionId);
    assert.equal(wide.rows[0].form_version, 1);
    assert.equal(wide.rows[0].catalog_release_id, releaseId);
    assert.equal(wide.rows[0].catalog_version, "3.5.1");
    assert.equal(wide.rows[0].amendment_count, 0);
    assert.equal(wide.rows[0].effective_amendment_sequence, 0);
    assert.equal(wide.rows[0].projector_version, "1.0.0");
    assert.deepEqual(wide.rows[0].quality_flags, ["vital.etco2.unusual"]);
    assert.equal(wide.rows[0].quality_rule_version, "clinical-quality-1.0.0");
    assert.equal(wide.rows[0].quality_findings[0].observedNumeric, 14);
    assert.equal(wide.rows[0].derived_values[0].derivedNumeric, 105.009);
    assert.equal(wide.rows[0].normalization_rule_version,
      "clinical-normalization-1.0.0");
    assert.ok(wide.rows[0].projected_at instanceof Date);
    const freshness = await client.query(`select
      extract(epoch from (projection.projected_at - event.occurred_at)) as seconds
      from integration.outbox_event event
      join analytics_private.epcr projection on projection.report_id = event.aggregate_id
      where event.aggregate_id = $1 and event.event_type = 'signed_snapshot'`, [ids.report]);
    assert.ok(Number(freshness.rows[0].seconds) >= 0);
    assert.ok(Number(freshness.rows[0].seconds) <= 300,
      `signed-to-analytical freshness was ${freshness.rows[0].seconds} seconds`);
    const healthAfterProjection = (await client.query("select * from operations.projection_health")).rows[0];
    assert.equal(healthAfterProjection.backlog_count, 0);
    assert.equal(healthAfterProjection.last_run_status, "succeeded");
    assert.equal(healthAfterProjection.last_run_processed_count, 1);
    assert.ok(healthAfterProjection.last_successful_run_at instanceof Date);

    const analystClient = await connectAsRole("open_triage_analyst");
    try {
      assert.equal((await analystClient.query("select current_user")).rows[0].current_user, "open_triage_analyst");
      const pseudonymous = await analystClient.query("select patient_key from analytics.epcr where report_id = $1", [ids.report]);
      assert.equal(pseudonymous.rowCount, 1);
      await assert.rejects(analystClient.query("select epatient_17 from analytics.epcr limit 1"),
        (error) => error.code === "42703");
      await assert.rejects(analystClient.query("select * from analytics.epcr_identified limit 1"),
        (error) => error.code === "42501");
      await assert.rejects(analystClient.query("select * from analytics_private.epcr limit 1"),
        (error) => error.code === "42501");
      await assert.rejects(analystClient.query("select * from clinical.patient limit 1"),
        (error) => error.code === "42501");
    } finally {
      await analystClient.end();
    }

    const identifiedClient = await connectAsRole("open_triage_identified_analyst");
    try {
      assert.equal((await identifiedClient.query("select current_user")).rows[0].current_user,
        "open_triage_identified_analyst");
      const identified = await identifiedClient.query("select epatient_17::text from analytics.epcr_identified where report_id = $1", [ids.report]);
      assert.equal(identified.rows[0].epatient_17, "1985-07-01");
      await assert.rejects(identifiedClient.query("select * from analytics_private.epcr limit 1"),
        (error) => error.code === "42501");
      await assert.rejects(identifiedClient.query("select * from clinical.patient limit 1"),
        (error) => error.code === "42501");
      await assert.rejects(identifiedClient.query("select * from integration.outbox_event limit 1"),
        (error) => error.code === "42501");
    } finally {
      await identifiedClient.end();
    }

    const originalPatientKey = wide.rows[0].patient_key;
    const rotatedEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PATIENT_KEY_INSTALLATION_ID: patientKeyEnvironment.PATIENT_KEY_INSTALLATION_ID,
      PATIENT_KEY_VERSION: "2",
      PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 0x32).toString("base64")
    };
    const rotation = await execFileAsync(process.execPath,
      [path.join(packageRoot, "scripts/rotate-patient-keys.mjs")], { env: rotatedEnvironment });
    assert.deepEqual(JSON.parse(rotation.stdout), {
      event: "patient_key_rotation", keyVersion: 2, rotatedPatients: 2
    });
    const expectedRotatedKey = derivePatientKey(
      patientKeyConfigFromEnvironment(rotatedEnvironment), organizationId, ids.patient
    );
    const rotated = (await client.query(`select
      patient.pseudonymous_key, patient.pseudonymous_key_version,
      wide.patient_key as wide_key, wide.patient_key_version as wide_version,
      bool_and(repeatable.patient_key = patient.pseudonymous_key) as repeatable_key_matches,
      bool_and(repeatable.patient_key_version = patient.pseudonymous_key_version) as repeatable_version_matches
      from clinical.patient patient
      join clinical.report report on report.patient_id = patient.id
      join analytics_private.epcr wide on wide.report_id = report.id
      join analytics_private.epcr_repeatable_element repeatable on repeatable.report_id = report.id
      where patient.id = $1
      group by patient.id, wide.reporting_date, wide.report_id`, [ids.patient])).rows[0];
    assert.notEqual(rotated.pseudonymous_key, originalPatientKey);
    assert.deepEqual(rotated, {
      pseudonymous_key: expectedRotatedKey,
      pseudonymous_key_version: 2,
      wide_key: expectedRotatedKey,
      wide_version: 2,
      repeatable_key_matches: true,
      repeatable_version_matches: true
    });
    const rotationReplay = await execFileAsync(process.execPath,
      [path.join(packageRoot, "scripts/rotate-patient-keys.mjs")], { env: rotatedEnvironment });
    assert.equal(JSON.parse(rotationReplay.stdout).rotatedPatients, 0);

    const repeatable = await client.query(`select *, tableoid::regclass::text as partition
      from analytics_private.epcr_repeatable_element where report_id = $1
      order by element_id`, [ids.report]);
    assert.equal(repeatable.rowCount, 11);
    assert.ok(repeatable.rows.every((row) => row.partition === "analytics_private.epcr_repeatable_element_m204202"));
    assert.ok(repeatable.rows.every((row) => row.signed_snapshot_id === ids.snapshot));
    assert.ok(repeatable.rows.every((row) => row.catalog_version === "3.5.1"));
    assert.ok(repeatable.rows.every((row) => row.projector_version === "1.0.0"));
    const repeatById = new Map(repeatable.rows.map((row) => [row.element_id, row]));
    assert.equal(repeatById.get("eHistory.01").value_text, "Language barrier");
    assert.equal(repeatById.get("eVitals.06").value_integer, "118");
    assert.equal(repeatById.get("eVitals.06").value_lexical, "0118");
    const etco2 = repeatById.get("eVitals.16");
    assert.equal(etco2.value_numeric, "14.000");
    assert.equal(etco2.value_lexical, "14.000");
    assert.deepEqual(etco2.source_attributes, { ETCO2Type: "3340005" });
    assert.equal(etco2.source_unit_code, "kPa");
    assert.equal(etco2.normalized_numeric, "105.009");
    assert.equal(etco2.normalized_unit_code, "mm[Hg]");
    assert.equal(etco2.normalization_rule_id, "etco2.kpa-to-mmhg");
    assert.equal(etco2.normalization_rule_version, "clinical-normalization-1.0.0");
    assert.deepEqual(etco2.quality_flags, ["vital.etco2.unusual"]);
    assert.equal(etco2.quality_rule_version, "clinical-quality-1.0.0");
    assert.equal(etco2.quality_findings[0].sourceOccurrenceId, etco2.element_occurrence_id);
    const paymentDate = repeatById.get("ePayment.60").value_date;
    const serializedPaymentDate = paymentDate instanceof Date
      ? `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`
      : paymentDate;
    assert.equal(
      serializedPaymentDate,
      "2042-12-31"
    );
    assert.equal(repeatById.get("ePayment.60").value_precision, "day");
    assert.equal(repeatById.get("eVitals.01").value_precision, "minute");
    assert.equal(repeatById.get("eVitals.01").value_utc_offset_minutes, -300);
    assert.deepEqual(repeatById.get("eDevice.05").value_binary, Buffer.from([0, 1, 2, 255]));
    assert.equal(repeatById.get("eVitals.02").code, "9925004");
    assert.equal(repeatById.get("eVitals.02").correlation_id, "element-correlation");
    assert.deepEqual(repeatById.get("eVitals.06").instance_path,
      [ids.vitalGroup, ids.bloodPressureGroup]);
    assert.equal(repeatById.get("eVitals.06").parent_group_instance_id, ids.vitalGroup);
    assert.equal(repeatById.get("eVitals.06").group_ordinal, 3);
    assert.equal(repeatById.get("eVitals.06").element_ordinal, 0);
    assert.equal(repeatById.get("eVitals.06").group_correlation_id, "bp-correlation");
    assert.equal(repeatById.get("eVitals.06").clinical_time.toISOString(), "2042-02-03T19:25:00.000Z");
    assert.equal(repeatById.get("eVitals.06").clinical_time_element_id, "eVitals.01");
    assert.equal(repeatById.get("eVitals.06").clinical_utc_offset_minutes, -300);
    assert.equal(repeatById.get("eVitals.06").clinical_time_precision, "minute");
    assert.equal(repeatById.get("eVitals.06").documented_time.toISOString(), "2042-02-03T19:30:16.000Z");
    assert.equal(repeatById.get("eVitals.06").documented_utc_offset_minutes, -300);
    assert.equal(repeatById.get("eVitals.06").documented_time_precision, "second");
    assert.equal(repeatById.get("eVitals.06").server_received_time.toISOString(), "2042-02-03T19:31:01.000Z");
    assert.deepEqual([
      repeatById.get("eVitals.07").absence_kind,
      repeatById.get("eVitals.08").absence_kind,
      repeatById.get("eVitals.13").absence_kind
    ], ["null", "pertinent-negative", "absent"]);

    const amendmentId = "37000000-0000-4000-8000-000000000001";
    const addedOccurrenceId = "37000000-0000-4000-8000-000000000002";
    const sourceRows = await client.query(`select element_id, to_jsonb(o) as occurrence
      from clinical.element_occurrence o where report_id = $1 and element_id = any($2::text[])`,
    [ids.report, ["eRecord.01", "eHistory.01"]]);
    const sourceByElement = new Map(sourceRows.rows.map((row) => [row.element_id, row.occurrence]));
    const recordOccurrence = sourceByElement.get("eRecord.01");
    const historyOccurrence = sourceByElement.get("eHistory.01");
    const historyDefinition = definitionById.get("eHistory.01");
    await client.query("begin");
    try {
      await client.query(`insert into clinical.amendment
        (id, report_id, sequence, author_id, reason, attestation, canonical_sha256, signed_at)
        values ($1, $2, 1, $3, 'Correct projection fixture', '{"statement":"signed correction"}',
          repeat('b', 64), '2042-02-04T20:00:00Z')`, [amendmentId, ids.report, clinicianId]);
      await client.query(`insert into clinical.amendment_change
        (amendment_id, action, target_element_occurrence_id, target_path, original_value, corrected_value)
        values
          ($1, 'replace', $2, '{"elementId":"eRecord.01"}', $3::jsonb,
            '{"value_kind":"text","value_text":"PCR-2042-CORRECTED"}'),
          ($1, 'remove', $4, '{"elementId":"eHistory.01"}', $5::jsonb, null),
          ($1, 'add', null, '{"elementId":"eHistory.01"}', null, $6::jsonb)`,
      [amendmentId, recordOccurrence.id, JSON.stringify(recordOccurrence), historyOccurrence.id,
        JSON.stringify(historyOccurrence), JSON.stringify({
          id: addedOccurrenceId, report_id: ids.report, catalog_release_id: releaseId,
          group_instance_id: ids.historyGroup, element_identity_id: historyDefinition.element_identity_id,
          element_id: "eHistory.01", ordinal: 0, analytical_repeatable: true, identifying: false,
          value_kind: "text", value_text: "Amended language-barrier note",
          server_received_time: "2042-02-04T20:00:00Z"
        })]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    await assert.rejects(client.query("update clinical.amendment set reason = 'changed' where id = $1", [amendmentId]),
      (error) => error.code === "P0001");
    const amendmentProjection = await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_BATCH_SIZE: "100" }
    });
    assert.equal(JSON.parse(amendmentProjection.stdout).processedCount, 1);
    const effectiveWide = (await client.query(`select erecord_01, signed_snapshot_id,
      signed_snapshot_sha256, amendment_count, effective_amendment_sequence, last_amended_at
      from analytics.epcr where report_id = $1`, [ids.report])).rows[0];
    assert.equal(effectiveWide.erecord_01, "PCR-2042-CORRECTED");
    assert.equal(effectiveWide.signed_snapshot_id, ids.snapshot);
    assert.equal(effectiveWide.signed_snapshot_sha256, "a".repeat(64));
    assert.equal(effectiveWide.amendment_count, 1);
    assert.equal(effectiveWide.effective_amendment_sequence, 1);
    assert.equal(effectiveWide.last_amended_at.toISOString(), "2042-02-04T20:00:00.000Z");
    const effectiveHistory = await client.query(`select element_occurrence_id, value_text,
      signed_snapshot_id, effective_amendment_sequence from analytics.epcr_repeatable_element
      where report_id = $1 and element_id = 'eHistory.01'`, [ids.report]);
    assert.deepEqual(effectiveHistory.rows, [{
      element_occurrence_id: addedOccurrenceId,
      value_text: "Amended language-barrier note",
      signed_snapshot_id: ids.snapshot,
      effective_amendment_sequence: 1
    }]);
    assert.deepEqual((await client.query(`select
      (select value_text from clinical.element_occurrence where id = $1) as original_wide,
      (select value_text from clinical.element_occurrence where id = $2) as original_repeatable,
      (select count(*)::integer from clinical.amendment_change where amendment_id = $3) as lineage_changes`,
    [recordOccurrence.id, historyOccurrence.id, amendmentId])).rows[0], {
      original_wide: "PCR-2042-0001", original_repeatable: "Language barrier", lineage_changes: 3
    });

    await execFileAsync(process.execPath, [projector, "--replay", ids.report], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });
    assert.deepEqual((await client.query(`select
      (select count(*)::integer from analytics_private.epcr where report_id = $1) as wide,
      (select count(*)::integer from analytics_private.epcr_repeatable_element where report_id = $1) as repeatable`,
    [ids.report])).rows[0], { wide: 1, repeatable: 11 });

    await assert.rejects(execFileAsync(process.execPath, [projector, "--replay", ids.report], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_FAIL_AFTER_DELETE: "1" }
    }), (error) => {
      assert.equal(JSON.parse(error.stdout).status, "failed");
      return true;
    });
    assert.deepEqual((await client.query(`select
      (select erecord_01 from analytics_private.epcr where report_id = $1) as wide_value,
      (select count(*)::integer from analytics_private.epcr_repeatable_element where report_id = $1) as repeatable`,
    [ids.report])).rows[0], { wide_value: "PCR-2042-CORRECTED", repeatable: 11 });

    await client.query(`delete from analytics_private.epcr_repeatable_element
      where report_id = $1 and element_id = 'eHistory.01'`, [ids.report]);
    const reconciliation = await execFileAsync(process.execPath,
      [projector, "--reconcile", "--report", ids.report],
      { env: { ...process.env, DATABASE_URL: databaseUrl } });
    assert.deepEqual(JSON.parse(reconciliation.stdout), {
      event: "analytics_projection_run", mode: "reconcile", status: "succeeded",
      processedCount: 1, checkedCount: 1, repairedCount: 1
    });
    assert.equal((await client.query(`select count(*)::integer as count
      from analytics_private.epcr_repeatable_element where report_id = $1`, [ids.report])).rows[0].count, 11);

    await client.query("delete from analytics_private.epcr_repeatable_element where report_id = $1", [ids.report]);
    await client.query("delete from analytics_private.epcr where report_id = $1", [ids.report]);
    const interruptedBackfill = await execFileAsync(process.execPath,
      [projector, "--backfill", "integration-report-2042", "--from", "2042-02-01", "--to", "2042-02-28"],
      { env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_INTERRUPT_AFTER: "1" } });
    assert.deepEqual(JSON.parse(interruptedBackfill.stdout), {
      event: "analytics_projection_run", mode: "backfill", status: "succeeded",
      processedCount: 1, checkedCount: 1, totalProcessedCount: 1, complete: false
    });
    const resumedBackfill = await execFileAsync(process.execPath,
      [projector, "--backfill", "integration-report-2042", "--from", "2042-02-01", "--to", "2042-02-28"],
      { env: { ...process.env, DATABASE_URL: databaseUrl } });
    assert.deepEqual(JSON.parse(resumedBackfill.stdout), {
      event: "analytics_projection_run", mode: "backfill", status: "succeeded",
      processedCount: 0, checkedCount: 0, totalProcessedCount: 1, complete: true
    });
    assert.deepEqual((await client.query(`select processed_count, completed_at is not null as complete,
      (select count(*)::integer from analytics_private.epcr where report_id = $2) as wide,
      (select count(*)::integer from analytics_private.epcr_repeatable_element where report_id = $2) as repeatable
      from integration.projection_backfill_job where id = $1`,
    ["integration-report-2042", ids.report])).rows[0], {
      processed_count: 1, complete: true, wide: 1, repeatable: 11
    });

    const reportingDateAmendmentId = "38000000-0000-4000-8000-000000000001";
    await client.query(`insert into clinical.amendment
      (id, report_id, sequence, author_id, reason, attestation, canonical_sha256, signed_at,
       reporting_date, reporting_date_source)
      values ($1, $2, 2, $3, 'Correct reporting date', '{"statement":"date correction"}',
        repeat('c', 64), '2043-03-05T12:00:00Z', '2043-03-04', 'service-date')`,
    [reportingDateAmendmentId, ids.report, clinicianId]);
    await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_BATCH_SIZE: "100" }
    });
    assert.deepEqual((await client.query(`select
      (select count(*)::integer from analytics_private.epcr_y2042 where report_id = $1) as old_wide,
      (select count(*)::integer from analytics_private.epcr_repeatable_element_m204202 where report_id = $1) as old_repeatable,
      (select tableoid::regclass::text from analytics_private.epcr where report_id = $1) as wide_partition,
      (select min(tableoid::regclass::text) from analytics_private.epcr_repeatable_element where report_id = $1) as repeat_partition,
      (select reporting_date::text from analytics_private.epcr where report_id = $1) as reporting_date`,
    [ids.report])).rows[0], {
      old_wide: 0,
      old_repeatable: 0,
      wide_partition: "analytics_private.epcr_y2043",
      repeat_partition: "analytics_private.epcr_repeatable_element_m204303",
      reporting_date: "2043-03-04"
    });

    const dictionary = await client.query(`select
      count(*)::integer as count,
      count(*) filter (where name is not null and description is not null and base_datatype is not null
        and group_path is not null and analytical_location is not null and sql_type is not null
        and identifying is not null)::integer as described
      from analytics.element_dictionary where catalog_version = '3.5.1'`);
    assert.deepEqual(dictionary.rows[0], { count: 441, described: 441 });
    const processed = await client.query(`select processed_at, last_error, attempt_count
      from integration.outbox_event where aggregate_id = $1`, [ids.report]);
    assert.ok(processed.rows[0].processed_at instanceof Date);
    assert.equal(processed.rows[0].last_error, null);
    assert.equal(processed.rows[0].attempt_count, 1);

    const retryEvent = (await client.query(`select id from integration.outbox_event
      where aggregate_id = $1 order by occurred_at limit 1`, [ids.report])).rows[0];
    await client.query(`update integration.outbox_event
      set processed_at = null, failed_at = null, attempt_count = 0, available_at = now()
      where id = $1`, [retryEvent.id]);
    const transientFailure = await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_MAX_ATTEMPTS: "2",
        ANALYTICS_PROJECTOR_FAIL_AFTER_DELETE: "1" }
    });
    assert.equal(JSON.parse(transientFailure.stdout).failedCount, 1);
    assert.deepEqual((await client.query(`select failed_at, attempt_count, last_error
      from integration.outbox_event where id = $1`, [retryEvent.id])).rows[0], {
      failed_at: null, attempt_count: 1, last_error: "projector.Error"
    });
    await client.query("update integration.outbox_event set available_at = now() where id = $1", [retryEvent.id]);
    const successfulRetry = await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_MAX_ATTEMPTS: "2" }
    });
    assert.equal(JSON.parse(successfulRetry.stdout).processedCount, 1);

    await client.query(`update integration.outbox_event
      set processed_at = null, failed_at = null, attempt_count = 0, available_at = now()
      where id = $1`, [retryEvent.id]);
    await execFileAsync(process.execPath, [projector], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_MAX_ATTEMPTS: "1",
        ANALYTICS_PROJECTOR_FAIL_AFTER_DELETE: "1" }
    });
    const persistentHealth = (await client.query("select * from operations.projection_health")).rows[0];
    assert.equal(persistentHealth.persistent_failure_count, 1);
    assert.equal(persistentHealth.last_run_failed_count, 1);
    assert.equal(persistentHealth.last_run_status, "partial");
    const safeFailure = await client.query("select * from operations.projection_failures");
    assert.deepEqual(safeFailure.rows.map((row) => ({
      event_id: row.event_id, attempt_count: row.attempt_count, error_code: row.error_code
    })), [{ event_id: retryEvent.id, attempt_count: 1, error_code: "projector.Error" }]);
    const healthScript = path.join(packageRoot, "scripts/projection-health.mjs");
    await assert.rejects(execFileAsync(process.execPath, [healthScript], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    }), (error) => {
      assert.equal(JSON.parse(error.stdout).healthy, false);
      return true;
    });

    await client.query(`update integration.outbox_event
      set failed_at = null, attempt_count = 0, available_at = now()
      where id = $1`, [retryEvent.id]);
    await execFileAsync(process.execPath, [projector], { env: { ...process.env, DATABASE_URL: databaseUrl } });
    const healthy = await execFileAsync(process.execPath, [healthScript], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });
    assert.equal(JSON.parse(healthy.stdout).healthy, true);

    await projectionTest.test("verifies recovery, replica roles, and metadata-only query auditing", async () => {
      const recoveryBefore = (await client.query("select * from operations.recovery_readiness")).rows[0];
      assert.deepEqual({
        missing_snapshot_count: Number(recoveryBefore.missing_snapshot_count),
        mismatched_snapshot_count: Number(recoveryBefore.mismatched_snapshot_count),
        orphan_snapshot_count: Number(recoveryBefore.orphan_snapshot_count),
        broken_audit_chain_count: Number(recoveryBefore.broken_audit_chain_count),
        missing_or_stale_projection_count: Number(recoveryBefore.missing_or_stale_projection_count)
      }, {
        missing_snapshot_count: 0,
        mismatched_snapshot_count: 0,
        orphan_snapshot_count: 0,
        broken_audit_chain_count: 0,
        missing_or_stale_projection_count: 0
      });

      const recoveryVerifier = path.join(packageRoot, "scripts/verify-recovery.mjs");
      const recovery = await execFileAsync(process.execPath, [recoveryVerifier], {
        env: { ...process.env, RESTORED_DATABASE_URL: databaseUrl,
          RECOVERY_EXERCISE_ACKNOWLEDGE_RESTORED_DATABASE: "1" }
      });
      const recoveryEvidence = JSON.parse(recovery.stdout);
      assert.equal(recoveryEvidence.status, "succeeded");
      assert.equal(recoveryEvidence.authoritativeIntegrityFailures, 0);
      assert.equal(recoveryEvidence.staleProjectionsAfter, 0);
      assert.ok(recoveryEvidence.projectionsChecked >= 1);

      const replicaVerifier = path.join(packageRoot, "scripts/verify-reporting-replica.mjs");
      for (const role of ["open_triage_analyst", "open_triage_identified_analyst"]) {
        const verification = await execFileAsync(process.execPath, [replicaVerifier], {
          env: { ...process.env, REPORTING_REPLICA_DATABASE_URL: databaseUrl,
            REPORTING_REPLICA_ROLE: role, ALLOW_PRIMARY_REPLICA_TEST: "1" }
        });
        assert.deepEqual({
          status: JSON.parse(verification.stdout).status,
          role: JSON.parse(verification.stdout).role,
          readOnly: JSON.parse(verification.stdout).readOnly,
          privateAccess: JSON.parse(verification.stdout).privateAccess
        }, { status: "succeeded", role, readOnly: true, privateAccess: false });
      }

      const auditColumns = await client.query(`select column_name from information_schema.columns
        where table_schema = 'operations' and table_name = 'query_audit_event'
        order by ordinal_position`);
      const names = auditColumns.rows.map((row) => row.column_name);
      assert.ok(!names.some((name) => /query_text|sql_text|bind|result_value|clinical_value/.test(name)));
      assert.ok(names.includes("statement_fingerprint_sha256"));
      assert.ok(names.includes("returned_row_count"));

      await client.query("begin");
      try {
        await client.query("set local role open_triage_query_auditor");
        const recorded = await client.query(`select operations.record_query_audit(
          '44000000-0000-4000-8000-000000000001', 'open_triage_analyst', 'analytics.epcr',
          'monthly.primary-impression-count', $1, 12.345, 4, true, null, 'analyst-gateway') as id`,
        ["4".repeat(64)]);
        assert.ok(Number(recorded.rows[0].id) > 0);
        await rejectsSql(client, "select * from operations.query_audit_event", [], "42501");
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      const audit = (await client.query(`select database_role, analyst_contract, statement_name,
        statement_fingerprint_sha256, duration_ms::text, returned_row_count, succeeded, sqlstate,
        application_name from operations.query_audit_event
        where session_id = '44000000-0000-4000-8000-000000000001'`)).rows[0];
      assert.deepEqual(audit, {
        database_role: "open_triage_analyst",
        analyst_contract: "analytics.epcr",
        statement_name: "monthly.primary-impression-count",
        statement_fingerprint_sha256: "4".repeat(64),
        duration_ms: "12.345",
        returned_row_count: "4",
        succeeded: true,
        sqlstate: null,
        application_name: "analyst-gateway"
      });
      await assert.rejects(client.query("update operations.query_audit_event set duration_ms = 0"),
        /append-only/);
      const health = (await client.query("select * from operations.query_audit_health")).rows[0];
      assert.equal(Number(health.events_last_hour), 1);
      assert.equal(Number(health.failures_last_hour), 0);
    });

    await projectionTest.test("enforces approved retention, legal holds, archive verification, and durable deletion evidence", async () => {
      const heldReportId = "39000000-0000-4000-8000-000000000001";
      const heldSnapshotId = "39000000-0000-4000-8000-000000000002";
      await client.query(`insert into clinical.report
        (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
         form_version_id, catalog_release_id, documenting_user_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [heldReportId, organizationId, ids.incident, ids.patient, agencyVersionId,
        formVersionId, releaseId, clinicianId]);
      await client.query("begin");
      try {
        await client.query(`update clinical.report set status = 'signed', revision = 1,
          reporting_date = '2043-03-05', reporting_date_source = 'service-date' where id = $1`,
        [heldReportId]);
        await client.query(`insert into clinical.signed_snapshot
          (id, report_id, signed_revision, form_version_id, catalog_release_id, signer_id,
           signed_at, canonical_sha256, attestation)
          values ($1, $2, 1, $3, $4, $5, '2043-03-05T12:00:00Z', repeat('d', 64),
            '{"statement":"retention hold fixture"}')`,
        [heldSnapshotId, heldReportId, formVersionId, releaseId, clinicianId]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
      await execFileAsync(process.execPath, [projector], {
        env: { ...process.env, DATABASE_URL: databaseUrl, ANALYTICS_PROJECTOR_BATCH_SIZE: "100" }
      });

      const destination = `s3://open-triage-retention-archive/integration/${organizationId}/`;
      await client.query(`insert into retention.policy
        (organization_id, retention_years, archive_destination_uri)
        values ($1, 10, $2)`, [organizationId, destination]);
      await assert.rejects(
        client.query("select retention.prepare_archive_batch($1, '2054-01-01', 'operator-a')", [organizationId]),
        /installation-owner approval is required/
      );
      await client.query(`update retention.policy set review_status = 'approved-installation-owner',
        approved_by = 'integration-owner', approved_at = now(), approval_note = 'integration only'
        where organization_id = $1`, [organizationId]);

      const hold = await client.query(`insert into retention.legal_hold
        (organization_id, report_id, reason, authority_reference, placed_by)
        values ($1, $2, 'Preserve test record', 'CASE-042', 'legal-user') returning id`,
      [organizationId, heldReportId]);
      const failedBatch = (await client.query(
        "select retention.prepare_archive_batch($1, '2054-01-01', 'operator-a') as id",
        [organizationId]
      )).rows[0].id;
      const failedMembers = await client.query(
        "select report_id from retention.archive_batch_report where batch_id = $1", [failedBatch]
      );
      assert.deepEqual(failedMembers.rows, [{ report_id: ids.report }]);
      await client.query("select retention.fail_archive($1, 'operator-a', 'UPLOAD_FAILED', 'simulated')", [failedBatch]);
      assert.equal((await client.query("select count(*)::integer as count from clinical.report where id = $1", [ids.report])).rows[0].count, 1);

      const batch = (await client.query(
        "select retention.prepare_archive_batch($1, '2054-01-01', 'operator-b') as id",
        [organizationId]
      )).rows[0].id;
      const archive = (await client.query(
        "select archive_sha256 from retention.archive_batch where id = $1", [batch]
      )).rows[0];
      await assert.rejects(client.query(
        "select retention.verify_archive($1, $2, 'version-1', $3, 'verifier')",
        [batch, `${destination}${batch}.ndjson`, "0".repeat(64)]
      ), /checksum does not match/);
      await client.query("select retention.verify_archive($1, $2, 'version-1', $3, 'verifier')",
        [batch, `${destination}${batch}.ndjson`, archive.archive_sha256]);

      await assert.rejects(
        client.query("select retention.delete_verified_batch($1, $2)", [batch, clinicianId]),
        /active installation administrator/
      );

      const lateHold = await client.query(`insert into retention.legal_hold
        (organization_id, report_id, reason, authority_reference, placed_by)
        values ($1, $2, 'Late preservation request', 'CASE-LATE', 'legal-user') returning id`,
      [organizationId, ids.report]);
      await assert.rejects(
        client.query("select retention.delete_verified_batch($1, $2)", [batch, administratorId]),
        /legal hold now protects/
      );
      await client.query(`update retention.legal_hold set released_by = 'legal-user', released_at = now(),
        release_reason = 'Late request withdrawn' where id = $1`, [lateHold.rows[0].id]);
      const deletion = (await client.query(
        "select retention.delete_verified_batch($1, $2) as evidence", [batch, administratorId]
      )).rows[0].evidence;
      assert.equal(deletion.reports, 1);
      assert.equal((await client.query("select count(*)::integer as count from clinical.report where id = $1", [ids.report])).rows[0].count, 0);
      assert.equal((await client.query("select count(*)::integer as count from clinical.report where id = $1", [heldReportId])).rows[0].count, 1);
      assert.equal((await client.query("select count(*)::integer as count from analytics_private.epcr where report_id = $1", [heldReportId])).rows[0].count, 1);
      await client.query("select retention.maintain_partitions($1, 'maintenance-operator')", [batch]);
      assert.equal((await client.query("select to_regclass('analytics_private.epcr_y2043') is not null as retained")).rows[0].retained, true);

      const evidence = await client.query(`select sequence, event_type, actor, previous_hash, event_hash
        from retention.evidence where batch_id = $1 order by sequence`, [batch]);
      assert.deepEqual(evidence.rows.map((row) => row.event_type), ["prepared", "archive_verified", "deleted", "partition_maintained"]);
      assert.equal(evidence.rows[0].previous_hash, null);
      assert.equal(evidence.rows[1].previous_hash, evidence.rows[0].event_hash);
      assert.equal(evidence.rows[2].previous_hash, evidence.rows[1].event_hash);
      assert.equal(evidence.rows[2].actor, administratorId);
      assert.equal(evidence.rows[3].previous_hash, evidence.rows[2].event_hash);
      await assert.rejects(client.query("delete from retention.evidence where batch_id = $1", [batch]), /append-only/);
      assert.equal((await client.query("select count(*)::integer as count from retention.evidence where batch_id = $1", [failedBatch])).rows[0].count, 2);
      assert.equal(hold.rowCount, 1);
    });
  });
});
