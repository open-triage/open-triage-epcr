"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { PatientDialog } from "../components/patient-dialog";
import { ProcedureDialog } from "../components/procedure-dialog";
import { QuickActionIcon } from "../components/quick-action-icon";
import { TimePicker } from "../components/time-picker";
import { clearShellState, loadShellStateResult, saveShellState } from "./local-persistence";
import { validateProcedure } from "./procedure";
import { configuredQuickActions, type QuickActionId } from "./encounter-definition";
import {
  completedSummaryEvents,
  INITIAL_SHELL_STATE,
  encounterEventDetail,
  encounterEventPresentation,
  reviewEncounter,
  standardEncounterReducer,
  type ReviewFinding,
  type ShellState,
  type ShellView,
  type VitalField,
  bundledEncounterDefinition,
} from "./standard-encounter";
import { nullOptionsFor, validateVitals } from "./vital-validation";
import { localClinicalDate } from "./time-picker";
import { patientSummary } from "./patient-document";
import { documentTimeline, incidentSummary } from "./incident-document";
import { ClinicianSessionGate } from "../components/clinician-session-gate";

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

function localClinicalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function EncounterWorkspace() {
  const [shell, dispatch] = useReducer(standardEncounterReducer, INITIAL_SHELL_STATE);
  const [restored, setRestored] = useState(false);
  const [procedureSearch, setProcedureSearch] = useState("");
  const [openNullField, setOpenNullField] = useState<VitalField | null>(null);
  const [patientOpen, setPatientOpen] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [editingFinding, setEditingFinding] = useState<ReviewFinding | null>(null);
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const encounter = shell.encounter;
  const patient = useMemo(() => patientSummary(encounter.document), [encounter.document]);
  const incident = useMemo(() => incidentSummary(encounter.document), [encounter.document]);
  const incidentEvents = useMemo(() => documentTimeline(encounter.document), [encounter.document]);
  const timelineEvents = useMemo(() => [...incidentEvents, ...encounter.events].sort((a, b) =>
    `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`),
  ), [incidentEvents, encounter.events]);
  const noteDefinition = bundledEncounterDefinition.events.note;
  const procedureDefinition = bundledEncounterDefinition.events.procedure;
  const medicationDefinition = bundledEncounterDefinition.events.medication;
  const vitalDefinition = bundledEncounterDefinition.events.vitals;
  const reviewFindings = useMemo(() => reviewEncounter(shell), [shell]);
  const reviewErrors = reviewFindings.filter((finding) => finding.severity === "error");
  const reviewWarnings = reviewFindings.filter((finding) => finding.severity === "warning");
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
  const activeDialog = patientOpen ? "patient" : shell.noteDraft ? "note" : shell.medicationDraft ? "medication" : shell.procedureDraft ? "procedure" : shell.vitalDraft ? "vitals" : null;

  const closeActiveDialog = useCallback(() => {
    if (activeDialog === "patient") setPatientOpen(false);
    else if (activeDialog === "note") dispatch({ type: "note-cancelled" });
    else if (activeDialog === "medication") dispatch({ type: "medication-cancelled" });
    else if (activeDialog === "procedure") dispatch({ type: "procedure-cancelled" });
    else if (activeDialog === "vitals") {
      setOpenNullField(null);
      dispatch({ type: "vitals-cancelled" });
    }
  }, [activeDialog]);

  useEffect(() => {
    const result = loadShellStateResult(window.localStorage);
    if (result.status === "restored") dispatch({ type: "state-restored", state: result.state });
    else if (result.status === "incompatible") queueMicrotask(() => setRecoveryNotice(`Saved encounter ${result.savedDefinition.id ?? "(unknown)"} version ${result.savedDefinition.version ?? "(unknown)"} is incompatible. Its original JSON was preserved in ${result.recoveryKey}.`));
    else if (result.status === "invalid") queueMicrotask(() => setRecoveryNotice(`Saved encounter could not be loaded: ${result.reason}. Its original JSON was preserved in ${result.recoveryKey}.`));
    // Hydration must finish before the baseline is allowed to overwrite browser progress.
    queueMicrotask(() => setRestored(true));
  }, []);

  useEffect(() => {
    if (restored) saveShellState(window.localStorage, shell);
  }, [restored, shell]);

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
    dispatch({ type: "review-finding-selected", id: finding.id });
  }

  function startNote(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    dispatch({ type: "note-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }
  function startPatient(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setPatientOpen(true);
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

  function resetPrototype() {
    if (!window.confirm("Remove your notes and restore the original synthetic encounter?")) return;
    clearShellState(window.localStorage);
    dispatch({ type: "prototype-reset" });
  }

  const quickActionHandlers: Record<QuickActionId, (event: React.MouseEvent<HTMLButtonElement>) => void> = {
    vitals: startVitals, medication: startMedication, procedure: startProcedure, note: startNote, patient: startPatient,
  };

  return (
    <main className="app-shell">
      <aside className="safety-notice" role="note" aria-label="Prototype safety notice">
        <strong>Synthetic data only</strong>
        <span>Usability prototype — not for clinical use</span>
      </aside>
      {recoveryNotice && <aside className="safety-notice" role="alert"><strong>Saved data needs recovery</strong><span>{recoveryNotice}</span></aside>}

      <header className="encounter-header">
        <div className="header-kicker">
          <span>{incidentEvents[0]?.time ?? "--:--"}</span>
          <span className="prototype-status">{bundledEncounterDefinition.labels.prototypeStatus}</span>
        </div>
        <div className="patient-line">
          <div>
            <p className="patient-name">{patient.name}</p>
            <p className="patient-demographics">
              {patient.age}{typeof patient.age === "number" ? " y" : ""} · {patient.sex} · {patient.identifier}
            </p>
          </div>
          <span className="crew-badge" aria-label={`Crew ${incident.crew}`}>{incident.crew}</span>
        </div>
        <div className="incident-line">
          <div>
            <span>{bundledEncounterDefinition.labels.incident} {incident.number}</span>
            <strong>{incident.complaint}</strong>
          </div>
        </div>
        <button className="reset-prototype" type="button" onClick={resetPrototype}>Reset prototype data</button>
      </header>

      <nav className="quick-actions" aria-label="Quick documentation">
        {configuredQuickActions(bundledEncounterDefinition).map((action) => <button key={action.id} className={activeDialog === action.id ? "active" : undefined} aria-pressed={activeDialog === action.id} title={action.title} aria-label={action.label} type="button" onClick={quickActionHandlers[action.id]}><QuickActionIcon kind={action.id} /></button>)}
      </nav>

      {shell.view !== "summary" && <nav className="view-switcher" aria-label="Encounter views">
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
      </nav>}

      {(shell.view === "timeline" || shell.view === "checklist") && (
        <div className="sign-action-bar">
          <button type="button" onClick={() => dispatch({ type: "review-opened" })}>Review &amp; sign</button>
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
          onFinding={(id) => dispatch({ type: "review-finding-selected", id })}
          onWarning={(id, acknowledged) => dispatch({ type: "review-warning-acknowledged", id, acknowledged })}
          onContinue={() => dispatch({ type: "summary-editing-continued" })}
          onFinish={() => dispatch({ type: "review-finished" })}
        />
      )}

      {shell.view === "summary" && (
        <ReadOnlySummary shell={shell} warnings={reviewWarnings} onContinue={() => dispatch({ type: "summary-editing-continued" })} />
      )}

      {patientOpen && <PatientDialog document={encounter.document} definition={bundledEncounterDefinition} dialogRef={dialog} onClose={() => setPatientOpen(false)} onSave={(document) => { dispatch({ type: "patient-updated", document }); setPatientOpen(false); }} />}

      {shell.noteDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-dialog-title">
            <div className="note-dialog-heading">
              <div>
                <p className="eyebrow">{shell.noteDraft.isNew ? noteDefinition.labels.newEyebrow : noteDefinition.labels.editEyebrow}</p>
                <h2 id="note-dialog-title">{noteDefinition.labels.editorTitle}</h2>
              </div>
              <button aria-label={noteDefinition.labels.closeEditor} type="button" onClick={() => dispatch({ type: "note-cancelled" })}>×</button>
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
              <button aria-label={vitalDefinition.labels.closeEditor} type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-cancelled" }); }}>×</button>
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
  return <ClinicianSessionGate><EncounterWorkspace /></ClinicianSessionGate>;
}

function ReviewPanel({ findings, errors, warnings, groups, canFinish, onFinding, onWarning, onContinue, onFinish }: {
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly errors: ReadonlyArray<ReviewFinding>;
  readonly warnings: ReadonlyArray<ReviewFinding>;
  readonly groups: typeof bundledEncounterDefinition.composition.review.groups;
  readonly canFinish: boolean;
  readonly onFinding: (id: string) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
  readonly onContinue: () => void;
  readonly onFinish: () => void;
}) {
  return (
    <section className="content-panel review-panel" aria-labelledby="review-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Consolidated validation</p><h1 id="review-heading">Review and finish</h1></div>
        <span>{errors.length} errors · {warnings.length} warnings</span>
      </div>
      <p className="review-intro">Resolve every blocking error and acknowledge each warning before producing the prototype summary.</p>

      {groups.map((group) => <FindingGroup key={group.severity} title={group.title} empty={group.empty} findings={findings.filter((finding) => finding.severity === group.severity)} onFinding={onFinding} onWarning={onWarning} />)}

      <div className="review-actions">
        <button type="button" onClick={onContinue}>Continue editing</button>
        <button type="button" disabled={!canFinish} onClick={onFinish}>Finish prototype</button>
      </div>
      {!canFinish && <p className="finish-help" role="status">Completion stays blocked until errors are fixed and every warning is acknowledged.</p>}
    </section>
  );
}

function FindingGroup({ title, empty, findings, onFinding, onWarning }: {
  readonly title: string;
  readonly empty: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly onFinding: (id: string) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
}) {
  return (
    <section className="review-group">
      <h2>{title} <span>{findings.length}</span></h2>
      {!findings.length ? <p className="review-empty">✓ {empty}</p> : (
        <ul className="review-findings">
          {findings.map((finding) => (
            <li key={finding.id} className={finding.severity}>
              <button type="button" onClick={() => onFinding(finding.id)}>
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

function ReadOnlySummary({ shell, warnings, onContinue }: {
  readonly shell: ShellState;
  readonly warnings: ReadonlyArray<ReviewFinding>;
  readonly onContinue: () => void;
}) {
  const encounter = shell.encounter;
  const patient = patientSummary(encounter.document);
  const incident = incidentSummary(encounter.document);
  const incidentEvents = documentTimeline(encounter.document);
  return (
    <article className="content-panel prototype-summary" aria-labelledby="summary-heading">
      <div className="summary-label" role="note">
        <strong>Synthetic usability prototype summary</strong>
        <span>Read-only preview — not a signed or complete legal clinical record</span>
      </div>
      <div className="section-heading">
        <div><p className="eyebrow">Review produced</p><h1 id="summary-heading">Encounter summary</h1></div>
      </div>
      <section className="summary-section">
        <h2>Patient and incident</h2>
        <dl>
          <div><dt>Patient</dt><dd>{patient.name} · {patient.age}{typeof patient.age === "number" ? " y" : ""} · {patient.sex}</dd></div>
          <div><dt>Synthetic ID</dt><dd>{patient.identifier}</dd></div>
          <div><dt>Incident</dt><dd>{incident.number}</dd></div>
          <div><dt>Complaint</dt><dd>{incident.complaint}</dd></div>
          <div><dt>Location</dt><dd>{incident.address}</dd></div>
          <div><dt>Crew</dt><dd>{incident.crew}</dd></div>
          <div><dt>Medical history</dt><dd>{patient.medicalHistory.join(", ") || "Not documented"}</dd></div>
          <div><dt>Current medications</dt><dd>{patient.currentMedications.join(", ") || "Not documented"}</dd></div>
          <div><dt>Medication allergies</dt><dd>{patient.allergies.join(", ") || "Not documented"}</dd></div>
        </dl>
      </section>
      <section className="summary-section">
        <h2>Timeline</h2>
        <ol className="summary-timeline">
          {incidentEvents.map((event) => <li key={event.id}><time>{event.time}</time><div><strong>{event.title}</strong><span>{event.detail}</span><small>{event.reference}</small></div></li>)}
          {completedSummaryEvents(encounter.events, bundledEncounterDefinition).map((event) => {
            const presentation = encounterEventPresentation(event, bundledEncounterDefinition);
            return <li key={event.id}><time>{event.time}</time><div><strong>{presentation.title}</strong><span>{encounterEventDetail(event, bundledEncounterDefinition)}</span><small>{presentation.reference}</small></div></li>;
          })}
        </ol>
      </section>
      <section className="summary-section">
        <h2>Warning acknowledgements</h2>
        {warnings.length ? <ul className="summary-warnings">{warnings.map((warning) => <li key={warning.id}><strong>Acknowledged</strong><span>{warning.title}: {warning.message}</span></li>)}</ul> : <p>No validation warnings were present at finish.</p>}
      </section>
      <button className="continue-editing" type="button" onClick={onContinue}>Continue editing</button>
    </article>
  );
}
