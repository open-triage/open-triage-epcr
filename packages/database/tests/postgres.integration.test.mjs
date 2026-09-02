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

  await t.test("bootstraps and safely replays a complete synthetic installation", async () => {
    const bootstrap = path.join(packageRoot, "scripts/bootstrap-synthetic-installation.mjs");
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    const first = await execFileAsync(process.execPath, [bootstrap], { env: environment });
    const second = await execFileAsync(process.execPath, [bootstrap], { env: environment });
    assert.equal(JSON.parse(first.stdout).status, "ready");
    assert.equal(JSON.parse(second.stdout).status, "ready");

    const fixture = await client.query(`
      select
        r.organization_id,
        r.agency_demographic_version_id,
        r.form_version_id,
        r.catalog_release_id,
        r.synthetic as report_synthetic,
        r.baseline as report_baseline,
        i.synthetic as incident_synthetic,
        i.baseline as incident_baseline,
        p.identity_state,
        fv.status as form_status,
        count(distinct u.id)::integer as users,
        count(distinct uc.capability_key)::integer as capabilities
      from clinical.report r
      join clinical.incident i on i.id = r.incident_id
      join clinical.patient p on p.id = r.patient_id
      join forms.form_version fv on fv.id = r.form_version_id
      join app_identity.app_user u on u.organization_id = r.organization_id and u.synthetic
      join app_identity.user_capability uc on uc.user_id = u.id
      where r.id = '32000000-0000-4000-8000-00000000000e'
      group by r.id, i.id, p.id, fv.id
    `);
    assert.deepEqual(fixture.rows[0], {
      organization_id: "32000000-0000-4000-8000-000000000001",
      agency_demographic_version_id: "32000000-0000-4000-8000-000000000006",
      form_version_id: "32000000-0000-4000-8000-000000000008",
      catalog_release_id: fixture.rows[0].catalog_release_id,
      report_synthetic: true,
      report_baseline: true,
      incident_synthetic: true,
      incident_baseline: true,
      identity_state: "unknown",
      form_status: "published",
      users: 2,
      capabilities: 3
    });

    const stableCounts = await client.query(`
      select
        (select count(*)::integer from app_identity.organization
          where id = '32000000-0000-4000-8000-000000000001') as organizations,
        (select count(*)::integer from app_identity.agency_demographic_version
          where organization_id = '32000000-0000-4000-8000-000000000001') as agency_versions,
        (select count(*)::integer from forms.form_version
          where form_id = '32000000-0000-4000-8000-000000000007') as form_versions,
        (select count(*)::integer from clinical.report
          where organization_id = '32000000-0000-4000-8000-000000000001') as reports
    `);
    assert.deepEqual(stableCounts.rows[0], {
      organizations: 1,
      agency_versions: 1,
      form_versions: 1,
      reports: 1
    });

    await client.query("begin");
    try {
      await rejectsSql(client,
        "update app_identity.agency_demographic_version set dagency_02 = 'changed' where id = $1",
        [fixture.rows[0].agency_demographic_version_id], "P0001");
      await rejectsSql(client,
        "update forms.form_version set change_note = 'changed' where id = $1",
        [fixture.rows[0].form_version_id], "P0001");
    } finally {
      await client.query("rollback");
    }
  });

  await t.test("projects one signed report from the outbox into lossless analyst contracts", async () => {
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
    const clinicianId = "32000000-0000-4000-8000-000000000003";
    const agencyVersionId = "32000000-0000-4000-8000-000000000006";
    const formVersionId = "32000000-0000-4000-8000-000000000008";
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
      { value_kind: "numeric", value_numeric: "98.70", value_lexical: "98.70" });
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
    assert.match(projection.stdout, /Processed 1 analytical projection event/);

    const wide = await client.query(`select
      tableoid::regclass::text as partition, reporting_date::text, reporting_date_source,
      report_id, incident_id, patient_key, patient_key_version, form_version_id, form_version,
      catalog_release_id, catalog_version, signed_snapshot_id, signed_snapshot_sha256, signed_at,
      amendment_count, effective_amendment_sequence, projector_version, projected_at,
      erecord_01, edisposition_11, edisposition_11_lexical, eexam_01, eexam_01_lexical,
      epatient_17::text, epatient_17_precision, etimes_01, etimes_01_precision,
      etimes_01_utc_offset_minutes, earrest_01, earrest_01_display, earrest_01_system,
      earrest_01_terminology_version, element_statuses
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
    assert.ok(wide.rows[0].projected_at instanceof Date);

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
    assert.equal(repeatById.get("eVitals.16").value_numeric, "98.70");
    const paymentDate = repeatById.get("ePayment.60").value_date;
    assert.equal(
      paymentDate instanceof Date ? paymentDate.toISOString().slice(0, 10) : paymentDate,
      "2042-12-31"
    );
    assert.equal(repeatById.get("ePayment.60").value_precision, "day");
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
  });
});
