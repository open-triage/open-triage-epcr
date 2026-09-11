import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertScratchDatabaseTarget,
  SCALE_TEST_OVERRIDE_ENV_VAR
} from "../scripts/lib/scale-test-guard.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("rejects a connection string that has no recognizable scratch/local marker", () => {
  assert.throws(
    () =>
      assertScratchDatabaseTarget(
        "postgresql://app_user:secret@prod-primary.internal.example.com:5432/open_triage_production",
        { env: {} }
      ),
    /not recognizable as a scratch database/
  );
});

test("does not leak the password when rejecting an unsafe connection string", () => {
  assert.throws(
    () =>
      assertScratchDatabaseTarget(
        "postgresql://app_user:super-secret-password@prod-primary.internal.example.com:5432/open_triage_production",
        { env: {} }
      ),
    (error) => {
      assert.ok(!error.message.includes("super-secret-password"), "error message must not contain the password");
      return true;
    }
  );
});

test("allows CI's actual invocation: localhost host with a *_test database name", () => {
  assert.doesNotThrow(() =>
    assertScratchDatabaseTarget("postgresql://postgres:postgres@localhost:5432/open_triage_test", { env: {} })
  );
});

test("allows a 127.0.0.1 host even without a scratch marker in the database name", () => {
  assert.doesNotThrow(() =>
    assertScratchDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:5432/anything", { env: {} })
  );
});

test("allows a remote host when the database name carries a scratch marker", () => {
  assert.doesNotThrow(() =>
    assertScratchDatabaseTarget("postgresql://user:pass@ci-runner.example.com:5432/scale_validation_scratch", {
      env: {}
    })
  );
});

test("allows an otherwise-unsafe connection string when the operator explicitly overrides", () => {
  assert.doesNotThrow(() =>
    assertScratchDatabaseTarget(
      "postgresql://app_user:secret@prod-primary.internal.example.com:5432/open_triage_production",
      { env: { [SCALE_TEST_OVERRIDE_ENV_VAR]: "1" } }
    )
  );
});

test("rejects an empty DATABASE_URL", () => {
  assert.throws(() => assertScratchDatabaseTarget("", { env: {} }), /DATABASE_URL is required/);
});

test("rejects an unparseable connection string", () => {
  assert.throws(() => assertScratchDatabaseTarget("not-a-url", { env: {} }), /could not be parsed/);
});

test("the harness guards before its first destructive statement runs", async () => {
  const harness = await readFile(path.join(packageRoot, "scripts/run-scale-tests.mjs"), "utf8");
  const guardIndex = harness.indexOf("assertScratchDatabaseTarget(sourceDatabaseUrl)");
  const createDatabaseIndex = harness.indexOf("create database ${quoteIdentifier(scratchDatabaseName)}");
  assert.ok(guardIndex >= 0, "run-scale-tests.mjs must call assertScratchDatabaseTarget");
  assert.ok(createDatabaseIndex >= 0, "run-scale-tests.mjs must create a dedicated scratch database");
  assert.ok(guardIndex < createDatabaseIndex, "the scratch-database guard must run before database creation");
});

test("the harness uses production migrations, catalog, schemas, and projector", async () => {
  const harness = await readFile(path.join(packageRoot, "scripts/run-scale-tests.mjs"), "utf8");
  assert.match(harness, /"migrate"/);
  assert.match(harness, /"load:catalog"/);
  assert.match(harness, /scripts\/project-analytics\.mjs/);
  assert.match(harness, /analytics_private\.epcr/);
  assert.match(harness, /supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(harness, /scale_validation\.(report_source|analytics_wide|analytics_repeatable|amendment)/);
});
