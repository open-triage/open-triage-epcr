import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AssignedCall, AssignedCallsResponse, InstallationSettings, OpenAssignmentResponse } from "@open-triage/contracts";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { clinicalFormConfiguration } from "../forms/clinical-form-configuration.js";
import { dispatchConflicts, encounterDocument, seedDispatchEncounter } from "../reports/encounter-document.persistence.js";
import { randomSyntheticDispatchPayload } from "./synthetic-dispatch-payloads.js";
import { selectedInstallationSettings } from "../config/installation-settings.js";

type AssignedCallRow = {
  id: string;
  call_number: string;
  unit_id: string;
  call_sign: string;
  dispatched_at: Date | string;
  dispatch_reason: string | null;
  dispatch_priority_code: string | null;
  dispatch_priority_display: string | null;
  chief_complaint: string | null;
  agency_time_zone: string;
  status: "assigned" | "opened" | "canceled";
};

type OpenableAssignmentRow = AssignedCallRow & {
  organization_id: string;
  incident_id: string;
  report_id: string | null;
  synthetic: boolean;
  dispatch_receipt_id: string | null;
};

type SyntheticReceiptRow = {
  source_id: string;
  source_payload: Record<string, unknown>;
};

type ReportRow = {
  id: string;
  documenting_user_id: string;
  form_version_id: string;
  catalog_release_id: string;
  revision: string | number;
  status: "draft" | "signed";
  dispatch_canceled_at: Date | string | null;
  dispatch_cancellation_revision: string | number | null;
  dispatch_cancellation_receipt_id: string | null;
};

function cancellation(row: ReportRow) {
  return row.dispatch_canceled_at && row.dispatch_cancellation_revision && row.dispatch_cancellation_receipt_id ? {
    canceledAt: new Date(row.dispatch_canceled_at).toISOString(),
    dispatchRevision: Number(row.dispatch_cancellation_revision), receiptId: row.dispatch_cancellation_receipt_id
  } : null;
}

function nextCallNumber(callNumber: string): string {
  const match = /^(.*?)(\d+)$/.exec(callNumber);
  if (!match) return `${callNumber}-002`;
  return `${match[1]!}${String(Number(match[2]!) + 1).padStart(match[2]!.length, "0")}`;
}

function syntheticSourceRecordId(callNumber: string): string {
  const sequence = /(\d+)$/.exec(callNumber)?.[1];
  return sequence
    ? `SYNTHETIC-SOURCE-RECORD-${sequence.padStart(4, "0")}`
    : `SYNTHETIC-SOURCE-RECORD-${randomUUID()}`;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((candidate): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null) : [];
}

function payloadElement(payload: Record<string, unknown>, elementId: string): Record<string, unknown> | undefined {
  return records(payload.groups).flatMap((group) => records(group.instances))
    .flatMap((instance) => records(instance.elements)).find((element) => element.id === elementId);
}

function scalarPayloadValue(payload: Record<string, unknown>, elementId: string): string | null {
  const value = records(payloadElement(payload, elementId)?.values)[0]?.value;
  return typeof value === "string" ? value : null;
}

function setScalarPayloadValue(payload: Record<string, unknown>, elementId: string, value: string): void {
  const target = records(payloadElement(payload, elementId)?.values)[0];
  if (!target) throw new TypeError(`Synthetic dispatch payload is missing ${elementId}`);
  target.value = value;
}

function ensurePayloadElement(
  payload: Record<string, unknown>,
  groupId: string,
  element: Record<string, unknown>,
): void {
  if (payloadElement(payload, String(element.id))) return;
  const group = records(payload.groups).find((candidate) => candidate.id === groupId);
  const instance = records(group?.instances)[0];
  if (!instance || !Array.isArray(instance.elements)) {
    throw new TypeError(`Synthetic dispatch payload is missing ${groupId}`);
  }
  instance.elements.push(structuredClone(element));
}

