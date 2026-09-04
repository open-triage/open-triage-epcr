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
    "npm run build -w @open-triage/api && node scripts/bootstrap-synthetic-installation.mjs"
  );
  for (const productionEntryPoint of [apiMain, apiModule, migration]) {
    assert.ok(!productionEntryPoint.includes("bootstrap-synthetic-installation"));
    assert.ok(!productionEntryPoint.includes("open-triage-synthetic-installation-v1"));
  }
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
  assert.ok(!bootstrap.includes("insert into clinical.call_assignment"));
  assert.match(bootstrap, /synthetic-assignment-01\.json/);
  assert.ok(!bootstrap.includes("synthetic-update.json"));
  assert.ok(!bootstrap.includes("synthetic-cancellation.json"));
  assert.match(bootstrap, /dispatchWriter = \{[\s\S]*client\.query\(sql, parameters\)\)\.rows/);
  assert.match(bootstrap, /ingestDispatchDelivery\(dispatchWriter/);
  assert.match(bootstrap, /projectDispatchAssignment\(validatedDispatch\.canonical\)/);
  assert.match(bootstrap, /dispatch-priority[\s\S]*eDispatch\.05/);
  assert.doesNotMatch(bootstrap, /dispatch-priority[\s\S]{0,120}eDispatch\.02/);
  assert.match(bootstrap, /default_form_id, synthetic[\s\S]*ids\.form/);
  assert.match(bootstrap, /unit_clinician[\s\S]*ids\.clinician/);
  assert.ok(!bootstrap.includes("SYN-20260903-001"));
  assert.ok(!bootstrap.includes("Medical assistance requested"));
  assert.match(bootstrap, /fv\.status as form_status/);
  assert.match(bootstrap, /expected\.form_status !== "published"/);
});

test("normal application startup and bootstrap never delete existing data", () => {
  for (const source of [apiMain, apiModule, bootstrap]) {
    assert.doesNotMatch(source, /\b(?:truncate|drop table|delete from)\b/i);
  }
});
