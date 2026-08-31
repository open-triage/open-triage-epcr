"use client";

import { useReducer } from "react";
import {
  INITIAL_SHELL_STATE,
  transitionShell,
  type ShellView,
} from "./synthetic-encounter";

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

export default function Home() {
  const [shell, dispatch] = useReducer(transitionShell, INITIAL_SHELL_STATE);
  const encounter = shell.encounter;

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
              <li key={`${event.time}-${event.title}`}>
                <time dateTime={`2026-04-18T${event.time}:00`}>{event.time}</time>
                <span className={`event-dot ${event.kind}`} aria-hidden="true" />
                <div>
                  <h2>{event.title}</h2>
                  <p>{event.detail}</p>
                  <small>{event.reference}</small>
                </div>
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
        <button type="button">+ Note</button>
      </footer>
    </main>
  );
}
