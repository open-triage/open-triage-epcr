import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { readMigrations } from "./migrate.mjs";

const fixtureOrganization = "51300000-0000-4000-8000-000000000001";
const fixtureOwner = "51300000-0000-4000-8000-000000000002";

export async function verifyUpgradedDatabase({
  databaseUrl = process.env.DATABASE_URL,
  healthDatabaseUrl = process.env.ANALYTICS_HEALTH_DATABASE_URL,
  fixtureDirectory = path.resolve(
    import.meta.dirname,
    "../fixtures/previous-release/2026-09-23",
  ),
  migrationsDirectory = path.resolve(import.meta.dirname, "../../../supabase/migrations"),
  Client = pg.Client,
} = {}) {
  if (!databaseUrl || !healthDatabaseUrl) {
    throw new Error("DATABASE_URL and ANALYTICS_HEALTH_DATABASE_URL are required");
  }
  const [manifestText, migrations] = await Promise.all([
    readFile(path.join(fixtureDirectory, "manifest.json"), "utf8"),
    readMigrations(migrationsDirectory),
  ]);
  const manifest = JSON.parse(manifestText);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const history = await client.query(`select history.version, checksum.checksum
      from supabase_migrations.schema_migrations history
      join open_triage_deploy.migration_checksums checksum using (version)
      order by history.version`);
    if (history.rowCount !== migrations.length) {
      throw new Error(`Upgraded migration history has ${history.rowCount} rows; expected ${migrations.length}`);
    }
    for (let index = 0; index < migrations.length; index += 1) {
      if (history.rows[index].version !== migrations[index].version ||
          history.rows[index].checksum !== migrations[index].checksum) {
        throw new Error(`Upgraded migration checksum differs at ${migrations[index].version}`);
      }
    }

    const preserved = (await client.query(`select
      (select count(*)::integer from app_identity.organization where id = $1) organizations,
      (select count(*)::integer from app_identity.app_user where id = $2 and organization_id = $1) users,
      (select count(*)::integer from app_identity.installation_owner
        where organization_id = $1 and user_id = $2) owners,
      (select app_identity.user_has_capability($2, $1, 'clinical:document')) authorized,
      (select count(*)::integer from catalog.release
        where standard = 'OPEN-TRIAGE-CI' and version = $3 and sealed) fixture_catalogs,
      (select count(*)::integer from catalog.release where standard = 'NEMSIS') nemsis_catalogs,
      (select count(*)::integer from catalog.element_definition) catalog_elements`, [
      fixtureOrganization,
      fixtureOwner,
      manifest.release,
    ])).rows[0];
    if (preserved.organizations !== 1 || preserved.users !== 1 || preserved.owners !== 1 ||
        preserved.authorized !== true || preserved.fixture_catalogs !== 1 ||
        preserved.nemsis_catalogs < 1 || preserved.catalog_elements < 1) {
      throw new Error(`Post-upgrade application smoke failed: ${JSON.stringify(preserved)}`);
    }

    const contracts = await client.query(`select rolname, rolcanlogin, rolsuper,
        rolcreatedb, rolcreaterole, rolbypassrls
      from pg_roles where rolname = any($1::text[]) order by rolname`, [manifest.database.runtimeRoles]);
    if (contracts.rowCount !== manifest.database.runtimeRoles.length || contracts.rows.some((role) =>
      role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls)) {
      throw new Error(`Runtime role contracts are missing or privileged: ${JSON.stringify(contracts.rows)}`);
    }
  } finally {
    await client.end();
  }

  const health = new Client({ connectionString: healthDatabaseUrl });
  await health.connect();
  try {
    const currentRole = (await health.query("select current_user")).rows[0].current_user;
    const projectionHealth = await health.query("select backlog_count from operations.projection_health");
    if (currentRole !== "open_triage_demo_upgrade_analytics_health_012345abcdef" ||
        projectionHealth.rowCount !== 1) {
      throw new Error("Least-privileged operational health smoke failed after upgrade");
    }
    await health.query("begin");
    try {
      await health.query("create schema upgrade_escape");
      throw new Error("Analytics health login unexpectedly created a schema");
    } catch (error) {
      if (error.code !== "42501") throw error;
    } finally {
      await health.query("rollback");
    }
  } finally {
    await health.end();
  }

  return { migrationCount: migrations.length, previousRelease: manifest.release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyUpgradedDatabase();
  console.log(JSON.stringify({ event: "forward_upgrade_smoke_verified", ...result }));
}
