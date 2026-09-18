"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SyntheticEvent } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { ProcedureDialog } from "../components/procedure-dialog";
import { QuickActionIcon } from "../components/quick-action-icon";
import { StationaryRecord } from "../components/stationary-record";
import { TimePicker } from "../components/time-picker";
import { DialogValidationMessage } from "../components/dialog-validation-message";
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
  signDraftReport,
  type ActiveDraftReport,
  dispatchCancellationNotice,
} from "./draft-report";
import type { ClinicianSession, DispatchConflict, DispatchConflictDisposition, EncounterValue } from "@open-triage/contracts";
import { sessionRequestToken } from "./clinician-session";
import { nextDraftChange } from "./offline-reports";
import type { PresentationMode } from "./presentation-mode";
import { useReportWorkspace } from "./report-workspace";
import { DEMO_CLEAR_EVENT, DEMO_FALLBACK_DATE, DEMO_POPULATE_EVENT } from "./demo-provenance";
import { stationarySectionForGroup } from "./stationary-record";
import { stationaryReviewFindings, validateStationaryRecord, type StationaryValidationFinding } from "./stationary-validation";
import { stationarySigningBlockers } from "./stationary-signing";
import { repeatingDialogPath } from "./stationary-repeating-group";
import { canUseClinicalDemoDraftActions } from "./clinical-demo";
import { browserRequestConfiguration } from "./browser-api";
import { flushProtectedReport } from "./protected-clinical-storage";

type SigningFinding = ReviewFinding | StationaryValidationFinding;

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

