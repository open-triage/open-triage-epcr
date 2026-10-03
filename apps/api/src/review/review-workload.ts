import type { ReviewWorkloadDefinition, ReviewWorkloadResult } from "@open-triage/contracts";

export type WorkloadRow = { id: string; report_id: string; reporting_date: string | null;
  criterion_id: string; priority: string; status: string;
  kind: string; report_status: string; first_matched_at: Date | string; reopened: boolean;
  resolution_reason: string | null; exception_code: string | null;
  completion_at: Date | string | null; reopened_at: Date | string | null };

function bucket(value: number, boundaries: ReadonlyArray<[number, string]>, last: string): string {
  for (const [ceiling, label] of boundaries) if (value < ceiling) return label;
  return last;
}

/** Each durable item is counted once. A reopened item remains one item, while
 * completion duration measures the latest review cycle. */
export function reduceWorkload(rows: readonly WorkloadRow[], definition: ReviewWorkloadDefinition,
  scope: "own" | "all", organizationId: string, observedAt = new Date()): ReviewWorkloadResult {
  const groups = new Map<string, number>();
  let reopenedItems = 0;
  let unsignedItems = 0;
  let exceptionallyClosedItems = 0;
  const sources = new Map<string, NonNullable<ReviewWorkloadResult["sources"]>[number]>();
  for (const row of rows) {
    if (row.reopened) reopenedItems++;
    if (row.kind === "overdue-unsigned" && row.report_status === "draft") unsignedItems++;
    if (row.resolution_reason === "closed-exceptionally") exceptionallyClosedItems++;
    const first = new Date(row.first_matched_at).getTime();
    const completed = row.status === "completed" && row.completion_at
      ? new Date(row.completion_at).getTime() : null;
    const ageDays = Math.max(0, ((completed ?? observedAt.getTime()) - first) / 86400000);
    const cycleStart = row.reopened_at && completed !== null
      ? Math.max(first, new Date(row.reopened_at).getTime()) : first;
    const durationHours = completed === null ? null : Math.max(0, (completed - cycleStart) / 3600000);
    const key = definition.groupBy === "criterion" ? row.kind === "overdue-unsigned"
      ? "overdue-unsigned" : row.criterion_id
      : definition.groupBy === "priority" ? row.priority
      : definition.groupBy === "status" ? row.status
      : definition.groupBy === "age" ? bucket(ageDays,
        [[2, "0-1 days"], [8, "2-7 days"], [31, "8-30 days"]], "31+ days")
      : definition.groupBy === "completion-duration" ? durationHours === null ? "not completed"
        : bucket(durationHours, [[1, "under 1 hour"], [24, "1-24 hours"], [168, "1-7 days"]], "over 7 days")
      : row.exception_code ?? "no exception";
    groups.set(key, (groups.get(key) ?? 0) + 1);
    const report = sources.get(row.report_id) ?? { reportId: row.report_id,
      reportingDate: row.reporting_date, items: [] };
    report.items.push({ itemId: row.id, criterionId: row.kind === "criterion" ? row.criterion_id : null,
      group: key, priority: row.priority, status: row.status, kind: row.kind,
      firstMatchedAt: new Date(row.first_matched_at).toISOString(),
      completedAt: row.completion_at ? new Date(row.completion_at).toISOString() : null,
      reopened: row.reopened, resolutionReason: row.resolution_reason,
      exceptionCode: row.exception_code });
    sources.set(row.report_id, report);
  }
  return { definition, population: { unit: "review-item", scope, organizationId, includesUnsigned: true },
    freshness: { source: "operational-primary", observedAt: observedAt.toISOString() },
    totalItems: rows.length, reopenedItems, unsignedItems, exceptionallyClosedItems,
    groups: [...groups].map(([key, count]) => ({ key, count })).sort((a,b) => a.key.localeCompare(b.key)),
    sources: [...sources.values()].map((report) => ({ ...report,
      items: report.items.sort((a, b) => a.itemId.localeCompare(b.itemId)) }))
      .sort((a, b) => a.reportId.localeCompare(b.reportId)) };
}
