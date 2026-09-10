import type { DispatchValidationCatalog, DispatchValidationFinding } from "./dispatch-assignment.validation.js";
import { validateDispatchAssignment } from "./dispatch-assignment.validation.js";
import { routeDispatchAssignment } from "./dispatch-assignment.projection.js";
import { persistDispatchReceipt, type DispatchReceiptWriter } from "./dispatch-receipt.persistence.js";
import { dispatchCanonicalDigest, dispatchSnapshotDigest } from "./dispatch-snapshot-revision.js";
import { mergeDispatchEncounter } from "./dispatch-encounter-merge.js";
import { retainPostSignatureDispatch } from "./dispatch-post-signature.js";

type JsonRecord = Record<string, unknown>;

export type DispatchIngestionStatus =
  | "applied"
  | "replayed"
  | "applied_with_findings"
  | "quarantined"
  | "rejected"
  | "stale"
  | "conflicting"
  | "post_signature";

export type DispatchIngestionResult = {
  readonly status: DispatchIngestionStatus;
  readonly sourceRecordId?: string;
  readonly revision?: number;
  readonly receiptId?: string;
  readonly assignmentId?: string | null;
  readonly originalStatus?: Exclude<DispatchIngestionStatus, "replayed">;
  readonly currentRevision?: number;
  readonly revisionGap?: { readonly firstMissing: number; readonly lastMissing: number } | null;
  readonly conflict?: "message_id" | "source_revision";
  readonly findings: ReadonlyArray<DispatchValidationFinding>;
};

export type IngestDispatchDeliveryInput = {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly sourceBytes: Uint8Array;
};

type ReceiptRow = {
  id: string;
  message_id: string;
  source_record_id: string;
  source_revision: string | number;
  source_payload: JsonRecord;
  status: Exclude<DispatchIngestionStatus, "replayed">;
  findings: DispatchValidationFinding[];
};

function parseSource(bytes: Uint8Array): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function identity(payload: JsonRecord): { messageId: string; sourceRecordId: string; revision: number } | null {
  return typeof payload.messageId === "string" && typeof payload.sourceRecordId === "string" &&
    Number.isSafeInteger(payload.revision) && Number(payload.revision) > 0
    ? { messageId: payload.messageId, sourceRecordId: payload.sourceRecordId, revision: Number(payload.revision) }
    : null;
}

function receiptResult(row: ReceiptRow): DispatchIngestionResult {
  return {
    status: "replayed",
    originalStatus: row.status,
    sourceRecordId: row.source_record_id,
    revision: Number(row.source_revision),
    receiptId: row.id,
    findings: row.findings
  };
}

