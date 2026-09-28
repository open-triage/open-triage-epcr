"use client";

import { resolveErrorMessage, resolveMessage, type AgencyLanguage } from "../app/localization";

import type { FeedbackDiagnosticMode, FeedbackDiagnosticScreen, FeedbackDiagnostics, FeedbackSubmissionType } from "@open-triage/contracts";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { feedbackDescriptionError, feedbackPrompt, FEEDBACK_DESCRIPTION_MAX_LENGTH, submitFeedback } from "../app/feedback";
import { captureFeedbackDiagnostics, diagnosticsForSubmission } from "../app/feedback-diagnostics";
import { recordFeedbackInteraction } from "../app/feedback-telemetry";
import { TransientNotice } from "./transient-notice";

export function FeedbackControl({ csrfToken, online, mode, screen, language = "en" }: {
  readonly csrfToken: string;
  readonly online: boolean;
  readonly mode: FeedbackDiagnosticMode;
  readonly screen: FeedbackDiagnosticScreen;
  readonly language?: AgencyLanguage;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const idempotencyKey = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackSubmissionType | null>(null);
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const diagnostics = useRef<FeedbackDiagnostics | null>(null);
  const validation = description ? feedbackDescriptionError(description, language) : null;

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (open && error && !pending) dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [open, error, pending]);

  function closeAndRestore() {
    if (pending) return;
    setOpen(false);
    setType(null);
    setDescription("");
    setError(null);
    diagnostics.current = null;
    idempotencyKey.current = null;
    recordFeedbackInteraction("feedback.cancelled");
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function trapKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestore();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)")];
    if (!controls.length) return;
    const first = controls[0]!;
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fieldError = feedbackDescriptionError(description, language);
    if (!type) { setError(t("noteUi.choose.bug.or.feature.before.submitting")); return; }
    if (fieldError) { setError(fieldError); return; }
    setPending(true);
    setError(null);
    recordFeedbackInteraction("feedback.submit.attempted");
    try {
      const captured = diagnostics.current ?? { status: "unavailable", schemaVersion: 1, reason: "capture-failed" };
      const draftKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = draftKey;
      const result = await submitFeedback(csrfToken, {
        idempotencyKey: draftKey, type, description: description.trim(), diagnostics: diagnosticsForSubmission(captured, type)
      }, language);
      setOpen(false);
      setType(null);
      setDescription("");
      diagnostics.current = null;
      idempotencyKey.current = null;
      setNotice(t("noteUi.feedbackReceived", { reference: result.referenceCode }));
      window.requestAnimationFrame(() => trigger.current?.focus());
    } catch (reason) {
      setError(resolveErrorMessage(language, reason instanceof Error ? reason.message : null, "noteUi.feedbackFailure"));
    } finally {
      setPending(false);
    }
  }

  return <>
    <button ref={trigger} className="feedback-trigger" type="button"
      aria-label={online ? t("noteUi.send.feedback") : t("noteUi.send.feedback.unavailable.while.offline")}
      title={online ? t("noteUi.send.feedback") : t("noteUi.feedback.is.unavailable.while.offline")} disabled={!online}
      onClick={() => {
        setNotice(null);
        recordFeedbackInteraction("feedback.opened");
        idempotencyKey.current = crypto.randomUUID();
        diagnostics.current = captureFeedbackDiagnostics(window, mode, screen);
        setOpen(true);
      }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter">
        <path d="m9.5 7-2-2-3-.75M14.5 7l2-2 3-.75" />
        <path d="m10 7-1.5 2L10 11h4l1.5-2L14 7h-4Z" />
        <path d="m10 11-1 2v5l3 4 3-4v-5l-1-2M12 11v11" />
        <path d="m9 12-3-2-1-2.5M15 12l3-2 1-2.5M9 14H6l-2 3M15 14h3l2 3M9 17l-2 3v2M15 17l2 3v2" />
      </svg>
    </button>
    <TransientNotice message={notice} onDismiss={() => setNotice(null)} />
    {open && <div className="dialog-backdrop feedback-backdrop" role="presentation">
      <section ref={dialog} className="note-dialog feedback-dialog" role="dialog" aria-modal="true"
        aria-labelledby={headingId} onKeyDown={trapKeys}>
        <div className="note-dialog-heading">
          <div><p className="eyebrow">{t("noteUi.opentriage.feedback")}</p><h2 id={headingId}>{t("noteUi.send.feedback")}</h2></div>
          <button type="button" aria-label={t("noteUi.close.feedback")} title={t("noteUi.close")} disabled={pending} onClick={closeAndRestore}>×</button>
        </div>
        <p className="feedback-warning" role="note"><strong>{t("noteUi.do.not.include.patient.identifying.information")}</strong> {t("noteUi.feedbackWarning")}</p>
        <fieldset className="feedback-type"><legend>{t("noteUi.feedback.type")}</legend>
          <div role="group" aria-label={t("noteUi.feedback.type")}>
            {(["bug", "feature"] as const).map((value) => <button key={value} type="button"
              aria-pressed={type === value} disabled={pending} onClick={() => {
                recordFeedbackInteraction(value === "bug" ? "feedback.type.bug.selected" : "feedback.type.feature.selected");
                setType(value); setError(null);
              }}>
              {value === "bug" ? t("noteUi.bug") : t("noteUi.feature")}
            </button>)}
          </div>
        </fieldset>
        <form onSubmit={submit} noValidate>
          <label htmlFor={descriptionId}>{feedbackPrompt(type, language)}</label>
          <textarea id={descriptionId} value={description} maxLength={FEEDBACK_DESCRIPTION_MAX_LENGTH} required disabled={pending}
            aria-describedby={`${descriptionId}-limit${error ? ` ${descriptionId}-error` : ""}`}
            onChange={(event) => { setDescription(event.target.value); setError(null); }} />
          <small id={`${descriptionId}-limit`}>{t("noteUi.captionCount", { count: description.length.toLocaleString(language === "sv" ? "sv-SE" : "en-US"), max: (4000).toLocaleString(language === "sv" ? "sv-SE" : "en-US") })}</small>
          {error && <p id={`${descriptionId}-error`} className="validation-message error" role="alert">{error}</p>}
          <div className="note-dialog-actions">
            <button type="button" disabled={pending} onClick={closeAndRestore}>{t("noteUi.cancel")}</button>
            <button type="submit" disabled={pending || !type || Boolean(validation)}>{pending ? t("noteUi.submitting") : t("noteUi.submit.feedback")}</button>
          </div>
        </form>
      </section>
    </div>}
  </>;
}
