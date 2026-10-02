import { ForbiddenException } from "@nestjs/common";
import type { ClinicianSession } from "@open-triage/contracts";

export type ReviewScope = Readonly<{
  organizationId: string;
  userId: string;
  reports: "own" | "all";
  identifying: boolean;
  administrator: boolean;
  defaultDataset: "real" | "synthetic";
}>;

/** Shared, request-time authorization boundary for Review reads and commands. */
export function reviewScope(session: ClinicianSession): ReviewScope {
  const capabilities = new Set(session.capabilities ?? []);
  const reports = capabilities.has("review:all") ? "all" : capabilities.has("review:self") ? "own" : null;
  if (!reports) throw new ForbiddenException("Review report access is required");
  return {
    organizationId: session.organization.id,
    userId: session.user.id,
    reports,
    identifying: capabilities.has("review:identifying"),
    administrator: capabilities.has("review:admin") && reports === "all",
    defaultDataset: capabilities.has("clinical:demo") ? "synthetic" : "real",
  };
}
