"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { clearShellState, loadShellState, saveShellState } from "./local-persistence";
import { COMPLICATIONS, OUTCOMES, PROCEDURE_MANIFEST, searchProcedures, validateProcedure } from "./procedure";
import {
  checklistFields,
  checklistDisplayValue,
  INITIAL_SHELL_STATE,
  reviewEncounter,
  transitionShell,
  validateChecklist,
  type ChecklistField,
  type ReviewFinding,
  type ShellState,
  type ShellView,
  type VitalField,
} from "./synthetic-encounter";
import { nullOptionsFor, validateVitals, VITAL_RULES } from "./vital-validation";

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

function localClinicalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export default function Home() {
  const [shell, dispatch] = useReducer(transitionShell, INITIAL_SHELL_STATE);
  const [restored, setRestored] = useState(false);
  const [procedureSearch, setProcedureSearch] = useState("");
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const encounter = shell.encounter;
  const findings = validateChecklist(shell.checklistValues);
  const reviewFindings = useMemo(() => reviewEncounter(shell), [shell]);
  const reviewErrors = reviewFindings.filter((finding) => finding.severity === "error");
  const reviewWarnings = reviewFindings.filter((finding) => finding.severity === "warning");
  const canFinish = reviewErrors.length === 0 && reviewWarnings.every((finding) => finding.acknowledged);
  const procedureResults = useMemo(() => searchProcedures(procedureSearch), [procedureSearch]);
  const procedureValidation = shell.procedureDraft ? validateProcedure(shell.procedureDraft) : null;
  const vitalValidation = useMemo(() => shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values) : null, [shell.vitalDraft]);
  const activeDialog = shell.noteDraft ? "note" : shell.medicationDraft ? "medication" : shell.procedureDraft ? "procedure" : shell.vitalDraft ? "vitals" : null;

  const closeActiveDialog = useCallback(() => {
    if (activeDialog === "note") dispatch({ type: "note-cancelled" });
    else if (activeDialog === "medication") dispatch({ type: "medication-cancelled" });
    else if (activeDialog === "procedure") dispatch({ type: "procedure-cancelled" });
    else if (activeDialog === "vitals") dispatch({ type: "vitals-cancelled" });
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
      const target = dialog.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
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
  }, [activeDialog, closeActiveDialog]);

  useEffect(() => {
    if (!shell.focusedChecklistField) return;
    document.getElementById(`checklist-${shell.focusedChecklistField}`)?.focus();
    dispatch({ type: "validation-focus-cleared" });
  }, [shell.focusedChecklistField]);

  function rememberTrigger(element: HTMLElement) {
    returnFocus.current = element;
  }

  function startNote(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    dispatch({ type: "note-started", id: crypto.randomUUID(), time: localClinicalTime() });
  }
  function startVitals(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    dispatch({ type: "vitals-started", id: crypto.randomUUID(), time: localClinicalTime() });
  }

  function startProcedure(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setProcedureSearch("");
    dispatch({ type: "procedure-started", id: crypto.randomUUID(), time: localClinicalTime() });
  }

  function startMedication(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    dispatch({ type: "medication-started", id: crypto.randomUUID(), time: localClinicalTime() });
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
          <span className="prototype-status">Prototype</span>
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
            <span>Incident {encounter.incident.number}</span>
            <strong>{encounter.incident.complaint}</strong>
          </div>
          <button className="required-count" aria-label={`Review encounter, ${reviewErrors.length} required ${reviewErrors.length === 1 ? "item" : "items"} left`} aria-live="polite" type="button" onClick={() => dispatch({ type: "review-opened" })}>
            <span aria-hidden="true">! </span>{reviewErrors.length} required left · Review
          </button>
        </div>
        <button className="reset-prototype" type="button" onClick={resetPrototype}>Reset prototype data</button>
      </header>

      {shell.view !== "summary" && <nav className="view-switcher" aria-label="Encounter views">
        {tabs.map((tab) => (
          <button
            aria-pressed={shell.view === tab.id}
            aria-current={shell.view === tab.id ? "page" : undefined}
            className={shell.view === tab.id ? "active" : undefined}
            key={tab.id}
            onClick={() => dispatch({ type: "view-selected", view: tab.id })}
            type="button"
          >
            {tab.label}
            {tab.id === "timeline" && <span aria-hidden="true"> · {encounter.events.length}</span>}
          </button>
        ))}
      </nav>}

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
            {encounter.events.map((event) => (
              <li key={event.id} className={event.kind === "note" || event.kind === "medication" || event.kind === "procedure" ? "editable-event" : undefined}>
                <time dateTime={`2026-04-18T${event.time}:00`}>{event.time}</time>
                <span className={`event-dot ${event.kind}`} aria-hidden="true" />
                {event.kind === "note" || event.kind === "procedure" || event.kind === "medication" || event.vitals ? (
                  <button
                    aria-label={`Edit ${event.title} at ${event.time}. ${event.detail}`}
                    className="timeline-event-button"
                    type="button"
                    onClick={(clickEvent) => {
                      rememberTrigger(clickEvent.currentTarget);
                      dispatch({ type: event.vitals ? "vitals-opened" : event.kind === "procedure" ? "procedure-opened" : event.kind === "medication" ? "medication-opened" : "note-opened", id: event.id });
                    }}
                  >
                    <span className="event-title">{event.title}</span>
                    <span className="event-detail">{event.detail}</span>
                    <small>{event.reference} · Tap to edit</small>
                    {event.procedure && validateProcedure({
                      id: event.id,
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
              </li>
            ))}
          </ol>
        </section>
      )}
      {shell.view === "checklist" && (
        <section className="content-panel checklist-panel" aria-labelledby="checklist-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Encounter details</p>
              <h1 id="checklist-heading">Checklist</h1>
            </div>
            <span aria-live="polite">{findings.length} remaining</span>
          </div>
          <div className="checklist-summary">
            <strong>{findings.length === 0 ? "✓ Status: required documentation complete" : `! Status: ${findings.length} required ${findings.length === 1 ? "item" : "items"} remaining`}</strong>
            <span>Curated chest-pain assessment, disposition and narrative</span>
          </div>
          {findings.length > 0 && (
            <section className="validation-summary" aria-labelledby="validation-heading">
              <h2 id="validation-heading">Needs attention</h2>
              <p>Select a finding to move to its NEMSIS input.</p>
              <ul>
                {findings.map((finding) => (
                  <li key={finding.fieldId}>
                    <button type="button" onClick={() => dispatch({ type: "validation-selected", field: finding.fieldId })}>
                      <strong>Error · {finding.reference}</strong>
                      <span>{finding.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <form className="checklist-form" onSubmit={(event) => event.preventDefault()}>
            {(["Assessment", "Disposition", "Narrative"] as const).map((section) => (
              <fieldset key={section}>
                <legend>{section}</legend>
                {checklistFields.filter((field) => field.section === section).map((field) => (
                  <ChecklistInput
                    field={field}
                    finding={findings.find((finding) => finding.fieldId === field.id)?.message}
                    key={field.id}
                    value={shell.checklistValues[field.id]}
                    onChange={(value) => dispatch({ type: "checklist-field-changed", field: field.id, value })}
                  />
                ))}
              </fieldset>
            ))}
          </form>
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

      {(shell.view === "timeline" || shell.view === "checklist") && <footer className="quick-actions" aria-label="Quick actions">
        <button aria-label="Add vital signs" type="button" onClick={startVitals}>+ Vitals</button>
        <button aria-label="Add medication" type="button" onClick={startMedication}>+ Med</button>
        <button aria-label="Add procedure" type="button" onClick={startProcedure}>+ Proc</button>
        <button aria-label="Add clinical note" type="button" onClick={startNote}>+ Note</button>
      </footer>}

      {shell.noteDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-dialog-title">
            <div className="note-dialog-heading">
              <div>
                <p className="eyebrow">{shell.noteDraft.isNew ? "New timeline event" : "Revise timeline event"}</p>
                <h2 id="note-dialog-title">Clinical note</h2>
              </div>
              <button aria-label="Close note editor" type="button" onClick={() => dispatch({ type: "note-cancelled" })}>×</button>
            </div>
            <label>
              Clinical time
              <input
                aria-describedby="clinical-time-help"
                inputMode="numeric"
                maxLength={5}
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                placeholder="HH:mm"
                type="text"
                value={shell.noteDraft.time}
                onChange={(event) => dispatch({ type: "note-draft-changed", field: "time", value: event.target.value })}
              />
            </label>
            <small id="clinical-time-help">Correct the time if documentation was entered later.</small>
            <label>
              Note summary
              <textarea
                ref={noteSummary}
                data-dialog-initial-focus
                rows={5}
                placeholder="Document the clinical observation or decision…"
                value={shell.noteDraft.summary}
                onChange={(event) => dispatch({ type: "note-draft-changed", field: "summary", value: event.target.value })}
              />
            </label>
            <div className="note-dialog-actions">
              <button type="button" onClick={() => dispatch({ type: "note-cancelled" })}>Cancel</button>
              <button type="button" disabled={!shell.noteDraft.summary.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(shell.noteDraft.time)} onClick={() => dispatch({ type: "note-saved" })}>
                {shell.noteDraft.isNew ? "Add to timeline" : "Save changes"}
              </button>
            </div>
          </section>
        </div>
      )}
      {shell.medicationDraft && <MedicationDialog dialogRef={dialog} draft={shell.medicationDraft} dispatch={dispatch} />}

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
              <div className="procedure-search">
                <label htmlFor="procedure-search">Search all {PROCEDURE_MANIFEST.release} procedures</label>
                <input
                  autoFocus
                  data-dialog-initial-focus
                  id="procedure-search"
                  type="search"
                  placeholder="Try ECG, IV, oxygen…"
                  value={procedureSearch}
                  onChange={(event) => setProcedureSearch(event.target.value)}
                />
                <p className="catalog-caption">{procedureResults.length} shown · {PROCEDURE_MANIFEST.element} · bundled offline</p>
                <ul className="procedure-results">
                  {procedureResults.map((procedure) => (
                    <li key={procedure.code}>
                      <button type="button" onClick={() => dispatch({ type: "procedure-selected", code: procedure.code })}>
                        <strong>{procedure.label}</strong>
                        <span>{procedure.category}</span>
                        <small>SNOMED CT {procedure.code} · {procedure.sourceLabel}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                {!procedureResults.length && <p className="empty-results">No procedure matches all search terms.</p>}
              </div>
            ) : (
              <>
                <div className="selected-procedure">
                  <div><strong>{shell.procedureDraft.procedureLabel}</strong><small>SNOMED CT {shell.procedureDraft.procedureCode} · eProcedures.03</small></div>
                  <button type="button" onClick={() => dispatch({ type: "procedure-selected", code: "" })}>Change</button>
                </div>
                <div className="procedure-grid">
                  <label>
                    Procedure time <small>eProcedures.01</small>
                    <input
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="HH:mm"
                      value={shell.procedureDraft.time}
                      onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "time", value: event.target.value })}
                    />
                  </label>
                  <label>
                    Attempts <small>eProcedures.05</small>
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
                <label>
                  Successful <small>eProcedures.06</small>
                  <select value={shell.procedureDraft.success} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "success", value: event.target.value })}>
                    <option value="">Select…</option>
                    <option value="yes">Yes (9923003)</option>
                    <option value="no">No (9923001)</option>
                  </select>
                </label>
                <label>
                  Patient response <small>eProcedures.08</small>
                  <select value={shell.procedureDraft.outcome} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "outcome", value: event.target.value })}>
                    <option value="">Select…</option>
                    {OUTCOMES.map((outcome) => <option key={outcome.value} value={outcome.value}>{outcome.label} ({outcome.code})</option>)}
                  </select>
                </label>
                <fieldset className="complication-options">
                  <legend>Complications <small>eProcedures.07</small></legend>
                  {COMPLICATIONS.map((complication) => (
                    <label key={complication.code}>
                      <input
                        type="checkbox"
                        checked={shell.procedureDraft!.complications.includes(complication.code)}
                        onChange={() => dispatch({ type: "procedure-complication-toggled", code: complication.code })}
                      />
                      <span>{complication.label}<small>{complication.code}</small></span>
                    </label>
                  ))}
                </fieldset>

                {procedureValidation!.errors.length > 0 && (
                  <div className="validation-callout errors" role="alert">
                    <strong>Errors: complete required NEMSIS fields</strong>
                    <ul>{procedureValidation!.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                  </div>
                )}
                {procedureValidation!.warnings.length > 0 && (
                  <div className="validation-callout warnings">
                    <strong>Warning: review before continuing</strong>
                    <ul>{procedureValidation!.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                    <label className="acknowledge-warning">
                      <input
                        type="checkbox"
                        checked={shell.procedureDraft.warningAcknowledged}
                        onChange={(event) => dispatch({ type: "procedure-warning-acknowledged", acknowledged: event.target.checked })}
                      />
                      I reviewed this warning
                    </label>
                  </div>
                )}
                <div className="note-dialog-actions">
                  <button type="button" onClick={() => dispatch({ type: "procedure-cancelled" })}>Cancel</button>
                  <button type="button" disabled={procedureValidation!.errors.length > 0} onClick={() => dispatch({ type: "procedure-saved" })}>
                    {shell.procedureDraft.isNew ? "Add procedure" : "Save changes"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {shell.vitalDraft && vitalValidation && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog vital-dialog" role="dialog" aria-modal="true" aria-labelledby="vital-dialog-title">
            <div className="note-dialog-heading">
              <div><p className="eyebrow">{shell.vitalDraft.isNew ? "New timeline event" : "Revise timeline event"}</p><h2 id="vital-dialog-title">Vital signs</h2></div>
              <button aria-label="Close vital signs editor" type="button" onClick={() => dispatch({ type: "vitals-cancelled" })}>×</button>
            </div>
            <label>Clinical time <small>eVitals.01</small>
              <input autoFocus data-dialog-initial-focus aria-invalid={Boolean(vitalValidation.errors.time)} aria-describedby={vitalValidation.errors.time ? "vital-time-error" : undefined} inputMode="numeric" placeholder="HH:mm" value={shell.vitalDraft.time} onChange={(event) => dispatch({ type: "vitals-time-changed", value: event.target.value })} />
            </label>
            {vitalValidation.errors.time && <p id="vital-time-error" className="validation-message error" role="alert">Error: {vitalValidation.errors.time}</p>}
            <div className="vital-grid">
              {(Object.entries(VITAL_RULES) as [VitalField, (typeof VITAL_RULES)[VitalField]][]).map(([field, rule]) => (
                <div className="vital-field" key={field}>
                  <label htmlFor={`vital-${field}`}>{rule.label} <small>{rule.reference}</small></label>
                  <div className="vital-inputs">
                    <input id={`vital-${field}`} aria-invalid={Boolean(vitalValidation.errors[field])} aria-describedby={vitalValidation.errors[field] || vitalValidation.warnings[field] ? `vital-${field}-message` : undefined} inputMode="numeric" placeholder={`${rule.min}–${rule.max}`} value={shell.vitalDraft!.values[field]} onChange={(event) => dispatch({ type: "vitals-value-changed", field, value: event.target.value })} />
                    <select aria-label={`${rule.label} null value`} value={shell.vitalDraft!.values.nullValues[field] ?? ""} onChange={(event) => dispatch({ type: "vitals-null-changed", field, value: event.target.value as never })}>
                      {nullOptionsFor(rule).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  {vitalValidation.errors[field] && <p id={`vital-${field}-message`} className="validation-message error" role="alert">Error: {vitalValidation.errors[field]}</p>}
                  {vitalValidation.warnings[field] && <p id={`vital-${field}-message`} className="validation-message warning">Warning: {vitalValidation.warnings[field]}</p>}
                </div>
              ))}
            </div>
            <p className="null-help">NV and PN choices are limited to the codes permitted for each element by the NEMSIS 3.5.1 schema.</p>
            {vitalValidation.errors.group && <p className="validation-message error" role="alert">Error: {vitalValidation.errors.group}</p>}
            <div className="note-dialog-actions"><button type="button" onClick={() => dispatch({ type: "vitals-cancelled" })}>Cancel</button><button type="button" disabled={!vitalValidation.valid} onClick={() => dispatch({ type: "vitals-saved" })}>{shell.vitalDraft.isNew ? "Add vital set" : "Save changes"}</button></div>
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
        </dl>
      </section>
      <section className="summary-section">
        <h2>Timeline</h2>
        <ol className="summary-timeline">
          {encounter.events.map((event) => <li key={event.id}><time>{event.time}</time><div><strong>{event.title}</strong><span>{event.detail}</span><small>{event.reference}</small></div></li>)}
        </ol>
      </section>
      <section className="summary-section">
        <h2>Checklist</h2>
        <dl>{checklistFields.map((field) => <div key={field.id}><dt>{field.label} <small>{field.reference}</small></dt><dd>{checklistDisplayValue(field, shell.checklistValues[field.id])}</dd></div>)}</dl>
      </section>
      <section className="summary-section">
        <h2>Warning acknowledgements</h2>
        {warnings.length ? <ul className="summary-warnings">{warnings.map((warning) => <li key={warning.id}><strong>Acknowledged</strong><span>{warning.title}: {warning.message}</span></li>)}</ul> : <p>No validation warnings were present at finish.</p>}
      </section>
      <button className="continue-editing" type="button" onClick={onContinue}>Continue editing</button>
    </article>
  );
}

function ChecklistInput({ field, finding, value, onChange }: {
  readonly field: ChecklistField;
  readonly finding?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const inputId = `checklist-${field.id}`;
  const findingId = `${inputId}-finding`;
  const metadataId = `${inputId}-metadata`;
  const sharedProps = {
    id: inputId,
    "aria-invalid": finding ? true : undefined,
    "aria-describedby": `${metadataId}${finding ? ` ${findingId}` : ""}`,
  };

  return (
    <div className={`checklist-field ${finding ? "has-finding" : "is-complete"}`}>
      <div className="field-heading">
        <label htmlFor={inputId}>{field.label}</label>
        <span>{finding ? "Required" : "Complete"}</span>
      </div>
      {field.control === "select" ? (
        <select {...sharedProps} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select…</option>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.control === "textarea" ? (
        <textarea {...sharedProps} maxLength={field.maxLength} placeholder={field.placeholder} rows={5} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...sharedProps} maxLength={field.maxLength} placeholder={field.placeholder} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {field.control !== "select" && field.exceptionalValues.length > 0 && (
        <div className="exceptional-values" aria-label={`Permitted exceptional values for ${field.label}`}>
          {field.exceptionalValues.map((exception) => (
            <button key={exception} type="button" onClick={() => onChange(exception)}>
              Use {exception === "NV" ? "Not available (NV)" : "Pertinent negative (PN)"}
            </button>
          ))}
        </div>
      )}
      <small id={metadataId} className="field-metadata">
        <strong>{field.reference}</strong> · {field.datatype} · {field.cardinality} · {field.usage}
        {field.exceptionalValues.length > 0 ? ` · permits ${field.exceptionalValues.join(" / ")}` : " · no NV/PN"}
      </small>
      {finding && <p className="field-finding" id={findingId}>{finding}</p>}
    </div>
  );
}
