"use client";

import type { FeedbackDiagnosticMode, FeedbackDiagnosticScreen, FeedbackDiagnostics, FeedbackSubmissionType } from "@open-triage/contracts";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { feedbackDescriptionError, feedbackPrompt, FEEDBACK_DESCRIPTION_MAX_LENGTH, submitFeedback } from "../app/feedback";
import { captureFeedbackDiagnostics, diagnosticsForSubmission } from "../app/feedback-diagnostics";
import { recordFeedbackInteraction } from "../app/feedback-telemetry";
import { TransientNotice } from "./transient-notice";

export function FeedbackControl({ csrfToken, online, mode, screen }: {
  readonly csrfToken: string;
  readonly online: boolean;
  readonly mode: FeedbackDiagnosticMode;
  readonly screen: FeedbackDiagnosticScreen;
}) {
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
  const validation = description ? feedbackDescriptionError(description) : null;

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

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
    const fieldError = feedbackDescriptionError(description);
    if (!type) { setError("Choose Bug or Feature before submitting."); return; }
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
      });
      setOpen(false);
      setType(null);
      setDescription("");
      diagnostics.current = null;
      idempotencyKey.current = null;
      setNotice(`Feedback received. Reference ${result.referenceCode}.`);
      window.requestAnimationFrame(() => trigger.current?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Feedback could not be submitted. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button ref={trigger} className="feedback-trigger" type="button"
      aria-label={online ? "Send feedback" : "Send feedback unavailable while offline"}
      title={online ? "Send feedback" : "Feedback is unavailable while offline"} disabled={!online}
      onClick={() => {
        setNotice(null);
        recordFeedbackInteraction("feedback.opened");
        idempotencyKey.current = crypto.randomUUID();
        diagnostics.current = captureFeedbackDiagnostics(window, mode, screen);
        setOpen(true);
      }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 9h6M9 13h6M8 4l1.2 2h5.6L16 4M6 8H4m16 0h-2M6 16H4m16 0h-2M8 6h8v12H8z" />
      </svg>
    </button>
    <TransientNotice message={notice} onDismiss={() => setNotice(null)} />
    {open && <div className="dialog-backdrop feedback-backdrop" role="presentation">
      <section ref={dialog} className="note-dialog feedback-dialog" role="dialog" aria-modal="true"
        aria-labelledby={headingId} onKeyDown={trapKeys}>
        <div className="note-dialog-heading">
          <div><p className="eyebrow">OpenTriage feedback</p><h2 id={headingId}>Send feedback</h2></div>
          <button type="button" aria-label="Close feedback" title="Close" disabled={pending} onClick={closeAndRestore}>×</button>
        </div>
        <p className="feedback-warning" role="note"><strong>Do not include patient-identifying information.</strong> Describe the application behavior or need only.</p>
        <fieldset className="feedback-type"><legend>Feedback type</legend>
          <div role="group" aria-label="Feedback type">
            {(["bug", "feature"] as const).map((value) => <button key={value} type="button"
              aria-pressed={type === value} disabled={pending} onClick={() => {
                recordFeedbackInteraction(value === "bug" ? "feedback.type.bug.selected" : "feedback.type.feature.selected");
                setType(value); setError(null);
              }}>
              {value === "bug" ? "Bug" : "Feature"}
            </button>)}
          </div>
        </fieldset>
        <form onSubmit={submit} noValidate>
          <label htmlFor={descriptionId}>{feedbackPrompt(type)}</label>
          <textarea id={descriptionId} value={description} maxLength={FEEDBACK_DESCRIPTION_MAX_LENGTH} required disabled={pending}
            aria-describedby={`${descriptionId}-limit${error ? ` ${descriptionId}-error` : ""}`}
            onChange={(event) => { setDescription(event.target.value); setError(null); }} />
          <small id={`${descriptionId}-limit`}>{description.length.toLocaleString()} / 4,000 characters</small>
          {error && <p id={`${descriptionId}-error`} className="validation-message error" role="alert">{error}</p>}
          <div className="note-dialog-actions">
            <button type="button" disabled={pending} onClick={closeAndRestore}>Cancel</button>
            <button type="submit" disabled={pending || !type || Boolean(validation)}>{pending ? "Submitting…" : "Submit feedback"}</button>
          </div>
        </form>
      </section>
    </div>}
  </>;
}
