import type { DispatchReceiptWriter } from "./dispatch-receipt.persistence.js";
import { dispatchEntityId } from "../reports/encounter-document.persistence.js";
import { dispatchIncomingTargets, planDispatchMerge, type CurrentTarget } from "./dispatch-encounter-merge.js";

type JsonRecord = Record<string, unknown>;

/** Records proposed post-signature changes without touching the immutable report or snapshot. */
export async function retainPostSignatureDispatch(writer: DispatchReceiptWriter, input: {
  reportId: string;
  receiptId: string;
  dispatchRevision: number;
  eventType: "upsert" | "cancel";
  canonical: JsonRecord;
}): Promise<ReadonlyArray<unknown>> {
  const rows = await writer.query<Array<{
    id: string; element_id: string; provenance_kind: string;
    provenance_detail: JsonRecord | null; tombstoned_at: unknown;
  }>>(`select id, element_id, provenance_kind, provenance_detail, tombstoned_at
    from clinical.element_occurrence where report_id = $1
      and (provenance_kind = 'dispatch' or provenance_detail ? 'sourceOccurrenceId')
      and id <> $2 order by element_id, ordinal, id`,
  [input.reportId, dispatchEntityId(input.reportId, "occurrence:server-pcr-number")]);
  const current: CurrentTarget[] = rows.map((row) => ({
    id: row.id, elementId: row.element_id, provenanceKind: row.provenance_kind,
    clinicianValue: row.provenance_detail?.clinicianValue ?? row.provenance_detail?.sourceValue,
    tombstoned: row.tombstoned_at !== null
  }));
  const differences = planDispatchMerge(current, dispatchIncomingTargets(input.reportId, input.canonical));
  await writer.query(`insert into clinical_audit.post_signature_dispatch_delivery
    (report_id, dispatch_receipt_id, dispatch_revision, event_type, proposed_snapshot, differences)
    values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [input.reportId, input.receiptId,
    input.dispatchRevision, input.eventType, JSON.stringify(input.canonical), JSON.stringify(differences)]);
  return differences;
}
