import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { applyMigrations, readMigrations } from "../scripts/migrate.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for the PostgreSQL integration suite");
}

// Run after the foundation suite against the disposable integration database.
(databaseUrl ? test : test.skip)("analytics history conversion preserves views, checksums and Supabase-only history", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const analytics = migrations.filter(({ version }) => ["20260928233346", "20261001173917"].includes(version));
  assert.equal(analytics.length, 2);
  const viewIds = () => client.query("select 'analytics.epcr'::regclass::oid as pseudonymous, 'analytics.epcr_identified'::regclass::oid as identified");
  const before = (await viewIds()).rows;

  for (const checksummed of [true, false]) {
    // Model an installation that already applied the original numbered files.
    await client.query("begin");
    try {
      for (const [index, migration] of analytics.entries()) {
        await client.query("delete from open_triage_deploy.migration_checksums where version = $1", [migration.version]);
        const oldVersion = `3000000000000${index + 1}`;
        await client.query("update supabase_migrations.schema_migrations set version = $2 where version = $1", [migration.version, oldVersion]);
        if (checksummed) {
          await client.query("insert into open_triage_deploy.migration_checksums (version, checksum) values ($1, $2)", [oldVersion, migration.checksum]);
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    assert.equal(await applyMigrations(client, migrations, { info() {} }), 0);
    assert.equal(await applyMigrations(client, migrations, { info() {} }), 0);
    assert.deepEqual((await viewIds()).rows, before, "history conversion must not recreate views");
    const history = await client.query(`select history.version, checksums.checksum
      from supabase_migrations.schema_migrations history
      left join open_triage_deploy.migration_checksums checksums using (version)
      where history.name like 'nemsis_analytics_%' order by history.version`);
    assert.deepEqual(history.rows, analytics.map(({ version, checksum }) => ({ version, checksum: checksummed ? checksum : null })));
    assert.equal((await client.query("select version from supabase_migrations.schema_migrations where version like '3000%'")).rowCount, 0);
  }
});
