import { randomUUID } from "node:crypto";
import {
  persistDispatchReceipt,
  type DispatchReceipt,
  type DispatchReceiptWriter
} from "./dispatch-receipt.persistence.js";
import type { DispatchValidationFinding } from "./dispatch-assignment.validation.js";

type JsonRecord = Record<string, unknown>;

export type DispatchAssignmentProjection = {
  readonly sourceRecordId: string;
  readonly revision: number;
  readonly eventType: "upsert" | "cancel";
  readonly incidentNumber: string;
  readonly responseNumber: string;
  readonly vehicleNumber: string;
  readonly callSign: string;
  readonly unitNotifiedAt: string;
  readonly dispatchReason: string | null;
};

export type RouteDispatchAssignmentInput = {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly sourceBytes: Uint8Array;
  readonly canonical: JsonRecord;
  readonly validationStatus: "applied" | "applied_with_findings";
  readonly findings: ReadonlyArray<DispatchValidationFinding>;
  readonly revisionMetadata?: Readonly<JsonRecord>;
};

export type RoutedDispatchAssignment = {
  readonly status: "applied" | "applied_with_findings";
  readonly receipt: DispatchReceipt;
  readonly assignmentId: string;
  readonly unitId: string;
  readonly projection: DispatchAssignmentProjection;
};

export type QuarantinedDispatchAssignment = {
  readonly status: "quarantined";
  readonly receipt: DispatchReceipt;
  readonly assignmentId: null;
  readonly unitId: null;
  readonly projection: DispatchAssignmentProjection;
};

export type DispatchAssignmentRoutingResult = RoutedDispatchAssignment | QuarantinedDispatchAssignment;

type ExistingAssignment = {
  id: string;
  incident_id: string;
  unit_id: string;
  call_sign: string;
  response_number: string;
};

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elementValue(canonical: JsonRecord, elementId: string): JsonRecord | undefined {
  if (!Array.isArray(canonical.groups)) return undefined;
  for (const group of canonical.groups) {
    if (!record(group) || !Array.isArray(group.instances)) continue;
    for (const instance of group.instances) {
      if (!record(instance) || !Array.isArray(instance.elements)) continue;
      for (const element of instance.elements) {
        if (!record(element) || element.id !== elementId || !Array.isArray(element.values)) continue;
        const first = element.values[0];
        return record(first) ? first : undefined;
      }
    }
  }
  return undefined;
}

function lexical(value: JsonRecord | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value.kind === "coded" ? value.code : value.value;
  return typeof candidate === "string" ? candidate : undefined;
}

function required(canonical: JsonRecord, elementId: string): string {
  const value = lexical(elementValue(canonical, elementId));
  if (value === undefined) throw new TypeError(`Accepted dispatch snapshot is missing ${elementId}`);
  return value;
}

/** Extracts the operational subset without changing or discarding the canonical document. */
export function projectDispatchAssignment(canonical: JsonRecord): DispatchAssignmentProjection {
  const { sourceRecordId, revision, eventType } = canonical;
  if (typeof sourceRecordId !== "string" || !Number.isSafeInteger(revision) || Number(revision) < 1 ||
      (eventType !== "upsert" && eventType !== "cancel")) {
    throw new TypeError("Accepted dispatch snapshot has invalid source identity or event type");
  }
  const dispatchReasonValue = elementValue(canonical, "eDispatch.01");
  const dispatchReason = dispatchReasonValue
    ? (typeof dispatchReasonValue.display === "string" ? dispatchReasonValue.display : lexical(dispatchReasonValue) ?? null)
    : null;
  return {
    sourceRecordId,
    revision: Number(revision),
    eventType,
    incidentNumber: required(canonical, "eResponse.03"),
    responseNumber: required(canonical, "eResponse.04"),
    vehicleNumber: required(canonical, "eResponse.13"),
    callSign: required(canonical, "eResponse.14"),
    unitNotifiedAt: required(canonical, "eTimes.03"),
    dispatchReason
  };
}

/**
 * Persists a receipt and rebuildable assignment projection. Callers run this inside the
 * same transaction as revision application so receipt and operational state are atomic.
 */
