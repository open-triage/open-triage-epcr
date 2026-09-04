"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { ProcedureDialog } from "../components/procedure-dialog";
import { QuickActionIcon } from "../components/quick-action-icon";
import { TimePicker } from "../components/time-picker";
import { loadShellStateResult, purgeCompletedReportCaches, saveReportSyncStatus, saveShellState } from "./local-persistence";
import { validateProcedure } from "./procedure";
import { configuredQuickActions, type QuickActionId } from "./encounter-definition";
import {
  INITIAL_SHELL_STATE,
  MISSING_VITALS_FINDING_ID,
  encounterEventDetail,
  encounterEventPresentation,
  reviewEncounter,
  standardEncounterReducer,
  type ReviewFinding,
  type ShellView,
  type VitalField,
  bundledEncounterDefinition,
} from "./standard-encounter";
import { nullOptionsFor, validateVitals } from "./vital-validation";
import { localClinicalDate } from "./time-picker";
import { documentTimeline, incidentSummary } from "./incident-document";
import { encounterEvents } from "./canonical-events";
import { ClinicianSessionGate } from "../components/clinician-session-gate";
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SYNC_RETRY_MS,
  saveDraftReport,
  signDraftReport,
  shellStateToDraftMutations,
  usesLocalDemoDrafts,
  type ActiveDraftReport,
  type DraftSyncStatus,
} from "./draft-report";
import type { ClinicianSession } from "@open-triage/contracts";
import {
  acceptDraftChange,
  expectedRevisionForNextChange,
  markDraftChangeAttempted,
  nextDraftChange,
  removeSignedOfflineReport,
  queueDraftChange,
  saveCachedValidationErrorCount,
} from "./offline-reports";

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

const quickActionText: Record<QuickActionId, string> = {
  vitals: "Vitals",
  medication: "Medications",
  procedure: "Procedures",
  note: "Notes",
};

function localClinicalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function EncounterWorkspace({ session, report, onSaveAndClose, onSessionEnded }: {
  readonly session: ClinicianSession;
  readonly report: ActiveDraftReport | null;
  readonly onSaveAndClose: () => void;
  readonly onSessionEnded: () => void;
}) {
  const [shell, dispatch] = useReducer(standardEncounterReducer, INITIAL_SHELL_STATE);
  const [restored, setRestored] = useState(false);
  const [procedureSearch, setProcedureSearch] = useState("");
  const [openNullField, setOpenNullField] = useState<VitalField | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [editingFinding, setEditingFinding] = useState<ReviewFinding | null>(null);
  const [syncStatus, setSyncStatus] = useState<DraftSyncStatus>("Saved");
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const revision = useRef(report?.revision ?? 0);
  const activeSave = useRef<Promise<void> | null>(null);
  const skipInitialQueue = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const encounter = shell.encounter;
  const incident = useMemo(() => {
    const documented = incidentSummary(encounter.document);
    return {
      ...documented,
      number: report?.callNumber ?? documented.number,
      complaint: report?.dispatchReason ?? report?.chiefComplaint ?? documented.complaint,
    };
  }, [encounter.document, report]);
  const incidentEvents = useMemo(() => {
    if (!report?.dispatchedAt) return documentTimeline(encounter.document);
    const dispatched = new Date(report.dispatchedAt);
    const date = `${dispatched.getFullYear()}-${String(dispatched.getMonth() + 1).padStart(2, "0")}-${String(dispatched.getDate()).padStart(2, "0")}`;
    const time = `${String(dispatched.getHours()).padStart(2, "0")}:${String(dispatched.getMinutes()).padStart(2, "0")}`;
    return [{
      id: `call-dispatch-${report.id}`,
      date,
      time,
      kind: "document" as const,
      title: "Unit Notified by Dispatch",
      detail: report.dispatchReason ?? report.chiefComplaint ?? "",
      reference: "eTimes.03",
    }];
  }, [encounter.document, report]);
  const clinicalEvents = useMemo(() => encounterEvents(encounter.document, bundledEncounterDefinition), [encounter.document]);
  const timelineEvents = useMemo(() => [...incidentEvents, ...clinicalEvents].sort((a, b) =>
    `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`),
  ), [incidentEvents, clinicalEvents]);
  const noteDefinition = bundledEncounterDefinition.events.note;
  const procedureDefinition = bundledEncounterDefinition.events.procedure;
  const medicationDefinition = bundledEncounterDefinition.events.medication;
  const vitalDefinition = bundledEncounterDefinition.events.vitals;
  const reviewFindings = useMemo(() => reviewEncounter(shell), [shell]);
  const reviewErrors = reviewFindings.filter((finding) => finding.severity === "error");
  const reviewWarnings = reviewFindings.filter((finding) => finding.severity === "warning");
  const validationClear = reviewErrors.length === 0 && reviewWarnings.length === 0;
  const eventValidationStatuses = useMemo(() => {
    const statuses = new Map<string, "warning" | "error">();
    for (const finding of reviewFindings) {
      if (finding.severity === "error" || !statuses.has(finding.target.eventId)) statuses.set(finding.target.eventId, finding.severity);
    }
    return statuses;
  }, [reviewFindings]);
  const canFinish = reviewErrors.length === 0 && reviewWarnings.every((finding) => finding.acknowledged);
  const vitalDraftValidation = shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values, bundledEncounterDefinition) : null;
  const vitalFindingActive = !!(editingFinding?.category === vitalDefinition.labels.category && vitalDraftValidation && [...Object.values(vitalDraftValidation.errors), ...Object.values(vitalDraftValidation.warnings)].includes(editingFinding.message));
  const noteFindingActive = !!(editingFinding?.category === noteDefinition.labels.category && shell.noteDraft);
  const noteTimeFindingActive = noteFindingActive && editingFinding?.message === noteDefinition.validationMessages.invalidTime;
  const noteSummaryFindingActive = noteFindingActive && editingFinding?.message === noteDefinition.validationMessages.summaryRequired;
  const activeDialog = shell.noteDraft ? "note" : shell.medicationDraft ? "medication" : shell.procedureDraft ? "procedure" : shell.vitalDraft ? "vitals" : null;

  const closeActiveDialog = useCallback(() => {
    if (activeDialog === "note") dispatch({ type: "note-cancelled" });
    else if (activeDialog === "medication") dispatch({ type: "medication-cancelled" });
    else if (activeDialog === "procedure") dispatch({ type: "procedure-cancelled" });
    else if (activeDialog === "vitals") {
      setOpenNullField(null);
      dispatch({ type: "vitals-cancelled" });
    }
  }, [activeDialog]);

  useEffect(() => {
    const result = loadShellStateResult(window.localStorage, bundledEncounterDefinition, report?.id);
    if (result.status === "restored") {
      skipInitialQueue.current = true;
      dispatch({ type: "state-restored", state: result.state });
    }
    else if (result.status === "incompatible") queueMicrotask(() => setRecoveryNotice(`Saved encounter ${result.savedDefinition.id ?? "(unknown)"} version ${result.savedDefinition.version ?? "(unknown)"} is incompatible. Its original JSON was preserved in ${result.recoveryKey}.`));
    else if (result.status === "invalid") queueMicrotask(() => setRecoveryNotice(`Saved encounter could not be loaded: ${result.reason}. Its original JSON was preserved in ${result.recoveryKey}.`));
    // Hydration must finish before the baseline is allowed to overwrite browser progress.
    queueMicrotask(() => {
      if (report && nextDraftChange(window.localStorage, report.id)) setSyncStatus("Pending sync");
      setRestored(true);
    });
  }, [report]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (!report) return;
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (activeSave.current) {
      await activeSave.current;
    }
    while (true) {
      const queued = nextDraftChange(window.localStorage, report.id);
      if (!queued) {
        setSyncStatus("Saved");
        return;
      }
      setSyncStatus("Saving");
      markDraftChangeAttempted(window.localStorage, report.id, queued.command.commandId);
      const attempt = (async () => {
        try {
          const saved = await saveDraftReport(session.accessToken, report.id, queued.command);
          revision.current = saved.revision;
          acceptDraftChange(window.localStorage, report.id, queued.command.commandId, saved);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "offline";
          if (reason === "session") {
            setSyncStatus("Pending sync");
            onSessionEnded();
            return;
          }
          setSyncStatus(reason === "conflict" ? "Conflict" : "Pending sync");
        }
      })();
      activeSave.current = attempt;
      await attempt;
      activeSave.current = null;
      if (nextDraftChange(window.localStorage, report.id)?.command.commandId === queued.command.commandId) return;
    }
  }, [onSessionEnded, report, session.accessToken]);

  useEffect(() => {
    if (!restored) return;
    saveShellState(window.localStorage, shell, report?.id);
    if (!report) return;
    if (skipInitialQueue.current) {
      skipInitialQueue.current = false;
      if (nextDraftChange(window.localStorage, report.id)) {
        if (navigator.onLine) queueMicrotask(() => void flushSave());
        else queueMicrotask(() => setSyncStatus("Pending sync"));
      }
      return;
    }
    const existing = nextDraftChange(window.localStorage, report.id);
    const commandId = existing && !existing.attempted ? existing.command.commandId : crypto.randomUUID();
    const clientTime = existing && !existing.attempted ? existing.command.clientTime : new Date().toISOString();
    queueDraftChange(window.localStorage, report.id, {
      commandId,
      expectedRevision: expectedRevisionForNextChange(window.localStorage, report.id, revision.current),
      authorId: session.user.id,
      deviceId: `web:${report.id}`,
      clientTime,
      ...shellStateToDraftMutations(report.id, shell),
    });
    queueMicrotask(() => setSyncStatus(navigator.onLine ? "Saving" : "Pending sync"));
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (navigator.onLine) saveTimer.current = window.setTimeout(() => void flushSave(), DRAFT_SAVE_DEBOUNCE_MS);
  }, [flushSave, restored, shell, report, session.user.id]);

  useEffect(() => {
    if (report) saveReportSyncStatus(window.localStorage, report.id, syncStatus);
  }, [report, syncStatus]);

  useEffect(() => {
    if (report) saveCachedValidationErrorCount(window.localStorage, report.id, reviewErrors.length);
  }, [report, reviewErrors.length]);

  useEffect(() => {
    const retry = () => { if (report && nextDraftChange(window.localStorage, report.id)) void flushSave(); };
    window.addEventListener("online", retry);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      window.removeEventListener("online", retry);
    };
  }, [flushSave, report]);

  useEffect(() => {
    if (!report || syncStatus !== "Pending sync") return;
    const retryTimer = window.setTimeout(() => {
      if (navigator.onLine && nextDraftChange(window.localStorage, report.id)) void flushSave();
    }, DRAFT_SYNC_RETRY_MS);
    return () => window.clearTimeout(retryTimer);
  }, [flushSave, report, syncStatus]);

  useEffect(() => {
    if (shell.noteDraft) noteSummary.current?.focus();
  }, [shell.noteDraft]);

  useEffect(() => {
    if (!activeDialog) {
      returnFocus.current?.focus();
      returnFocus.current = null;
      return;
    }

    returnFocus.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const target = (activeDialog === "vitals" && openNullField ? dialog.current?.querySelector<HTMLElement>(".null-value-menu button") : null)
        ?? dialog.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?? dialog.current?.querySelector<HTMLElement>("button, input, select, textarea");
      target?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
        .filter((control) => control.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDialog, closeActiveDialog, openNullField]);

  function rememberTrigger(element: HTMLElement) {
    returnFocus.current = element;
  }

  function editValidationFinding(finding: ReviewFinding, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(finding);
    setOpenNullField(null);
    if (finding.id === MISSING_VITALS_FINDING_ID) {
      dispatch({ type: "view-selected", view: "timeline" });
      dispatch({ type: "vitals-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
      return;
    }
    dispatch({ type: "review-finding-selected", id: finding.id });
  }

  function startNote(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    dispatch({ type: "note-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }
  function startVitals(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setOpenNullField(null);
    dispatch({ type: "vitals-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  function startProcedure(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setProcedureSearch("");
    dispatch({ type: "procedure-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  function startMedication(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    dispatch({ type: "medication-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  const quickActionHandlers: Record<QuickActionId, (event: React.MouseEvent<HTMLButtonElement>) => void> = {
    vitals: startVitals, medication: startMedication, procedure: startProcedure, note: startNote,
  };

  async function signRecord() {
    if (!report || !canFinish || signing) return;
    setSigning(true);
    setSignError(null);
    await flushSave();
    if (!usesLocalDemoDrafts() && nextDraftChange(window.localStorage, report.id)) {
      setSignError("The record must finish syncing before it can be signed.");
      setSigning(false);
      return;
    }
    try {
      await signDraftReport(session.accessToken, report.id, revision.current, session.user.id, shell.acknowledgedWarnings);
      purgeCompletedReportCaches(window.localStorage, [report.id]);
      removeSignedOfflineReport(window.localStorage, report.id);
      onSaveAndClose();
    } catch (error) {
      setSignError(error instanceof Error ? error.message : "The record could not be signed.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <main className="app-shell">
      {recoveryNotice && <aside className="safety-notice" role="alert"><strong>Saved data needs recovery</strong><span>{recoveryNotice}</span></aside>}

      <header className="encounter-header">
        {report && <div className="draft-actions">
          <span className={`sync-status sync-${syncStatus.toLocaleLowerCase().replaceAll(" ", "-")}`} role="status" aria-live="polite">{syncStatus}</span>
          <button type="button" onClick={async () => { await flushSave(); onSaveAndClose(); }}>Save &amp; close</button>
        </div>}
        <div className="header-kicker"><span>{incidentEvents[0]?.time ?? "--:--"}</span></div>
        <div className="incident-line">
          <div>
            <span>{bundledEncounterDefinition.labels.incident} {incident.number}</span>
            <strong>{incident.complaint}</strong>
          </div>
        </div>
      </header>

      <nav className="quick-actions" aria-label="Quick documentation">
        {configuredQuickActions(bundledEncounterDefinition).map((action) => <button key={action.id} className={activeDialog === action.id ? "active" : undefined} aria-pressed={activeDialog === action.id} title={action.title} aria-label={action.label} type="button" onClick={quickActionHandlers[action.id]}><QuickActionIcon kind={action.id} /><span aria-hidden="true">{quickActionText[action.id]}</span></button>)}
      </nav>

      <nav className="view-switcher" aria-label="Encounter views">
        {tabs.map((tab) => (
          <button
            aria-pressed={shell.view === tab.id}
            aria-current={shell.view === tab.id ? "page" : undefined}
            aria-label={tab.id === "checklist" ? `Checklist, ${reviewErrors.length} ${reviewErrors.length === 1 ? "error" : "errors"}, ${reviewWarnings.length} ${reviewWarnings.length === 1 ? "warning" : "warnings"}` : undefined}
            className={shell.view === tab.id ? "active" : undefined}
            key={tab.id}
            onClick={() => dispatch({ type: "view-selected", view: tab.id })}
            type="button"
          >
            {tab.label}
            {tab.id === "timeline" && <span aria-hidden="true"> · {timelineEvents.length}</span>}
            {tab.id === "checklist" && <span className="checklist-counts" aria-hidden="true">
              <span className="error-count">{reviewErrors.length} {reviewErrors.length === 1 ? "error" : "errors"}</span>
              <span className="warning-count">{reviewWarnings.length} {reviewWarnings.length === 1 ? "warning" : "warnings"}</span>
            </span>}
          </button>
        ))}
      </nav>

      {(shell.view === "timeline" || shell.view === "checklist") && (
        <div className="sign-action-bar">
          <button className={validationClear ? "validation-clear" : undefined} type="button" onClick={() => dispatch({ type: "review-opened" })}>Review &amp; sign</button>
        </div>
      )}

      {shell.view === "timeline" && (
        <section className="content-panel" aria-labelledby="timeline-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Newest first</p>
              <h1 id="timeline-heading">Timeline</h1>
            </div>
            <span>{timelineEvents.length} events</span>
          </div>
          <ol className="timeline-list">
            {timelineEvents.map((event) => {
              const validationStatus = eventValidationStatuses.get(event.id) ?? "clear";
              const presentation = encounterEventPresentation(event, bundledEncounterDefinition);
              const eventDetail = encounterEventDetail(event, bundledEncounterDefinition);
              return <li key={event.id} className={event.kind === "note" || event.kind === "medication" || event.kind === "procedure" ? "editable-event" : undefined}>
                <time dateTime={`${event.date ?? "2026-04-18"}T${event.time}:00`}>{event.time}</time>
                <span className={`event-dot validation-${validationStatus}`} role="img" aria-label={`Validation ${validationStatus}`} />
                {event.kind === "note" || event.kind === "procedure" || event.kind === "medication" || event.vitals ? (
                  <button
                    aria-label={`Edit ${presentation.title} at ${event.time}. ${eventDetail}`}
                    className="timeline-event-button"
                    type="button"
                    onClick={(clickEvent) => {
                      rememberTrigger(clickEvent.currentTarget);
                      if (event.vitals) setOpenNullField(null);
                      dispatch({ type: event.vitals ? "vitals-opened" : event.kind === "procedure" ? "procedure-opened" : event.kind === "medication" ? "medication-opened" : "note-opened", id: event.id });
                    }}
                  >
                    <span className="event-title">{presentation.title}</span>
                    <span className="event-detail">{eventDetail}</span>
                    <small>{presentation.reference} · Tap to edit</small>
                    {event.procedure && validateProcedure({
                      id: event.id,
                      date: event.date ?? "2026-04-18",
                      time: event.time,
                      procedureCode: event.procedure.code,
                      procedureLabel: event.procedure.label,
                      attempts: String(event.procedure.attempts),
                      success: event.procedure.success,
                      outcome: event.procedure.outcome,
                      complications: event.procedure.complications,
                      warningAcknowledged: event.procedure.warningAcknowledged,
                      isNew: false,
                    }, procedureDefinition).warnings.length > 0 && !event.procedure.warningAcknowledged && (
                      <span className="warning-pill">{procedureDefinition.labels.warningPill}</span>
                    )}
                  </button>
                ) : (
                  <div>
                    <h2>{event.title}</h2>
                    <p>{event.detail}</p>
                    <small>{event.reference}</small>
                  </div>
                )}
              </li>;
            })}
          </ol>
        </section>
      )}
      {shell.view === "checklist" && (
        <section className="content-panel checklist-panel" aria-labelledby="checklist-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Warnings and errors</p>
              <h1 id="checklist-heading">Checklist</h1>
            </div>
            <span aria-live="polite">{reviewFindings.length} open</span>
          </div>
          {!reviewFindings.length ? <p className="review-empty checklist-empty">✓ No warnings or errors.</p> : (
            <ul className="review-findings checklist-findings">
              {reviewFindings.map((finding) => (
                <li key={finding.id} className={finding.severity}>
                  <button type="button" onClick={(event) => editValidationFinding(finding, event.currentTarget)}>
                    <span className="finding-category">{finding.severity === "error" ? "Error" : "Warning"} · {finding.category}</span>
                    <strong>{finding.title}</strong>
                    <span>{finding.message}</span>
                    <small>{finding.target.vitalField ? "Edit value or choose PN/NV × →" : "Edit affected entry →"}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {shell.view === "review" && (
        <ReviewPanel
          findings={reviewFindings}
          errors={reviewErrors}
          warnings={reviewWarnings}
          groups={bundledEncounterDefinition.composition.review.groups}
          canFinish={canFinish}
          validationClear={validationClear}
          signing={signing}
          signError={signError}
          onFinding={editValidationFinding}
          onWarning={(id, acknowledged) => dispatch({ type: "review-warning-acknowledged", id, acknowledged })}
          onSign={() => void signRecord()}
        />
      )}

      {shell.noteDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-dialog-title">
            <div className="note-dialog-heading">
              <div>
                <p className="eyebrow">{shell.noteDraft.isNew ? noteDefinition.labels.newEyebrow : noteDefinition.labels.editEyebrow}</p>
                <h2 id="note-dialog-title">{noteDefinition.labels.editorTitle}</h2>
              </div>
              <button className="remove-entry-button" type="button" onClick={() => dispatch({ type: "note-removed" })}>{noteDefinition.labels.remove}</button>
            </div>
            <TimePicker className={noteTimeFindingActive ? `finding-frame ${editingFinding!.severity}` : undefined} label={noteDefinition.labels.time} date={shell.noteDraft.date} onDateChange={(value) => dispatch({ type: "note-draft-changed", field: "date", value })} describedBy="clinical-time-help" value={shell.noteDraft.time} onChange={(value) => dispatch({ type: "note-draft-changed", field: "time", value })} />
            <small id="clinical-time-help">{noteDefinition.labels.timeHelp}</small>
            <label className={noteSummaryFindingActive ? `finding-frame ${editingFinding!.severity}` : undefined}>
              {noteDefinition.labels.summary}
              <textarea
                ref={noteSummary}
                data-dialog-initial-focus
                rows={5}
                placeholder={noteDefinition.labels.summaryPlaceholder}
                required={noteDefinition.required.summary}
                value={shell.noteDraft.summary}
                onChange={(event) => dispatch({ type: "note-draft-changed", field: "summary", value: event.target.value })}
              />
            </label>
            <div className="note-dialog-actions">
              <button type="button" onClick={() => dispatch({ type: "note-cancelled" })}>{noteDefinition.labels.cancel}</button>
              <button type="button" onClick={() => dispatch({ type: "note-saved" })}>
                {shell.noteDraft.isNew ? noteDefinition.labels.add : noteDefinition.labels.save}
              </button>
            </div>
          </section>
        </div>
      )}
      {shell.medicationDraft && <MedicationDialog definition={bundledEncounterDefinition} dialogRef={dialog} draft={shell.medicationDraft} dispatch={dispatch} finding={editingFinding?.category === medicationDefinition.labels.category ? editingFinding : undefined} />}

      {shell.procedureDraft && <ProcedureDialog dialogRef={dialog} draft={shell.procedureDraft} definition={procedureDefinition} search={procedureSearch} onSearch={setProcedureSearch} dispatch={dispatch} finding={editingFinding ?? undefined} />}

      {shell.vitalDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog vital-dialog" role="dialog" aria-modal="true" aria-labelledby="vital-dialog-title">
            <div className="note-dialog-heading">
              <div><p className="eyebrow">{shell.vitalDraft.isNew ? vitalDefinition.labels.newEyebrow : vitalDefinition.labels.editEyebrow}</p><h2 id="vital-dialog-title">{vitalDefinition.labels.editorTitle}</h2></div>
              <button className="remove-entry-button" type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-removed" }); }}>{vitalDefinition.labels.remove}</button>
            </div>
            <TimePicker className={vitalFindingActive && editingFinding && !editingFinding.target.vitalField ? `finding-frame ${editingFinding.severity}` : undefined} initialFocus label={vitalDefinition.labels.time} date={shell.vitalDraft.date} onDateChange={(value) => dispatch({ type: "vitals-date-changed", value })} value={shell.vitalDraft.time} onChange={(value) => dispatch({ type: "vitals-time-changed", value })} />
            <div className="vital-grid">
              {vitalDefinition.fields.map((configuredField) => {
                const field = configuredField.id;
                return (
                <div className={`vital-field ${vitalFindingActive && editingFinding?.target.vitalField === field ? `finding-frame ${editingFinding.severity}` : ""}`.trim()} key={field}>
                  <label htmlFor={`vital-${field}`}>{configuredField.label} <small>{configuredField.unit}</small></label>
                  <div className="vital-inputs">
                    <input id={`vital-${field}`} inputMode="numeric" required={configuredField.required} placeholder={`${configuredField.boundaries.min}–${configuredField.boundaries.max}`} value={shell.vitalDraft!.values[field]} onChange={(event) => dispatch({ type: "vitals-value-changed", field, value: event.target.value })} />
                    <button
                      type="button"
                      className={`null-value-trigger ${shell.vitalDraft!.values.nullValues[field] ? "active" : ""}`}
                      aria-label={`Set unavailable or pertinent-negative value for ${configuredField.label}`}
                      aria-expanded={openNullField === field}
                      onClick={() => setOpenNullField((current) => current === field ? null : field)}
                    >×</button>
                    {openNullField === field && (
                      <div className="null-value-menu" role="menu" aria-label={`${configuredField.label} unavailable or pertinent-negative value`}>
                        {shell.vitalDraft!.values.nullValues[field] && (
                          <button
                            autoFocus
                            type="button"
                            role="menuitem"
                            onClick={() => { dispatch({ type: "vitals-null-changed", field, value: "" }); setOpenNullField(null); }}
                          >Clear exceptional value</button>
                        )}
                        {nullOptionsFor(configuredField).filter((option) => option.value).map((option, index) => (
                          <button
                            autoFocus={!shell.vitalDraft!.values.nullValues[field] && index === 0}
                            key={option.value}
                            type="button"
                            role="menuitem"
                            onClick={() => { dispatch({ type: "vitals-null-changed", field, value: option.value }); setOpenNullField(null); }}
                          >{option.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );})}
            </div>
            <p className="null-help">{vitalDefinition.labels.absenceHelp}</p>
            <div className="note-dialog-actions"><button type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-cancelled" }); }}>{vitalDefinition.labels.cancel}</button><button type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-saved" }); }}>{shell.vitalDraft.isNew ? vitalDefinition.labels.add : vitalDefinition.labels.save}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return <ClinicianSessionGate>{({ session, report, closeReport, sessionEnded }) => (
    <EncounterWorkspace key={report?.id ?? "standalone"} session={session} report={report} onSaveAndClose={closeReport} onSessionEnded={sessionEnded} />
  )}</ClinicianSessionGate>;
}

function ReviewPanel({ findings, errors, warnings, groups, canFinish, validationClear, signing, signError, onFinding, onWarning, onSign }: {
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly errors: ReadonlyArray<ReviewFinding>;
  readonly warnings: ReadonlyArray<ReviewFinding>;
  readonly groups: typeof bundledEncounterDefinition.composition.review.groups;
  readonly canFinish: boolean;
  readonly validationClear: boolean;
  readonly signing: boolean;
  readonly signError: string | null;
  readonly onFinding: (finding: ReviewFinding, trigger: HTMLElement) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
  readonly onSign: () => void;
}) {
  return (
    <section className="content-panel review-panel" aria-labelledby="review-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Consolidated validation</p><h1 id="review-heading">Review and sign</h1></div>
        <span>{errors.length} errors · {warnings.length} warnings</span>
      </div>
      <p className="review-intro">Resolve every blocking error and acknowledge each warning before signing the record.</p>

      {groups.map((group) => <FindingGroup key={group.severity} title={group.title} empty={group.empty} findings={findings.filter((finding) => finding.severity === group.severity)} onFinding={onFinding} onWarning={onWarning} />)}

      <div className="review-actions">
        <button className={validationClear ? "validation-clear" : undefined} type="button" disabled={!canFinish || signing} onClick={onSign}>{signing ? "Signing…" : "Sign record"}</button>
      </div>
      {!canFinish && <p className="finish-help" role="status">Signing stays blocked until errors are fixed and every warning is acknowledged.</p>}
      {signError && <p className="finish-help" role="alert">{signError}</p>}
    </section>
  );
}

function FindingGroup({ title, empty, findings, onFinding, onWarning }: {
  readonly title: string;
  readonly empty: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly onFinding: (finding: ReviewFinding, trigger: HTMLElement) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
}) {
  return (
    <section className="review-group">
      <h2>{title} <span>{findings.length}</span></h2>
      {!findings.length ? <p className="review-empty">✓ {empty}</p> : (
        <ul className="review-findings">
          {findings.map((finding) => (
            <li key={finding.id} className={finding.severity}>
              <button type="button" onClick={(event) => onFinding(finding, event.currentTarget)}>
                <span className="finding-category">{finding.category} · {finding.reference}</span>
                <strong>{finding.title}</strong>
                <span>{finding.message}</span>
                <small>Open affected entry →</small>
              </button>
              {finding.severity === "warning" && (
                <label className="review-acknowledgement">
                  <input type="checkbox" checked={finding.acknowledged} onChange={(event) => onWarning(finding.id, event.target.checked)} />
                  I reviewed and acknowledge this warning
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
