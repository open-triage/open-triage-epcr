import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const RESET_CONFIRMATION = "DELETE-UNSIGNED-CLINICAL-WORK";

function digestIds(ids) {
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

async function snapshot(client) {
  const reports = await client.query(`select id from clinical.report report where status='draft'
      and not exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id=report.id)
      order by id`);
  const calls = await client.query(`select assignment.id from clinical.call_assignment assignment
      left join clinical.report report on report.id=assignment.report_id
      where assignment.report_id is null or (report.status='draft'
        and not exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id=report.id))
      order by assignment.id`);
  const signed = await client.query(`select report.id, snapshot.id snapshot_id, snapshot.canonical_sha256
      from clinical.report report join clinical.signed_snapshot snapshot on snapshot.report_id=report.id
      order by report.id`);
  return {
    reportIds: reports.rows.map(({ id }) => id),
    callIds: calls.rows.map(({ id }) => id),
    signedBoundary: signed.rows.map((row) => `${row.id}:${row.snapshot_id}:${row.canonical_sha256}`),
  };
}

export async function resetUnsignedClinicalWork({
  databaseUrl = process.env.DATABASE_URL,
  confirmation,
  Client = pg.Client,
  log = console,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to reset unsigned clinical work");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const preview = await snapshot(client);
    const previewEvent = { event: "unsigned_clinical_reset_preview", calls: preview.callIds.length,
      reports: preview.reportIds.length, callIds: preview.callIds, reportIds: preview.reportIds,
      signedReportsExcluded: preview.signedBoundary.length };
    log.info(JSON.stringify(previewEvent));
    if (confirmation === undefined) return { preview: previewEvent, result: null };
    if (confirmation !== RESET_CONFIRMATION) {
      throw new Error(`Preview only; rerun with --confirm ${RESET_CONFIRMATION} to delete exactly this unsigned boundary`);
    }

    await client.query("begin isolation level serializable");
    try {
      const locked = await snapshot(client);
      if (JSON.stringify(locked.reportIds) !== JSON.stringify(preview.reportIds)
        || JSON.stringify(locked.callIds) !== JSON.stringify(preview.callIds)) {
        throw new Error("Unsigned reset boundary changed after preview; rerun to review the new boundary");
      }
      if (digestIds(locked.signedBoundary) !== digestIds(preview.signedBoundary)) {
        throw new Error("Signed report boundary changed after preview; no data was deleted");
      }
      await client.query("set local role open_triage_migration_executor");
      const reset = await client.query(
        "select clinical.reset_unsigned_rollout($1::uuid[],$2::uuid[]) result",
        [preview.reportIds, preview.callIds],
      );
      await client.query("commit");
      const after = await snapshot(client);
      if (after.reportIds.length || after.callIds.length) {
        throw new Error("Unsigned reset boundary verification failed: unsigned records remain");
      }
      if (digestIds(after.signedBoundary) !== digestIds(preview.signedBoundary)) {
        throw new Error("Signed reset boundary verification failed after deletion");
      }
      const result = { event: "unsigned_clinical_reset_complete",
        deleted: reset.rows[0]?.result ?? { calls: 0, reports: 0 },
        remainingUnsignedCalls: 0, remainingUnsignedReports: 0,
        signedReportsPreserved: after.signedBoundary.length };
      log.info(JSON.stringify(result));
      return { preview: previewEvent, result };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

function argumentValue(arguments_, name) {
  const position = arguments_.indexOf(name);
  return position < 0 ? undefined : arguments_[position + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await resetUnsignedClinicalWork({ confirmation: argumentValue(process.argv.slice(2), "--confirm") });
}
