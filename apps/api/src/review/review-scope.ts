import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { ClinicianSession } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

export type ReviewScope = Readonly<{
  organizationId: string;
  organizationIds?: string[];
  organizationNames?: Record<string, string>;
  userId: string;
  reports: "own" | "all";
  identifying: boolean;
  administrator: boolean;
  defaultDataset: "real" | "synthetic";
}>;

/** Shared, request-time authorization boundary for Review reads and commands. */
export function reviewScope(session: ClinicianSession): ReviewScope {
  const capabilities = new Set(session.capabilities ?? []);
  // Defense in depth for sessions carrying broad capabilities: installation
  // authority must never widen a clinician's patient-data scope.
  if (session.installationOwner || session.installationSuperadmin) {
    capabilities.delete("review:all");
    capabilities.delete("review:admin");
    capabilities.delete("review:identifying");
  }
  const reports = capabilities.has("review:all") ? "all" : capabilities.has("review:self") ? "own" : null;
  if (!reports) throw new ForbiddenException("Review report access is required");
  return {
    organizationId: session.organization.id,
    ...(session.agencies ? { organizationIds: session.agencies.filter((agency) =>
      agency.id === session.organization.id || agency.parentOrganizationId === session.organization.id).map((agency) => agency.id),
      organizationNames: Object.fromEntries(session.agencies.map((agency) => [agency.id, agency.name])) } : {}),
    userId: session.user.id,
    reports,
    identifying: capabilities.has("review:identifying"),
    administrator: capabilities.has("review:admin") && reports === "all",
    defaultDataset: capabilities.has("clinical:demo") ? "synthetic" : "real",
  };
}

export const reviewOrganizations = (scope: ReviewScope): string[] => scope.organizationIds ?? [scope.organizationId];

/** A parent queue can open a child's record; writes stay in that record's agency. */
export async function reviewTargetScope(database: Pick<EntityManager, "query">, scope: ReviewScope,
  id: string | undefined, kind: "report" | "item" = "item"): Promise<ReviewScope> {
  if (!id || reviewOrganizations(scope).length < 2) return scope;
  const table = kind === "report" ? "clinical.report" : "clinical.review_item";
  const [row] = await database.query<Array<{ organization_id: string }>>(`select organization_id from ${table}
    where id=$1 and organization_id=any($2::uuid[])`, [id, reviewOrganizations(scope)]);
  if (!row) throw new NotFoundException("Review record was not found in scope");
  return { ...scope, organizationId: row.organization_id };
}
