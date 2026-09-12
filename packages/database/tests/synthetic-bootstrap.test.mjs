import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [databasePackage, bootstrap, apiMain, apiModule, initialMigration] = await Promise.all([
  readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(packageRoot, "scripts/bootstrap-synthetic-installation.mjs"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/api/src/app.module.ts"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8"),
]);

test("exposes fixture accounts only through an explicit insert-only command", () => {
  assert.equal(databasePackage.scripts["bootstrap:synthetic:runtime"],
    "node scripts/bootstrap-synthetic-installation.mjs");
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
  assert.doesNotMatch(bootstrap, /insert into (?:clinical|forms|catalog)\./);
  assert.doesNotMatch(bootstrap, /insert into app_identity\.(?:organization|operational_unit|unit_clinician|external_identity)/);
  assert.doesNotMatch(bootstrap, /synthetic\)\s*values/i);
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