function EncounterWorkspace({ session, report, presentationMode, onSaveAndClose, onReportCompleted, onSessionEnded, onErrorStateChange }: {
  readonly session: ClinicianSession;
  readonly report: ActiveDraftReport | null;
  readonly presentationMode: PresentationMode;
  readonly onSaveAndClose: () => void;
  readonly onReportCompleted: () => void;
  readonly onSessionEnded: () => void;
  readonly onErrorStateChange: (hasErrors: boolean) => void;
}) {
  const [shell, dispatch] = useReducer(standardEncounterReducer, INITIAL_SHELL_STATE);
  const [procedureSearch, setProcedureSearch] = useState("");
  const [openNullField, setOpenNullField] = useState<VitalField | null>(null);
  const [editingFinding, setEditingFinding] = useState<SigningFinding | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const encounter = shell.encounter;
  const incident = useMemo(() => incidentSummary(encounter.document), [encounter.document]);
  const incidentEvents = useMemo(
    () => documentTimeline(encounter.document, report?.agencyTimeZone),
    [encounter.document, report?.agencyTimeZone],
  );
  const clinicalEvents = useMemo(() => encounterEvents(encounter.document, bundledEncounterDefinition), [encounter.document]);
  const timelineEvents = useMemo(() => [...incidentEvents, ...clinicalEvents].sort((a, b) =>
    `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`),
  ), [incidentEvents, clinicalEvents]);
  const noteDefinition = bundledEncounterDefinition.events.note;
  const procedureDefinition = bundledEncounterDefinition.events.procedure;
  const medicationDefinition = bundledEncounterDefinition.events.medication;
  const vitalDefinition = bundledEncounterDefinition.events.vitals;
  const reviewFindings = useMemo(() => reviewEncounter(shell), [shell]);
  const stationaryFindings = useMemo(() => validateStationaryRecord(encounter.document, report?.clinicalForm), [encounter.document, report?.clinicalForm]);
  const configuredStationaryFindings: ReadonlyArray<SigningFinding> = useMemo(
    () => [...stationaryFindings, ...stationaryReviewFindings(reviewFindings, report?.clinicalForm)],
    [report?.clinicalForm, reviewFindings, stationaryFindings],
  );
  const activeFindings: ReadonlyArray<SigningFinding> = presentationMode === "stationary" ? configuredStationaryFindings : reviewFindings;
  const reviewErrors = activeFindings.filter((finding) => finding.severity === "error");
  const reviewWarnings = activeFindings.filter((finding) => finding.severity === "warning");
  const {
    restored, recoveryNotice, recoveryNoticeHeading, bestEffortNoticeInDemoBanner, syncStatus, revision, dispatchConflicts, dispatchCancellation,
    conflictError, editingBlocked, flushSave, completeReport: completeWorkspaceReport, resolveConflict,
  } = useReportWorkspace({
    session, report, presentationMode, shell, dispatch,
    validationErrorCount: reviewErrors.length, online,
    onSessionEnded,
    onReportCompleted,
  });
  useEffect(() => {
    onErrorStateChange(reviewErrors.length > 0 || Boolean((recoveryNotice && !bestEffortNoticeInDemoBanner) || signError || conflictError));
  }, [bestEffortNoticeInDemoBanner, conflictError, onErrorStateChange, recoveryNotice, reviewErrors.length, signError]);
  const validationClear = reviewErrors.length === 0 && reviewWarnings.length === 0;
  const eventValidationStatuses = useMemo(() => {
    const statuses = new Map<string, "warning" | "error">();
    for (const finding of reviewFindings) {
      if (finding.severity === "error" || !statuses.has(finding.target.eventId)) statuses.set(finding.target.eventId, finding.severity);
    }
    return statuses;
  }, [reviewFindings]);
  const unresolvedDispatchConflicts = dispatchConflicts.filter(({ disposition }) => disposition === null);
  const signingBlockers = stationarySigningBlockers({
    presentationMode, restored, online, syncStatus, errorCount: reviewErrors.length,
    warnings: reviewWarnings, unresolvedDispatchConflictCount: unresolvedDispatchConflicts.length,
  });
  const canFinish = signingBlockers.length === 0;
  const vitalDraftValidation = shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values, bundledEncounterDefinition) : null;
  const editingVitalField = editingFinding && "vitalField" in editingFinding.target ? editingFinding.target.vitalField : undefined;
  const vitalFindingActive = !!(editingFinding?.category === vitalDefinition.labels.category && vitalDraftValidation && [...Object.values(vitalDraftValidation.errors), ...Object.values(vitalDraftValidation.warnings)].includes(editingFinding.message));
  const noteFindingActive = !!(editingFinding?.category === noteDefinition.labels.category && shell.noteDraft);
  const noteSummaryFindingActive = noteFindingActive && editingFinding?.message === noteDefinition.validationMessages.summaryRequired;
  const activeDialog = shell.noteDraft ? "note" : shell.medicationDraft ? "medication" : shell.procedureDraft ? "procedure" : shell.vitalDraft ? "vitals" : null;

  useEffect(() => {
    if (presentationMode === "mobile" && shell.view === "review") dispatch({ type: "view-selected", view: "timeline" });
  }, [presentationMode, shell.view]);

  useEffect(() => {
    const authorized = () => canUseClinicalDemoDraftActions(report) && navigator.onLine &&
      browserRequestConfiguration().mode === "server" && session.capabilities?.includes("clinical:demo") === true;
    const populate = () => { if (authorized()) dispatch({ type: "demo-populated" }); };
    const clear = () => { if (authorized()) dispatch({ type: "demo-cleared" }); };
    window.addEventListener(DEMO_POPULATE_EVENT, populate);
    window.addEventListener(DEMO_CLEAR_EVENT, clear);
    return () => {
      window.removeEventListener(DEMO_POPULATE_EVENT, populate);
      window.removeEventListener(DEMO_CLEAR_EVENT, clear);
    };
  }, [report, session.capabilities]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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

  function navigateToStationaryFinding(finding: SigningFinding) {
    dispatch({ type: "view-selected", view: "timeline" });
    const target = finding.target;
    window.requestAnimationFrame(() => {
      const section = stationarySectionForGroup(target.groupId);
      if (section) window.history.pushState(null, "", `#${section.hash}`);
      const escape = (value: string) => CSS.escape(value);
      const instanceId = "groupInstanceId" in target ? target.groupInstanceId : target.instanceId;
      const focusTarget = () => {
        const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
        const group = document.querySelector<HTMLElement>(`[data-group-id="${escape(target.groupId)}"]`);
        const scope = dialogs.item(dialogs.length - 1) ?? group;
        const elementId = "fieldId" in target ? target.fieldId : target.elementId;
        const occurrenceId = "occurrenceId" in target ? target.occurrenceId : undefined;
        const occurrence = occurrenceId ? scope?.querySelector<HTMLElement>(`[data-occurrence-id="${escape(occurrenceId)}"]`) : null;
        const field = elementId ? scope?.querySelector<HTMLElement>(`[data-element-id="${escape(elementId)}"]`) : null;
        const destination = occurrence ?? field ?? scope;
        destination?.scrollIntoView({ block: "center" });
        (destination?.matches("button, input, select, textarea") ? destination : destination?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]"))?.focus();
        setNavigationMessage(`Opened ${finding.reference} for correction.`);
      };
      const dialogPath = instanceId ? repeatingDialogPath(shell.encounter.document, target.groupId, instanceId) : [];
      const openDialog = (index: number) => {
        if (index >= dialogPath.length) return window.requestAnimationFrame(focusTarget);
        const step = dialogPath[index]!;
        const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
        const scope: ParentNode = dialogs.item(dialogs.length - 1) ?? document;
        const group = scope.querySelector<HTMLElement>(`[data-group-id="${escape(step.groupId)}"]`);
        const row = group?.querySelector<HTMLElement>(`[data-group-instance-id="${escape(step.instanceId)}"]`)?.closest("tr");
        const edit = row?.querySelector<HTMLButtonElement>("button.stationary-icon-action.edit, button");
        if (!edit) return focusTarget();
        edit.click();
        window.requestAnimationFrame(() => openDialog(index + 1));
      };
      if (dialogPath.length) openDialog(0);
      else {
        const group = document.querySelector<HTMLElement>(`[data-group-id="${escape(target.groupId)}"]`);
        if (!instanceId) group?.querySelector<HTMLButtonElement>(".stationary-group-add-controls button, button")?.click();
        window.requestAnimationFrame(focusTarget);
      }
    });
  }

  function editValidationFinding(finding: SigningFinding, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(finding);
    setOpenNullField(null);
    if (presentationMode === "stationary") {
      navigateToStationaryFinding(finding);
      return;
    }
    if (!("eventType" in finding)) return;
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
    try {
      await flushSave();
      await flushProtectedReport(report.id);
    } catch {
      setSignError("The record must finish protected storage before it can be signed.");
      setSigning(false);
      return;
    }
    if (!navigator.onLine || nextDraftChange(window.localStorage, report.id)) {
      setSignError("The record must finish syncing before it can be signed.");
      setSigning(false);
      return;
    }
    try {
      await signDraftReport(sessionRequestToken(session), report.id, revision.current, session.user.id, shell.acknowledgedWarnings);
      completeWorkspaceReport();
    } catch (error) {
      setSignError(error instanceof Error ? error.message : "The record could not be signed.");
    } finally {
      setSigning(false);
    }
  }

  async function disposeConflict(conflict: DispatchConflict, disposition: DispatchConflictDisposition) {
    await resolveConflict(conflict, disposition);
  }

  const blockProtectedEdit = (event: SyntheticEvent<HTMLElement>) => {
    if (!editingBlocked) return;
    const target = event.target as HTMLElement;
    if (!target.closest("button, input, select, textarea, label, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <main className={`app-shell ${presentationMode}-presentation`} data-presentation-mode={presentationMode}
      data-editing-blocked={editingBlocked || undefined} onClickCapture={blockProtectedEdit}
      onBeforeInputCapture={blockProtectedEdit} onKeyDownCapture={blockProtectedEdit}>
      {recoveryNotice && !bestEffortNoticeInDemoBanner && <aside className="safety-notice" role="status"><strong>{recoveryNoticeHeading}</strong><span>{recoveryNotice}</span></aside>}
      {dispatchCancellation && <aside className="dispatch-canceled-notice" role="status">
        <strong>Dispatch canceled this response</strong>
        <span>{dispatchCancellationNotice(dispatchCancellation)}</span>
      </aside>}
      {navigationMessage && <p className="visually-hidden" role="status" aria-live="polite">{navigationMessage}</p>}

      <header className="encounter-header">
        {presentationMode === "stationary" ? <div className="encounter-summary" aria-label="Call information">
          <span><small>Response</small><strong>{incident.responseNumber || "Not provided"}</strong></span>
          <span><small>Unit</small><strong>{incident.callSign || "Not provided"}</strong></span>
          <span><small>Priority</small><strong>{incident.dispatchPriority || "Not provided"}</strong></span>
          <span className="encounter-location"><small>Location</small><strong>{incident.location || "Not provided"}</strong></span>
        </div> : <>
          <div className="header-kicker"><span>{incidentEvents[0]?.time ?? "--:--"}</span></div>
          <div className="incident-line"><div>
            <span>{bundledEncounterDefinition.labels.incident} {incident.incidentNumber}</span>
            <span>Response {incident.responseNumber}</span>
            <span>Unit {incident.callSign}</span>
            <span>Priority {incident.dispatchPriority || "Not provided"}</span>
            <strong>{incident.location}</strong>
          </div></div>
        </>}
        {report && <div className="draft-actions">
          <span className={`sync-status sync-${syncStatus.toLocaleLowerCase().replaceAll(" ", "-")}`} role="status" aria-live="polite">{syncStatus}</span>
          {presentationMode === "stationary" && <button className="review-record-action" type="button" onClick={() => dispatch(shell.view === "review" ? { type: "view-selected", view: "timeline" } : { type: "review-opened" })}>{shell.view === "review" ? "Return to record" : "Review & sign"}</button>}
          <button type="button" onClick={async () => { await flushSave(); onSaveAndClose(); }}>Save &amp; close</button>
        </div>}
      </header>

      {presentationMode === "mobile" && <nav className="quick-actions" aria-label="Quick documentation">
        {configuredQuickActions(bundledEncounterDefinition).map((action) => <button key={action.id} className={activeDialog === action.id ? "active" : undefined} aria-pressed={activeDialog === action.id} title={action.title} aria-label={action.label} type="button" onClick={quickActionHandlers[action.id]}><QuickActionIcon kind={action.id} /><span aria-hidden="true">{quickActionText[action.id]}</span></button>)}
      </nav>}

      {presentationMode === "mobile" && <nav className="view-switcher" aria-label="Encounter views">
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
              <span className={`error-count${reviewErrors.length ? "" : " zero-count"}`}>{reviewErrors.length} {reviewErrors.length === 1 ? "error" : "errors"}</span>
              <span className={`warning-count${reviewWarnings.length ? "" : " zero-count"}`}>{reviewWarnings.length} {reviewWarnings.length === 1 ? "warning" : "warnings"}</span>
            </span>}
          </button>
        ))}
      </nav>}

      {presentationMode === "stationary" && (
        <div hidden={shell.view === "review"}>
          <StationaryRecord
            document={encounter.document}
            findings={configuredStationaryFindings}
            formDefinition={report?.clinicalForm?.definition}
            catalogFields={report?.clinicalForm?.catalogFields}
            onDocumentChange={(document) => dispatch({ type: "document-opened", document })}
          />
        </div>
      )}

      {presentationMode === "mobile" && shell.view === "timeline" && (
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
                <time dateTime={event.dateTime ?? `${event.date ?? DEMO_FALLBACK_DATE}T${event.time}:00`}>{event.time}</time>
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
                      date: event.date ?? DEMO_FALLBACK_DATE,
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
      {presentationMode === "mobile" && shell.view === "checklist" && (
        <section className="content-panel checklist-panel" aria-labelledby="checklist-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Warnings and errors</p>
              <h1 id="checklist-heading">Checklist</h1>
            </div>
            <span aria-live="polite">{reviewFindings.length + unresolvedDispatchConflicts.length} open</span>
          </div>
          {!reviewFindings.length && !unresolvedDispatchConflicts.length ? <p className="review-empty checklist-empty">✓ No warnings or errors.</p> : reviewFindings.length ? (
            <ul className="review-findings checklist-findings">
              {reviewFindings.map((finding) => (
                <li key={finding.id} className={finding.severity}>
                  <button type="button" onClick={(event) => editValidationFinding(finding, event.currentTarget)}>
                    <span className="finding-category">{finding.severity === "error" ? "Error" : "Warning"} · {finding.category}</span>
                    <strong>{finding.title}</strong>
                    <span>{finding.message}</span>
                    <small>{"vitalField" in finding.target && finding.target.vitalField ? "Edit value or choose PN/NV × →" : "Edit affected entry →"}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <DispatchConflictList conflicts={dispatchConflicts} onDispose={disposeConflict} />
          {conflictError && <p className="finish-help" role="alert">{conflictError}</p>}
        </section>
      )}

      {presentationMode === "stationary" && shell.view === "review" && (
        <>
        <ReviewPanel
          findings={configuredStationaryFindings}
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
          blockedReason={!restored ? "The report is still loading."
            : !online ? "Signing is unavailable while offline. Reconnect and finish synchronization."
              : syncStatus !== "Saved" ? "Signing is unavailable until all changes finish synchronizing."
                : unresolvedDispatchConflicts.length ? "Resolve every dispatch difference before signing."
                  : undefined}
        />
        <DispatchConflictList conflicts={dispatchConflicts} onDispose={disposeConflict} />
        {conflictError && <p className="finish-help" role="alert">{conflictError}</p>}
        </>
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
              <DialogValidationMessage finding={noteSummaryFindingActive ? editingFinding : undefined} />
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

      {shell.procedureDraft && <ProcedureDialog dialogRef={dialog} draft={shell.procedureDraft} definition={procedureDefinition} search={procedureSearch} onSearch={setProcedureSearch} dispatch={dispatch} finding={editingFinding && "eventType" in editingFinding ? editingFinding : undefined} />}

      {shell.vitalDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog vital-dialog" role="dialog" aria-modal="true" aria-labelledby="vital-dialog-title">
            <div className="note-dialog-heading">
              <div><p className="eyebrow">{shell.vitalDraft.isNew ? vitalDefinition.labels.newEyebrow : vitalDefinition.labels.editEyebrow}</p><h2 id="vital-dialog-title">{vitalDefinition.labels.editorTitle}</h2></div>
              <button className="remove-entry-button" type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-removed" }); }}>{vitalDefinition.labels.remove}</button>
            </div>
            <TimePicker className={vitalFindingActive && editingFinding && !editingVitalField ? `finding-frame ${editingFinding.severity}` : undefined} initialFocus label={vitalDefinition.labels.time} date={shell.vitalDraft.date} onDateChange={(value) => dispatch({ type: "vitals-date-changed", value })} value={shell.vitalDraft.time} onChange={(value) => dispatch({ type: "vitals-time-changed", value })} />
            <DialogValidationMessage finding={vitalFindingActive && !editingVitalField ? editingFinding : undefined} />
            <div className="vital-grid">
              {vitalDefinition.fields.map((configuredField) => {
                const field = configuredField.id;
                return (
                <div className={`vital-field ${vitalFindingActive && editingVitalField === field ? `finding-frame ${editingFinding!.severity}` : ""}`.trim()} key={field}>
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
                  <DialogValidationMessage finding={vitalFindingActive && editingVitalField === field ? editingFinding : undefined} />
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
  return <ClinicianSessionGate>{({ session, report, presentationMode, closeReport, completeReport, sessionEnded, reportErrorStateChanged }) => (
    <EncounterWorkspace key={report?.id ?? "standalone"} session={session} report={report} presentationMode={presentationMode} onSaveAndClose={closeReport} onReportCompleted={completeReport} onSessionEnded={sessionEnded} onErrorStateChange={reportErrorStateChanged} />
  )}</ClinicianSessionGate>;
}

function conflictValue(value: EncounterValue | null): string {
  if (value === null) return "Retracted by dispatch";
  if (value.kind === "coded") return value.display ?? value.code;
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "Null";
  if (value.kind === "absent") return "Not documented";
  return String(value.value);
}

function DispatchConflictList({ conflicts, onDispose }: {
  readonly conflicts: ReadonlyArray<DispatchConflict>;
  readonly onDispose: (conflict: DispatchConflict, disposition: DispatchConflictDisposition) => void;
}) {
  const unresolved = conflicts.filter(({ disposition }) => disposition === null);
  return (
    <section className="review-group dispatch-conflicts" aria-labelledby="dispatch-conflicts-heading">
      <h2 id="dispatch-conflicts-heading">Dispatch differences <span>{unresolved.length}</span></h2>
      {!unresolved.length ? <p className="review-empty">✓ No unresolved dispatch differences.</p> : (
        <ul className="review-findings">
          {unresolved.map((conflict) => <li key={conflict.id} className="warning">
            <span className="finding-category">Dispatch revision {conflict.dispatchRevision} · {conflict.elementId}</span>
            <strong>Clinician value: {conflictValue(conflict.clinicianValue)}</strong>
            <span>Dispatch proposes: {conflictValue(conflict.dispatchValue)}</span>
            <div className="dispatch-conflict-actions">
              <button type="button" onClick={() => onDispose(conflict, "keep")}>Keep my value</button>
              <button type="button" onClick={() => onDispose(conflict, "accept")}>Accept dispatch value</button>
              <button type="button" onClick={() => onDispose(conflict, "acknowledge")}>Acknowledge difference</button>
            </div>
          </li>)}
        </ul>
      )}
    </section>
  );
}

function ReviewPanel({ findings, errors, warnings, groups, canFinish, validationClear, signing, signError, blockedReason, onFinding, onWarning, onSign }: {
  readonly findings: ReadonlyArray<SigningFinding>;
  readonly errors: ReadonlyArray<SigningFinding>;
  readonly warnings: ReadonlyArray<SigningFinding>;
  readonly groups: typeof bundledEncounterDefinition.composition.review.groups;
  readonly canFinish: boolean;
  readonly validationClear: boolean;
  readonly signing: boolean;
  readonly signError: string | null;
  readonly blockedReason?: string;
  readonly onFinding: (finding: SigningFinding, trigger: HTMLElement) => void;
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
      {!canFinish && <p className="finish-help" role="status">{blockedReason ?? "Signing stays blocked until errors are fixed and every warning is acknowledged."}</p>}
      {signError && <p className="finish-help" role="alert">{signError}</p>}
    </section>
  );
}

function FindingGroup({ title, empty, findings, onFinding, onWarning }: {
  readonly title: string;
  readonly empty: string;
  readonly findings: ReadonlyArray<SigningFinding>;
  readonly onFinding: (finding: SigningFinding, trigger: HTMLElement) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
}) {
  return (
    <section className="review-group">
      <h2>{title} <span className={findings.length ? undefined : "zero-count"}>{findings.length}</span></h2>
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
