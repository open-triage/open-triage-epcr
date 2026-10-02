"use client";

import type { ReviewWorkloadDefinition, ReviewWorkloadResult } from "@open-triage/contracts";
import { useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { ReviewAnalysisChart } from "./review-analysis-chart";
import { downloadReviewCsv } from "./review-csv-download";

const views: ReviewWorkloadDefinition["groupBy"][] = [
  "criterion", "priority", "status", "age", "completion-duration", "exception-reason",
];

export function ReviewWorkloadBuilder({ dataset, from, to, language, csrfToken }: {
  dataset: "real" | "synthetic"; from: string; to: string;
  language: AgencyLanguage; csrfToken: string;
}) {
  const [groupBy, setGroupBy] = useState<ReviewWorkloadDefinition["groupBy"]>("status");
  const [result, setResult] = useState<ReviewWorkloadResult | null>(null);
  const [error, setError] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const t = (key: string) => resolveMessage(language, key);
  const run = async () => {
    const url = apiRequestUrl("/api/review/workload");
    if (!url) return;
    setResult(null); setError(false); setExportNotice(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ groupBy, filters: { from, to, dataset } }) }));
      if (!response.ok) throw new Error(String(response.status));
      setResult(await response.json() as ReviewWorkloadResult);
    } catch { setError(true); }
  };
  const exportCsv = async (records = false) => {
    if (!result) return;
    setExportBusy(true); setExportNotice(null);
    const outcome = await downloadReviewCsv("workload", result, csrfToken, records);
    if (outcome.status === "refreshed") {
      setResult(outcome.result); setExportNotice(t("review.csvRefreshed"));
    } else if (outcome.status === "denied") {
      setResult(null); setExportNotice(t("review.csvDenied"));
    } else if (outcome.status === "error") setExportNotice(t("review.csvUnavailable"));
    setExportBusy(false);
  };
  return <section aria-labelledby="review-workload-heading">
    <h2 id="review-workload-heading">{t("review.workloadHeading")}</h2>
    <p>{t("review.workloadHelp")}</p>
    <div className="review-controls">
      <label>{t("review.workloadView")} <select value={groupBy} onChange={(event) => {
        setGroupBy(event.target.value as ReviewWorkloadDefinition["groupBy"]); setResult(null);
      }}>{views.map((view) => <option key={view} value={view}>{t(`review.workload.${view}`)}</option>)}</select></label>
      <button type="button" disabled={from > to} onClick={() => void run()}>{t("review.workloadRun")}</button>
    </div>
    {error && <p role="alert">{t("review.workloadUnavailable")}</p>}
    {exportNotice && <p role="alert">{exportNotice}</p>}
    {result && <>
      {result.exportRevision && <button type="button" disabled={exportBusy}
        onClick={() => void exportCsv()}>{t("review.csvDownload")}</button>}
      {result.exportRevision && <button type="button" disabled={exportBusy}
        onClick={() => void exportCsv(true)}>{t("review.csvRecordsDownload")}</button>}
      <p>{t("review.workloadItemUnit")}: {result.totalItems} · {t("review.workloadOpenUnsigned")}: {result.unsignedItems}
        {" · "}{t("review.workloadReopened")}: {result.reopenedItems}
        {" · "}{t("review.workloadExceptions")}: {result.exceptionallyClosedItems}</p>
      <p>{t("review.workloadFreshness")}: {new Intl.DateTimeFormat(language, {
        dateStyle: "medium", timeStyle: "short" }).format(new Date(result.freshness.observedAt))}</p>
      <ReviewAnalysisChart title={t("review.workloadChart")}
        values={result.groups.map((group) => ({ value: group.key === "overdue-unsigned"
          ? t("review.overdueUnsigned") : group.key, count: group.count }))} />
      <table><caption>{t(`review.workload.${result.definition.groupBy}`)}</caption><thead><tr>
        <th>{t("review.analysisValue")}</th><th>{t("review.workloadItemCount")}</th>
      </tr></thead><tbody>{result.groups.map((group) => <tr key={group.key}>
        <td>{group.key === "overdue-unsigned" ? t("review.overdueUnsigned") : group.key}</td>
        <td>{group.count}</td></tr>)}</tbody></table>
    </>}
  </section>;
}
