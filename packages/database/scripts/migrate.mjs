import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const migrationName = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/;
const lockName = "open-triage-forward-only-migrations-v1";
const compatibleMigrationChecksums = new Map([
  ["20260912120000", new Map([
    [
      "de083488ce021a6cfd2333603b5e8e3da700553bc8f024840e3dd5c3b9ff4534",
      "a94e7492463a45e29089d56e0e1d8c46a31f544efe9af4ea93eabf7e60feeeed",
    ],
  ])],
]);

function isCompatibleMigrationChecksum(version, recordedChecksum, currentChecksum) {
  return compatibleMigrationChecksums.get(version)?.get(recordedChecksum) === currentChecksum;
}

export async function readMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const match = migrationName.exec(entry.name);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
    const sql = await readFile(path.join(migrationsDirectory, entry.name), "utf8");
    migrations.push({
      version: match[1],
      name: match[2],
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }

  migrations.sort((left, right) => left.version.localeCompare(right.version));
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(`Duplicate migration version: ${migrations[index].version}`);
    }
  }
  return migrations;
}

export async function applyMigrations(client, migrations, log = console) {
  log.info("Waiting for the deployment migration lock");
  await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
  log.info("Acquired the deployment migration lock");
  try {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
      alter table supabase_migrations.schema_migrations
        add column if not exists statements text[];
      alter table supabase_migrations.schema_migrations
        add column if not exists name text;
      create schema if not exists open_triage_deploy;
      revoke all on schema open_triage_deploy from public;
      create table if not exists open_triage_deploy.migration_checksums (
        version text primary key references supabase_migrations.schema_migrations(version),
        checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
        recorded_at timestamptz not null default now()
      );
      revoke all on table open_triage_deploy.migration_checksums from public;
    `);

    const result = await client.query(
      `select history.version, checksums.checksum
       from supabase_migrations.schema_migrations history
       left join open_triage_deploy.migration_checksums checksums using (version)
       order by history.version`,
    );
    const applied = new Map(result.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const recordedChecksum = applied.get(migration.version);
      if (applied.has(migration.version)) {
        const compatibleChecksum = recordedChecksum && recordedChecksum !== migration.checksum &&
          isCompatibleMigrationChecksum(migration.version, recordedChecksum, migration.checksum);
        if (recordedChecksum && recordedChecksum !== migration.checksum && !compatibleChecksum) {
          throw new Error(`Applied migration ${migration.version} has been modified`);
        }
        const verification = compatibleChecksum
          ? "compatible legacy checksum verified"
          : recordedChecksum ? "checksum verified" : "trusted Supabase history";
        log.info(`Migration ${migration.version}_${migration.name} already applied (${verification})`);
        continue;
      }

      log.info(`Applying migration ${migration.version}_${migration.name}`);
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)`,
          [migration.version, migration.name, [migration.sql]],
        );
        await client.query(
          `insert into open_triage_deploy.migration_checksums (version, checksum)
           values ($1, $2)`,
          [migration.version, migration.checksum],
        );
        await client.query("commit");
        log.info(`Applied migration ${migration.version}_${migration.name}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migration.version}_${migration.name} failed`, { cause: error });
      }
    }
    return migrations.filter((migration) => !applied.has(migration.version)).length;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]);
  }
}

export async function migrate({
  databaseUrl = process.env.DATABASE_URL,
  migrationsDirectory = path.resolve(import.meta.dirname, "../../../supabase/migrations"),
  log = console,
  Client = pg.Client,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");
  const migrations = await readMigrations(migrationsDirectory);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyMigrations(client, migrations, log);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
}
