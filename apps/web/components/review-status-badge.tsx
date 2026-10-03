import type { ReviewQueueItem } from "@open-triage/contracts";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function ReviewStatusBadge({ item, language }: {
  item: Pick<ReviewQueueItem, "status"> & Partial<Pick<ReviewQueueItem, "reopened">>;
  language: AgencyLanguage;
}) {
  const key = item.status === "in-review" ? "inReview" : item.status === "awaiting-clinician" ? "awaitingClinician" : item.status;
  return <span className={`review-badge status-${item.status}`}>
    {resolveMessage(language, `review.${key}`)}
    {item.reopened && ` · ${resolveMessage(language, "review.reopened")}`}
  </span>;
}
