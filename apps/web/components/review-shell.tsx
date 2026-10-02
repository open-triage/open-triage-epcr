"use client";

import type { ClinicianSession, ReviewSignedReportsResponse } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function ReviewShell({ session, language, online }: {
  session: ClinicianSession;
  language: AgencyLanguage;
  online: boolean;
}) {
  const [dataset, setDataset] = useState<"real" | "synthetic">(
    session.capabilities?.includes("clinical:demo") ? "synthetic" : "real");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReviewSignedReportsResponse | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/reports?dataset=${dataset}&page=${page}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewSignedReportsResponse;
      if (!controller.signal.aborted) { setResult(next); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setResult(null); setError(true); } });
    return () => controller.abort();
  }, [dataset, online, page, refresh]);

  return <main className="review-shell" aria-labelledby="review-heading">
    <header className="review-heading">
      <div><p className="eyebrow">{t("review.online")}</p><h1 id="review-heading">{t("review.heading")}</h1></div>
      {online && <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("navigation.refresh")}</button>}
    </header>
    {!online ? <p role="status">{t("review.offline")}</p> : <>
      <div className="review-controls">
        <label>{t("review.dataset")}{" "}<select value={dataset} onChange={(event) => {
          setResult(null); setDataset(event.target.value as "real" | "synthetic"); setPage(1);
        }}>
          <option value="real">{t("review.real")}</option>
          <option value="synthetic">{t("review.synthetic")}</option>
        </select></label>
        {result && <span>{t("review.freshness", { time: new Intl.DateTimeFormat(language, {
          dateStyle: "medium", timeStyle: "short" }).format(new Date(result.asOf)) })}</span>}
      </div>
      {error && <p role="alert">{t("review.unavailable")}</p>}
      {!result && !error && <p role="status">{t("review.loading")}</p>}
      {result && <>
        <p>{t("review.count", { count: result.total })}</p>
        {result.reports.length === 0 ? <p>{t("review.empty")}</p> :
          <table><thead><tr><th>{t("review.report")}</th><th>{t("review.reportingDate")}</th>
            <th>{t("review.signedAt")}</th>{result.identifying && <th>{t("review.clinician")}</th>}</tr></thead>
            <tbody>{result.reports.map((report) => <tr key={report.id}>
              <td><code>{report.id}</code></td><td>{report.reportingDate}</td>
              <td>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.signedAt))}</td>
              {result.identifying && <td>{report.documentingClinician ?? "—"}</td>}
            </tr>)}</tbody></table>}
        <nav className="review-pagination" aria-label={t("review.pages")}>
          <button type="button" disabled={page === 1} onClick={() => { setResult(null); setPage(page - 1); }}>{t("review.previous")}</button>
          <span>{t("review.page", { page })}</span>
          <button type="button" disabled={page * result.pageSize >= result.total}
            onClick={() => { setResult(null); setPage(page + 1); }}>{t("review.next")}</button>
        </nav>
      </>}
    </>}
  </main>;
}
