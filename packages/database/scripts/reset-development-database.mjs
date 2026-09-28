import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scriptDirectory, "../../..");
const applicationSchemas = Object.freeze([
  "app_identity", "catalog", "forms", "clinical", "clinical_audit", "integration",
  "analytics_private", "analytics", "operations", "clinical_history", "retention",
  "feedback", "offline_recovery", "validation", "supabase_migrations", "open_triage_deploy",
]);

export function developmentDatabaseTarget(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`Refusing to reset non-local database host ${parsed.hostname}`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database || new Set(["template0", "template1"]).has(database)) {
    throw new Error(`Refusing to reset database ${database || "<empty>"}`);
  }
  return { host: parsed.hostname, port: parsed.port || "5432", database };
}

export function requireResetConfirmation(argv) {
  if (argv.length !== 1 || argv[0] !== "--confirm-reset") {
    throw new Error("Usage: npm run db:reset:development -- --confirm-reset");
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function runScript(name, environment) {
  const child = spawn(process.execPath, [path.join(scriptDirectory, name)], {
    cwd: repository, env: environment, stdio: "inherit",
  });
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (code !== 0) throw new Error(`${name} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`);
}

export async function resetDevelopmentDatabase({
  databaseUrl = process.env.DATABASE_URL,
  argv = process.argv.slice(2),
  environment = process.env,
  Client = pg.Client,
  run = runScript,
  log = console,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  requireResetConfirmation(argv);
  const target = developmentDatabaseTarget(databaseUrl);
  for (const key of ["PATIENT_KEY_INSTALLATION_ID", "PATIENT_KEY_VERSION", "PATIENT_KEY_SECRET_BASE64"]) {
    if (!environment[key]) throw new Error(`${key} is required before resetting the development database`);
  }
  const definitions = await readInstallDefinitions(path.join(repository, "defines"));
  const expectedOptions = definitions.pairs.length;
  log.warn(`Resetting local PostgreSQL database ${target.database} at ${target.host}:${target.port}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["open-triage-development-reset-v1"]);
    for (const schema of applicationSchemas) {
      await client.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
    }
    await client.query("drop function if exists public.prevent_update_or_delete() cascade");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  const childEnvironment = { ...environment, DATABASE_URL: databaseUrl };
  await run("migrate.mjs", childEnvironment);

  const organizationClient = new Client({ connectionString: databaseUrl });
  await organizationClient.connect();
  try {
    await organizationClient.query(`insert into app_identity.organization (id,name,deployment_timezone)
      values ($1,$2,$3)`, [SYNTHETIC_DEMO_FIXTURE.organizationId, "Demonstration EMS", "UTC"]);
  } finally {
    await organizationClient.end();
  }

  await run("bootstrap-synthetic-installation.mjs", childEnvironment);
  await run("seed-initial-validation-versions.mjs", childEnvironment);
  await run("seed-install-definitions.mjs", childEnvironment);

  const verificationClient = new Client({ connectionString: databaseUrl });
  await verificationClient.connect();
  try {
    const verified = await verificationClient.query(`select
      (select count(*)::int from app_identity.organization) organizations,
      (select count(*)::int from app_identity.app_user) users,
      (select count(*)::int from app_identity.installation_owner) owners,
      (select count(*)::int from catalog.release where sealed) catalogs,
      (select count(*)::int from forms.form_version where status='published') forms,
      (select count(*)::int from validation.version where status='published') validations,
      (select count(*)::int from app_identity.active_configuration_bundle) active_bundles`);
    const state = verified.rows[0];
    if (state.organizations !== 1 || state.users !== 1 || state.owners !== 0
        || state.catalogs < 1 || state.forms !== expectedOptions
        || state.validations !== expectedOptions || state.active_bundles !== 1) {
      throw new Error(`Development reset verification failed: ${JSON.stringify(state)}`);
    }
    log.info(JSON.stringify({ status: "ready", database: target.database,
      defaultDefinition: definitions.defaultPair.key, availableDefinitions: definitions.pairs.map(({ key }) => key),
      organizationId: SYNTHETIC_DEMO_FIXTURE.organizationId, ownerConfigured: false }, null, 2));
  } finally {
    await verificationClient.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetDevelopmentDatabase().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
