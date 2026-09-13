import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { syntheticStationaryDefinition } from "../scripts/synthetic-stationary-definition.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [databasePackage, bootstrap, apiMain, apiModule, initialMigration] = await Promise.all([
  readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(packageRoot, "scripts/bootstrap-synthetic-installation.mjs"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/app.module.ts"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8"),
]);

test("builds the Stationary bootstrap from the complete NEMSIS dataset", async () => {
  const [definition, catalog] = await Promise.all([
    syntheticStationaryDefinition(),
    readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8").then(JSON.parse),
  ]);
  const placed = definition.sections.flatMap(({ fields }) => fields.map(({ source }) => source.elementId));

  assert.equal(definition.sections.length, 27);
  assert.equal(placed.length, 453);
  assert.equal(new Set(placed).size, 453);
  assert.deepEqual(new Set(placed), new Set(catalog.elements.map(({ id }) => id)));
  assert.deepEqual(definition.sections.slice(0, 7).map(({ key }) => key), [
    "DemographicGroup", "eCustomConfigurationSection", "eRecordSection", "eResponseSection",
    "eDispatchSection", "eCrewSection", "eTimesSection",
  ]);
});

test("exposes fixture accounts only through an explicit insert-only command", () => {
  assert.equal(databasePackage.scripts["bootstrap:synthetic:runtime"],
    "node scripts/bootstrap-synthetic-installation.mjs");
  assert.match(databasePackage.scripts["bootstrap:synthetic"], /migrate.*load:catalog.*bootstrap:synthetic:runtime/);
  for (const productionEntryPoint of [apiMain, apiModule, initialMigration]) {
    assert.ok(!productionEntryPoint.includes("bootstrap-synthetic-installation"));
  }
  assert.match(bootstrap, /insert into app_identity\.app_user/);
  assert.match(bootstrap, /on conflict \(id\) do nothing/);
  assert.doesNotMatch(bootstrap, /on conflict[\s\S]{0,100}do update/i);
  assert.doesNotMatch(bootstrap, /\bupdate app_identity\.(?:app_user|local_credential|user_role_assignment)\b/i);
  assert.doesNotMatch(bootstrap, /\bdelete from\b|\breactivat/i);
});

test("creates only one ordinary demo account with its exact initial role", () => {
  assert.match(bootstrap, /SYNTHETIC_DEMO_FIXTURE\.userId/);
  assert.match(bootstrap, /SYNTHETIC_DEMO_FIXTURE\.username/);
  assert.match(bootstrap, /roles: \["demo"\]/);
  assert.doesNotMatch(bootstrap, /roles: \[[^\]]*"administrator"/);
  assert.doesNotMatch(bootstrap, /roles: \[[^\]]*"clinician"/);
  assert.match(bootstrap, /must_change_password,[\s\S]*values \(\$1, \$2, \$3, false, null, now\(\)\)/);
  assert.match(bootstrap, /insert into forms\.form/);
  assert.match(bootstrap, /insert into forms\.form_version/);
  assert.match(bootstrap, /insert into forms\.agency_stationary_default/);
  assert.match(bootstrap, /insert into app_identity\.agency_demographic_version/);
  assert.match(bootstrap, /insert into app_identity\.operational_unit/);
  assert.match(bootstrap, /insert into app_identity\.unit_clinician/);
  assert.doesNotMatch(bootstrap, /insert into (?:clinical|catalog)\./);
  assert.doesNotMatch(bootstrap, /insert into app_identity\.(?:organization|external_identity)/);
});

test("requires an existing organization and reports owner readiness without creating ownership", () => {
  assert.match(bootstrap, /Create the demonstration organization/);
  assert.match(bootstrap, /select exists \(select 1 from app_identity\.installation_owner/);
  assert.match(bootstrap, /ownerConfigured/);
  assert.doesNotMatch(bootstrap, /insert into app_identity\.installation_owner/);
});

test("records fixture provisioning without exposing credential material to audit", () => {
  assert.match(bootstrap, /'account\.provision'/);
  assert.match(bootstrap, /'demonstration-fixture'/);
  assert.doesNotMatch(bootstrap, /jsonb_build_object\([^)]*(?:password|verifier|token)/i);
});