/** Call inside a transaction; source payload content is deliberately never logged. */
export async function ingestDispatchDelivery(
  writer: DispatchReceiptWriter,
  input: IngestDispatchDeliveryInput,
  catalog: DispatchValidationCatalog
): Promise<DispatchIngestionResult> {
  const payload = parseSource(input.sourceBytes);
  if (!payload) return { status: "rejected", findings: [{
    severity: "error", code: "dispatch.envelope", pointer: "", message: "Dispatch source must be one UTF-8 JSON object"
  }] };
  const sourceIdentity = identity(payload);
  if (!sourceIdentity) {
    const validation = validateDispatchAssignment(payload, catalog);
    return { status: "rejected", findings: validation.findings };
  }

  await writer.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    JSON.stringify([input.organizationId, input.sourceId, sourceIdentity.sourceRecordId])
  ]);
  const receipts = await writer.query<ReceiptRow[]>(`
    select id, message_id, source_record_id, source_revision, source_payload,
           status, findings
    from clinical.dispatch_receipt
    where organization_id = $1 and source_id = $2
      and (message_id = $3 or source_record_id = $4)
    order by source_revision, received_at
  `, [input.organizationId, input.sourceId, sourceIdentity.messageId, sourceIdentity.sourceRecordId]);

  const incomingDeliveryDigest = dispatchCanonicalDigest(payload);
  const priorMessage = receipts.find((row) => row.message_id === sourceIdentity.messageId);
  if (priorMessage) {
    if (dispatchCanonicalDigest(priorMessage.source_payload) === incomingDeliveryDigest) return receiptResult(priorMessage);
    const currentRevision = Math.max(...receipts.map((row) => Number(row.source_revision)));
    return { status: "conflicting", conflict: "message_id", sourceRecordId: sourceIdentity.sourceRecordId,
      revision: sourceIdentity.revision, currentRevision, findings: [] };
  }

  const validation = validateDispatchAssignment(payload, catalog);
  const acceptedReceipts = receipts.filter((row) =>
    ["applied", "applied_with_findings", "quarantined", "post_signature"].includes(row.status));
  if (validation.canonical) {
    const priorRevision = acceptedReceipts.find((row) => Number(row.source_revision) === sourceIdentity.revision);
    if (priorRevision) {
      const priorValidation = validateDispatchAssignment(priorRevision.source_payload, catalog);
      if (priorValidation.canonical &&
          dispatchSnapshotDigest(priorValidation.canonical) === dispatchSnapshotDigest(validation.canonical)) {
        return receiptResult(priorRevision);
      }
      const currentRevision = Math.max(...acceptedReceipts.map((row) => Number(row.source_revision)));
      return { status: "conflicting", conflict: "source_revision", sourceRecordId: sourceIdentity.sourceRecordId,
        revision: sourceIdentity.revision, currentRevision, findings: validation.findings };
    }
  }

  const currentRevision = acceptedReceipts.length
    ? Math.max(...acceptedReceipts.map((row) => Number(row.source_revision)))
    : 0;
  if (sourceIdentity.revision < currentRevision) {
    return { status: "stale", sourceRecordId: sourceIdentity.sourceRecordId,
      revision: sourceIdentity.revision, currentRevision, findings: validation.findings };
  }
  if (validation.status === "rejected" || !validation.canonical) {
    const receipt = await persistDispatchReceipt(writer, {
      ...input, status: "rejected", findings: validation.findings,
      result: { sourceRecordId: sourceIdentity.sourceRecordId, revision: sourceIdentity.revision }
    });
    return { status: "rejected", sourceRecordId: sourceIdentity.sourceRecordId,
      revision: sourceIdentity.revision, receiptId: receipt.id, findings: validation.findings };
  }

  // The (organization_id, dispatch_source_id, dispatch_source_record_id) triple is unique on
  // clinical.call_assignment, so this normally matches at most one row. The explicit ordering
  // and limit are a deterministic safety net: if that invariant is ever relaxed, the most
  // recently dispatched assignment (tie-broken by call_assignment id) always decides the
  // signed/unsigned branch below, rather than depending on incidental row order.
  const reports = await writer.query<Array<{ id: string; status: string }>>(`
    select r.id, r.status from clinical.call_assignment ca
    join clinical.report r on r.id = ca.report_id
    where ca.organization_id = $1 and ca.dispatch_source_id = $2
      and ca.dispatch_source_record_id = $3
    order by ca.dispatched_at desc, ca.id desc
    limit 1
  `, [input.organizationId, input.sourceId, sourceIdentity.sourceRecordId]);
  if (reports[0]?.status === "signed") {
    const receipt = await persistDispatchReceipt(writer, {
      ...input, status: "post_signature", findings: validation.findings,
      result: { sourceRecordId: sourceIdentity.sourceRecordId, revision: sourceIdentity.revision,
        reportId: reports[0].id, signedSnapshotImmutable: true, acceptanceRequiresAmendment: true }
    });
    await retainPostSignatureDispatch(writer, { reportId: reports[0].id, receiptId: receipt.id,
      dispatchRevision: sourceIdentity.revision, eventType: String(validation.canonical.eventType) as "upsert" | "cancel",
      canonical: validation.canonical });
    return { status: "post_signature", sourceRecordId: sourceIdentity.sourceRecordId,
      revision: sourceIdentity.revision, receiptId: receipt.id, findings: validation.findings };
  }

  const routed = await routeDispatchAssignment(writer, {
    ...input,
    canonical: validation.canonical,
    validationStatus: validation.status,
    findings: validation.findings,
    revisionMetadata: {
      previousRevision: currentRevision || null,
      revisionGap: sourceIdentity.revision > currentRevision + 1
        ? { firstMissing: currentRevision + 1, lastMissing: sourceIdentity.revision - 1 }
        : null
    }
  });
  if (reports[0]?.status === "draft") {
    await mergeDispatchEncounter(writer, {
      reportId: reports[0].id,
      canonical: validation.canonical,
      receiptId: routed.receipt.id,
      dispatchRevision: sourceIdentity.revision
    });
    if (routed.projection.eventType === "cancel") {
      await writer.query(`update clinical.report set dispatch_canceled_at = $2,
        dispatch_cancellation_revision = $3, dispatch_cancellation_receipt_id = $4, updated_at = now()
        where id = $1 and status = 'draft'`, [reports[0].id, routed.projection.canceledAt,
        sourceIdentity.revision, routed.receipt.id]);
      await writer.query(`update clinical.incident set operational_state = 'canceled', updated_at = now()
        where id = (select incident_id from clinical.report where id = $1)`, [reports[0].id]);
    }
  }
  return {
    status: routed.status,
    sourceRecordId: sourceIdentity.sourceRecordId,
    revision: sourceIdentity.revision,
    receiptId: routed.receipt.id,
    assignmentId: routed.assignmentId,
    revisionGap: sourceIdentity.revision > currentRevision + 1
      ? { firstMissing: currentRevision + 1, lastMissing: sourceIdentity.revision - 1 }
      : null,
    findings: validation.findings
  };
}
