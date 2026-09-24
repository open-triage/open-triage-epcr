import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compareSchemaDumps, normalizeSchemaDump } from "../scripts/compare-schema-dumps.mjs";
import {
  parseNameStatus,
  rejectNonAdditiveMigrationChanges,
  verifyForwardOnlyMigrations,
  verifyPreviousReleaseManifest,
} from "../scripts/verify-forward-only-migrations.mjs";

const fixtureDirectory = path.resolve(
  import.meta.dirname,
  "../fixtures/previous-release/2026-09-23",
);

test("the committed N-1 fixture locks every applied migration and contains no PHI", async () => {
  const { manifest, inventory } = await verifyForwardOnlyMigrations();
  const data = await readFile(path.join(fixtureDirectory, "data.sql"), "utf8");

  assert.equal(manifest.release, "n-1-2026-09-23");
  assert.equal(manifest.lastMigration, "20260923120000");
  assert.equal(manifest.migrations.length, 62);
  assert.equal(inventory.length > manifest.migrations.length, true);
  assert.equal(manifest.data.containsPhi, false);
  assert.deepEqual(manifest.schemaComparison.expectedDifferences, []);
  assert.match(data, /Sanitized N-1 Upgrade Fixture/);
  assert.doesNotMatch(data, /patient|incident|report|birth|address|phone|email/i);
});

test("changing an N-1 migration or fixture row is rejected", async () => {
  const { manifest, inventory } = await verifyForwardOnlyMigrations();
  const data = await readFile(path.join(fixtureDirectory, "data.sql"), "utf8");
  const changedMigration = structuredClone(manifest);
  changedMigration.migrations[0].sha256 = "0".repeat(64);
  assert.throws(
    () => verifyPreviousReleaseManifest(changedMigration, inventory, data),
    /Applied migration fixture is immutable/,
  );
  assert.throws(
    () => verifyPreviousReleaseManifest(manifest, inventory, `${data}\nselect 1;\n`),
    /bounded data checksum differs/,
  );
});

test("pull-request migration changes must be additive and forward-only", () => {
  assert.doesNotThrow(() => rejectNonAdditiveMigrationChanges([
    { status: "A", paths: ["supabase/migrations/20260925120000_corrective_change.sql"] },
  ]));
  for (const status of ["M", "D", "R"]) {
    assert.throws(
      () => rejectNonAdditiveMigrationChanges([{
        status,
        paths: status === "R"
          ? ["supabase/migrations/old.sql", "supabase/migrations/new.sql"]
          : ["supabase/migrations/20260923120000_applied.sql"],
      }]),
      /add a corrective migration instead/,
    );
  }
  assert.deepEqual(parseNameStatus(
    "A\0supabase/migrations/20260925120000_fix.sql\0M\0supabase/migrations/applied.sql\0",
  ), [
    { status: "A", paths: ["supabase/migrations/20260925120000_fix.sql"] },
    { status: "M", paths: ["supabase/migrations/applied.sql"] },
  ]);
});

test("schema comparison ignores only documented pg_dump environment noise", () => {
  const clean = `\\restrict clean-token\n-- Dumped from database version 15.14\ncreate schema app_identity;\n\\unrestrict clean-token\n`;
  const upgraded = `\\restrict upgrade-token\n-- Dumped from database version 15.15\ncreate schema app_identity;\n\\unrestrict upgrade-token\n`;
  assert.equal(normalizeSchemaDump(clean), "create schema app_identity;");
  assert.doesNotThrow(() => compareSchemaDumps(clean, upgraded));
  assert.throws(
    () => compareSchemaDumps(clean, upgraded.replace("app_identity", "different")),
    /schemas differ at line 1/,
  );
});
