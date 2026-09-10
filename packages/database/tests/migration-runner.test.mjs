import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyMigrations, readMigrations } from "../scripts/migrate.mjs";

class FakeClient {
  constructor(applied = []) {
    this.applied = new Map(applied);
    this.queries = [];
    this.pending = null;
  }

  async query(sql, parameters = []) {
    const normalized = sql.trim().toLowerCase();
    this.queries.push({ sql, parameters });
    if (normalized.startsWith("select history.version, checksums.checksum")) {
      return { rows: [...this.applied].map(([version, checksum]) => ({ version, checksum })) };
    }
    if (normalized === "begin") this.pending = [];
    if (normalized === "rollback") this.pending = null;
    if (normalized === "commit") {
      for (const [version, checksum] of this.pending ?? []) this.applied.set(version, checksum);
      this.pending = null;
    }
    if (normalized.startsWith("insert into supabase_migrations.schema_migrations")) {
      this.pending.push([parameters[0], null]);
    }
    if (normalized.startsWith("insert into open_triage_deploy.migration_checksums")) {
      this.pending[this.pending.length - 1][1] = parameters[1];
    }
    if (sql.includes("raise_migration_failure")) throw new Error("synthetic migration failure");
    return { rows: [] };
  }
}

const silentLog = { info() {} };

async function migrationSet(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-migrations-"));
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(path.join(directory, name), sql)));
  return readMigrations(directory);
}

test("migrations run in version order before rollout", async () => {
  const migrations = await migrationSet({
    "202608300003_third.sql": "select 'third migration';",
    "202608300001_first.sql": "select 'first migration';",
    "202608300002_second.sql": "select 'second migration';",
  });
  const client = new FakeClient();

  await applyMigrations(client, migrations, silentLog);

  const executed = client.queries.map(({ sql }) => sql).filter((sql) => sql.includes("migration';"));
  assert.deepEqual(executed, ["select 'first migration';", "select 'second migration';", "select 'third migration';"]);
  assert.deepEqual([...client.applied.keys()], ["202608300001", "202608300002", "202608300003"]);
});

test("a failed migration rolls back, is not recorded, and stops later migrations", async () => {
  const migrations = await migrationSet({
    "202608300001_first.sql": "select 'first migration';",
    "202608300002_failure.sql": "select raise_migration_failure();",
    "202608300003_never.sql": "select 'never migration';",
  });
  const client = new FakeClient();

  await assert.rejects(applyMigrations(client, migrations, silentLog), /202608300002_failure failed/);

  assert.deepEqual([...client.applied.keys()], ["202608300001"]);
  assert.ok(client.queries.some(({ sql }) => sql.trim().toLowerCase() === "rollback"));
  assert.ok(!client.queries.some(({ sql }) => sql.includes("never migration")));
});

test("completed migrations are safe to rerun and changed history is rejected", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([[migrations[0].version, migrations[0].checksum]]);

  await applyMigrations(client, migrations, silentLog);
  assert.ok(!client.queries.some(({ sql }) => sql.includes("first migration")));

  client.applied.set(migrations[0].version, "0".repeat(64));
  await assert.rejects(applyMigrations(client, migrations, silentLog), /has been modified/);
});

test("migration history previously written by the Supabase CLI is respected", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([[migrations[0].version, null]]);

  await applyMigrations(client, migrations, silentLog);

  assert.ok(!client.queries.some(({ sql }) => sql.includes("first migration")));
  assert.equal(client.applied.get(migrations[0].version), null);
});

test("an older application tolerates unknown forward migrations without reverting them", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([
    [migrations[0].version, migrations[0].checksum],
    ["202608309999", "f".repeat(64)],
  ]);

  await applyMigrations(client, migrations, silentLog);

  assert.equal(client.applied.get("202608309999"), "f".repeat(64));
  assert.ok(!client.queries.some(({ sql }) => /delete|update/i.test(sql)));
});
