"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { useAgencyTimeZone } from "../app/agency-time-zone";

/** Ephemeral inspection: never puts identifying PDF bytes into local storage or a service-worker cache. */
export function SignedReportPdfPreview({ reportId, snapshotId, amendmentSequence, dataset, language, deliveryId, draftRevision, disabled = false }: {
  reportId: string; snapshotId: string; amendmentSequence: number; dataset: "real" | "synthetic"; language: AgencyLanguage; deliveryId?: string; draftRevision?: number | (() => number); disabled?: boolean;
}) {
  const zone = useAgencyTimeZone();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const t = (key: string) => resolveMessage(language, key);
  const title = t(draftRevision !== undefined ? "cosSigning.showPdf" : deliveryId ? "pdf.submittedPreview" : "pdf.preview");
  const titleId = `pdf-title-${reportId}-${deliveryId ?? "signed"}`;
  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    dialog.current?.showModal();
    const query = new URLSearchParams({ amendmentSequence: String(amendmentSequence), language: language === "sv" ? "sv" : "en", dataset });
    if (!deliveryId) query.set("timeZone", zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    const url = apiRequestUrl(draftRevision !== undefined ? `/api/reports/${reportId}/cos/pdf?revision=${typeof draftRevision === 'function' ? draftRevision() : draftRevision}&language=${language}` : deliveryId ? `/api/review/reports/${reportId}/cos-deliveries/${deliveryId}/pdf?${query}` : `/api/review/reports/${reportId}/snapshots/${snapshotId}/pdf?${query}`);
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
  }, [open, reportId, snapshotId, amendmentSequence, dataset, language, attempt, deliveryId, zone, draftRevision, disabled]);
  const close = () => { dialog.current?.close(); setOpen(false); setSource(null); setError(null); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" disabled={disabled} onClick={() => setOpen(true)}>{title}</button>
    {open && !disabled && <dialog ref={dialog} className="signed-report-pdf-dialog" aria-labelledby={titleId} onCancel={close}>
      <header><h2 id={titleId}>{title}</h2>
        <button type="button" onClick={close}>{t("noteUi.close")}</button></header>
      <p>{draftRevision !== undefined ? t("cosSigning.draftPdf") : resolveMessage(language, "pdf.version", { sequence: amendmentSequence })}</p>
      {draftRevision === undefined && <p>{t(deliveryId ? "pdf.submittedEvidence" : "pdf.limits")}</p>}
      {error ? <div role="alert"><p>{t(error)}</p><button type="button" onClick={() => { setError(null); setSource(null); setAttempt(attempt + 1); }}>{t("pdf.retry")}</button></div> :
        source ? <><p>{t("pdf.viewerHelp")}</p><iframe src={source} title={title} /><a href={source} download={draftRevision !== undefined ? `draft-report-${reportId}.pdf` : deliveryId ? `cos-submitted-${deliveryId}.pdf` : `signed-report-${reportId}-${amendmentSequence}.pdf`}>{t("pdf.download")}</a></> :
          <p role="status">{t("pdf.loading")}</p>}
    </dialog>}
  </>;
}
