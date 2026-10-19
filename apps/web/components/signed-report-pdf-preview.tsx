"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

/** Ephemeral inspection: never puts identifying PDF bytes into local storage or a service-worker cache. */
export function SignedReportPdfPreview({ reportId, snapshotId, amendmentSequence, dataset, language }: {
  reportId: string; snapshotId: string; amendmentSequence: number; dataset: "real" | "synthetic"; language: AgencyLanguage;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    dialog.current?.showModal();
    const query = new URLSearchParams({ amendmentSequence: String(amendmentSequence), language: language === "sv" ? "sv" : "en", dataset });
    const url = apiRequestUrl(`/api/review/reports/${reportId}/snapshots/${snapshotId}/pdf?${query}`);
    void (async () => {
      try {
        if (!url) throw new Error("pdf.unavailable");
        const response = await fetch(url, browserRequestInit({ signal: controller.signal }));
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { code?: string };
          throw new Error(["pdf.media-unavailable", "pdf.media-decode-failed", "pdf.media-too-large", "pdf.audio-metadata-unavailable", "pdf.amendment-evidence-unavailable", "pdf.invalid-version", "pdf.definitions-unavailable", "pdf.unsupported-text", "pdf.too-large"].includes(failure.code ?? "")
            ? failure.code : "pdf.unavailable");
        }
        if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("pdf.unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "pdf.unavailable");
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, reportId, snapshotId, amendmentSequence, dataset, language, attempt]);
  const close = () => { dialog.current?.close(); setOpen(false); setSource(null); setError(null); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)}>{t("pdf.preview")}</button>
    {open && <dialog ref={dialog} className="signed-report-pdf-dialog" aria-labelledby={`pdf-title-${reportId}`} onCancel={close}>
      <header><h2 id={`pdf-title-${reportId}`}>{t("pdf.preview")}</h2>
        <button type="button" onClick={close}>{t("noteUi.close")}</button></header>
      <p>{resolveMessage(language, "pdf.version", { sequence: amendmentSequence })}</p>
      <p>{t("pdf.limits")}</p>
      {error ? <div role="alert"><p>{t(error)}</p><button type="button" onClick={() => { setError(null); setSource(null); setAttempt(attempt + 1); }}>{t("pdf.retry")}</button></div> :
        source ? <><p>{t("pdf.viewerHelp")}</p><iframe src={source} title={t("pdf.preview")} /><a href={source} download={`signed-report-${reportId}-${amendmentSequence}.pdf`}>{t("pdf.download")}</a></> :
          <p role="status">{t("pdf.loading")}</p>}
    </dialog>}
  </>;
}
