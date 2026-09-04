import type { DispatchValidationFinding } from "./dispatch-assignment.validation.js";

type JsonRecord = Record<string, unknown>;

export type DispatchReceiptStatus =
  | "applied"
  | "applied_with_findings"
  | "rejected"
  | "quarantined"
  | "stale"
  | "conflicting"
  | "post_signature";

export type PersistDispatchReceiptInput = {
  readonly organizationId: string;
  readonly sourceId: string;
  /** The exact bytes received from the caller. Do not reconstruct these from parsed JSON. */
  readonly sourceBytes: Uint8Array;
  readonly status: DispatchReceiptStatus;
  readonly findings: ReadonlyArray<DispatchValidationFinding>;
  /** Structured outcome metadata only; source content belongs in sourceBytes/source_payload. */
  readonly result: Readonly<JsonRecord>;
};

export type DispatchReceipt = {
  readonly id: string;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly messageId: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: number;
  readonly receivedAt: string;
  readonly exactSha256: string;
  readonly canonicalSha256: string;
  readonly status: DispatchReceiptStatus;
  readonly findings: ReadonlyArray<DispatchValidationFinding>;
  readonly result: Readonly<JsonRecord>;
};

export interface DispatchReceiptWriter {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
}

type StoredReceipt = {
  id: string;
  organization_id: string;
  source_id: string;
  message_id: string;
  source_record_id: string;
  source_revision: string | number;
  received_at: Date | string;
  exact_sha256: string;
  canonical_sha256: string;
  status: DispatchReceiptStatus;
  findings: DispatchValidationFinding[];
  result: JsonRecord;
};

function parseSource(bytes: Uint8Array): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("Dispatch source bytes must contain one UTF-8 JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Dispatch source bytes must contain one JSON object");
  }
  return parsed as JsonRecord;
}

function requiredIdentity(payload: JsonRecord): {
  messageId: string;
  sourceRecordId: string;
  sourceRevision: number;
} {
  const { messageId, sourceRecordId, revision } = payload;
  if (typeof messageId !== "string" || typeof sourceRecordId !== "string" ||
      !Number.isSafeInteger(revision) || Number(revision) < 1) {
    throw new TypeError("Validated dispatch source is missing its immutable message or revision identity");
  }
  return { messageId, sourceRecordId, sourceRevision: Number(revision) };
}

/**
 * Writes one immutable delivery receipt. The database computes both digests from the
 * submitted bytea/jsonb values, so callers cannot accidentally persist mismatched evidence.
 * This boundary intentionally performs no payload logging.
 */
export async function persistDispatchReceipt(
  writer: DispatchReceiptWriter,
  input: PersistDispatchReceiptInput
): Promise<DispatchReceipt> {
  const payload = parseSource(input.sourceBytes);
  const identity = requiredIdentity(payload);
  const rows = await writer.query<StoredReceipt[]>(`
    insert into clinical.dispatch_receipt
      (organization_id, source_id, message_id, source_record_id, source_revision,
       source_bytes, source_payload, findings, status, result)
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb)
    returning id, organization_id, source_id, message_id, source_record_id,
      source_revision, received_at, exact_sha256, canonical_sha256, status,
      findings, result
  `, [
    input.organizationId,
    input.sourceId,
    identity.messageId,
    identity.sourceRecordId,
    identity.sourceRevision,
    Buffer.from(input.sourceBytes),
    JSON.stringify(payload),
    JSON.stringify(input.findings),
    input.status,
    JSON.stringify(input.result)
  ]);
  const row = rows[0];
  if (!row) throw new Error("Dispatch receipt insert returned no row");
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceId: row.source_id,
    messageId: row.message_id,
    sourceRecordId: row.source_record_id,
    sourceRevision: Number(row.source_revision),
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    exactSha256: row.exact_sha256,
    canonicalSha256: row.canonical_sha256,
    status: row.status,
    findings: row.findings,
    result: row.result
  };
}