export async function routeDispatchAssignment(
  writer: DispatchReceiptWriter,
  input: RouteDispatchAssignmentInput
): Promise<DispatchAssignmentRoutingResult> {
  const projection = projectDispatchAssignment(input.canonical);
  const units = await writer.query<Array<{ id: string }>>(`
    select id from app_identity.operational_unit
    where organization_id = $1 and call_sign = $2 and active
  `, [input.organizationId, projection.callSign]);
  const unit = units[0];

  if (!unit) {
    const result = {
      reason: "unknown_call_sign",
      callSign: projection.callSign,
      sourceRecordId: projection.sourceRecordId,
      revision: projection.revision
    };
    const receipt = await persistDispatchReceipt(writer, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      sourceBytes: input.sourceBytes,
      status: "quarantined",
      findings: input.findings,
      result
    });
    return { status: "quarantined", receipt, assignmentId: null, unitId: null, projection };
  }

  const existingRows = await writer.query<ExistingAssignment[]>(`
    select ca.id, ca.incident_id, ca.unit_id, ou.call_sign, ca.response_number
    from clinical.call_assignment ca
    join app_identity.operational_unit ou
      on ou.organization_id = ca.organization_id and ou.id = ca.unit_id
    where ca.organization_id = $1 and ca.dispatch_source_id = $2
      and ca.dispatch_source_record_id = $3
    for update of ca
  `, [input.organizationId, input.sourceId, projection.sourceRecordId]);
  const existing = existingRows[0];
  if (existing && (existing.call_sign !== projection.callSign || existing.response_number !== projection.responseNumber)) {
    throw new TypeError("Dispatch reassignment requires cancellation and a new sourceRecordId with a new response number");
  }

  const receiptResult = {
    callSign: projection.callSign,
    responseNumber: projection.responseNumber,
    vehicleNumber: projection.vehicleNumber,
    revision: projection.revision,
    ...input.revisionMetadata
  };
  const receipt = await persistDispatchReceipt(writer, {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    sourceBytes: input.sourceBytes,
    status: input.validationStatus,
    findings: input.findings,
    result: receiptResult
  });

  let incidentId = existing?.incident_id;
  if (!incidentId) {
    const related = await writer.query<Array<{ incident_id: string }>>(`
      select incident_id from clinical.call_assignment
      where organization_id = $1 and call_number = $2
      order by created_at limit 1
    `, [input.organizationId, projection.incidentNumber]);
    incidentId = related[0]?.incident_id ?? randomUUID();
    if (!related[0]) {
      await writer.query(`
        insert into clinical.incident (id, organization_id, operational_state, dispatch_provenance)
        values ($1, $2, $3, $4::jsonb)
      `, [incidentId, input.organizationId,
        projection.eventType === "cancel" ? "canceled" : "assigned",
        JSON.stringify({ sourceId: input.sourceId, sourceRecordId: projection.sourceRecordId })]);
    }
  }

  const assignmentId = existing?.id ?? randomUUID();
  if (existing) {
    await writer.query(`
      update clinical.call_assignment
      set dispatch_receipt_id = $2, dispatch_revision = $3, vehicle_number = $4,
          dispatched_at = $5, dispatch_reason = $6,
          status = case when $7 = 'cancel' and status = 'assigned' then 'canceled' else status end,
          updated_at = now()
      where id = $1
    `, [assignmentId, receipt.id, projection.revision, projection.vehicleNumber,
      projection.unitNotifiedAt, projection.dispatchReason, projection.eventType]);
  } else {
    await writer.query(`
      insert into clinical.call_assignment
        (id, organization_id, unit_id, incident_id, call_number, dispatched_at,
         dispatch_reason, status, dispatch_source_id, dispatch_source_record_id,
         dispatch_revision, response_number, vehicle_number, dispatch_receipt_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [assignmentId, input.organizationId, unit.id, incidentId, projection.incidentNumber,
      projection.unitNotifiedAt, projection.dispatchReason,
      projection.eventType === "cancel" ? "canceled" : "assigned", input.sourceId,
      projection.sourceRecordId, projection.revision, projection.responseNumber,
      projection.vehicleNumber, receipt.id]);
  }
  return { status: input.validationStatus, receipt, assignmentId, unitId: unit.id, projection };
}
