"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { clearShellState, loadShellState, saveShellState } from "./local-persistence";
import { INITIAL_SHELL_STATE, transitionShell, type ShellView } from "./synthetic-encounter";

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

  function startNote() {
    dispatch({ type: "note-started", id: crypto.randomUUID(), time: localClinicalTime() });
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
          <span className="required-count">{encounter.requiredRemaining} required left</span>
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
              <li key={event.id} className={event.kind === "note" ? "editable-event" : undefined}>
                <time dateTime={`2026-04-18T${event.time}:00`}>{event.time}</time>
                <span className={`event-dot ${event.kind}`} aria-hidden="true" />
                {event.kind === "note" ? (
                  <button className="timeline-event-button" type="button" onClick={() => dispatch({ type: "note-opened", id: event.id })}>
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
            <span>{encounter.requiredRemaining} remaining</span>
          </div>
          <div className="checklist-summary">
            <strong>Chest-pain transport</strong>
            <span>{encounter.incident.address}</span>
          </div>
          <ul className="checklist-list">
            {encounter.checklist.map((item) => (
              <li key={item.title} className={item.complete ? "complete" : "incomplete"}>
                <span className="check-status" aria-hidden="true">{item.complete ? "✓" : "!"}</span>
                <div>
                  <h2>{item.title}</h2>
                  <p>{item.detail}</p>
                  <small>{item.reference}</small>
                </div>
                <span className="status-label">{item.complete ? "Complete" : "Required"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="quick-actions" aria-label="Quick actions">
        <button type="button">+ Vitals</button>
        <button type="button">+ Med</button>
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
    </main>
  );
}
