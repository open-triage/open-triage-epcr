import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [databasePackage, bootstrap, apiMain, apiModule, migration] = await Promise.all([
  readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(packageRoot, "scripts/bootstrap-synthetic-installation.mjs"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/app.module.ts"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8")
]);

test("exposes the synthetic installation only through an explicit command", () => {
  assert.equal(
    databasePackage.scripts["bootstrap:synthetic"],
    "npm run build -w @open-triage/contracts && npm run build -w @open-triage/api && npm run bootstrap:synthetic:runtime"
  );
  assert.equal(
    databasePackage.scripts["bootstrap:synthetic:runtime"],
    "node scripts/bootstrap-synthetic-installation.mjs --settings ../contracts/config/installation.synthetic-demo.json"
  );
  for (const productionEntryPoint of [apiMain, apiModule, migration]) {
    assert.ok(!productionEntryPoint.includes("bootstrap-synthetic-installation"));
    assert.ok(!productionEntryPoint.includes("open-triage-synthetic-installation-v1"));
  }
});

test("fixture and initial assignment creation are independently selected settings", () => {
  assert.match(bootstrap, /--settings <installation-settings\.json> is required/);
  assert.match(bootstrap, /installationSettings\.syntheticFixtures\.enabled/);
  assert.match(bootstrap, /installationSettings\.sampleDispatchAssignment\.enabled/);
  assert.match(bootstrap, /if \(dispatchSourceBytes && dispatchCatalog && dispatchProjection\)/);
});

test("uses deterministic synthetic identities and contains no patient identity fixture", () => {
  assert.ok(!bootstrap.includes("randomUUID"));
  assert.match(bootstrap, /identity_state, pseudonymous_key, pseudonymous_key_version/);
  assert.match(bootstrap, /derivePatientKey/);
  assert.match(bootstrap, /'unknown'/);
  assert.match(bootstrap, /synthetic, baseline/);
  assert.match(bootstrap, /on conflict do nothing/);
  for (const identifyingField of ["patient_name", "date_of_birth", "street_address", "phone_number"]) {
    assert.ok(!bootstrap.toLowerCase().includes(identifyingField));
  }
});

test("seeds usable local credentials for both demo roles", () => {
  assert.match(bootstrap, /SYNTHETIC_DEMO_FIXTURE\.administratorUsername/);
  assert.match(bootstrap, /SYNTHETIC_DEMO_FIXTURE\.clinicianUsername/);
  assert.match(bootstrap, /createPasswordVerifier\(SYNTHETIC_DEMO_FIXTURE\.password\)/);
  assert.match(bootstrap, /on conflict \(user_id\) do update set[\s\S]*password_verifier = excluded\.password_verifier/);
});

test("seeds the demo organization with a fixed fourteen-hour shift session", () => {
  assert.match(bootstrap, /shift_session_duration_hours, deployment_timezone/);
  assert.match(bootstrap, /OpenTriage Synthetic EMS', 14, 'UTC'/);
  assert.match(migration, /shift_session_duration_hours integer not null default 14/);
});

test("associates the demo clinician and unit, then ingests only the committed initial dispatch sample", () => {
  for (const table of ["app_identity.operational_unit", "app_identity.unit_clinician", "clinical.call_assignment"]) {
    assert.match(migration, new RegExp(`create table ${table.replace(".", "\\.")}`));
  }
  assert.ok(bootstrap.includes("insert into app_identity.operational_unit"));
  assert.ok(bootstrap.includes("insert into app_identity.unit_clinician"));
  assert.equal(bootstrap.match(/insert into clinical\.call_assignment/g)?.length, 1,
    "the only direct assignment write is the replay-recovery projection");
  assert.match(bootstrap, /synthetic-assignment-01\.json/);
  assert.ok(!bootstrap.includes("synthetic-update.json"));
  assert.ok(!bootstrap.includes("synthetic-cancellation.json"));
  assert.match(bootstrap, /dispatchWriter = \{[\s\S]*client\.query\(sql, parameters\)\)\.rows/);
  assert.match(bootstrap, /let dispatchStatus = "disabled";[\s\S]*dispatchStatus = dispatchIngestion\.status/);
  assert.match(bootstrap, /synthetic-dispatch-assignment:/);
  assert.match(bootstrap, /on conflict \(organization_id, dispatch_source_id, dispatch_source_record_id\) do nothing/,
    "a replay must restore its rebuildable assignment projection after demo data is cleared");
  assert.match(bootstrap, /ingestDispatchDelivery\(dispatchWriter/);
  assert.match(bootstrap, /projectDispatchAssignment\(validatedDispatch\.canonical\)/);
  assert.match(bootstrap, /stationary-layout-1\.0\.0\.json/);
  assert.match(bootstrap, /fullStationaryFormDefinition\(stationaryLayout\)/);
  assert.match(bootstrap, /fieldElementIds = formDefinition\.sections\.flatMap/);
  assert.match(bootstrap, /synthetic-stationary-section:\$\{ids\.formVersion\}/);
  assert.match(bootstrap, /synthetic-stationary-field:\$\{ids\.formVersion\}/);
  assert.match(bootstrap, /default_form_id, synthetic[\s\S]*ids\.form/);
  assert.match(bootstrap, /unit_clinician[\s\S]*ids\.clinician/);
  assert.ok(!bootstrap.includes("SYN-20260903-001"));
  assert.ok(!bootstrap.includes("Medical assistance requested"));
  assert.match(bootstrap, /active_fv\.definition_sha256 as active_form_sha256/);
  assert.match(bootstrap, /active form version identity/);
  assert.match(bootstrap, /active form content/,
    "the fixture reconciler must detect stale immutable form content");
  assert.match(bootstrap, /insert into forms\.agency_stationary_default[\s\S]*on conflict \(organization_id\) do update set/);
  assert.doesNotMatch(bootstrap, /expected\.assignment_status !== "assigned"/,
    "rerunning the bootstrap must preserve an assignment that has progressed through the demo workflow");
});

test("normal application startup and bootstrap never delete existing data", () => {
  for (const source of [apiMain, apiModule, bootstrap]) {
    assert.doesNotMatch(source, /\b(?:truncate|drop table|delete from)\b/i);
  }
});
