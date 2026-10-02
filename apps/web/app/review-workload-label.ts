import type { ReviewWorkloadDefinition } from "@open-triage/contracts";
import { resolveMessage, type AgencyLanguage } from "./localization";

const ageLabels: Record<string, string> = {
  "0-1 days": "review.workloadAge.0-1",
  "2-7 days": "review.workloadAge.2-7",
  "8-30 days": "review.workloadAge.8-30",
  "31+ days": "review.workloadAge.31-plus",
};
const durationLabels: Record<string, string> = {
  "not completed": "review.workloadDuration.not-completed",
  "under 1 hour": "review.workloadDuration.under-1-hour",
  "1-24 hours": "review.workloadDuration.1-24-hours",
  "1-7 days": "review.workloadDuration.1-7-days",
  "over 7 days": "review.workloadDuration.over-7-days",
};

/** Keep aggregate keys and CSV values stable while translating the visible grouping. */
export function reviewWorkloadLabel(language: AgencyLanguage,
  groupBy: ReviewWorkloadDefinition["groupBy"], key: string): string {
  const messageKey = groupBy === "age" ? ageLabels[key]
    : groupBy === "completion-duration" ? durationLabels[key]
    : groupBy === "exception-reason" ? key === "no exception"
      ? "review.workloadNoException"
      : ["duplicate-follow-up", "report-not-required", "administrative-exception"].includes(key)
        ? `review.exception.${key}` : undefined
    : groupBy === "criterion" && key === "overdue-unsigned" ? "review.overdueUnsigned"
    : undefined;
  return messageKey ? resolveMessage(language, messageKey) : key;
}
