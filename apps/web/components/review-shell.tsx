"use client";

import type { ClinicianSession, ReviewSignedReport, ReviewSignedReportsResponse, ReviewVolumeResult, ReportNote } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { ReviewVolumeChart } from "./review-volume-chart";

function dateString(date: Date): string { return date.toISOString().slice(0, 10); }

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
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewSignedReport | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [from, setFrom] = useState(() => dateString(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => dateString(new Date()));
  const [volume, setVolume] = useState<ReviewVolumeResult | null>(null);
  const [volumeError, setVolumeError] = useState(false);
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

  useEffect(() => {
    if (!online || !selected) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/reports/${selected}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewSignedReport;
      if (!controller.signal.aborted) { setDetail(next); setDetailError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setDetail(null); setDetailError(true); } });
    return () => controller.abort();
  }, [dataset, online, selected, refresh]);

  useEffect(() => {
    if (!online || from > to) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/volume?dataset=${dataset}&from=${from}&to=${to}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewVolumeResult;
      if (!controller.signal.aborted) setVolume(next);
    }).catch(() => { if (!controller.signal.aborted) setVolumeError(true); });
    return () => controller.abort();
  }, [dataset, from, to, online, refresh]);

  return <main className="review-shell" aria-labelledby="review-heading">
    <header className="review-heading">
      <div><p className="eyebrow">{t("review.online")}</p><h1 id="review-heading">{t("review.heading")}</h1></div>
      {online && <button type="button" onClick={() => {
        setResult(null); setDetail(null); setVolume(null); setVolumeError(false); setRefresh((value) => value + 1);
      }}>{t("navigation.refresh")}</button>}
    </header>
    {!online ? <p role="status">{t("review.offline")}</p> : <>
      <div className="review-controls">
        <label>{t("review.dataset")}{" "}<select value={dataset} onChange={(event) => {
          setResult(null); setDetail(null); setSelected(null); setVolume(null); setVolumeError(false);
          setDataset(event.target.value as "real" | "synthetic"); setPage(1);
        }}>
          <option value="real">{t("review.real")}</option>
          <option value="synthetic">{t("review.synthetic")}</option>
        </select></label>
        {result && <span>{t("review.freshness", { time: new Intl.DateTimeFormat(language, {
          dateStyle: "medium", timeStyle: "short" }).format(new Date(result.asOf)) })}</span>}
      </div>
      <section aria-labelledby="review-volume-heading">
        <h2 id="review-volume-heading">{t("review.volumeHeading")}</h2>
        <div className="review-controls">
          <label>{t("review.from")}{" "}<input type="date" value={from} max={to}
            onChange={(event) => { setVolume(null); setVolumeError(false); setFrom(event.target.value); }} /></label>
          <label>{t("review.to")}{" "}<input type="date" value={to} min={from}
            onChange={(event) => { setVolume(null); setVolumeError(false); setTo(event.target.value); }} /></label>
        </div>
        <p>{t("review.volumeUnit")}</p>
        {volumeError && <p role="alert">{t("review.volumeUnavailable")}</p>}
        {!volume && !volumeError && <p role="status">{t("review.volumeLoading")}</p>}
        {volume?.freshness.status === "stale" && <p role="alert">{t("review.volumeStale")}</p>}
        {volume?.freshness.status === "current" && <>
          <p>{t("review.volumeTotal", { count: volume.total ?? 0 })}{" · "}
            {t("review.volumeScope", { scope: t(`review.scope.${volume.population.scope}`) })}{" · "}
            {t("review.volumeFresh", { time: new Intl.DateTimeFormat(language, {
              dateStyle: "medium", timeStyle: "short" }).format(new Date(volume.freshness.observedAt)) })}</p>
          <ReviewVolumeChart points={volume.points} title={t("review.volumeChartLabel")} />
          <table><caption>{t("review.volumeTable")}</caption><thead><tr>
            <th>{t("review.reportingDate")}</th><th>{t("review.volumeCount")}</th>
          </tr></thead><tbody>{volume.points.map((point) => <tr key={point.date}>
            <td>{point.date}</td><td>{point.count}</td>
          </tr>)}</tbody></table>
        </>}
      </section>
      {error && <p role="alert">{t("review.unavailable")}</p>}
      {!result && !error && <p role="status">{t("review.loading")}</p>}
      {result && <>
        <p>{t("review.count", { count: result.total })}</p>
        {result.reports.length === 0 ? <p>{t("review.empty")}</p> :
          <table><thead><tr><th>{t("review.report")}</th><th>{t("review.reportingDate")}</th>
            <th>{t("review.signedAt")}</th>{result.identifying && <th>{t("review.clinician")}</th>}</tr></thead>
            <tbody>{result.reports.map((report) => <tr key={report.id}>
              <td><button type="button" onClick={() => { setSelected(report.id); setDetail(null); setDetailError(false); }}><code>{report.id}</code></button></td><td>{report.reportingDate}</td>
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
      {selected && <section className="review-detail" aria-label={t("review.detail")}>
        <button type="button" onClick={() => { setSelected(null); setDetail(null); }}>{t("review.close")}</button>
        {detailError && <p role="alert">{t("review.detailUnavailable")}</p>}
        {!detail && !detailError && <p role="status">{t("review.detailLoading")}</p>}
        {detail && <>
          <h2>{t("review.detail")}: <code>{detail.id}</code></h2>
          <p>{t("review.amendments", { count: detail.amendmentSequence })}</p>
          {detail.groups.map((group) => <section key={group.id}>
            <h3>{group.parentGroupInstanceId ? `${detail.groups.find((item) => item.id === group.parentGroupInstanceId)?.label ?? ""} / ` : ""}
              {group.label} {group.ordinal > 0 ? `#${group.ordinal + 1}` : ""}</h3>
            <ReviewValues values={detail.values.filter((value) => value.groupInstanceId === group.id)} />
          </section>)}
          <ReviewValues values={detail.values.filter((value) => !value.groupInstanceId)} />
          {detail.notes.length > 0 && <section><h3>{t("review.notes")}</h3>
            {detail.notes.map((note) => <ReviewNote key={note.id} note={note} reportId={detail.id} dataset={dataset} language={language} />)}
          </section>}
        </>}
      </section>}
    </>}
  </main>;
}

function ReviewValues({ values }: { values: ReviewSignedReport["values"] }) {
  return values.length > 0 && <dl>{values.map((value) => <div key={value.id}>
    <dt>{value.label}{value.ordinal > 0 ? ` #${value.ordinal + 1}` : ""}</dt>
    <dd>{value.codeDisplay ?? value.absenceDisplay ?? String(value.value ?? "—")}</dd>
  </div>)}</dl>;
}

function ReviewNote({ note, reportId, dataset, language }: { note: ReportNote; reportId: string;
  dataset: "real" | "synthetic"; language: AgencyLanguage }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const t = (key: string) => resolveMessage(language, key);
  const load = async () => {
    if (note.type === "text") return;
    const url = apiRequestUrl(`/api/review/reports/${reportId}/${note.type}/${note.id}/content?dataset=${dataset}`);
    if (!url) return;
    try {
      const response = await fetch(url, browserRequestInit());
      if (!response.ok) throw new Error(String(response.status));
      setMediaUrl(URL.createObjectURL(await response.blob())); setError(false);
    } catch { setError(true); }
  };
  return <article>
    <p>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.capturedAt))}</p>
    {note.type === "text" ? <p>{note.content}</p> : <>
      {note.caption && <p>{note.caption}</p>}
      <button type="button" onClick={() => void load()}>{note.type === "photo" ? t("review.openPhoto") : t("review.playAudio")}</button>
      {error && <p role="alert">{t("review.mediaUnavailable")}</p>}
      {mediaUrl && (note.type === "photo" ? <img src={mediaUrl} alt={note.caption ?? t("review.photo")} /> :
        <audio src={mediaUrl} controls />)}
    </>}
  </article>;
}
