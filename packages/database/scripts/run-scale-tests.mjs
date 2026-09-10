import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertScratchDatabaseTarget } from "./lib/scale-test-guard.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const policyPath = path.join(packageRoot, "config/production-scale-performance.json");
const projectorPath = path.join(packageRoot, "scripts/project-analytics.mjs");
const [policyText, projectorText] = await Promise.all([
  readFile(policyPath, "utf8"), readFile(projectorPath, "utf8")
]);
const policy = JSON.parse(policyText);
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required to run scale tests");
// This check runs before the first destructive statement. A dedicated database is created on the
// approved scratch server; the configured database and all of its application schemas stay intact.
assertScratchDatabaseTarget(sourceDatabaseUrl);

function argumentsFrom(argv) {
  const options = { profile: "ci", output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile" || argument === "--output") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!policy.profiles[options.profile]) throw new Error(`unknown scale-test profile: ${options.profile}`);
  return options;
}

const options = argumentsFrom(process.argv.slice(2));
const profile = policy.profiles[options.profile];
if (options.profile === "production" && profile.reports !== policy.capacityModel.totalReports) {
  throw new Error("production profile must materialize the approved capacity total");
}

const rounded = (number) => Number(number.toFixed(3));
const elapsed = async (operation) => {
  const started = performance.now();
  const value = await operation();
  return { value, milliseconds: rounded(performance.now() - started) };
};
const percentile95 = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return rounded(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]);
};
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDatabaseName = decodeURIComponent(sourceUrl.pathname.slice(1));
const scratchDatabaseName = `${sourceDatabaseName.slice(0, 40)}_scale_${process.pid}`;
const scratchUrl = new URL(sourceUrl);
scratchUrl.pathname = `/${scratchDatabaseName}`;
const scratchDatabaseUrl = scratchUrl.toString();
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString(), application_name: "open-triage-scale-setup" });
let adminConnected = false;
let client;

