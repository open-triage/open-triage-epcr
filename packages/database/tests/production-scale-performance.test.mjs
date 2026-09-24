import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateScaleThreshold } from "../scripts/lib/scale-performance-policy.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [policy, harness, evidencePolicy, workflow] = await Promise.all([
  readFile(path.join(packageRoot, "config/production-scale-performance.json"), "utf8").then(JSON.parse),
  readFile(path.join(packageRoot, "scripts/run-scale-tests.mjs"), "utf8"),
  readFile(path.join(repoRoot, "docs/production-scale-performance.md"), "utf8"),
  readFile(path.join(repoRoot, ".github/workflows/database-postgresql.yml"), "utf8")
]);

test("records approved production scale capacity and measurable thresholds", () => {
  assert.equal(policy.policyVersion, "production-scale-performance-1.2.0");
  assert.equal(policy.policyStatus, "approved-under-requesting-owner-delegation");
  assert.deepEqual(policy.capacityModel, {
    onlineYears: 10,
    reportsPerYear: 1_000_000,
    totalReports: 10_000_000
  });
  assert.equal(policy.profiles.production.reports, policy.capacityModel.totalReports);
  assert.equal(policy.profiles.production.years, policy.capacityModel.onlineYears);
  assert.equal(policy.profiles.production.projectorBatchSize, policy.thresholds.projectorBatchSize);
  for (const name of [
    "commonWideQueryP95Ms", "commonRepeatableQueryP95Ms", "partitionPrunedQueryP95Ms",
    "signingWritesPerSecond", "projectorReportsPerSecond", "projectorBatchMaxMs",
    "reconciliationReportsPerSecond", "amendmentReplayReportsPerSecond",
    "recoveryRpoMinutes", "recoveryRtoHours", "steadyStateCpuPercentMax",
    "peakCpuPercentMax", "connectionUtilizationPercentMax", "storageHeadroomPercentMin",
    "commonQueryTempBytesMax"
  ]) assert.equal(typeof policy.thresholds[name], "number", `missing numerical threshold ${name}`);
  assert.equal(policy.productionSchemaCalibration.minimumHeadroomPercent, 25);
  assert.deepEqual(policy.productionSchemaCalibration.dataset, {
    profile: "ci", analyticsReports: 10_000, repeatableElements: 40_000,
    measuredClinicalReports: 500, measuredAmendments: 25, onlineYears: 10
  });
  assert.equal(policy.productionSchemaCalibration.productionSchema.wideColumnCount, 566);
  assert.equal(policy.productionSchemaCalibration.productionSchema.repeatableColumnCount, 66);
  for (const name of ["projectorReportsPerSecond", "projectorBatchMaxMs",
    "reconciliationReportsPerSecond", "amendmentReplayReportsPerSecond"]) {
    const basis = policy.productionSchemaCalibration.thresholdBasis[name];
    assert.equal(basis.threshold, policy.thresholds[name]);
    assert.ok(basis.marginPercent >= policy.productionSchemaCalibration.minimumHeadroomPercent);
    assert.ok(basis.query.length > 0);
  }
});

test("CI has explicit generous margins without weakening production or correctness gates", () => {
  const latency = ["commonWideQueryP95Ms", "commonRepeatableQueryP95Ms", "partitionPrunedQueryP95Ms", "projectorBatchMaxMs"];
  const throughput = ["signingWritesPerSecond", "projectorReportsPerSecond", "reconciliationReportsPerSecond", "amendmentReplayReportsPerSecond"];
  assert.deepEqual(Object.keys(policy.ciThresholds).sort(), [...latency, ...throughput].sort());
  for (const name of latency) assert.equal(policy.ciThresholds[name], policy.thresholds[name] * 2);
  for (const name of throughput) assert.equal(policy.ciThresholds[name], policy.thresholds[name] / 2);
  const evaluate = (profile, name, value, comparator = "max") =>
    evaluateScaleThreshold(policy, profile, name, value, comparator, { profile });
  assert.equal(evaluate("ci", "projectorBatchMaxMs", 13021.419).status, "pass");
  assert.equal(evaluate("production", "projectorBatchMaxMs", 13021.419).status, "fail");
  assert.equal(evaluate("ci", "projectorBatchMaxMs", 26000).status, "pass");
  assert.equal(evaluate("ci", "projectorBatchMaxMs", 26001).status, "fail");
  assert.equal(evaluate("ci", "projectorReportsPerSecond", 17.5, "min").status, "pass");
  assert.equal(evaluate("ci", "projectorReportsPerSecond", 17.4, "min").status, "fail");
  assert.equal(evaluate("production", "projectorReportsPerSecond", 17.5, "min").status, "fail");
  assert.equal(evaluate("ci", "commonQueryTempBytesMax", 1).status, "fail");
  assert.equal(evaluate("ci", "projectorBatchMaxMs", 13021.419).productionThreshold, 13000);
  assert.equal(evaluate("ci", "projectorBatchMaxMs", 13021.419).thresholdProfile, "ci");
  assert.throws(() => evaluate("unknown", "projectorBatchMaxMs", 1), /unknown scale-test profile/);
  assert.match(harness, /evaluateScaleThreshold\(policy, options.profile/);
});

test("scale harness covers representative distributions and preserves executable plans", () => {
  for (const expected of [
    '"migrate"', '"load:catalog"', "scripts/project-analytics.mjs",
    "clinical.report", "integration.outbox_event", "analytics_private.epcr",
    "analytics_private.epcr_repeatable_element", "supabase_migrations.schema_migrations",
    "explain (analyze, buffers, format json)", "for update skip locked",
    "commonWide", "commonRepeatable", "partitionPruning", "reconciliation", "amendmentReplay"
  ]) assert.ok(harness.includes(expected), `scale harness is missing ${expected}`);
  assert.doesNotMatch(harness, /scale_validation\.(report_source|analytics_wide|analytics_repeatable|amendment)/);
  assert.match(harness, /productionSchemaEvidence/);
  assert.match(harness, /wideColumnCount/);
  assert.match(harness, /environment,/);
  assert.match(harness, /dataset:/);
  assert.match(harness, /productionSchema:/);
  assert.match(harness, /query:/);
  assert.match(harness, /productionOnlyThresholds/);
  assert.match(harness, /pending-production-run/);
  assert.match(harness, /process\.exitCode = 1/);
  assert.match(harness, /policySha256/);
});

test("CI runs and retains bounded evidence without claiming the production exercise", () => {
  assert.match(workflow, /npm run scale:test:ci -w @open-triage\/database/);
  assert.match(workflow,
    /validation-\$\{\{ inputs\.checkout_ref \|\| github\.sha \}\}-\$\{\{ matrix\.lane \}\}-results/);
  assert.match(workflow, /packages\/database\/artifacts\/database-lanes\/\*\.json/);
  assert.match(evidencePolicy, /measured, resource-bounded representative run, not a ten-million-report claim/i);
  assert.match(evidencePolicy, /run the production profile before production readiness sign-off/i);
  assert.match(evidencePolicy, /never rewrites or relaxes policy/i);
});
