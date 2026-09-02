import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const restoredDatabaseUrl = process.env.RESTORED_DATABASE_URL;
const acknowledged = process.env.RECOVERY_EXERCISE_ACKNOWLEDGE_RESTORED_DATABASE === "1";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projector = path.join(packageRoot, "scripts/project-analytics.mjs");

if (!restoredDatabaseUrl) throw new Error("RESTORED_DATABASE_URL is required");
if (!acknowledged) {
  throw new Error("RECOVERY_EXERCISE_ACKNOWLEDGE_RESTORED_DATABASE=1 is required for an isolated restore");
}

const client = new pg.Client({ connectionString: restoredDatabaseUrl });
await client.connect();

function numericCounters(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function assertAuthoritativeStateReady(readiness) {
  for (const key of ["missing_snapshot_count", "mismatched_snapshot_count", "orphan_snapshot_count",
    "broken_audit_chain_count"]) {
    if (readiness[key] !== 0) throw new Error(`restored authoritative state failed ${key}`);
  }
}

try {
  const serverVersion = Number((await client.query("show server_version_num")).rows[0].server_version_num);
  if (serverVersion < 150000) throw new Error("restored PostgreSQL server must be version 15 or newer");

  const before = numericCounters((await client.query("select * from operations.recovery_readiness")).rows[0]);
  assertAuthoritativeStateReady(before);

  const range = (await client.query(`
    select min(effective.reporting_date)::text as start_date,
      max(effective.reporting_date)::text as end_date
    from clinical.report report
    cross join lateral (
      select coalesce((
        select amendment.reporting_date from clinical.amendment amendment
        where amendment.report_id = report.id and amendment.reporting_date is not null
        order by amendment.sequence desc limit 1
      ), report.reporting_date) as reporting_date
    ) effective
    where report.status = 'signed'
  `)).rows[0];

  let reconciliation = { checkedCount: 0, repairedCount: 0 };
  if (range.start_date && range.end_date) {
    const execution = await execFileAsync(process.execPath,
      [projector, "--reconcile", "--from", range.start_date, "--to", range.end_date], {
        env: { ...process.env, DATABASE_URL: restoredDatabaseUrl }
      });
    reconciliation = JSON.parse(execution.stdout.trim());
    if (reconciliation.status !== "succeeded") throw new Error("projection reconciliation did not succeed");
  }

  const after = numericCounters((await client.query("select * from operations.recovery_readiness")).rows[0]);
  assertAuthoritativeStateReady(after);
  if (after.missing_or_stale_projection_count !== 0) {
    throw new Error("restored analytical projections could not be rebuilt from signed state");
  }

  console.log(JSON.stringify({
    event: "database_recovery_verification",
    status: "succeeded",
    postgresMajorVersion: Math.floor(serverVersion / 10000),
    signedReportCount: after.signed_report_count,
    authoritativeIntegrityFailures: 0,
    staleProjectionsBefore: before.missing_or_stale_projection_count,
    projectionsChecked: Number(reconciliation.checkedCount ?? 0),
    projectionsRepaired: Number(reconciliation.repairedCount ?? 0),
    staleProjectionsAfter: 0
  }));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error
    ? `database.${String(error.code).slice(0, 32)}`
    : "recovery.VerificationFailed";
  console.log(JSON.stringify({ event: "database_recovery_verification", status: "failed", errorCode: code }));
  process.exitCode = 1;
} finally {
  await client.end();
}
