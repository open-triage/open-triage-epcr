"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { clearShellState, loadShellState, saveShellState } from "./local-persistence";
import {
  checklistFields,
  INITIAL_SHELL_STATE,
  transitionShell,
  validateChecklist,
  type ChecklistField,
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
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const encounter = shell.encounter;
  const findings = validateChecklist(shell.checklistValues);
  const vitalValidation = useMemo(() => shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values) : null, [shell.vitalDraft]);

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
    if (!shell.focusedChecklistField) return;
    document.getElementById(`checklist-${shell.focusedChecklistField}`)?.focus();
    dispatch({ type: "validation-focus-cleared" });
  }, [shell.focusedChecklistField]);

  function startNote() {
    dispatch({ type: "note-started", id: crypto.randomUUID(), time: localClinicalTime() });
  }
  function startVitals() {
    dispatch({ type: "vitals-started", id: crypto.randomUUID(), time: localClinicalTime() });
  }

  function startMedication() {
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
          <span className="required-count" aria-live="polite">{findings.length} required left</span>
        </div>
        <button className="reset-prototype" type="button" onClick={resetPrototype}>Reset prototype</button>
      </header>

      <nav className="view-switcher" aria-label="Encounter views">
        {tabs.map((tab) => (
          <button
            aria-pressed={shell.view === tab.id}
            className={shell.view === tab.id ? "active" : undefined}
            key={tab.id}
            onClick={() => dispatch({ type: "view-selected", view: tab.id })}
            type="button"
          >
            {tab.label}
            {tab.id === "timeline" && <span aria-hidden="true"> · {encounter.events.length}</span>}
          </button>
        ))}
      </nav>

      {shell.view === "timeline" ? (
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
              <li key={event.id} className={event.kind === "note" || event.kind === "medication" ? "editable-event" : undefined}>
                <time dateTime={`2026-04-18T${event.time}:00`}>{event.time}</time>
                <span className={`event-dot ${event.kind}`} aria-hidden="true" />
                {event.kind === "note" || event.kind === "medication" || event.vitals ? (
                  <button className="timeline-event-button" type="button" onClick={() => dispatch({ type: event.vitals ? "vitals-opened" : event.kind === "medication" ? "medication-opened" : "note-opened", id: event.id })}>
                    <span className="event-title">{event.title}</span>
                    <span className="event-detail">{event.detail}</span>
                    <small>{event.reference} · Tap to edit</small>
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
      ) : (
        <section className="content-panel checklist-panel" aria-labelledby="checklist-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Encounter details</p>
              <h1 id="checklist-heading">Checklist</h1>
            </div>
            <span aria-live="polite">{findings.length} remaining</span>
          </div>
          <div className="checklist-summary">
            <strong>{findings.length === 0 ? "Required documentation complete" : `${findings.length} required ${findings.length === 1 ? "item" : "items"} remaining`}</strong>
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
                      <strong>{finding.reference}</strong>
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

      <footer className="quick-actions" aria-label="Quick actions">
        <button type="button" onClick={startVitals}>+ Vitals</button>
        <button type="button" onClick={startMedication}>+ Med</button>
        <button type="button">+ Proc</button>
        <button type="button" onClick={startNote}>+ Note</button>
      </footer>

      {shell.noteDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-dialog-title">
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
      {shell.medicationDraft && <MedicationDialog draft={shell.medicationDraft} dispatch={dispatch} />}

      {shell.vitalDraft && vitalValidation && (
        <div className="dialog-backdrop" role="presentation">
          <section className="note-dialog vital-dialog" role="dialog" aria-modal="true" aria-labelledby="vital-dialog-title">
            <div className="note-dialog-heading">
              <div><p className="eyebrow">{shell.vitalDraft.isNew ? "New timeline event" : "Revise timeline event"}</p><h2 id="vital-dialog-title">Vital signs</h2></div>
              <button aria-label="Close vital signs editor" type="button" onClick={() => dispatch({ type: "vitals-cancelled" })}>×</button>
            </div>
            <label>Clinical time <small>eVitals.01</small>
              <input inputMode="numeric" placeholder="HH:mm" value={shell.vitalDraft.time} onChange={(event) => dispatch({ type: "vitals-time-changed", value: event.target.value })} />
            </label>
            {vitalValidation.errors.time && <p className="validation-message error" role="alert">{vitalValidation.errors.time}</p>}
            <div className="vital-grid">
              {(Object.entries(VITAL_RULES) as [VitalField, (typeof VITAL_RULES)[VitalField]][]).map(([field, rule]) => (
                <div className="vital-field" key={field}>
                  <label htmlFor={`vital-${field}`}>{rule.label} <small>{rule.reference}</small></label>
                  <div className="vital-inputs">
                    <input id={`vital-${field}`} aria-invalid={Boolean(vitalValidation.errors[field])} inputMode="numeric" placeholder={`${rule.min}–${rule.max}`} value={shell.vitalDraft!.values[field]} onChange={(event) => dispatch({ type: "vitals-value-changed", field, value: event.target.value })} />
                    <select aria-label={`${rule.label} null value`} value={shell.vitalDraft!.values.nullValues[field] ?? ""} onChange={(event) => dispatch({ type: "vitals-null-changed", field, value: event.target.value as never })}>
                      {nullOptionsFor(rule).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  {vitalValidation.errors[field] && <p className="validation-message error" role="alert">{vitalValidation.errors[field]}</p>}
                  {vitalValidation.warnings[field] && <p className="validation-message warning">{vitalValidation.warnings[field]}</p>}
                </div>
              ))}
            </div>
            <p className="null-help">NV and PN choices are limited to the codes permitted for each element by the NEMSIS 3.5.1 schema.</p>
            {vitalValidation.errors.group && <p className="validation-message error" role="alert">{vitalValidation.errors.group}</p>}
            <div className="note-dialog-actions"><button type="button" onClick={() => dispatch({ type: "vitals-cancelled" })}>Cancel</button><button type="button" disabled={!vitalValidation.valid} onClick={() => dispatch({ type: "vitals-saved" })}>{shell.vitalDraft.isNew ? "Add vital set" : "Save changes"}</button></div>
          </section>
        </div>
      )}
    </main>
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
