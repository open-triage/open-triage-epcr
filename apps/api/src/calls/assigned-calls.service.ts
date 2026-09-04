import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AssignedCall, AssignedCallsResponse, OpenAssignmentResponse } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { dispatchConflicts, encounterDocument, seedDispatchEncounter } from "../reports/encounter-document.persistence.js";

type AssignedCallRow = {
  id: string;
  call_number: string;
  unit_id: string;
  call_sign: string;
  dispatched_at: Date | string;
  dispatch_reason: string | null;
  chief_complaint: string | null;
  status: "assigned" | "opened" | "canceled";
};

type OpenableAssignmentRow = AssignedCallRow & {
  organization_id: string;
  incident_id: string;
  report_id: string | null;
  synthetic: boolean;
  default_form_id: string;
  dispatch_receipt_id: string | null;
};

type ReportRow = {
  id: string;
  documenting_user_id: string;
  form_version_id: string;
  catalog_release_id: string;
  revision: string | number;
  status: "draft" | "signed";
};

function nextCallNumber(callNumber: string): string {
  const match = /^(.*?)(\d+)$/.exec(callNumber);
  if (!match) return `${callNumber}-002`;
  return `${match[1]!}${String(Number(match[2]!) + 1).padStart(match[2]!.length, "0")}`;
}

function assignedCall(row: AssignedCallRow): AssignedCall {
  return {
    id: row.id,
    callNumber: row.call_number,
    unit: { id: row.unit_id, callSign: row.call_sign },
    dispatchedAt: new Date(row.dispatched_at).toISOString(),
    dispatchReason: row.dispatch_reason,
    chiefComplaint: row.chief_complaint,
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
    const session = this.sessions.get(accessToken, now);
    const rows = await this.dataSource.query<AssignedCallRow[]>(`
      select ca.id, ca.call_number, ou.id as unit_id, ou.call_sign,
             ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint, ca.status
      from app_identity.unit_clinician uc
      join app_identity.operational_unit ou
        on ou.organization_id = uc.organization_id and ou.id = uc.unit_id
      join clinical.call_assignment ca
        on ca.organization_id = ou.organization_id and ca.unit_id = ou.id
      where uc.user_id = $1 and uc.organization_id = $2 and ou.active
        and ca.status in ('assigned', 'canceled')
      order by ca.dispatched_at desc, ca.id
    `, [session.user.id, session.organization.id]);

    return {
      assignedCalls: rows.filter((row) => row.status === "assigned").map((row) => ({
        id: row.id,
        callNumber: row.call_number,
        unit: { id: row.unit_id, callSign: row.call_sign },
        dispatchedAt: new Date(row.dispatched_at).toISOString(),
        dispatchReason: row.dispatch_reason,
        chiefComplaint: row.chief_complaint,
        status: "assigned"
      })),
      canceledAssignmentIds: rows.filter((row) => row.status === "canceled").map((row) => row.id),
      refreshedAt: now.toISOString()
    };
  }

  async open(accessToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
    const session = this.sessions.get(accessToken);
    return this.dataSource.transaction(async (manager) => {
      const assignments = await manager.query<OpenableAssignmentRow[]>(`
        select ca.id, ca.organization_id, ca.unit_id, ca.incident_id, ca.call_number,
               ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint, ca.status,
               ca.report_id, ca.synthetic, ca.dispatch_receipt_id, ou.call_sign, ou.default_form_id
        from clinical.call_assignment ca
        join app_identity.operational_unit ou
          on ou.organization_id = ca.organization_id and ou.id = ca.unit_id
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
        return this.openResult(manager, assignment, assignment.report_id, session.user.id, null);
      }

      const versions = await manager.query<Array<{ id: string; catalog_release_id: string }>>(`
        select fv.id, fv.catalog_release_id
        from forms.form_version fv
        join forms.form f on f.id = fv.form_id
        where fv.form_id = $1 and f.organization_id = $2 and fv.status = 'published'
        order by fv.version desc
        limit 1
      `, [assignment.default_form_id, session.organization.id]);
      const version = versions[0];
      if (!version) throw new ConflictException("The unit default form has no published version");

      const agencyVersions = await manager.query<Array<{ id: string }>>(`
        select id from app_identity.agency_demographic_version
        where organization_id = $1 and catalog_release_id = $2 and effective_from <= now()
        order by version desc limit 1
      `, [session.organization.id, version.catalog_release_id]);
      const agencyVersion = agencyVersions[0];
      if (!agencyVersion) throw new ConflictException("No compatible agency demographics are available");

      const patientId = randomUUID();
      const reportId = randomUUID();
      const patientKey = createHash("sha256").update(`synthetic-assignment:${assignment.id}`).digest("hex");
      await manager.query(`
        insert into clinical.patient
          (id, organization_id, identity_state, pseudonymous_key)
        values ($1, $2, 'unknown', $3)
      `, [patientId, session.organization.id, patientKey]);
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

      const replacement = assignment.synthetic
        ? await this.createReplacement(manager, assignment)
        : null;
      return this.openResult(manager, assignment, reportId, session.user.id, replacement);
    });
  }

  private async createReplacement(manager: EntityManager, source: OpenableAssignmentRow): Promise<AssignedCall> {
    const incidentId = randomUUID();
    const assignmentId = randomUUID();
    const dispatchedAt = new Date(new Date(source.dispatched_at).getTime() + 15 * 60 * 1_000);
    const callNumber = nextCallNumber(source.call_number);
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
         dispatch_reason, chief_complaint, status, synthetic)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'assigned', true)
    `, [assignmentId, source.organization_id, source.unit_id, incidentId, callNumber,
      dispatchedAt.toISOString(), source.dispatch_reason, source.chief_complaint]);
    return assignedCall({
      id: assignmentId,
      call_number: callNumber,
      unit_id: source.unit_id,
      call_sign: source.call_sign,
      dispatched_at: dispatchedAt,
      dispatch_reason: source.dispatch_reason,
      chief_complaint: source.chief_complaint,
      status: "assigned"
    });
  }

  private async openResult(
    manager: EntityManager,
    assignment: OpenableAssignmentRow,
    reportId: string,
    documentingUserId: string,
    replacementAssignment: AssignedCall | null
  ): Promise<OpenAssignmentResponse> {
    const reports = await manager.query<ReportRow[]>(`
      select id, documenting_user_id, form_version_id, catalog_release_id, revision, status
      from clinical.report where id = $1 and organization_id = $2 and documenting_user_id = $3
    `, [reportId, assignment.organization_id, documentingUserId]);
    const report = reports[0];
    if (!report) throw new NotFoundException(`Assignment ${assignment.id} is not open for this clinician`);
    if (report.status !== "draft") throw new ConflictException("The assignment report is no longer an open draft");
    const document = await encounterDocument(manager, report.id);
    const conflicts = await dispatchConflicts(manager, report.id);
    return {
      assignmentId: assignment.id,
      report: {
        id: report.id,
        documentingUserId: report.documenting_user_id,
        formVersionId: report.form_version_id,
        catalogReleaseId: report.catalog_release_id,
        revision: Number(report.revision),
        status: "draft",
        document,
        dispatchConflicts: conflicts
      },
      replacementAssignment
    };
  }
}
