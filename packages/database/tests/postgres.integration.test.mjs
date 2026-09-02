import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;

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

integrationTest("the database foundation runs on a clean PostgreSQL 15+ server", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());

  const version = await client.query("show server_version_num");
  assert.ok(Number(version.rows[0].server_version_num) >= 150000);

  const migration = await readFile(
    path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"),
    "utf8"
  );
  await client.query(migration);

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
      await client.query("insert into clinical.patient (id, organization_id, identity_state) values ($1, $2, 'unknown')", [patientId, organizationId]);
      await client.query(`insert into app_identity.agency_demographic_version
        (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
         definition_sha256, effective_from, created_by)
        values ($1, $2, $3, 1, 'a', 'b', 'c', repeat('b', 64), now(), $4)`,
        [agencyId, organizationId, release.rows[0].id, userId]);
      await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, 'integration', 'Integration')", [formId, organizationId]);
      await client.query(`insert into forms.form_version
        (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
        values ($1, $2, $3, 1, '{}', repeat('c', 64), $4)`,
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
        to_regclass('auth.users') is null as no_supabase_auth_dependency
    `);
    assert.deepEqual(grants.rows[0], {
      analyst_view: true,
      analyst_private: false,
      identified_view: true,
      projector_insert: true,
      no_supabase_auth_dependency: true
    });
  });
});