function shiftedTimestamp(value: string, milliseconds: number): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new TypeError(`Synthetic dispatch timestamp is invalid: ${value}`);
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!offset) return new Date(instant + milliseconds).toISOString();
  const offsetMinutes = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  const shifted = new Date(instant + milliseconds + offsetMinutes * 60_000).toISOString();
  const local = value.includes(".") ? shifted.replace(/Z$/, "") : shifted.replace(/\.000Z$/, "");
  return `${local}${offset[1]}${offset[2]}:${offset[3]}`;
}

/** Creates a complete next-call fixture while retaining the canonical NEMSIS shape. */
export function syntheticReplacementPayload(
  source: Record<string, unknown>,
  callNumber: string,
  dispatchedAt: Date,
  messageId: string,
  sourceRecordId = nextCallNumber(String(source.sourceRecordId)),
): Record<string, unknown> {
  const payload = structuredClone(source);
  const priorUnitNotified = scalarPayloadValue(payload, "eTimes.03");
  if (!priorUnitNotified) throw new TypeError("Synthetic dispatch payload is missing eTimes.03");
  const shift = dispatchedAt.getTime() - Date.parse(priorUnitNotified);
  payload.messageId = messageId;
  payload.sourceRecordId = sourceRecordId;
  payload.revision = 1;
  if (typeof payload.sentAt === "string") payload.sentAt = shiftedTimestamp(payload.sentAt, shift);
  setScalarPayloadValue(payload, "eResponse.03", callNumber);
  setScalarPayloadValue(payload, "eResponse.04", `${callNumber}-1`);
  ensurePayloadElement(payload, "eDispatchSection", {
    id: "eDispatch.05",
    values: [{ kind: "coded", occurrenceId: "synthetic-dispatch-priority", code: "2305003", display: "Emergent" }],
  });
  ensurePayloadElement(payload, "eSceneSection", {
    id: "eScene.11",
    values: [{ kind: "scalar", occurrenceId: "synthetic-scene-gps", value: "40.750600,-73.997200" }],
  });
  for (const element of records(payload.groups).flatMap((group) => records(group.instances))
    .flatMap((instance) => records(instance.elements)).filter((element) =>
      typeof element.id === "string" && element.id.startsWith("eTimes."))) {
    for (const value of records(element.values)) {
      if (typeof value.value === "string" && Number.isFinite(Date.parse(value.value))) {
        value.value = shiftedTimestamp(value.value, shift);
      }
    }
  }
  return payload;
}

function assignedCall(row: AssignedCallRow): AssignedCall {
  return {
    id: row.id,
    callNumber: row.call_number,
    unit: { id: row.unit_id, callSign: row.call_sign },
    dispatchedAt: new Date(row.dispatched_at).toISOString(),
    dispatchReason: row.dispatch_reason,
    dispatchPriority: row.dispatch_priority_code ? {
      code: row.dispatch_priority_code,
      display: row.dispatch_priority_display ?? row.dispatch_priority_code,
    } : null,
    chiefComplaint: row.chief_complaint,
    ...(row.agency_time_zone ? { agencyTimeZone: row.agency_time_zone } : {}),
    status: "assigned"
  };
}

export function shouldCreateSampleReplacement(
  syntheticAssignment: boolean,
  settings: InstallationSettings = selectedInstallationSettings(),
): boolean {
  return syntheticAssignment && settings.sampleDispatchAssignment.enabled;
}

@Injectable()
export class AssignedCallsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async list(accessToken: string, now = new Date()): Promise<AssignedCallsResponse> {
    const session = await this.sessions.get(accessToken, now);
    const rows = await this.dataSource.query<AssignedCallRow[]>(`
      select ca.id, ca.call_number, ou.id as unit_id, ou.call_sign,
             organization.deployment_timezone as agency_time_zone,
             ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint, ca.status,
             jsonb_path_query_first(dr.source_payload,
               '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'code'
               as dispatch_priority_code,
             jsonb_path_query_first(dr.source_payload,
               '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'display'
               as dispatch_priority_display
      from app_identity.unit_clinician uc
      join app_identity.operational_unit ou
        on ou.organization_id = uc.organization_id and ou.id = uc.unit_id
      join app_identity.organization organization on organization.id = ou.organization_id
      join clinical.call_assignment ca
        on ca.organization_id = ou.organization_id and ca.unit_id = ou.id
      left join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
      where uc.user_id = $1 and uc.organization_id = $2 and ou.active
        and ca.status in ('assigned', 'canceled')
      order by ca.dispatched_at desc, ca.id
    `, [session.user.id, session.organization.id]);

