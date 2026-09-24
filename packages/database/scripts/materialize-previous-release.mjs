import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { applyMigrations, readMigrations } from "./migrate.mjs";
import { verifyPreviousReleaseManifest } from "./verify-forward-only-migrations.mjs";

export async function materializePreviousRelease({
  databaseUrl = process.env.DATABASE_URL,
  fixtureDirectory = path.resolve(
    import.meta.dirname,
    "../fixtures/previous-release/2026-09-23",
  ),
  migrationsDirectory = path.resolve(import.meta.dirname, "../../../supabase/migrations"),
  Client = pg.Client,
  log = console,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to materialize the previous release");
  const [manifestText, dataSql, migrations] = await Promise.all([
    readFile(path.join(fixtureDirectory, "manifest.json"), "utf8"),
    readFile(path.join(fixtureDirectory, "data.sql"), "utf8"),
    readMigrations(migrationsDirectory),
  ]);
  const manifest = JSON.parse(manifestText);
  verifyPreviousReleaseManifest(
    manifest,
    migrations.map(({ version, name, checksum }) => ({
      file: `${version}_${name}.sql`, version, name, sha256: checksum,
    })),
    dataSql,
  );
  const previousMigrations = migrations.filter(({ version }) => version <= manifest.lastMigration);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyMigrations(client, previousMigrations, log);
    await client.query(dataSql);
    const evidence = (await client.query(`select
      current_user,
      (select count(*)::integer from supabase_migrations.schema_migrations) migration_count,
      (select namespace.nspname from pg_extension extension
       join pg_namespace namespace on namespace.oid = extension.extnamespace
       where extension.extname = 'pgcrypto') extension_schema,
      (select count(*)::integer from app_identity.organization) organization_count,
      (select count(*)::integer from app_identity.app_user) user_count,
      (select count(*)::integer from catalog.release) catalog_release_count`)).rows[0];
    if (evidence.current_user !== manifest.database.migrationRole ||
        evidence.migration_count !== manifest.migrations.length ||
        evidence.extension_schema !== manifest.database.extensions.pgcrypto.schema ||
        evidence.organization_count !== manifest.data.expectedRows.organizations ||
        evidence.user_count !== manifest.data.expectedRows.users ||
        evidence.catalog_release_count !== manifest.data.expectedRows.catalogReleases) {
      throw new Error(`Previous-release fixture evidence did not match its manifest: ${JSON.stringify(evidence)}`);
    }
    return evidence;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await materializePreviousRelease();
  console.log(JSON.stringify({ event: "previous_release_materialized", ...evidence }));
}
