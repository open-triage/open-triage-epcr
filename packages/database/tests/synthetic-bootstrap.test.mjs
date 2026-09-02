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
  assert.match(bootstrap, /identity_state, pseudonymous_key/);
  assert.match(bootstrap, /'unknown'/);
  assert.match(bootstrap, /synthetic, baseline/);
  assert.match(bootstrap, /on conflict do nothing/);
  for (const identifyingField of ["patient_name", "date_of_birth", "street_address", "phone_number"]) {
    assert.ok(!bootstrap.toLowerCase().includes(identifyingField));
  }
});