    return {
      assignedCalls: rows.filter((row) => row.status === "assigned").map(assignedCall),
      canceledAssignmentIds: rows.filter((row) => row.status === "canceled").map((row) => row.id),
      refreshedAt: now.toISOString()
    };
  }

  async open(accessToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
    const session = await this.sessions.get(accessToken);
    try {
      const opened = await this.dataSource.transaction(async (manager) => {
        const assignments = await manager.query<OpenableAssignmentRow[]>(`
          select ca.id, ca.organization_id, ca.unit_id, ca.incident_id, ca.call_number,
                 organization.deployment_timezone as agency_time_zone,
                 ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint, ca.status,
                 ca.report_id, ca.synthetic, ca.dispatch_receipt_id, ou.call_sign
          from clinical.call_assignment ca
          join app_identity.operational_unit ou
            on ou.organization_id = ca.organization_id and ou.id = ca.unit_id
          join app_identity.organization organization on organization.id = ca.organization_id
          where ca.id = $1 and ca.organization_id = $2 and ou.active
            and exists (
              select 1 from app_identity.unit_clinician uc
              where uc.organization_id = ca.organization_id and uc.unit_id = ca.unit_id
                and uc.user_id = $3
            )
          for update of ca
        `, [assignmentId, session.organization.id, session.user.id]);
        const assignment = assignments[0];
        if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} was not found`);
        if (assignment.status === "canceled") throw new ConflictException("The assignment was canceled before it could be opened");
        if (assignment.status === "opened") {
          if (!assignment.report_id) throw new ConflictException("The opened assignment has no report");
          return { assignment, reportId: assignment.report_id, replacement: null };
        }

        const versions = await manager.query<Array<{ id: string; catalog_release_id: string }>>(`
          select fv.id, fv.catalog_release_id
          from forms.form_version fv
          join forms.form f on f.id = fv.form_id
          join forms.agency_stationary_default active on active.form_version_id = fv.id
            and active.organization_id = f.organization_id
          where f.organization_id = $1 and fv.status = 'published'
          limit 1
        `, [session.organization.id]);
        const version = versions[0];
        if (!version) throw new ConflictException("The agency Stationary default is unavailable");

        const agencyVersions = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.agency_demographic_version
          where organization_id = $1 and catalog_release_id = $2 and effective_from <= now()
          order by version desc limit 1
        `, [session.organization.id, version.catalog_release_id]);
        const agencyVersion = agencyVersions[0];
        if (!agencyVersion) throw new ConflictException("No compatible agency demographics are available");

        const patientId = randomUUID();
        const reportId = randomUUID();
        const patientKeyConfig = patientKeyConfigFromEnvironment(process.env);
        const patientKey = derivePatientKey(patientKeyConfig, session.organization.id, patientId);
        await manager.query(`
          insert into clinical.patient
            (id, organization_id, identity_state, pseudonymous_key, pseudonymous_key_version)
          values ($1, $2, 'unknown', $3, $4)
        `, [patientId, session.organization.id, patientKey, patientKeyConfig.keyVersion]);
        await manager.query(`
          insert into clinical.report
            (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
             form_version_id, catalog_release_id, documenting_user_id, synthetic)
          values ($1, $2, $3, $4, $5, $6, $7, $8, true)
        `, [reportId, session.organization.id, assignment.incident_id, patientId, agencyVersion.id,
          version.id, version.catalog_release_id, session.user.id]);
        const receipts = assignment.dispatch_receipt_id
          ? await manager.query<Array<{ source_payload: Record<string, unknown> }>>(`
              select source_payload from clinical.dispatch_receipt
              where id = $1 and organization_id = $2
            `, [assignment.dispatch_receipt_id, session.organization.id])
          : [];
        await seedDispatchEncounter(manager, reportId, version.catalog_release_id, session.user.id,
          receipts[0]?.source_payload ?? null, `PCR-${reportId}`);
        await manager.query(`
          update clinical.call_assignment
          set status = 'opened', report_id = $2, updated_at = now()
          where id = $1
        `, [assignment.id, reportId]);

        const replacement = shouldCreateSampleReplacement(assignment.synthetic)
          ? await this.createReplacement(manager, assignment)
          : null;
        return { assignment, reportId, replacement };
      });
      return await this.openResult(opened.assignment, opened.reportId, session.user.id, opened.replacement);
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
    if (typeof error === "object" && error !== null && "code" in error &&
        ["23503", "23505", "23514", "23P01", "40001", "40P01"].includes(String(error.code))) {
      throw new ConflictException("The call-opening command conflicts with existing clinical data");
    }
    throw error;
  }

  private async createReplacement(manager: EntityManager, source: OpenableAssignmentRow): Promise<AssignedCall> {
    let callNumber = nextCallNumber(source.call_number);
    const incidentId = randomUUID();
    const assignmentId = randomUUID();
    let dispatchedAt = new Date(new Date(source.dispatched_at).getTime() + 15 * 60 * 1_000);
    const sourceReceipts = source.dispatch_receipt_id
      ? await manager.query<SyntheticReceiptRow[]>(`
          select source_id, source_payload from clinical.dispatch_receipt
          where id = $1 and organization_id = $2
        `, [source.dispatch_receipt_id, source.organization_id])
      : [];
    const sourceReceipt = sourceReceipts[0];
    let sourceRecordId = sourceReceipt
      ? nextCallNumber(String(sourceReceipt.source_payload.sourceRecordId))
      : syntheticSourceRecordId(callNumber);
    const priorReceipts = await manager.query<Array<{ source_record_id: string }>>(`
      select source_record_id from clinical.dispatch_receipt
      where organization_id = $1 and source_id = $2
    `, [source.organization_id, sourceReceipt?.source_id ?? "synthetic-generator"]);
    const occupiedSourceRecords = new Set(priorReceipts.map(({ source_record_id }) => source_record_id));
    while (occupiedSourceRecords.has(sourceRecordId)) {
      callNumber = nextCallNumber(callNumber);
      sourceRecordId = nextCallNumber(sourceRecordId);
      dispatchedAt = new Date(dispatchedAt.getTime() + 15 * 60 * 1_000);
    }

    let receiptId: string;
    let payload: Record<string, unknown>;
    while (true) {
      receiptId = randomUUID();
      payload = syntheticReplacementPayload(
        randomSyntheticDispatchPayload(), callNumber, dispatchedAt, randomUUID(), sourceRecordId,
      );
      const insertedReceipts = await manager.query<Array<{ id: string }>>(`
        insert into clinical.dispatch_receipt
          (id, organization_id, source_id, message_id, source_record_id, source_revision,
           source_bytes, source_payload, status, result)
        values ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, 'applied', $8::jsonb)
        on conflict (organization_id, source_id, source_record_id, source_revision) do nothing
        returning id
      `, [receiptId, source.organization_id, sourceReceipt?.source_id ?? "synthetic-generator", payload.messageId,
        payload.sourceRecordId, Buffer.from(JSON.stringify(payload), "utf8"), JSON.stringify(payload), JSON.stringify({
          synthetic: true, generatedFromAssignmentId: source.id
        })]);
      if (insertedReceipts.length > 0) break;
      callNumber = nextCallNumber(callNumber);
      sourceRecordId = nextCallNumber(sourceRecordId);
      dispatchedAt = new Date(dispatchedAt.getTime() + 15 * 60 * 1_000);
    }
    const dispatchReason = records(payloadElement(payload, "eDispatch.01")?.values)[0]?.display;
    const generatedDispatchReason = typeof dispatchReason === "string" ? dispatchReason : source.dispatch_reason;
    const priority = records(payloadElement(payload, "eDispatch.05")?.values)[0];
    const priorityCode = typeof priority?.code === "string" ? priority.code : null;
    const priorityDisplay = typeof priority?.display === "string" ? priority.display : priorityCode;
    await manager.query(`
      insert into clinical.incident
        (id, organization_id, operational_state, dispatch_provenance, synthetic)
      values ($1, $2, 'assigned', $3::jsonb, true)
    `, [incidentId, source.organization_id, JSON.stringify({
      fixture: "open-triage-synthetic-assignment-v1",
      synthetic: true,
      callNumber,
      dispatchedAt: dispatchedAt.toISOString()
    })]);
    await manager.query(`
      insert into clinical.call_assignment
        (id, organization_id, unit_id, incident_id, call_number, dispatched_at,
         dispatch_reason, chief_complaint, dispatch_source_id, dispatch_source_record_id,
         dispatch_revision, response_number, vehicle_number, dispatch_receipt_id, status, synthetic)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'assigned', true)
    `, [assignmentId, source.organization_id, source.unit_id, incidentId, callNumber,
      dispatchedAt.toISOString(), generatedDispatchReason, source.chief_complaint,
      sourceReceipt?.source_id ?? "synthetic-generator", payload.sourceRecordId, 1,
      scalarPayloadValue(payload, "eResponse.04"),
      scalarPayloadValue(payload, "eResponse.13"), receiptId]);
    return assignedCall({
      id: assignmentId,
      call_number: callNumber,
      unit_id: source.unit_id,
      call_sign: source.call_sign,
      dispatched_at: dispatchedAt,
      dispatch_reason: generatedDispatchReason,
      dispatch_priority_code: priorityCode,
      dispatch_priority_display: priorityDisplay,
      chief_complaint: source.chief_complaint,
      agency_time_zone: source.agency_time_zone,
      status: "assigned"
    });
  }

  private async openResult(
    assignment: OpenableAssignmentRow,
    reportId: string,
    documentingUserId: string,
    replacementAssignment: AssignedCall | null
  ): Promise<OpenAssignmentResponse> {
    const reports = await this.dataSource.query<ReportRow[]>(`
      select id, documenting_user_id, form_version_id, catalog_release_id, revision, status,
             dispatch_canceled_at, dispatch_cancellation_revision, dispatch_cancellation_receipt_id
      from clinical.report where id = $1 and organization_id = $2 and documenting_user_id = $3
    `, [reportId, assignment.organization_id, documentingUserId]);
    const report = reports[0];
    if (!report) throw new NotFoundException(`Assignment ${assignment.id} is not open for this clinician`);
    if (report.status !== "draft") throw new ConflictException("The assignment report is no longer an open draft");
    // These immutable/read-only projections are independent. Loading them after commit both
    // shortens the assignment lock and lets the connection pool overlap their database waits.
    const [document, conflicts, clinicalForm] = await Promise.all([
      encounterDocument(this.dataSource, report.id),
      dispatchConflicts(this.dataSource, report.id),
      clinicalFormConfiguration(this.dataSource, report.form_version_id, report.catalog_release_id),
    ]);
    return {
      assignmentId: assignment.id,
      report: {
        id: report.id,
        documentingUserId: report.documenting_user_id,
        formVersionId: report.form_version_id,
        catalogReleaseId: report.catalog_release_id,
        clinicalForm,
        revision: Number(report.revision),
        status: "draft",
        document,
        ...(assignment.agency_time_zone ? { agencyTimeZone: assignment.agency_time_zone } : {}),
        dispatchConflicts: conflicts,
        ...(cancellation(report) ? { dispatchCancellation: cancellation(report) } : {})
      },
      replacementAssignment
    };
  }
}
