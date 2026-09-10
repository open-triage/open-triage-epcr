import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertScratchDatabaseTarget } from "./lib/scale-test-guard.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(packageRoot, "config/production-scale-performance.json");
const policyText = await readFile(policyPath, "utf8");
const policy = JSON.parse(policyText);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run scale tests");
// Safety check: this harness is destructive (see resetFixture below) and must never run against
// a real installation's database. Fails fast, before any connection or statement, unless
// DATABASE_URL is recognizable as scratch/local or the operator explicitly overrides.
assertScratchDatabaseTarget(databaseUrl);

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

const client = new pg.Client({ connectionString: databaseUrl, application_name: "open-triage-scale-validation" });
await client.connect();

const rounded = (number) => Number(number.toFixed(3));
const percentile95 = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return rounded(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]);
};
const elapsed = async (operation) => {
  const started = performance.now();
  const value = await operation();
  return { value, milliseconds: rounded(performance.now() - started) };
};
const explain = async (sql, parameters = []) => {
  const result = await client.query(`explain (analyze, buffers, format json) ${sql}`, parameters);
  return result.rows[0]["QUERY PLAN"][0];
};
const explainRolledBack = async (sql, parameters = []) => {
  await client.query("begin");
  try {
    const plan = await explain(sql, parameters);
    await client.query("rollback");
    return plan;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
};

// KNOWN LIMITATION (out of scope for this slice, tracked as a schema-fidelity gap): the fixture
// below models a small invented analytics schema (report_source/analytics_wide/
// analytics_repeatable/amendment, roughly 17 columns total) rather than the real production
// schema, which is generated from the full NEMSIS element catalog and has on the order of
// ~700 columns. This harness therefore measures representative query, write, partitioning, and
// projector shapes at the modeled scale — it does not validate against the actual production
// table/column layout. Closing that gap would mean generating this fixture from the real schema
// (see packages/database/scripts/generate-nemsis-analytics.mjs) instead of hand-authoring it here.
async function resetFixture() {
  await client.query("drop schema if exists scale_validation cascade");
  await client.query("create schema scale_validation");
  await client.query(`
    create table scale_validation.report_source (
      report_id bigint primary key,
      reporting_date date not null,
      organization_id integer not null,
      agency_id integer not null,
      patient_key text not null,
      status text not null check (status in ('draft', 'signed')),
      revision integer not null,
      signed_at timestamptz,
      sparse_payload jsonb
    );
    create index report_source_status_idx on scale_validation.report_source (status, report_id);
    create table scale_validation.outbox (
      event_id bigint generated always as identity primary key,
      report_id bigint not null unique references scale_validation.report_source(report_id),
      event_type text not null,
      occurred_at timestamptz not null default clock_timestamp(),
      processed_at timestamptz
    );
    create table scale_validation.analytics_wide (
      reporting_date date not null,
      report_id bigint not null,
      organization_id integer not null,
      agency_id integer not null,
      patient_key text not null,
      signed_at timestamptz not null,
      amendment_count integer not null default 0,
      incident_number text,
      primary_impression text,
      disposition_code text,
      response_mode text,
      destination_code text,
      systolic integer,
      diastolic integer,
      heart_rate integer,
      oxygen_saturation numeric,
      narrative text,
      additional_elements jsonb,
      primary key (reporting_date, report_id)
    ) partition by range (reporting_date);
    create index analytics_wide_agency_idx on scale_validation.analytics_wide (agency_id, reporting_date);
    create index analytics_wide_patient_idx on scale_validation.analytics_wide (patient_key, reporting_date);
    create table scale_validation.analytics_repeatable (
      reporting_date date not null,
      report_id bigint not null,
      occurrence integer not null,
      element_id text not null,
      value_numeric numeric,
      clinical_time timestamptz,
      source_attributes jsonb,
      primary key (reporting_date, report_id, occurrence)
    ) partition by range (reporting_date);
    create index analytics_repeatable_element_time_idx
      on scale_validation.analytics_repeatable (element_id, clinical_time);
    create index analytics_repeatable_report_idx
      on scale_validation.analytics_repeatable (report_id, element_id);
    create table scale_validation.amendment (
      report_id bigint primary key references scale_validation.report_source(report_id),
      sequence integer not null,
      corrected_impression text not null,
      signed_at timestamptz not null
    );
  `);
  for (let year = 0; year < profile.years; year += 1) {
    const start = 2016 + year;
    await client.query(`create table scale_validation.analytics_wide_y${start}
      partition of scale_validation.analytics_wide for values from ('${start}-01-01') to ('${start + 1}-01-01')`);
    for (let month = 1; month <= 12; month += 1) {
      const from = `${start}-${String(month).padStart(2, "0")}-01`;
      const next = month === 12 ? `${start + 1}-01-01` : `${start}-${String(month + 1).padStart(2, "0")}-01`;
      await client.query(`create table scale_validation.analytics_repeatable_m${start}${String(month).padStart(2, "0")}
        partition of scale_validation.analytics_repeatable for values from ('${from}') to ('${next}')`);
    }
  }
}

async function loadRepresentativeFixture() {
  const signingBatchSize = Math.min(profile.signingBatchSize, profile.reports);
  await client.query(`insert into scale_validation.report_source
    (report_id, reporting_date, organization_id, agency_id, patient_key, status, revision, signed_at, sparse_payload)
    select id,
      date '2016-01-01' + ((id * 37) % ($1 * 365))::integer,
      1 + (id % 10)::integer,
      1 + (id % 100)::integer,
      md5('patient-' || (id % greatest(1, ($2 / 3)))::text),
      case when id <= $3 then 'draft' else 'signed' end,
      case when id <= $3 then 3 else 4 end,
      case when id <= $3 then null else timestamptz '2026-01-01 00:00:00+00' + id * interval '1 second' end,
      case when id % 20 = 0 then jsonb_build_object(
        'customFields', jsonb_build_array(id, id % 17),
        'sparseNarrative', repeat(md5(id::text), 64)
      ) end
    from generate_series(1, $2) id`, [profile.years, profile.reports, signingBatchSize]);

  await client.query(`insert into scale_validation.analytics_wide
    (reporting_date, report_id, organization_id, agency_id, patient_key, signed_at,
     incident_number, primary_impression, disposition_code, response_mode, destination_code,
     systolic, diastolic, heart_rate, oxygen_saturation, narrative, additional_elements)
    select reporting_date, report_id, organization_id, agency_id, patient_key, signed_at,
      'INC-' || report_id, 'R69', (report_id % 10)::text, (report_id % 3)::text,
      case when report_id % 7 = 0 then null else (report_id % 25)::text end,
      90 + (report_id % 70)::integer, 55 + (report_id % 45)::integer,
      55 + (report_id % 100)::integer, 90 + (report_id % 11),
      case when report_id % 20 = 0 then repeat('representative sparse narrative ', 64) end,
      sparse_payload
    from scale_validation.report_source where status = 'signed'`);

  await client.query(`insert into scale_validation.analytics_repeatable
    (reporting_date, report_id, occurrence, element_id, value_numeric, clinical_time, source_attributes)
    select source.reporting_date, source.report_id, occurrence,
      (array['eVitals.06','eVitals.07','eVitals.10','eMedications.03','eProcedures.03','eHistory.01'])[
        1 + ((occurrence - 1) % 6)],
      60 + ((source.report_id + occurrence) % 100),
      source.reporting_date::timestamptz + occurrence * interval '5 minutes',
      case when occurrence % 4 = 0 then jsonb_build_object('unit', 'mm[Hg]', 'ordinal', occurrence) end
    from scale_validation.report_source source
    cross join generate_series(1, $1) occurrence
    where source.status = 'signed'`, [profile.repeatableElementsPerReport]);

  const every = Math.max(1, Math.round(1 / profile.amendmentRate));
  await client.query(`insert into scale_validation.amendment
    (report_id, sequence, corrected_impression, signed_at)
    select report_id, 1, 'I21.3', signed_at + interval '1 day'
    from scale_validation.report_source
    where status = 'signed' and report_id % $1 = 0`, [every]);
  await client.query("analyze scale_validation.report_source");
  await client.query("analyze scale_validation.analytics_wide");
  await client.query("analyze scale_validation.analytics_repeatable");
}

async function querySamples(sql, parameters) {
  const samples = [];
  for (let index = 0; index < profile.measurementIterations; index += 1) {
    samples.push((await elapsed(() => client.query(sql, parameters))).milliseconds);
  }
  return samples;
}

function thresholdResult(name, observed, threshold, comparator, evidence) {
  const passed = comparator === "max" ? observed <= threshold : observed >= threshold;
  return { name, status: passed ? "pass" : "fail", observed, comparator, threshold, evidence,
    followUp: passed ? null : `Investigate ${name}; the approved target remains unchanged.` };
}

try {
  const environment = (await client.query(`select version() as postgres_version,
    current_setting('server_version') as server_version,
    current_setting('shared_buffers') as shared_buffers,
    current_setting('work_mem') as work_mem,
    current_setting('max_connections') as max_connections`)).rows[0];
  const fixture = await elapsed(async () => {
    await resetFixture();
    await loadRepresentativeFixture();
  });

  const wideSql = `select primary_impression, disposition_code, count(*)
    from scale_validation.analytics_wide
    where agency_id = $1 and reporting_date >= $2 and reporting_date < $3
    group by primary_impression, disposition_code`;
  const repeatableSql = `select date_trunc('month', clinical_time) as month, avg(value_numeric)
    from scale_validation.analytics_repeatable
    where element_id = $1 and reporting_date >= $2 and reporting_date < $3
    group by month order by month`;
  const partitionSql = `select count(*) from scale_validation.analytics_wide
    where reporting_date >= $1 and reporting_date < $2`;
  const wideParameters = [42, "2022-01-01", "2023-01-01"];
  const repeatableParameters = ["eVitals.06", "2022-01-01", "2023-01-01"];
  const partitionParameters = ["2022-04-01", "2022-05-01"];

  const wideSamples = await querySamples(wideSql, wideParameters);
  const repeatableSamples = await querySamples(repeatableSql, repeatableParameters);
  const partitionSamples = await querySamples(partitionSql, partitionParameters);
  const plans = {
    commonWide: await explain(wideSql, wideParameters),
    commonRepeatable: await explain(repeatableSql, repeatableParameters),
    partitionPruning: await explain(partitionSql, partitionParameters)
  };

  const signingCount = Math.min(profile.signingBatchSize, profile.reports);
  plans.signingWrite = await explainRolledBack(`update scale_validation.report_source
    set status = 'signed', revision = revision + 1, signed_at = clock_timestamp()
    where report_id <= $1 and status = 'draft'`, [signingCount]);
  const signing = await elapsed(async () => {
    await client.query("begin");
    try {
      await client.query(`update scale_validation.report_source set status = 'signed', revision = revision + 1,
        signed_at = clock_timestamp() where report_id <= $1 and status = 'draft'`, [signingCount]);
      await client.query(`insert into scale_validation.outbox (report_id, event_type)
        select report_id, 'signed_snapshot' from scale_validation.report_source where report_id <= $1`, [signingCount]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  const projectorCount = Math.min(profile.projectorBatchSize, signingCount);
  const projectorSql = `with claimed as (
      select event.report_id from scale_validation.outbox event
      where processed_at is null order by event_id limit $1 for update skip locked
    ), inserted as (
      insert into scale_validation.analytics_wide
        (reporting_date, report_id, organization_id, agency_id, patient_key, signed_at,
         incident_number, primary_impression, disposition_code, response_mode)
      select source.reporting_date, source.report_id, source.organization_id, source.agency_id,
        source.patient_key, source.signed_at, 'INC-' || source.report_id, 'R69',
        (source.report_id % 10)::text, (source.report_id % 3)::text
      from claimed join scale_validation.report_source source using (report_id)
      on conflict (reporting_date, report_id) do update set signed_at = excluded.signed_at
      returning report_id
    ) update scale_validation.outbox event set processed_at = clock_timestamp()
      from inserted where event.report_id = inserted.report_id`;
  plans.projectorBatch = await explainRolledBack(projectorSql, [projectorCount]);
  const projector = await elapsed(async () => {
    await client.query(projectorSql, [projectorCount]);
  });

  const reconciliationSql = `select count(*) from scale_validation.report_source source
    left join scale_validation.analytics_wide projected on projected.report_id = source.report_id
    where source.status = 'signed' and projected.report_id is null`;
  const reconciliation = await elapsed(() => client.query(reconciliationSql));
  plans.reconciliation = await explain(reconciliationSql);

  const amendmentCount = Number((await client.query("select count(*)::integer as count from scale_validation.amendment")).rows[0].count);
  const amendmentReplaySql = `update scale_validation.analytics_wide projected
    set primary_impression = amendment.corrected_impression,
        amendment_count = amendment.sequence
    from scale_validation.amendment amendment
    where projected.report_id = amendment.report_id`;
  plans.amendmentReplay = await explainRolledBack(amendmentReplaySql);
  const amendmentReplay = await elapsed(() => client.query(amendmentReplaySql));

  const partitionPlanText = JSON.stringify(plans.partitionPruning.Plan);
  const scannedWidePartitions = new Set(partitionPlanText.match(/analytics_wide_y\d+/g) ?? []).size;
  const prunedPartitions = Math.max(0, profile.years - scannedWidePartitions);
  const throughput = (count, milliseconds) => rounded(count / Math.max(milliseconds / 1000, 0.001));
  const observed = {
    commonWideQueryP95Ms: percentile95(wideSamples),
    commonRepeatableQueryP95Ms: percentile95(repeatableSamples),
    partitionPrunedQueryP95Ms: percentile95(partitionSamples),
    signingWritesPerSecond: throughput(signingCount, signing.milliseconds),
    projectorReportsPerSecond: throughput(projectorCount, projector.milliseconds),
    projectorBatchMaxMs: projector.milliseconds,
    reconciliationReportsPerSecond: throughput(profile.reports, reconciliation.milliseconds),
    amendmentReplayReportsPerSecond: throughput(amendmentCount, amendmentReplay.milliseconds),
    commonQueryTempBytesMax: Math.max(
      plans.commonWide.Plan["Temp Read Blocks"] ?? 0,
      plans.commonWide.Plan["Temp Written Blocks"] ?? 0,
      plans.commonRepeatable.Plan["Temp Read Blocks"] ?? 0,
      plans.commonRepeatable.Plan["Temp Written Blocks"] ?? 0
    ) * 8192
  };
  const comparisons = {
    commonWideQueryP95Ms: "max", commonRepeatableQueryP95Ms: "max",
    partitionPrunedQueryP95Ms: "max", signingWritesPerSecond: "min",
    projectorReportsPerSecond: "min", projectorBatchMaxMs: "max",
    reconciliationReportsPerSecond: "min", amendmentReplayReportsPerSecond: "min",
    commonQueryTempBytesMax: "max"
  };
  const thresholdResults = Object.entries(comparisons).map(([name, comparator]) =>
    thresholdResult(name, observed[name], policy.thresholds[name], comparator, "this-run"));
  thresholdResults.push({
    name: "projectorBatchSize", status: projectorCount === policy.thresholds.projectorBatchSize ? "pass" : "not-applicable",
    observed: projectorCount, comparator: "equal", threshold: policy.thresholds.projectorBatchSize,
    evidence: "this-run", followUp: projectorCount === policy.thresholds.projectorBatchSize ? null : "Run the production profile with the approved batch size."
  });
  for (const name of policy.productionOnlyThresholds) {
    thresholdResults.push({ name, status: "pending-production-run", observed: null,
      comparator: name.endsWith("Min") ? "min" : "max", threshold: policy.thresholds[name],
      evidence: null, followUp: "Measure in the production-like 10-million-report exercise; CI cannot substantiate infrastructure capacity or recovery behavior." });
  }

  const result = {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    policySha256: createHash("sha256").update(policyText).digest("hex"),
    executedAt: new Date().toISOString(),
    profile: options.profile,
    runClassification: options.profile === "production" ? "production-scale" : "resource-bounded-representative",
    environment,
    configuration: profile,
    distribution: {
      reports: profile.reports,
      onlineYears: profile.years,
      repeatableElements: (profile.reports - signingCount) * profile.repeatableElementsPerReport,
      amendmentCount,
      sparseWideRowsPercent: 5,
      organizations: 10,
      agencies: 100,
      annualWidePartitions: profile.years,
      monthlyRepeatablePartitions: profile.years * 12
    },
    timings: { fixtureLoadMs: fixture.milliseconds, signingBatchMs: signing.milliseconds,
      projectorBatchMs: projector.milliseconds, reconciliationMs: reconciliation.milliseconds,
      amendmentReplayMs: amendmentReplay.milliseconds, wideSamplesMs: wideSamples,
      repeatableSamplesMs: repeatableSamples, partitionSamplesMs: partitionSamples },
    partitionEvidence: { partitionsPrunedAtLeast: prunedPartitions,
      planMentions: [...new Set(partitionPlanText.match(/analytics_wide_y\d+/g) ?? [])] },
    observed,
    thresholdResults,
    plans,
    overallStatus: thresholdResults.some((item) => item.status === "fail") ? "failed" :
      thresholdResults.some((item) => item.status.startsWith("pending")) ? "passed-bounded-pending-production" : "passed"
  };
  if (options.output) {
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify({ event: "production_scale_validation", profile: options.profile,
    reports: profile.reports, overallStatus: result.overallStatus,
    passed: thresholdResults.filter((item) => item.status === "pass").length,
    failed: thresholdResults.filter((item) => item.status === "fail").length,
    pending: thresholdResults.filter((item) => item.status.startsWith("pending")).length,
    output: options.output }));
  if (result.overallStatus === "failed") process.exitCode = 1;
} finally {
  await client.end();
}
