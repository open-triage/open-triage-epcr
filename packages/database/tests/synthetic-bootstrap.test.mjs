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
    "node scripts/bootstrap-synthetic-installation.mjs"
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

test("associates the demo clinician, operational unit, default published form, and assigned call", () => {
  for (const table of ["app_identity.operational_unit", "app_identity.unit_clinician", "clinical.call_assignment"]) {
    assert.match(migration, new RegExp(`create table ${table.replace(".", "\\.")}`));
    assert.ok(bootstrap.includes(`insert into ${table}`));
  }
  assert.match(bootstrap, /default_form_id, synthetic[\s\S]*ids\.form/);
  assert.match(bootstrap, /unit_clinician[\s\S]*ids\.clinician/);
  assert.match(bootstrap, /SYN-20260903-001/);
  assert.match(bootstrap, /'Medical assistance requested', 'assigned', true/);
  assert.match(bootstrap, /fv\.status as form_status/);
  assert.match(bootstrap, /expected\.form_status !== "published"/);
});
