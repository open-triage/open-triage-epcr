import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  AssignedCall,
  AssignedCallsResponse,
  GenerateSyntheticCallResponse,
  OpenAssignmentResponse,
  SyntheticCallGenerationContext,
} from "@open-triage/contracts";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { clinicalFormConfiguration } from "../forms/clinical-form-configuration.js";
import { dispatchConflicts, encounterDocument, seedDispatchEncounter } from "../reports/encounter-document.persistence.js";
import { withReportSnapshot } from "../reports/report-snapshot.js";
import { randomSyntheticDispatchPayload } from "./synthetic-dispatch-payloads.js";

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
  expires_at: Date | string | null;
  status: "assigned" | "opened" | "canceled";
};

type OpenableAssignmentRow = AssignedCallRow & {
  organization_id: string;
  incident_id: string;
  report_id: string | null;
  synthetic: boolean;
  synthetic_generated_by: string | null;
  dispatch_receipt_id: string | null;
};

type EligibleUnitRow = {
  id: string;
  call_sign: string;
  name: string;
  agency_time_zone: string;
};

type ReportRow = {
  id: string;
  documenting_user_id: string;
  form_version_id: string;
  catalog_release_id: string;
  validation_version_id: string | null;
  validation_compiled_sha256: string | null;
  revision: string | number;
  status: "draft" | "signed";
  synthetic: boolean;
  dispatch_canceled_at: Date | string | null;
  dispatch_cancellation_revision: string | number | null;
  dispatch_cancellation_receipt_id: string | null;
  expires_at: Date | string | null;
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
  let local = shifted.replace(/Z$/, "");
  if (!value.includes(".")) local = local.replace(/\.000$/, "");
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
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    status: "assigned"
  };
}

