"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { PatientDialog } from "../components/patient-dialog";
import { QuickActionIcon } from "../components/quick-action-icon";
import { TimePicker } from "../components/time-picker";
import { clearShellState, loadShellState, saveShellState } from "./local-persistence";
import { COMPLICATIONS, OUTCOMES, searchProcedures, validateProcedure } from "./procedure";
import {
  INITIAL_SHELL_STATE,
  encounterEventDetail,
  encounterEventPresentation,
  reviewEncounter,
  syntheticEncounterReducer,
  type ReviewFinding,
  type ShellState,
  type ShellView,
  type VitalField,
  syntheticEncounterDefinition,
} from "./synthetic-encounter";
import { nullOptionsFor, validateVitals } from "./vital-validation";
import { localClinicalDate } from "./time-picker";

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

function localClinicalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export default function Home() {
  const [shell, dispatch] = useReducer(syntheticEncounterReducer, INITIAL_SHELL_STATE);
  const [restored, setRestored] = useState(false);
  const [procedureSearch, setProcedureSearch] = useState("");
  const [openNullField, setOpenNullField] = useState<VitalField | null>(null);
  const [patientOpen, setPatientOpen] = useState(false);
  const [editingFinding, setEditingFinding] = useState<ReviewFinding | null>(null);
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const encounter = shell.encounter;
  const noteDefinition = syntheticEncounterDefinition.events.note;
  const vitalDefinition = syntheticEncounterDefinition.events.vitals;
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
  const procedureResults = useMemo(() => searchProcedures(procedureSearch), [procedureSearch]);
  const procedureDraftValidation = shell.procedureDraft ? validateProcedure(shell.procedureDraft) : null;
  const procedureFindingActive = !!(editingFinding?.category === "Procedure" && procedureDraftValidation && [...procedureDraftValidation.errors, ...procedureDraftValidation.warnings].includes(editingFinding.message));
  const vitalDraftValidation = shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values, syntheticEncounterDefinition) : null;
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
    const saved = loadShellState(window.localStorage);
    if (saved) dispatch({ type: "state-restored", state: saved });
    // Hydration must finish before the baseline is allowed to overwrite browser progress.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
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

  return (
    <main className="app-shell">
      <aside className="safety-notice" role="note" aria-label="Prototype safety notice">
        <strong>Synthetic data only</strong>
        <span>Usability prototype — not for clinical use</span>
      </aside>

      <header className="encounter-header">
        <div className="header-kicker">
          <span>{encounter.currentTime}</span>
          <span className="prototype-status">{syntheticEncounterDefinition.labels.prototypeStatus}</span>
        </div>
        <div className="patient-line">
          <div>
            <p className="patient-name">{encounter.patient.name}</p>
            <p className="patient-demographics">
              {encounter.patient.age} y · {encounter.patient.sex} · {encounter.patient.identifier}
            </p>
          </div>
          <span className="crew-badge" aria-label={`Crew ${encounter.crew}`}>{encounter.crew}</span>
        </div>
        <div className="incident-line">
          <div>
            <span>{syntheticEncounterDefinition.labels.incident} {encounter.incident.number}</span>
            <strong>{encounter.incident.complaint}</strong>
          </div>
        </div>
        <button className="reset-prototype" type="button" onClick={resetPrototype}>Reset prototype data</button>
      </header>

      <nav className="quick-actions" aria-label="Quick documentation">
        {vitalDefinition.quickAction.visible && <button className={activeDialog === "vitals" ? "active" : undefined} aria-pressed={activeDialog === "vitals"} title={vitalDefinition.labels.timelineTitle} aria-label={vitalDefinition.quickAction.label} type="button" onClick={startVitals}><QuickActionIcon kind="vitals" /></button>}
        <button className={activeDialog === "medication" ? "active" : undefined} aria-pressed={activeDialog === "medication"} title="Medication" aria-label="Add medication" type="button" onClick={startMedication}><QuickActionIcon kind="medication" /></button>
        <button className={activeDialog === "procedure" ? "active" : undefined} aria-pressed={activeDialog === "procedure"} title="Procedure" aria-label="Add procedure" type="button" onClick={startProcedure}><QuickActionIcon kind="procedure" /></button>
        {noteDefinition.quickAction.visible && <button className={activeDialog === "note" ? "active" : undefined} aria-pressed={activeDialog === "note"} title={noteDefinition.labels.timelineTitle} aria-label={noteDefinition.quickAction.label} type="button" onClick={startNote}><QuickActionIcon kind="note" /></button>}
        <button className={activeDialog === "patient" ? "active" : undefined} aria-pressed={activeDialog === "patient"} title="Patient information" aria-label="Edit patient information" type="button" onClick={startPatient}><QuickActionIcon kind="patient" /></button>
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
            {tab.id === "timeline" && <span aria-hidden="true"> · {encounter.events.length}</span>}
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
            <span>{encounter.events.length} events</span>
          </div>
          <ol className="timeline-list">
            {encounter.events.map((event) => {
              const validationStatus = eventValidationStatuses.get(event.id) ?? "clear";
              const presentation = encounterEventPresentation(event, syntheticEncounterDefinition);
              const eventDetail = encounterEventDetail(event, syntheticEncounterDefinition);
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
                    }).warnings.length > 0 && !event.procedure.warningAcknowledged && (
                      <span className="warning-pill">⚠ Warning: review needed</span>
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
          errors={reviewErrors}
          warnings={reviewWarnings}
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

      {patientOpen && <PatientDialog patient={encounter.patient} definition={syntheticEncounterDefinition} dialogRef={dialog} onClose={() => setPatientOpen(false)} onSave={(patient) => { dispatch({ type: "patient-updated", patient }); setPatientOpen(false); }} />}

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
      {shell.medicationDraft && <MedicationDialog dialogRef={dialog} draft={shell.medicationDraft} dispatch={dispatch} finding={editingFinding?.category === "Medication" ? editingFinding : undefined} />}

      {shell.procedureDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog procedure-dialog" role="dialog" aria-modal="true" aria-labelledby="procedure-dialog-title">
            <div className="note-dialog-heading">
              <div>
                <p className="eyebrow">{shell.procedureDraft.isNew ? "New treatment event" : "Edit canonical event"}</p>
                <h2 id="procedure-dialog-title">Procedure</h2>
              </div>
              <button aria-label="Close procedure editor" type="button" onClick={() => dispatch({ type: "procedure-cancelled" })}>×</button>
            </div>

            {!shell.procedureDraft.procedureCode ? (
              <div className={`catalog-picker ${procedureFindingActive && /Select a procedure|display label/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : ""}`.trim()}>
                <label htmlFor="procedure-search">Search procedures</label>
                <input
                  autoFocus
                  data-dialog-initial-focus
                  id="procedure-search"
                  type="search"
                  placeholder="Try ECG, IV, oxygen…"
                  value={procedureSearch}
                  onChange={(event) => setProcedureSearch(event.target.value)}
                />
                <p className="catalog-caption">{procedureResults.length} shown · available offline</p>
                <ul className="catalog-results">
                  {procedureResults.map((procedure) => (
                    <li key={procedure.code}>
                      <button type="button" onClick={() => dispatch({ type: "procedure-selected", code: procedure.code })}>
                        <strong>{procedure.label}</strong>
                        <span>{procedure.category}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!procedureResults.length && <p className="empty-results">No procedure matches all search terms.</p>}
              </div>
            ) : (
              <>
                <div className={`selected-catalog-item ${procedureFindingActive && /Select a procedure|display label/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : ""}`.trim()}>
                  <strong>{shell.procedureDraft.procedureLabel}</strong>
                  <button type="button" onClick={() => { setProcedureSearch(""); dispatch({ type: "procedure-selected", code: "" }); }}>Change</button>
                </div>
                <div className="procedure-grid">
                  <TimePicker className={procedureFindingActive && /time/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : undefined} label="Procedure time" date={shell.procedureDraft.date} onDateChange={(value) => dispatch({ type: "procedure-draft-changed", field: "date", value })} value={shell.procedureDraft.time} onChange={(value) => dispatch({ type: "procedure-draft-changed", field: "time", value })} />
                  <label className={procedureFindingActive && /Attempts/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : undefined}>
                    Attempts
                    <input
                      inputMode="numeric"
                      min={1}
                      max={10}
                      type="number"
                      value={shell.procedureDraft.attempts}
                      onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "attempts", value: event.target.value })}
                    />
                  </label>
                </div>
                <label className={procedureFindingActive && /successful/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : undefined}>
                  Successful
                  <select value={shell.procedureDraft.success} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "success", value: event.target.value })}>
                    <option value="">Select…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className={procedureFindingActive && /response/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : undefined}>
                  Patient response
                  <select value={shell.procedureDraft.outcome} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "outcome", value: event.target.value })}>
                    <option value="">Select…</option>
                    {OUTCOMES.map((outcome) => <option key={outcome.value} value={outcome.value}>{outcome.label}</option>)}
                  </select>
                </label>
                <fieldset className={`complication-options ${procedureFindingActive && /complication/i.test(editingFinding?.message ?? "") ? `finding-frame ${editingFinding!.severity}` : ""}`.trim()}>
                  <legend>Complications</legend>
                  {COMPLICATIONS.map((complication) => (
                    <label key={complication.code}>
                      <input
                        type="checkbox"
                        checked={shell.procedureDraft!.complications.includes(complication.code)}
                        onChange={() => dispatch({ type: "procedure-complication-toggled", code: complication.code })}
                      />
                      <span>{complication.label}</span>
                    </label>
                  ))}
                </fieldset>

                <div className="note-dialog-actions">
                  <button type="button" onClick={() => dispatch({ type: "procedure-cancelled" })}>Cancel</button>
                  <button type="button" onClick={() => dispatch({ type: "procedure-saved" })}>
                    {shell.procedureDraft.isNew ? "Add procedure" : "Save changes"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

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

function ReviewPanel({ errors, warnings, canFinish, onFinding, onWarning, onContinue, onFinish }: {
  readonly errors: ReadonlyArray<ReviewFinding>;
  readonly warnings: ReadonlyArray<ReviewFinding>;
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

      <FindingGroup title="Blocking errors" empty="No blocking errors." findings={errors} onFinding={onFinding} onWarning={onWarning} />
      <FindingGroup title="Warnings to acknowledge" empty="No warnings." findings={warnings} onFinding={onFinding} onWarning={onWarning} />

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
          <div><dt>Patient</dt><dd>{encounter.patient.name} · {encounter.patient.age} y · {encounter.patient.sex}</dd></div>
          <div><dt>Synthetic ID</dt><dd>{encounter.patient.identifier}</dd></div>
          <div><dt>Incident</dt><dd>{encounter.incident.number}</dd></div>
          <div><dt>Complaint</dt><dd>{encounter.incident.complaint}</dd></div>
          <div><dt>Location</dt><dd>{encounter.incident.address}</dd></div>
          <div><dt>Crew</dt><dd>{encounter.crew}</dd></div>
          <div><dt>Medical history</dt><dd>{encounter.patient.medicalHistory.join(", ") || "Not documented"}</dd></div>
          <div><dt>Current medications</dt><dd>{encounter.patient.currentMedications.join(", ") || "Not documented"}</dd></div>
          <div><dt>Medication allergies</dt><dd>{encounter.patient.allergies.join(", ") || "Not documented"}</dd></div>
        </dl>
      </section>
      <section className="summary-section">
        <h2>Timeline</h2>
        <ol className="summary-timeline">
          {encounter.events.map((event) => {
            const presentation = encounterEventPresentation(event, syntheticEncounterDefinition);
            return <li key={event.id}><time>{event.time}</time><div><strong>{presentation.title}</strong><span>{encounterEventDetail(event, syntheticEncounterDefinition)}</span><small>{presentation.reference}</small></div></li>;
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