async function bootstrapProductionDatabase() {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${quoteIdentifier(scratchDatabaseName)}`);
  const environment = {
    ...process.env,
    DATABASE_URL: scratchDatabaseUrl,
    PATIENT_KEY_INSTALLATION_ID: process.env.PATIENT_KEY_INSTALLATION_ID ?? "39000000-0000-4000-8000-000000000001",
    PATIENT_KEY_VERSION: process.env.PATIENT_KEY_VERSION ?? "1",
    PATIENT_KEY_SECRET_BASE64: process.env.PATIENT_KEY_SECRET_BASE64 ?? Buffer.alloc(32, 0x39).toString("base64")
  };
  const result = await execFileAsync("npm", ["run", "bootstrap:synthetic", "-w", "@open-triage/database"], {
    cwd: repoRoot, env: environment, maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
}

async function removeScratchDatabase() {
  if (client) await client.end();
  if (!adminConnected) return;
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [scratchDatabaseName]);
  await admin.query(`drop database if exists ${quoteIdentifier(scratchDatabaseName)}`);
  await admin.end();
}

async function runProjector(args = []) {
  const result = await execFileAsync(process.execPath, [projectorPath, ...args], {
    env: { ...process.env, DATABASE_URL: scratchDatabaseUrl,
      ANALYTICS_PROJECTOR_BATCH_SIZE: String(profile.projectorBatchSize) },
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}

async function loadProductionWorkload() {
  await client.query(`create function pg_temp.scale_uuid(seed text) returns uuid immutable language sql as $$
    select (substr(md5(seed),1,8) || '-' || substr(md5(seed),9,4) || '-4' || substr(md5(seed),14,3) ||
      '-8' || substr(md5(seed),18,3) || '-' || substr(md5(seed),21,12))::uuid $$`);
  const signingCount = Math.min(profile.signingBatchSize, profile.reports);
  const bulkCount = profile.reports - signingCount;
  const baseYear = new Date().getUTCFullYear() - profile.years;
  const fixture = (await client.query(`select r.organization_id, r.agency_demographic_version_id,
      r.form_version_id, fv.version as form_version, r.catalog_release_id, cr.version as catalog_version,
      r.documenting_user_id
    from clinical.report r join forms.form_version fv on fv.id = r.form_version_id
    join catalog.release cr on cr.id = r.catalog_release_id where r.baseline limit 1`)).rows[0];
  if (!fixture) throw new Error("production bootstrap did not create its baseline report");
  const definitions = await client.query(`select element_id, element_identity_id
    from catalog.element_definition where release_id = $1 and element_id = any($2::text[])`,
  [fixture.catalog_release_id, ["eResponse.01", "eVitals.06"]]);
  const identity = new Map(definitions.rows.map((row) => [row.element_id, row.element_identity_id]));
  if (!identity.has("eResponse.01") || !identity.has("eVitals.06")) {
    throw new Error("bootstrapped production catalog is missing scale workload elements");
  }
  await client.query("select analytics_private.ensure_partitions(make_date($1,1,1), make_date($2,1,1))",
    [baseYear, baseYear + profile.years]);

  if (bulkCount) {
    await client.query(`insert into analytics_private.epcr
      (reporting_date, reporting_date_source, report_id, incident_id, organization_id,
       agency_demographic_version_id, patient_key, patient_key_version, form_version_id, form_version,
       catalog_release_id, catalog_version, signed_snapshot_id, signed_snapshot_sha256, signed_at,
       amendment_count, effective_amendment_sequence, projector_version, projected_at,
       normalization_rule_version, eresponse_01)
      select make_date($2,1,1) + ((n * 37) % ($3 * 365))::integer, 'service-date',
        pg_temp.scale_uuid('bulk-report-' || n), pg_temp.scale_uuid('bulk-incident-' || n), $4, $5,
        md5('patient-' || (n % greatest(1, ($1 / 3)))::text) ||
          md5('patient-key-' || (n % greatest(1, ($1 / 3)))::text),
        1, $6, $7, $8, $9, pg_temp.scale_uuid('bulk-snapshot-' || n), repeat('a', 64),
        timestamptz '2026-01-01 00:00:00+00' + n * interval '1 second', 0, 0,
        'scale-production-schema', clock_timestamp(), 'clinical-normalization-1.0.0',
        'AGENCY-' || (n % 100)::text
      from generate_series(1, $1) n`, [bulkCount, baseYear, profile.years, fixture.organization_id,
      fixture.agency_demographic_version_id, fixture.form_version_id, fixture.form_version,
      fixture.catalog_release_id, fixture.catalog_version]);
    await client.query(`insert into analytics_private.epcr_repeatable_element
      (reporting_date, reporting_date_source, report_id, incident_id, organization_id,
       agency_demographic_version_id, patient_key, patient_key_version, form_version_id,
       catalog_release_id, catalog_version, element_identity_id, element_id, element_occurrence_id,
       group_id, group_instance_id, group_path, instance_path, group_ordinal, element_ordinal,
       value_kind, value_integer, clinical_time, server_received_time, is_identifying,
       signed_snapshot_id, signed_snapshot_sha256, effective_amendment_sequence, projector_version, projected_at)
      select make_date($3,1,1) + ((n * 37) % ($4 * 365))::integer, 'service-date',
        pg_temp.scale_uuid('bulk-report-' || n), pg_temp.scale_uuid('bulk-incident-' || n), $5, $6,
        md5('patient-' || (n % greatest(1, ($1 / 3)))::text) ||
          md5('patient-key-' || (n % greatest(1, ($1 / 3)))::text),
        1, $7, $8, $9, $10, 'eVitals.06',
        pg_temp.scale_uuid('bulk-occurrence-' || n || '-' || occurrence),
        'eVitals.BloodPressureGroup', pg_temp.scale_uuid('bulk-group-' || n || '-' || occurrence),
        array['EMSDataSet','HeaderGroup','PatientCareReportGroup','eVitalsSection','eVitals.VitalGroup','eVitals.BloodPressureGroup'],
        array[pg_temp.scale_uuid('bulk-group-' || n || '-' || occurrence)], occurrence - 1, 0,
        'integer', 90 + ((n + occurrence) % 70),
        (make_date($3,1,1) + ((n * 37) % ($4 * 365))::integer)::timestamptz + occurrence * interval '5 minutes',
        clock_timestamp(), false, pg_temp.scale_uuid('bulk-snapshot-' || n), repeat('a', 64), 0,
        'scale-production-schema', clock_timestamp()
      from generate_series(1, $1) n cross join generate_series(1, $2) occurrence`,
    [bulkCount, profile.repeatableElementsPerReport, baseYear, profile.years, fixture.organization_id,
      fixture.agency_demographic_version_id, fixture.form_version_id, fixture.catalog_release_id,
      fixture.catalog_version, identity.get("eVitals.06")]);
  }

  await client.query(`insert into clinical.incident (id, organization_id, operational_state, synthetic)
    select pg_temp.scale_uuid('live-incident-' || n), $2, 'created', true from generate_series(1, $1) n`,
  [signingCount, fixture.organization_id]);
  await client.query(`insert into clinical.patient
    (id, organization_id, identity_state, pseudonymous_key, pseudonymous_key_version)
    select pg_temp.scale_uuid('live-patient-' || n), $2, 'unknown',
      md5('live-patient-' || n) || md5('live-patient-key-' || n), 1 from generate_series(1, $1) n`,
  [signingCount, fixture.organization_id]);
  await client.query(`insert into clinical.report
    (id, organization_id, incident_id, patient_id, agency_demographic_version_id, form_version_id,
     catalog_release_id, documenting_user_id, status, revision, synthetic)
    select pg_temp.scale_uuid('live-report-' || n), $2, pg_temp.scale_uuid('live-incident-' || n),
      pg_temp.scale_uuid('live-patient-' || n), $3, $4, $5, $6, 'draft', 0, true
    from generate_series(1, $1) n`, [signingCount, fixture.organization_id,
    fixture.agency_demographic_version_id, fixture.form_version_id, fixture.catalog_release_id,
    fixture.documenting_user_id]);
  await client.query(`insert into clinical.element_occurrence
    (id, report_id, catalog_release_id, element_identity_id, element_id, analytical_repeatable,
     identifying, value_kind, value_text, author_id)
    select pg_temp.scale_uuid('live-wide-' || n), pg_temp.scale_uuid('live-report-' || n), $2,
      $3, 'eResponse.01', false, false, 'text', 'AGENCY-' || (n % 100)::text, $4
    from generate_series(1, $1) n`, [signingCount, fixture.catalog_release_id,
    identity.get("eResponse.01"), fixture.documenting_user_id]);
  await client.query(`insert into clinical.group_instance
    (id, report_id, catalog_release_id, group_id, ordinal, created_by)
    select pg_temp.scale_uuid('live-group-' || n || '-' || occurrence),
      pg_temp.scale_uuid('live-report-' || n), $3, 'eVitals.BloodPressureGroup', occurrence - 1, $4
    from generate_series(1, $1) n cross join generate_series(1, $2) occurrence`,
  [signingCount, profile.repeatableElementsPerReport, fixture.catalog_release_id, fixture.documenting_user_id]);
  await client.query(`insert into clinical.element_occurrence
    (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id, ordinal,
     analytical_repeatable, identifying, value_kind, value_integer, author_id)
    select pg_temp.scale_uuid('live-repeat-' || n || '-' || occurrence),
      pg_temp.scale_uuid('live-report-' || n), $3, pg_temp.scale_uuid('live-group-' || n || '-' || occurrence),
      $4, 'eVitals.06', 0, true, false, 'integer', 90 + ((n + occurrence) % 70), $5
    from generate_series(1, $1) n cross join generate_series(1, $2) occurrence`,
  [signingCount, profile.repeatableElementsPerReport, fixture.catalog_release_id,
    identity.get("eVitals.06"), fixture.documenting_user_id]);
  await client.query("analyze analytics_private.epcr");
  await client.query("analyze analytics_private.epcr_repeatable_element");
  return { fixture, signingCount, baseYear };
}

async function sample(sql, parameters) {
  const values = [];
  for (let index = 0; index < profile.measurementIterations; index += 1) {
    values.push((await elapsed(() => client.query(sql, parameters))).milliseconds);
  }
  return values;
}

function thresholdResult(name, observed, comparator, evidence) {
  const threshold = policy.thresholds[name];
  const passed = comparator === "max" ? observed <= threshold : observed >= threshold;
  return { name, status: passed ? "pass" : "fail", observed, comparator, threshold, evidence,
    followUp: passed ? null : `Investigate ${name}; the approved target remains unchanged.` };
}

try {
  const bootstrap = await elapsed(bootstrapProductionDatabase);
  client = new pg.Client({ connectionString: scratchDatabaseUrl, application_name: "open-triage-scale-validation" });
  await client.connect();
  const environment = (await client.query(`select version() as postgres_version,
    current_setting('server_version') as server_version, current_setting('shared_buffers') as shared_buffers,
    current_setting('work_mem') as work_mem, current_setting('max_connections') as max_connections`)).rows[0];
  const fixture = await elapsed(loadProductionWorkload);
  const { signingCount, baseYear } = fixture.value;
  const rangeFrom = `${baseYear + profile.years - 4}-01-01`;
  const rangeTo = `${baseYear + profile.years - 3}-01-01`;
  const queries = {
    commonWide: { sql: `select eresponse_01, count(*) from analytics_private.epcr
      where eresponse_01 = $1 and reporting_date >= $2 and reporting_date < $3 group by eresponse_01`,
      parameters: ["AGENCY-42", rangeFrom, rangeTo] },
    commonRepeatable: { sql: `select date_trunc('month', clinical_time) as month, avg(value_integer)
      from analytics_private.epcr_repeatable_element where element_id = $1
      and reporting_date >= $2 and reporting_date < $3 group by month order by month`,
      parameters: ["eVitals.06", rangeFrom, rangeTo] },
    partitionPruning: { sql: `select count(*) from analytics_private.epcr
      where reporting_date >= $1 and reporting_date < $2`,
      parameters: [`${baseYear + profile.years - 4}-04-01`, `${baseYear + profile.years - 4}-05-01`] },
    reconciliation: { sql: `select count(*) from clinical.report source
      left join analytics_private.epcr projected on projected.report_id = source.id
      where source.status = 'signed' and projected.report_id is null`, parameters: [] }
  };
  const explain = async ({ sql, parameters }) => (await client.query(
    `explain (analyze, buffers, format json) ${sql}`, parameters)).rows[0]["QUERY PLAN"][0];
  const wideSamples = await sample(queries.commonWide.sql, queries.commonWide.parameters);
  const repeatableSamples = await sample(queries.commonRepeatable.sql, queries.commonRepeatable.parameters);
  const partitionSamples = await sample(queries.partitionPruning.sql, queries.partitionPruning.parameters);
  const plans = { commonWide: await explain(queries.commonWide),
    commonRepeatable: await explain(queries.commonRepeatable), partitionPruning: await explain(queries.partitionPruning) };

  const signing = await elapsed(async () => {
    await client.query("begin");
    try {
      await client.query(`update clinical.report set status = 'signed', revision = 1,
        reporting_date = make_date($1,1,1) + ((abs(hashtext(id::text)) % ($2 * 365)))::integer,
        reporting_date_source = 'service-date' where status = 'draft' and synthetic and not baseline`,
      [baseYear, profile.years]);
      await client.query(`insert into clinical.signed_snapshot
        (report_id, signed_revision, form_version_id, catalog_release_id, signer_id, canonical_sha256, attestation)
        select id, revision, form_version_id, catalog_release_id, documenting_user_id,
          encode(digest(id::text, 'sha256'), 'hex'), '{"statement":"scale fixture"}'::jsonb
        from clinical.report where status = 'signed' and synthetic and not baseline`);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
  });
  plans.projectorBatch = await explain({ sql: `select id from integration.outbox_event
    where processed_at is null and failed_at is null and available_at <= now()
    order by occurred_at for update skip locked limit $1`, parameters: [profile.projectorBatchSize] });
  const projector = await elapsed(() => runProjector());
  if (projector.value.status !== "succeeded" || projector.value.processedCount !== signingCount) {
    throw new Error(`production projector did not process the signing batch: ${JSON.stringify(projector.value)}`);
  }
  const reconciliation = await elapsed(() => runProjector([
    "--reconcile", "--from", `${baseYear}-01-01`, "--to", `${baseYear + profile.years - 1}-12-31`
  ]));
  plans.reconciliation = await explain(queries.reconciliation);

  const amendmentCount = Math.floor(signingCount * profile.amendmentRate);
  await client.query(`insert into clinical.amendment
    (report_id, sequence, author_id, reason, attestation, canonical_sha256)
    select id, 1, documenting_user_id, 'Scale replay', '{"statement":"scale correction"}'::jsonb,
      encode(digest('amendment-' || id::text, 'sha256'), 'hex')
    from clinical.report where status = 'signed' and synthetic and not baseline order by id limit $1`,
  [amendmentCount]);
  const amendmentReplay = await elapsed(() => runProjector());
  if (amendmentReplay.value.status !== "succeeded" || amendmentReplay.value.processedCount !== amendmentCount) {
    throw new Error(`production projector did not process amendments: ${JSON.stringify(amendmentReplay.value)}`);
  }

  const schema = (await client.query(`select
    (select count(*)::integer from information_schema.columns where table_schema='analytics_private' and table_name='epcr') wide_column_count,
    (select count(*)::integer from information_schema.columns where table_schema='analytics_private' and table_name='epcr_repeatable_element') repeatable_column_count,
    (select count(*)::integer from pg_inherits join pg_class p on p.oid=inhparent where p.relname='epcr') wide_partitions,
    (select count(*)::integer from pg_inherits join pg_class p on p.oid=inhparent where p.relname='epcr_repeatable_element') repeatable_partitions,
    (select count(*)::integer from supabase_migrations.schema_migrations) applied_migrations,
    (select count(*)::integer from analytics_private.epcr) wide_rows,
    (select count(*)::integer from analytics_private.epcr_repeatable_element) repeatable_rows`)).rows[0];
  const throughput = (count, milliseconds) => rounded(count / Math.max(milliseconds / 1000, 0.001));
  const observed = {
    commonWideQueryP95Ms: percentile95(wideSamples), commonRepeatableQueryP95Ms: percentile95(repeatableSamples),
    partitionPrunedQueryP95Ms: percentile95(partitionSamples), signingWritesPerSecond: throughput(signingCount, signing.milliseconds),
    projectorReportsPerSecond: throughput(signingCount, projector.milliseconds), projectorBatchMaxMs: projector.milliseconds,
    reconciliationReportsPerSecond: throughput(signingCount, reconciliation.milliseconds),
    amendmentReplayReportsPerSecond: throughput(amendmentCount, amendmentReplay.milliseconds),
    commonQueryTempBytesMax: Math.max(plans.commonWide.Plan["Temp Read Blocks"] ?? 0,
      plans.commonWide.Plan["Temp Written Blocks"] ?? 0, plans.commonRepeatable.Plan["Temp Read Blocks"] ?? 0,
      plans.commonRepeatable.Plan["Temp Written Blocks"] ?? 0) * 8192
  };
  const queryByThreshold = { commonWideQueryP95Ms: "commonWide", commonRepeatableQueryP95Ms: "commonRepeatable",
    partitionPrunedQueryP95Ms: "partitionPruning", reconciliationReportsPerSecond: "reconciliation" };
  const evidence = (name) => ({ profile: options.profile,
    dataset: { analyticsReports: schema.wide_rows, repeatableElements: schema.repeatable_rows,
      measuredClinicalReports: signingCount, measuredAmendments: amendmentCount },
    environment,
    query: queries[queryByThreshold[name]]?.sql ?? (name.includes("projector") || name.includes("amendment")
      ? "packages/database/scripts/project-analytics.mjs" : "clinical signing transaction"),
    productionSchema: { tables: ["clinical.report", "integration.outbox_event", "analytics_private.epcr",
      "analytics_private.epcr_repeatable_element"], wideColumnCount: schema.wide_column_count,
      repeatableColumnCount: schema.repeatable_column_count, appliedMigrations: schema.applied_migrations },
    calibration: policy.productionSchemaCalibration.thresholdBasis[name] ?? null });
  const comparisons = { commonWideQueryP95Ms: "max", commonRepeatableQueryP95Ms: "max",
    partitionPrunedQueryP95Ms: "max", signingWritesPerSecond: "min", projectorReportsPerSecond: "min",
    projectorBatchMaxMs: "max", reconciliationReportsPerSecond: "min",
    amendmentReplayReportsPerSecond: "min", commonQueryTempBytesMax: "max" };
  const thresholdResults = Object.entries(comparisons).map(([name, comparator]) =>
    thresholdResult(name, observed[name], comparator, evidence(name)));
  thresholdResults.push({ name: "projectorBatchSize",
    status: signingCount === policy.thresholds.projectorBatchSize ? "pass" : "not-applicable",
    observed: signingCount, comparator: "equal", threshold: policy.thresholds.projectorBatchSize,
    evidence: evidence("projectorBatchSize"), followUp: signingCount === policy.thresholds.projectorBatchSize
      ? null : "Run the production profile with the approved batch size." });
  for (const name of policy.productionOnlyThresholds) thresholdResults.push({ name,
    status: "pending-production-run", observed: null, comparator: name.endsWith("Min") ? "min" : "max",
    threshold: policy.thresholds[name], evidence: evidence(name),
    followUp: "Measure in the production-like 10-million-report exercise; CI cannot substantiate infrastructure capacity or recovery behavior." });

  const partitionPlanText = JSON.stringify(plans.partitionPruning.Plan);
  const result = {
    schemaVersion: 2, policyVersion: policy.policyVersion,
    policySha256: createHash("sha256").update(policyText).digest("hex"), executedAt: new Date().toISOString(),
    profile: options.profile,
    runClassification: options.profile === "production" ? "production-scale" : "resource-bounded-representative",
    environment: { ...environment, scratchDatabase: scratchDatabaseName }, configuration: profile,
    distribution: { reports: schema.wide_rows, onlineYears: profile.years,
      repeatableElements: schema.repeatable_rows, amendmentCount, organizations: 1, agencies: 100,
      annualWidePartitions: schema.wide_partitions, monthlyRepeatablePartitions: schema.repeatable_partitions },
    productionSchemaEvidence: { bootstrapStatus: bootstrap.value.status,
      bootstrapBaselineReportId: bootstrap.value.baselineReportId, appliedMigrations: schema.applied_migrations,
      wideTable: "analytics_private.epcr", wideColumnCount: schema.wide_column_count,
      repeatableTable: "analytics_private.epcr_repeatable_element", repeatableColumnCount: schema.repeatable_column_count,
      projectorPath: path.relative(repoRoot, projectorPath),
      projectorSha256: createHash("sha256").update(projectorText).digest("hex"),
      signingProjectionRun: projector.value, reconciliationRun: reconciliation.value,
      amendmentProjectionRun: amendmentReplay.value },
    queries, timings: { migrationBootstrapMs: bootstrap.milliseconds, fixtureLoadMs: fixture.milliseconds,
      signingBatchMs: signing.milliseconds, projectorBatchMs: projector.milliseconds,
      reconciliationMs: reconciliation.milliseconds, amendmentReplayMs: amendmentReplay.milliseconds,
      wideSamplesMs: wideSamples, repeatableSamplesMs: repeatableSamples, partitionSamplesMs: partitionSamples },
    partitionEvidence: { planMentions: [...new Set(partitionPlanText.match(/epcr_y\d+/g) ?? [])] },
    observed, thresholdResults, plans,
    overallStatus: thresholdResults.some((item) => item.status === "fail") ? "failed" :
      thresholdResults.some((item) => item.status.startsWith("pending")) ? "passed-bounded-pending-production" : "passed"
  };
  if (options.output) { await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`); }
  console.log(JSON.stringify({ event: "production_scale_validation", profile: options.profile,
    reports: result.distribution.reports, overallStatus: result.overallStatus,
    passed: thresholdResults.filter((item) => item.status === "pass").length,
    failed: thresholdResults.filter((item) => item.status === "fail").length,
    pending: thresholdResults.filter((item) => item.status.startsWith("pending")).length,
    output: options.output }));
  if (result.overallStatus === "failed") process.exitCode = 1;
} finally {
  await removeScratchDatabase();
}