@Injectable()
export class AssignedCallsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async list(accessToken: string, now = new Date()): Promise<AssignedCallsResponse> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document", undefined, now);
    await this.dataSource.query("select retention.purge_expired_synthetic_records($1)", [now]);
    const rows = await this.dataSource.query<AssignedCallRow[]>(`
      select ca.id, ca.call_number, ou.id as unit_id, ou.call_sign,
             organization.deployment_timezone as agency_time_zone, ca.expires_at,
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
        and (ca.expires_at is null or ca.expires_at > $3)
      order by ca.dispatched_at desc, ca.id
    `, [session.user.id, session.organization.id, now]);

    return {
      assignedCalls: rows.filter((row) => row.status === "assigned").map(assignedCall),
      canceledAssignmentIds: rows.filter((row) => row.status === "canceled").map((row) => row.id),
      refreshedAt: now.toISOString()
    };
  }

  async syntheticGenerationContext(accessToken: string): Promise<SyntheticCallGenerationContext> {
    await this.sessions.requireCapability(accessToken, "clinical:document");
    const session = await this.sessions.requireCapability(accessToken, "clinical:demo");
    const [units, unopenedCalls] = await Promise.all([
      this.dataSource.query<EligibleUnitRow[]>(`
        select ou.id, ou.call_sign, ou.name, organization.deployment_timezone as agency_time_zone
        from app_identity.unit_clinician uc
        join app_identity.operational_unit ou
          on ou.organization_id = uc.organization_id and ou.id = uc.unit_id
        join app_identity.organization organization on organization.id = ou.organization_id
        where uc.user_id = $1 and uc.organization_id = $2 and ou.active
        order by ou.call_sign, ou.id
      `, [session.user.id, session.organization.id]),
      this.dataSource.query<Array<{ exists: boolean }>>(`select exists (
        select 1 from clinical.call_assignment
        where organization_id = $1 and synthetic_generated_by = $2
          and synthetic and status = 'assigned'
          and (expires_at is null or expires_at > clock_timestamp())
      )`, [session.organization.id, session.user.id]),
    ]);
    return {
      eligibleUnits: units.map((unit) => ({ id: unit.id, callSign: unit.call_sign, name: unit.name })),
      hasUnopenedCall: unopenedCalls[0]?.exists ?? false,
    };
  }

  async generateSynthetic(accessToken: string, csrfToken: string | undefined, unitId: string,
    now = new Date()): Promise<GenerateSyntheticCallResponse> {
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await this.sessions.assertCsrf(accessToken, csrfToken, manager);
        await this.sessions.requireCapability(accessToken, "clinical:document", manager, now);
        const session = await this.sessions.requireCapability(accessToken, "clinical:demo", manager, now);
        await manager.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `synthetic-call:${session.organization.id}:${session.user.id}:${unitId}`,
        ]);
        const units = await manager.query<EligibleUnitRow[]>(`
          select ou.id, ou.call_sign, ou.name, organization.deployment_timezone as agency_time_zone
          from app_identity.unit_clinician uc
          join app_identity.operational_unit ou
            on ou.organization_id = uc.organization_id and ou.id = uc.unit_id
          join app_identity.organization organization on organization.id = ou.organization_id
          where uc.user_id = $1 and uc.organization_id = $2 and ou.id = $3 and ou.active
        `, [session.user.id, session.organization.id, unitId]);
        const unit = units[0];
        if (!unit) throw new NotFoundException("The selected unit is not eligible for synthetic calls");
        const existing = await manager.query<AssignedCallRow[]>(`
          select ca.id, ca.call_number, ca.unit_id, ou.call_sign, ca.dispatched_at,
                 ca.dispatch_reason, ca.chief_complaint, ca.status,
                 organization.deployment_timezone as agency_time_zone, ca.expires_at,
                 jsonb_path_query_first(dr.source_payload,
                   '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'code'
                   as dispatch_priority_code,
                 jsonb_path_query_first(dr.source_payload,
                   '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'display'
                   as dispatch_priority_display
          from clinical.call_assignment ca
          join app_identity.operational_unit ou
            on ou.organization_id = ca.organization_id and ou.id = ca.unit_id
          join app_identity.organization organization on organization.id = ca.organization_id
          left join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
          where ca.organization_id = $1 and ca.synthetic_generated_by = $2
            and ca.unit_id = $3 and ca.synthetic and ca.status = 'assigned'
            and ca.expires_at > $4
          limit 1
        `, [session.organization.id, session.user.id, unit.id, now]);
        if (existing[0]) {
          await this.auditSyntheticGeneration(manager, session.organization.id, session.user.id,
            unit.id, existing[0].id, "synthetic_call.reuse", now);
          return { assignment: assignedCall(existing[0]), reused: true };
        }

        const assignment = await this.createSyntheticAssignment(manager, {
          organizationId: session.organization.id,
          userId: session.user.id,
          unit,
          now,
        });
        await this.auditSyntheticGeneration(manager, session.organization.id, session.user.id,
          unit.id, assignment.id, "synthetic_call.generate", now);
        return { assignment, reused: false };
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  async open(accessToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
    try {
      const opened = await this.dataSource.transaction(async (manager) => {
        const assignments = await manager.query<OpenableAssignmentRow[]>(`
          select ca.id, ca.organization_id, ca.unit_id, ca.incident_id, ca.call_number,
                 organization.deployment_timezone as agency_time_zone,
                 ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint, ca.status,
                 ca.report_id, ca.synthetic, ca.synthetic_generated_by, ca.dispatch_receipt_id,
                 ca.expires_at, ou.call_sign
          from clinical.call_assignment ca
          join app_identity.operational_unit ou
            on ou.organization_id = ca.organization_id and ou.id = ca.unit_id
          join app_identity.organization organization on organization.id = ca.organization_id
          where ca.id = $1 and ca.organization_id = $2 and ou.active
            and exists (
              select 1 from app_identity.unit_clinician uc
              where uc.organization_id = ca.organization_id and uc.unit_id = ca.unit_id
                and uc.user_id = $3
            ) and (ca.expires_at is null or ca.expires_at > clock_timestamp())
          for update of ca
        `, [assignmentId, session.organization.id, session.user.id]);
        const assignment = assignments[0];
        if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} was not found`);
        if (assignment.status === "canceled") throw new ConflictException("The assignment was canceled before it could be opened");
        if (assignment.status === "opened") {
          if (!assignment.report_id) throw new ConflictException("The opened assignment has no report");
          return { assignment, reportId: assignment.report_id, replacement: null };
        }

        const versions = await manager.query<Array<{ id: string; catalog_release_id: string; validation_version_id: string;
          form_definition_sha256: string; catalog_artifact_sha256: string; validation_compiled_sha256: string }>>(`
          select active.form_version_id as id,active.catalog_release_id,active.validation_version_id,
            active.form_definition_sha256,active.catalog_artifact_sha256,active.validation_compiled_sha256
          from app_identity.active_configuration_bundle active
          join forms.form_version fv on fv.id=active.form_version_id and fv.status='published'
          where active.organization_id = $1
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
             form_version_id, catalog_release_id, documenting_user_id, validation_version_id, synthetic,
             synthetic_generated_by, synthetic_source_assignment_id,form_definition_sha256,
             catalog_artifact_sha256,validation_compiled_sha256)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13, $14)
        `, [reportId, session.organization.id, assignment.incident_id, patientId, agencyVersion.id,
          version.id, version.catalog_release_id, session.user.id, version.validation_version_id,
          assignment.synthetic_generated_by, assignment.synthetic_generated_by ? assignment.id : null,
          version.form_definition_sha256,version.catalog_artifact_sha256,version.validation_compiled_sha256]);
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

        return { assignment, reportId, replacement: null };
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

  private async createSyntheticAssignment(manager: EntityManager, input: {
    organizationId: string;
    userId: string;
    unit: EligibleUnitRow;
    now: Date;
  }): Promise<AssignedCall> {
    const callNumber = `DEMO-${input.now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const incidentId = randomUUID();
    const assignmentId = randomUUID();
    const receiptId = randomUUID();
    const sourceRecordId = `SYNTHETIC-GENERATED-${randomUUID()}`;
    const payload = syntheticReplacementPayload(
      randomSyntheticDispatchPayload(), callNumber, input.now, randomUUID(), sourceRecordId,
    );
    await manager.query(`
      insert into clinical.dispatch_receipt
        (id, organization_id, source_id, message_id, source_record_id, source_revision,
         source_bytes, source_payload, status, result)
      values ($1, $2, 'clinical-demo-generator', $3, $4, 1, $5, $6::jsonb, 'applied', $7::jsonb)
    `, [receiptId, input.organizationId, payload.messageId, payload.sourceRecordId,
      Buffer.from(JSON.stringify(payload), "utf8"), JSON.stringify(payload), JSON.stringify({
        synthetic: true, generator: "clinical-demo",
      })]);
    const dispatchReason = records(payloadElement(payload, "eDispatch.01")?.values)[0]?.display;
    const generatedDispatchReason = typeof dispatchReason === "string" ? dispatchReason : null;
    const priority = records(payloadElement(payload, "eDispatch.05")?.values)[0];
    const priorityCode = typeof priority?.code === "string" ? priority.code : null;
    const priorityDisplay = typeof priority?.display === "string" ? priority.display : priorityCode;
    await manager.query(`
      insert into clinical.incident
        (id, organization_id, operational_state, dispatch_provenance, synthetic)
      values ($1, $2, 'assigned', $3::jsonb, true)
    `, [incidentId, input.organizationId, JSON.stringify({
      fixture: "open-triage-synthetic-assignment-v1",
      synthetic: true,
      callNumber,
      dispatchedAt: input.now.toISOString()
    })]);
    const inserted = mutationRows<{
      created_at: Date | string;
      expires_at: Date | string;
    }>(await manager.query(`
      insert into clinical.call_assignment
        (id, organization_id, unit_id, incident_id, call_number, dispatched_at,
         dispatch_reason, chief_complaint, dispatch_source_id, dispatch_source_record_id,
         dispatch_revision, response_number, vehicle_number, dispatch_receipt_id, status, synthetic,
         synthetic_generated_by)
      values ($1, $2, $3, $4, $5, $6, $7, null, 'clinical-demo-generator', $8, 1, $9, $10, $11,
              'assigned', true, $12)
      returning created_at, expires_at
    `, [assignmentId, input.organizationId, input.unit.id, incidentId, callNumber,
      input.now.toISOString(), generatedDispatchReason, payload.sourceRecordId,
      scalarPayloadValue(payload, "eResponse.04"),
      scalarPayloadValue(payload, "eResponse.13"), receiptId, input.userId]));
    if (!inserted[0]) throw new Error("Synthetic assignment lifecycle was not returned");
    return assignedCall({
      id: assignmentId,
      call_number: callNumber,
      unit_id: input.unit.id,
      call_sign: input.unit.call_sign,
      dispatched_at: input.now,
      dispatch_reason: generatedDispatchReason,
      dispatch_priority_code: priorityCode,
      dispatch_priority_display: priorityDisplay,
      chief_complaint: null,
      agency_time_zone: input.unit.agency_time_zone,
      expires_at: inserted[0].expires_at,
      status: "assigned"
    });
  }

  private async auditSyntheticGeneration(manager: EntityManager, organizationId: string, actorId: string,
    unitId: string, assignmentId: string, action: "synthetic_call.generate" | "synthetic_call.reuse",
    occurredAt: Date): Promise<void> {
    await manager.query(`insert into clinical_audit.synthetic_generation_event
      (organization_id, actor_id, unit_id, assignment_id, action, occurred_at)
      values ($1, $2, $3, $4, $5, $6)`,
    [organizationId, actorId, unitId, assignmentId, action, occurredAt]);
  }

  private async openResult(
    assignment: OpenableAssignmentRow,
    reportId: string,
    documentingUserId: string,
    replacementAssignment: AssignedCall | null
  ): Promise<OpenAssignmentResponse> {
    return withReportSnapshot(this.dataSource, async (manager) => {
      const reports = await manager.query<ReportRow[]>(`
        select id, documenting_user_id, form_version_id, catalog_release_id, validation_version_id,
               validation_compiled_sha256, revision, status, synthetic,
               expires_at,
               dispatch_canceled_at, dispatch_cancellation_revision, dispatch_cancellation_receipt_id
        from clinical.report where id = $1 and organization_id = $2 and documenting_user_id = $3
      `, [reportId, assignment.organization_id, documentingUserId]);
      const report = reports[0];
      if (!report) throw new NotFoundException(`Assignment ${assignment.id} is not open for this clinician`);
      if (report.status !== "draft") throw new ConflictException("The assignment report is no longer an open draft");
      const document = await encounterDocument(manager, report.id);
      const conflicts = await dispatchConflicts(manager, report.id);
      const clinicalForm = await clinicalFormConfiguration(manager, report.form_version_id, report.catalog_release_id,
        report.validation_version_id, report.validation_compiled_sha256);
      return {
        assignmentId: assignment.id,
        report: {
          id: report.id,
          documentingUserId: report.documenting_user_id,
          formVersionId: report.form_version_id,
          catalogReleaseId: report.catalog_release_id,
          ...(report.validation_version_id ? { validationVersionId: report.validation_version_id } : {}),
          clinicalForm,
          revision: Number(report.revision),
          status: "draft" as const,
          ...(report.synthetic && assignment.synthetic && assignment.synthetic_generated_by === documentingUserId
            ? { demoMutable: true } : {}),
          ...(report.expires_at ? { expiresAt: new Date(report.expires_at).toISOString() } : {}),
          document,
          ...(assignment.agency_time_zone ? { agencyTimeZone: assignment.agency_time_zone } : {}),
          dispatchConflicts: conflicts,
          ...(cancellation(report) ? { dispatchCancellation: cancellation(report) } : {})
        },
        replacementAssignment
      };
    });
  }
}
