import { ServiceUnavailableException } from "@nestjs/common";
import type { EntityManager } from "typeorm";

export type PatientAccessAction = "eps.read" | "eps.import" | "eps.export" | "eps.submit" | "report.read" | "report.reopen" | "report.active"
  | "report.list" | "assignment.open" | "review.report" | "review.overdue"
  | "photo.read" | "audio.read" | "audit.clinical-values";

/** Call after authorization, in the transaction preparing the response. Never pass payloads or tokens. */
export async function recordPatientAccess(
  manager: Pick<EntityManager, "query">,
  input: {
    organizationId: string;
    actorId: string;
    accessOrganizationId?: string;
    reportIds: readonly string[];
    action: PatientAccessAction;
    careProcess: "documentation" | "review" | "audit";
    resourceId?: string;
    integrationProvenance?: { configurationRevision: number; mappingId: string; mappingRevision: number; mappingSha256: string; decision?: string; importId?: string };
  },
): Promise<void> {
  const reportIds = [...new Set(input.reportIds)];
  if (!reportIds.length) return;
  // Resolve patient/tenant identities from the authorized server-side records.
  // A missing target must never silently produce an unaudited response.
  const [result] = await manager.query<Array<{ recorded: number }>>(`
    with recorded_access as (
      insert into clinical_audit.patient_access_event
        (organization_id, access_organization_id, actor_id, patient_id, report_id,
         action, care_process, resource_id, synthetic, integration_provenance)
      select r.organization_id, $3::uuid, $2::uuid, r.patient_id, r.id,
             $5, $6, $7::uuid, r.synthetic, $8::jsonb
      from clinical.report r
      where r.organization_id = $1 and r.id = any($4::uuid[])
      returning 1
    ) select count(*)::integer as recorded from recorded_access
  `, [input.organizationId, input.actorId, input.accessOrganizationId ?? input.organizationId,
    reportIds, input.action, input.careProcess, input.resourceId ?? null, input.integrationProvenance ? JSON.stringify(input.integrationProvenance) : null]);
  if (result?.recorded !== reportIds.length) {
    throw new ServiceUnavailableException({ code: "audit.unavailable" });
  }
}
