import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertScratchDatabaseTarget } from "./scale-test-guard.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportRoot = path.join(packageRoot, "artifacts/database-lanes");
const SAFE_LANE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class SuiteCommandError extends Error {
  constructor({ lane, command, exitCode, signal }) {
    super(`Database suite ${lane} failed: ${command} ${signal ? `received ${signal}` : `exited ${exitCode}`}`);
    this.name = "SuiteCommandError";
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function isolatedDatabaseName(lane, {
  runId = process.env.GITHUB_RUN_ID,
  runAttempt = process.env.GITHUB_RUN_ATTEMPT,
  processId = process.pid,
} = {}) {
  if (!SAFE_LANE.test(lane)) {
    throw new Error(`Database lane must match ${SAFE_LANE}: ${lane}`);
  }
  const execution = runId ? `${runId}_${runAttempt ?? "1"}` : `local_${processId}`;
  const prefix = "open_triage_test_";
  const laneLimit = 63 - prefix.length - execution.length - 1;
  return `${prefix}${lane.replaceAll("-", "_").slice(0, laneLimit)}_${execution}`;
}

function commandRunner(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) resolve();
      else reject(new SuiteCommandError({ lane: env.DATABASE_TEST_LANE, command, exitCode, signal }));
    });
  });
}

async function writeLaneReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function errorEvidence(error) {
  if (!error) return null;
  return {
    name: error.name ?? "Error",
    message: error.message ?? String(error),
    exitCode: error.exitCode ?? null,
    signal: error.signal ?? null,
  };
}

/**
 * Runs one stateful suite in a database owned by the configured maintenance user.
 * The command's first failure remains authoritative even if best-effort cleanup also fails.
 */
export async function runIsolatedDatabaseSuite({
  lane,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  databaseName = isolatedDatabaseName(lane),
  reportPath = path.join(reportRoot, `${lane}.json`),
}, dependencies = {}) {
  const Client = dependencies.Client ?? pg.Client;
  const runCommand = dependencies.runCommand ?? commandRunner;
  const persistReport = dependencies.persistReport ?? writeLaneReport;
  const now = dependencies.now ?? (() => new Date());

  if (!command) throw new Error(`Database lane ${lane} has no command`);
  const sourceDatabaseUrl = env.DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error(`DATABASE_URL is required for database lane ${lane}`);
  assertScratchDatabaseTarget(sourceDatabaseUrl, { env });

  const sourceUrl = new URL(sourceDatabaseUrl);
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const suiteUrl = new URL(sourceUrl);
  suiteUrl.pathname = `/${databaseName}`;
  const startedAt = now();
  const admin = new Client({
    connectionString: adminUrl.toString(),
    application_name: `open-triage-test-owner-${lane}`,
  });
  let connected = false;
  let created = false;
  let databaseOwner;
  let primaryFailure;
  let cleanupFailure;

  try {
    await admin.connect();
    connected = true;
    const owner = (await admin.query("select current_user")).rows[0]?.current_user;
    if (!owner) throw new Error(`Database lane ${lane} could not determine its owner`);
    databaseOwner = owner;
    await admin.query(
      `create database ${quoteIdentifier(databaseName)} with owner ${quoteIdentifier(owner)} template template0`,
    );
    created = true;
    await runCommand(command, args, {
      cwd,
      env: {
        ...env,
        DATABASE_URL: suiteUrl.toString(),
        DATABASE_TEST_LANE: lane,
        DATABASE_TEST_DATABASE: databaseName,
      },
    });
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (connected && created) {
      try {
        await admin.query(`drop database ${quoteIdentifier(databaseName)} with (force)`);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (connected) {
      try {
        await admin.end();
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
  }

  const finishedAt = now();
  const report = {
    schemaVersion: 1,
    lane,
    suite: [command, ...args].join(" "),
    database: { name: databaseName, owner: databaseOwner ?? null, lifecycle: "create-drop" },
    status: primaryFailure || cleanupFailure ? "failed" : "passed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    primaryFailure: errorEvidence(primaryFailure),
    cleanupFailure: errorEvidence(cleanupFailure),
  };

  try {
    await persistReport(reportPath, report);
  } catch (error) {
    primaryFailure ??= error;
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  return report;
}
