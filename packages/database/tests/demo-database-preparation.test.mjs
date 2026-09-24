import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";
import {
  prepareDemoDatabase,
  requirePreparationMode,
  validateDemoDatabaseTarget,
} from "../scripts/prepare-demo-database.mjs";
import { readMigrations } from "../scripts/migrate.mjs";

const projectRef = "abcdefghijklmnopqrst";
const host = `db.${projectRef}.supabase.co`;
const databaseUrl = `postgresql://postgres:secret@${host}:5432/postgres?sslmode=require`;
const sourceRevision = "a".repeat(40);
const baseEnvironment = Object.freeze({
  DEMO_DATABASE_TARGET: "open-triage-public-disposable-demo",
  DEMO_DATABASE_EXPECTED_HOST: host,
  DEMO_DATABASE_EXPECTED_NAME: "postgres",
  DEMO_DATABASE_PROJECT_REF: projectRef,
  DEMO_DATABASE_PREPARE_MODE: "migrate",
  SOURCE_REVISION: sourceRevision,
});

test("accepts only the explicitly configured TLS Supabase target", () => {
  assert.equal(validateDemoDatabaseTarget(databaseUrl, baseEnvironment).target,
    "open-triage-public-disposable-demo");
  assert.equal(validateDemoDatabaseTarget(
    `postgresql://postgres.${projectRef}:secret@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    { ...baseEnvironment, DEMO_DATABASE_EXPECTED_HOST: "aws-0-eu-north-1.pooler.supabase.com" },
  ).projectRef, projectRef);
  for (const [url, environment] of [
    [databaseUrl, { ...baseEnvironment, DEMO_DATABASE_TARGET: "production" }],
    [databaseUrl, { ...baseEnvironment, DEMO_DATABASE_EXPECTED_HOST: "db.other.supabase.co" }],
    [databaseUrl.replace("postgres?sslmode=require", "production?sslmode=require"), baseEnvironment],
    [databaseUrl.replace("sslmode=require", "sslmode=disable"), baseEnvironment],
    [databaseUrl.replace(projectRef, "zyxwvutsrqponmlkjihg"), baseEnvironment],
    [databaseUrl.replace(":5432/", ":6543/"), baseEnvironment],
  ]) assert.throws(() => validateDemoDatabaseTarget(url, environment));
});

test("destructive preparation requires the exact reset confirmation", () => {
  assert.throws(() => requirePreparationMode({
    ...baseEnvironment,
    DEMO_DATABASE_PREPARE_MODE: "reinitialize",
  }), /exactly reinitialize-open-triage-public-disposable-demo/);
  assert.equal(requirePreparationMode({
    ...baseEnvironment,
    DEMO_DATABASE_PREPARE_MODE: "reinitialize",
    DEMO_DATABASE_RESET_CONFIRMATION: "reinitialize-open-triage-public-disposable-demo",
  }), "reinitialize");
});

test("an identity mismatch fails before opening a database connection", async () => {
  class ForbiddenClient {
    constructor() { assert.fail("database connection must not be constructed"); }
  }
  await assert.rejects(prepareDemoDatabase({
    databaseUrl,
    environment: { ...baseEnvironment, DEMO_DATABASE_EXPECTED_HOST: "db.production.supabase.co" },
    Client: ForbiddenClient,
  }), /host does not match/);
});

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const definitions = await readInstallDefinitions(path.join(repoRoot, "defines"));
const migrations = await readMigrations(path.join(repoRoot, "supabase/migrations"));

class FakeClient {
  static queries = [];
  static organizationTable = "app_identity.organization";
  static organizations = [{ id: SYNTHETIC_DEMO_FIXTURE.organizationId }];
  constructor() { this.queries = FakeClient.queries; }
  async connect() { this.queries.push("connect"); }
  async end() { this.queries.push("end"); }
  async query(sql) {
    this.queries.push(sql);
    if (sql.includes("current_database()")) return { rows: [{ database: "postgres" }] };
    if (sql.includes("to_regclass")) return { rows: [{ organization_table: FakeClient.organizationTable }] };
    if (sql.startsWith("select id::text")) return { rows: FakeClient.organizations };
    if (sql.includes("active_bundles")) return { rows: [{
      migrations: migrations.length,
      organizations: 1,
      users: 2,
      catalogs: 1,
      forms: definitions.pairs.length,
      validations: definitions.pairs.length,
      active_bundles: 1,
    }] };
    return { rows: [] };
  }
}

test("reinitialize drops only application schemas before rebuilding and is safe to rerun", async () => {
  const environment = {
    ...baseEnvironment,
    DEMO_DATABASE_PREPARE_MODE: "reinitialize",
    DEMO_DATABASE_RESET_CONFIRMATION: "reinitialize-open-triage-public-disposable-demo",
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    FakeClient.queries = [];
    const runs = [];
    const summary = await prepareDemoDatabase({
      databaseUrl,
      environment,
      Client: FakeClient,
      migrateDatabase: async () => runs.push("migrate"),
      run: async (name) => runs.push(name),
      log: { info() {} },
    });
    assert.equal(summary.status, "ready");
    assert.equal(summary.sourceRevision, sourceRevision);
    assert.deepEqual(runs, [
      "migrate",
      "load-nemsis-catalog.mjs",
      "bootstrap-synthetic-installation.mjs",
      "seed-initial-validation-versions.mjs",
      "seed-install-definitions.mjs",
    ]);
    assert.ok(FakeClient.queries.some((sql) => typeof sql === "string" && sql.includes('drop schema if exists "clinical" cascade')));
    assert.ok(!FakeClient.queries.some((sql) => typeof sql === "string" && /drop schema.*(?:auth|storage|realtime)/i.test(sql)));
    assert.match(FakeClient.queries.at(-2), /pg_advisory_unlock/);
    assert.equal(FakeClient.queries.at(-1), "end");
  }
});

test("an unknown organization fails before reset and preserves the first cause", async () => {
  FakeClient.queries = [];
  FakeClient.organizations = [{ id: "00000000-0000-4000-8000-000000000001" }];
  const environment = {
    ...baseEnvironment,
    DEMO_DATABASE_PREPARE_MODE: "reinitialize",
    DEMO_DATABASE_RESET_CONFIRMATION: "reinitialize-open-triage-public-disposable-demo",
  };
  await assert.rejects(prepareDemoDatabase({
    databaseUrl,
    environment,
    Client: FakeClient,
    migrateDatabase: async () => assert.fail("migration must not run"),
    run: async () => assert.fail("fixtures must not run"),
    log: { info() {} },
  }), /target does not contain only the known synthetic demo organization/);
  assert.ok(!FakeClient.queries.some((sql) => typeof sql === "string" && sql.startsWith("drop schema")));
  assert.match(FakeClient.queries.at(-2), /pg_advisory_unlock/);
  FakeClient.organizations = [{ id: SYNTHETIC_DEMO_FIXTURE.organizationId }];
});

test("a fixture failure remains the causal error and always releases the preparation lock", async () => {
  FakeClient.queries = [];
  const failure = new Error("catalog fixture failed first");
  await assert.rejects(prepareDemoDatabase({
    databaseUrl,
    environment: baseEnvironment,
    Client: FakeClient,
    migrateDatabase: async () => undefined,
    run: async () => { throw failure; },
    log: { info() {} },
  }), (error) => error === failure);
  assert.match(FakeClient.queries.at(-2), /pg_advisory_unlock/);
  assert.equal(FakeClient.queries.at(-1), "end");
});
