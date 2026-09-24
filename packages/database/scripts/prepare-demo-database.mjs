import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";
import { migrate, readMigrations } from "./migrate.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scriptDirectory, "../../..");
const targetIdentity = "open-triage-public-disposable-demo";
const resetConfirmation = `reinitialize-${targetIdentity}`;
const preparationLock = "open-triage-disposable-demo-preparation-v1";
const applicationSchemas = Object.freeze([
  "app_identity", "catalog", "forms", "clinical", "clinical_audit", "integration",
  "analytics_private", "analytics", "operations", "clinical_history", "retention",
  "feedback", "offline_recovery", "validation", "supabase_migrations", "open_triage_deploy",
]);

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function validateDemoDatabaseTarget(databaseUrl, environment = process.env) {
  if (required(environment, "DEMO_DATABASE_TARGET") !== targetIdentity) {
    throw new Error(`DEMO_DATABASE_TARGET must be exactly ${targetIdentity}`);
  }
  const expectedHost = required(environment, "DEMO_DATABASE_EXPECTED_HOST").toLowerCase();
  const expectedDatabase = required(environment, "DEMO_DATABASE_EXPECTED_NAME");
  const projectRef = required(environment, "DEMO_DATABASE_PROJECT_REF").toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("DEMO_DATABASE_PROJECT_REF must be a 20-character Supabase project reference");
  }

  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  if (parsed.hostname.toLowerCase() !== expectedHost) {
    throw new Error("DATABASE_URL host does not match the configured disposable demo host");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== expectedDatabase || database !== "postgres") {
    throw new Error("DATABASE_URL database must match the configured Supabase postgres database");
  }
  if (!new Set(["require", "verify-ca", "verify-full"]).has(parsed.searchParams.get("sslmode"))) {
    throw new Error("DATABASE_URL must require TLS");
  }
  const directHost = `db.${projectRef}.supabase.co`;
  const poolerHost = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname);
  const poolerUser = decodeURIComponent(parsed.username).endsWith(`.${projectRef}`);
  if (parsed.hostname !== directHost && !(poolerHost && poolerUser)) {
    throw new Error("DATABASE_URL does not identify the configured Supabase project");
  }
  if ((parsed.port || "5432") !== "5432") {
    throw new Error("DATABASE_URL must use a direct or session-mode connection for advisory locking");
  }
  return Object.freeze({ target: targetIdentity, host: expectedHost, database, projectRef });
}

export function requirePreparationMode(environment = process.env) {
  const mode = required(environment, "DEMO_DATABASE_PREPARE_MODE");
  if (!new Set(["migrate", "reinitialize"]).has(mode)) {
    throw new Error("DEMO_DATABASE_PREPARE_MODE must be migrate or reinitialize");
  }
  if (mode === "reinitialize" && environment.DEMO_DATABASE_RESET_CONFIRMATION !== resetConfirmation) {
    throw new Error(`DEMO_DATABASE_RESET_CONFIRMATION must be exactly ${resetConfirmation}`);
  }
  return mode;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function runScript(name, environment) {
  const child = spawn(process.execPath, [path.join(scriptDirectory, name)], {
    cwd: repository,
    env: environment,
    stdio: "inherit",
  });
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (code !== 0) throw new Error(`${name} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`);
}

async function inspectOrganization(client, { required: mustExist }) {
  const relation = await client.query("select to_regclass('app_identity.organization')::text as organization_table");
  if (!relation.rows[0]?.organization_table) {
    if (mustExist) throw new Error("Refusing destructive reset: the known demo organization table is absent");
    return;
  }
  const organizations = await client.query("select id::text from app_identity.organization order by id");
  const ids = organizations.rows.map(({ id }) => id);
  if ((mustExist && ids.length !== 1) || ids.some((id) => id !== SYNTHETIC_DEMO_FIXTURE.organizationId)) {
    throw new Error("Refusing database preparation: target does not contain only the known synthetic demo organization");
  }
}

async function resetApplicationSchemas(client) {
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '45s'");
    await client.query("set local statement_timeout = '8min'");
    for (const schema of applicationSchemas) {
      await client.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
    }
    await client.query("drop function if exists public.prevent_update_or_delete() cascade");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error("Disposable demo schema reset failed", { cause: error });
  }
}

export async function prepareDemoDatabase({
  databaseUrl = process.env.DATABASE_URL,
  environment = process.env,
  Client = pg.Client,
  run = runScript,
  migrateDatabase = migrate,
  migrationsDirectory = path.join(repository, "supabase/migrations"),
  log = console,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const target = validateDemoDatabaseTarget(databaseUrl, environment);
  const mode = requirePreparationMode(environment);
  const sourceRevision = required(environment, "SOURCE_REVISION");
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error("SOURCE_REVISION must be a full commit SHA");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let locked = false;
  try {
    const server = await client.query("select current_database() as database");
    if (server.rows[0]?.database !== target.database) {
      throw new Error("Connected database identity does not match the configured disposable demo");
    }
    await client.query("select pg_advisory_lock(hashtext($1))", [preparationLock]);
    locked = true;
    await inspectOrganization(client, { required: mode === "reinitialize" });
    if (mode === "reinitialize") await resetApplicationSchemas(client);

    const childEnvironment = { ...environment, DATABASE_URL: databaseUrl };
    await migrateDatabase({ databaseUrl, migrationsDirectory, log });
    await run("load-nemsis-catalog.mjs", childEnvironment);
    await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
      values ($1, $2, $3) on conflict (id) do nothing`, [
      SYNTHETIC_DEMO_FIXTURE.organizationId, "OpenTriage synthetic demonstration", "UTC",
    ]);
    await inspectOrganization(client, { required: true });
    await run("bootstrap-synthetic-installation.mjs", childEnvironment);
    await run("seed-initial-validation-versions.mjs", childEnvironment);
    await run("seed-install-definitions.mjs", childEnvironment);

    const definitions = await readInstallDefinitions(path.join(repository, "defines"));
    const migrations = await readMigrations(migrationsDirectory);
    const verification = await client.query(`select
      (select count(*)::int from supabase_migrations.schema_migrations where version = any($1::text[])) migrations,
      (select count(*)::int from app_identity.organization) organizations,
      (select count(*)::int from app_identity.app_user) users,
      (select count(*)::int from catalog.release where sealed) catalogs,
      (select count(*)::int from forms.form_version where status = 'published') forms,
      (select count(*)::int from validation.version where status = 'published') validations,
      (select count(*)::int from app_identity.active_configuration_bundle) active_bundles`,
    [migrations.map(({ version }) => version)]);
    const state = verification.rows[0];
    if (state.migrations !== migrations.length || state.organizations !== 1 || state.users < 1 ||
        state.catalogs < 1 || state.forms !== definitions.pairs.length ||
        state.validations !== definitions.pairs.length || state.active_bundles !== 1) {
      throw new Error(`Post-prepare verification failed: ${JSON.stringify(state)}`);
    }
    const summary = {
      schemaVersion: 1,
      status: "ready",
      target: target.target,
      mode,
      sourceRevision,
      migrations: state.migrations,
      catalogs: state.catalogs,
      definitions: definitions.pairs.length,
      organizationId: SYNTHETIC_DEMO_FIXTURE.organizationId,
    };
    log.info(`DEMO_DATABASE_PREPARATION_SUMMARY=${JSON.stringify(summary)}`);
    return summary;
  } finally {
    if (locked) await client.query("select pg_advisory_unlock(hashtext($1))", [preparationLock]).catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareDemoDatabase().catch((error) => {
    console.error(`Demo database preparation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
