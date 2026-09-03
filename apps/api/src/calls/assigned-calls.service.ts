import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AssignedCallsResponse } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type AssignedCallRow = {
  id: string;
  call_number: string;
  unit_id: string;
  call_sign: string;
  dispatched_at: Date | string;
  dispatch_reason: string | null;
  chief_complaint: string | null;
  status: "assigned" | "canceled";
};

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
}
