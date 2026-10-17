import { ServiceUnavailableException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { reviewOrganizations, type ReviewScope } from "./review-scope.js";
import type { AnalyticsCatalogCountsRequest, AnalyticsDefinition, ReviewAnalysisDefinition, ReviewVolumeDefinition, ReviewWorkloadDefinition } from "@open-triage/contracts";

export type AnalyticsAuditInput = {
  surface: "analytics" | "review.analysis" | "review.volume" | "review.workload";
  operation: "query" | "counts" | "elements" | "values" | "export.aggregate" | "export.records";
  dataset: "real" | "synthetic";
  from?: string;
  through?: string;
  // Constructed from validated definitions, never arbitrary HTTP bodies or headers.
  request: {
    definition?: AnalyticsDefinition | ReviewAnalysisDefinition | ReviewVolumeDefinition | ReviewWorkloadDefinition;
    selection?: AnalyticsCatalogCountsRequest["selection"];
    search?: string; page?: number; purpose?: string | null; element?: string;
    kind?: "aggregate" | "records"; expectedRevision?: string;
  };
  // Undefined denotes catalog discovery, which has no enumerated report population.
  reportIds?: readonly string[];
};

/** Persist on the primary, never the optional read-only reporting replica, before releasing results. */
export async function recordAnalyticsAccess(primary: DataSource, scope: ReviewScope, input: AnalyticsAuditInput): Promise<void> {
  const reportIds = input.reportIds ? [...new Set(input.reportIds)] : undefined;
  await primary.transaction("REPEATABLE READ", async (manager) => {
    await manager.query("select set_config('open_triage.audit_organization_id', $1, true)", [scope.organizationId]);
    const [event] = mutationRows<{ id: string }>(await manager.query(`insert into clinical_audit.analytics_access_event
      (organization_id,actor_id,surface,operation,dataset,from_date,through_date,report_scope,identifying,scoped_organization_ids,report_count,query_payload)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) returning id`, [scope.organizationId, scope.userId,
      input.surface, input.operation, input.dataset, input.from ?? null, input.through ?? null,
      scope.reports, scope.identifying, reviewOrganizations(scope), reportIds?.length ?? null,
      input.request ? JSON.stringify(input.request) : null]));
    if (!event?.id) throw new ServiceUnavailableException({ code: "audit.unavailable" });
    if (!reportIds?.length) return;
    const [written] = await manager.query<Array<{ recorded: number }>>(`with recorded_access as (
      insert into clinical_audit.patient_access_event
        (organization_id,access_organization_id,actor_id,patient_id,report_id,action,care_process,resource_id,synthetic)
      select r.organization_id,$1,$2,r.patient_id,r.id,$3,'analytics',$4,r.synthetic
      from clinical.report r where r.id=any($5::uuid[]) and r.organization_id=any($6::uuid[])
        and r.synthetic=$7 and ($8::boolean or r.documenting_user_id=$2)
      returning 1
    ) select count(*)::integer recorded from recorded_access`, [scope.organizationId, scope.userId,
      input.operation.startsWith("export.") ? `analytics.${input.operation}` : "analytics.query",
      event.id, reportIds, reviewOrganizations(scope), input.dataset === "synthetic", scope.reports === "all"]);
    if (written?.recorded !== reportIds.length) throw new ServiceUnavailableException({ code: "audit.unavailable" });
  });
}
