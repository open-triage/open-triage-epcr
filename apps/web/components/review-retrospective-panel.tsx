"use client";

import type { ReviewRetrospectiveDefinition, ReviewRetrospectivePreview,
  ReviewRetrospectiveRun, ReviewRetrospectiveVersion } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function ReviewRetrospectivePanel({ dataset, language, online, csrfToken, refresh }: {
  dataset: "real" | "synthetic"; language: AgencyLanguage; online: boolean;
  csrfToken: string; refresh: () => void;
}) {
  const [versions, setVersions] = useState<ReviewRetrospectiveVersion[]>([]);
  const [selected, setSelected] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<ReviewRetrospectivePreview | null>(null);
  const [runs, setRuns] = useState<ReviewRetrospectiveRun[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const versionsUrl = apiRequestUrl("/api/review/retrospective/versions");
    const runsUrl = apiRequestUrl("/api/review/retrospective/runs");
    if (!versionsUrl || !runsUrl) return;
    void Promise.all([fetch(versionsUrl, browserRequestInit({ signal: controller.signal })),
      fetch(runsUrl, browserRequestInit({ signal: controller.signal }))]).then(async ([a, b]) => {
      if (!a.ok || !b.ok) throw new Error("unavailable");
      const nextVersions = await a.json() as ReviewRetrospectiveVersion[];
      const nextRuns = await b.json() as ReviewRetrospectiveRun[];
      if (!controller.signal.aborted) { setVersions(nextVersions); setRuns(nextRuns); }
    }).catch(() => { if (!controller.signal.aborted)
      setMessage(resolveMessage(language, "review.retroUnavailable")); });
    return () => controller.abort();
  }, [online, language]);

  function definition(): ReviewRetrospectiveDefinition | null {
    const version = versions.find((value) => value.validationVersionId === selected);
    return version ? { criterionId: version.criterionId, validationVersionId: version.validationVersionId,
      from, to, dataset } : null;
  }

  async function request<T>(path: string, body: unknown): Promise<T> {
    const url = apiRequestUrl(path);
    if (!url) throw new Error("unavailable");
    const response = await fetch(url, browserRequestInit({ method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) }));
    if (response.status === 409) {
      const conflict = await response.json() as { message?: string; preview?: ReviewRetrospectivePreview;
        response?: { preview?: ReviewRetrospectivePreview } };
      setPreview(conflict.preview ?? conflict.response?.preview ?? null);
      throw new Error(t("review.retroChanged"));
    }
    if (!response.ok) throw new Error(t("review.retroUnavailable"));
    return response.json() as Promise<T>;
  }

  async function showPreview() {
    const value = definition(); if (!value) return;
    setBusy(true); setMessage("");
    try { setPreview(await request<ReviewRetrospectivePreview>("/api/review/retrospective/preview", value)); }
    catch (error) { setMessage(error instanceof Error ? error.message : t("review.retroUnavailable")); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const run = await request<ReviewRetrospectiveRun>("/api/review/retrospective/runs",
        { commandId: crypto.randomUUID(), definition: preview.definition, expectedRevision: preview.revision });
      setRuns((previous) => [run, ...previous]); setPreview(null); setMessage(t("review.retroStarted"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("review.retroUnavailable")); }
    finally { setBusy(false); }
  }

  async function advance(run: ReviewRetrospectiveRun) {
    setBusy(true); setMessage("");
    try {
      const next = await request<ReviewRetrospectiveRun>(`/api/review/retrospective/runs/${run.id}/advance`,
        { batchSize: 25 });
      setRuns((previous) => previous.map((entry) => entry.id === next.id ? next : entry));
      refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("review.retroUnavailable")); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="review-retro-heading">
    <h2 id="review-retro-heading">{t("review.retroHeading")}</h2>
    <p>{t("review.retroHelp")}</p>
    <label>{t("review.retroCriterion")} <select value={selected} onChange={(event) => {
      setSelected(event.target.value); setPreview(null); setMessage(""); }}>
      <option value="">{t("review.retroChoose")}</option>
      {versions.map((version) => <option key={version.validationVersionId} value={version.validationVersionId}>
        {version.name} (v{version.version}, {version.catalogReleaseId})
      </option>)}
    </select></label>
    <label>{t("review.from")} <input type="date" value={from} onChange={(event) => {
      setFrom(event.target.value); setPreview(null); setMessage(""); }} /></label>
    <label>{t("review.to")} <input type="date" value={to} onChange={(event) => {
      setTo(event.target.value); setPreview(null); setMessage(""); }} /></label>
    <p>{t("review.dataset")}: {dataset}</p>
    <button type="button" disabled={!selected || busy || !online} onClick={() => void showPreview()}>
      {t("review.retroPreview")}</button>
    {message && <p role="alert">{message}</p>}
    {preview && <div role="region" aria-label={t("review.retroPreview")}>
      <p>{t("review.retroPreviewCounts", { total: preview.total, matches: preview.matches,
        newItems: preview.newItems, existing: preview.existingItems, failed: preview.failed,
        incompatible: preview.incompatible })}</p>
      <table><thead><tr><th>{t("review.report")}</th><th>{t("review.reportingDate")}</th>
        <th>{t("review.retroResult")}</th><th>{t("review.retroExisting")}</th></tr></thead>
        <tbody>{preview.reports.map((row) => <tr key={row.reportId}>
          <td><code>{row.reportId}</code></td><td>{row.reportingDate}</td>
          <td>{t(`review.retroOutcome.${row.outcome}`)}{row.failureCode ? ` (${row.failureCode})` : ""}</td>
          <td>{row.existing ? t("review.yes") : t("review.no")}</td>
        </tr>)}</tbody></table>
      <button type="button" disabled={busy || !online || preview.total === 0} onClick={() => void start()}>
        {t("review.retroStart")}</button>
    </div>}
    <h3>{t("review.retroRuns")}</h3>
    {runs.length === 0 ? <p>{t("review.retroNoRuns")}</p> : <ul>{runs.map((run) => <li key={run.id}>
      <code>{run.id}</code> — {run.definition.from}–{run.definition.to} ({run.definition.dataset}):
      {" "}{t("review.retroRunCounts", { complete: run.complete, total: run.total,
        pending: run.pending, failed: run.failed, incompatible: run.incompatible })}
      {(run.pending > 0 || run.failed > 0) && <button type="button" disabled={busy || !online}
        onClick={() => void advance(run)}>{t("review.retroAdvance")}</button>}
    </li>)}</ul>}
  </section>;
}
