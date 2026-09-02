import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [policy, harness, evidencePolicy, workflow] = await Promise.all([
  readFile(path.join(packageRoot, "config/production-scale-performance.json"), "utf8").then(JSON.parse),
  readFile(path.join(packageRoot, "scripts/run-scale-tests.mjs"), "utf8"),
  readFile(path.join(repoRoot, "docs/production-scale-performance.md"), "utf8"),
  readFile(path.join(repoRoot, ".github/workflows/database-postgresql.yml"), "utf8")
]);

test("records approved production scale capacity and measurable thresholds", () => {
  assert.equal(policy.policyVersion, "production-scale-performance-1.0.0");
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
});

test("scale harness covers representative distributions and preserves executable plans", () => {
  for (const expected of [
    "scale_validation.report_source", "scale_validation.analytics_wide",
    "scale_validation.analytics_repeatable", "scale_validation.amendment",
    "explain (analyze, buffers, format json)", "for update skip locked",
    "commonWide", "commonRepeatable", "partitionPruning", "reconciliation", "amendmentReplay"
  ]) assert.ok(harness.includes(expected), `scale harness is missing ${expected}`);
  assert.match(harness, /sparseNarrative/);
  assert.match(harness, /productionOnlyThresholds/);
  assert.match(harness, /pending-production-run/);
  assert.match(harness, /process\.exitCode = 1/);
  assert.match(harness, /policySha256/);
});

test("CI runs and retains bounded evidence without claiming the production exercise", () => {
  assert.match(workflow, /npm run scale:test:ci -w @open-triage\/database/);
  assert.match(workflow, /database-scale-test-ci/);
  assert.match(evidencePolicy, /measured, resource-bounded representative run, not a ten-million-report claim/i);
  assert.match(evidencePolicy, /run the production profile before production readiness sign-off/i);
  assert.match(evidencePolicy, /never rewrites or relaxes policy/i);
});
