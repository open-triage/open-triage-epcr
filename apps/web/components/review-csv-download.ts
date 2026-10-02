import type { ReviewAnalysisResult, ReviewVolumeResult } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";

export type ReviewCsvResult<T> = { status: "downloaded" } | { status: "refreshed"; result: T } |
  { status: "denied" } | { status: "error" };

/** The API rechecks authorization and the exact aggregate before sending CSV. */
export async function downloadReviewCsv<T extends ReviewAnalysisResult | ReviewVolumeResult>(
  kind: "analysis" | "volume", result: T, csrfToken: string,
): Promise<ReviewCsvResult<T>> {
  const url = apiRequestUrl(`/api/review/${kind}/export`);
  if (!url || !result.exportRevision) return { status: "error" };
  try {
    const response = await fetch(url, browserRequestInit({ method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ definition: result.definition, expectedRevision: result.exportRevision }) }));
    // A previously displayed field can become undiscoverable after permission
    // loss; analysis validation then returns 400 for that old definition.
    if ([400, 401, 403].includes(response.status)) return { status: "denied" };
    if (response.status === 409) {
      const payload = await response.json() as { result?: T };
      return payload.result ? { status: "refreshed", result: payload.result } : { status: "error" };
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/csv"))
      return { status: "error" };
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = kind === "analysis" ? "review-analysis.csv" : "review-volume.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return { status: "downloaded" };
  } catch { return { status: "error" }; }
}
