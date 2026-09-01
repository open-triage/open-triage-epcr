"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { MEDICATIONS, MEDICATION_DOSE_UNITS, MEDICATION_ROUTES, searchMedications } from "../app/medication-catalog";
import { validateMedication, type MedicationDraft, type ReviewFinding, type ShellAction } from "../app/synthetic-encounter";
import { TimePicker } from "./time-picker";

type Props = { readonly draft: MedicationDraft; readonly dispatch: React.Dispatch<ShellAction>; readonly dialogRef: RefObject<HTMLElement | null>; readonly finding?: Pick<ReviewFinding, "severity" | "message"> };

export function MedicationDialog({ draft, dispatch, dialogRef, finding }: Props) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchMedications(query), [query]);
  const currentFindings = validateMedication(draft);
  const findingActive = finding ? [...currentFindings.errors, ...currentFindings.warnings].includes(finding.message) : false;
  const frame = (pattern: RegExp) => finding && findingActive && pattern.test(finding.message) ? `finding-frame ${finding.severity}` : undefined;

  return <div className="dialog-backdrop" role="presentation">
    <section ref={dialogRef} className="note-dialog medication-dialog" role="dialog" aria-modal="true" aria-labelledby="medication-dialog-title">
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{draft.isNew ? "New timeline event" : "Revise timeline event"}</p><h2 id="medication-dialog-title">Medication</h2></div>
        <button aria-label="Close medication editor" type="button" onClick={() => dispatch({ type: "medication-cancelled" })}>×</button>
      </div>

      {!draft.medicationCode ? <div className={`catalog-picker ${frame(/Select a medication/i) ?? ""}`.trim()}>
        <label htmlFor="medication-query">Search medications</label>
        <input id="medication-query" ref={searchInput} autoFocus data-dialog-initial-focus autoComplete="off" placeholder="Try aspirin, fentanyl, saline…" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="catalog-caption">{results.length} shown · {MEDICATIONS.length} available offline</p>
        <ul className="catalog-results" aria-label="Medication search results">
          {results.map((medication) => <li key={`${medication.codeType}-${medication.code}`}>
            <button type="button" onClick={() => dispatch({ type: "medication-selected", code: medication.code, codeType: medication.codeType, label: medication.displayLabel })}><strong>{medication.displayLabel}</strong></button>
          </li>)}
        </ul>
        {!results.length && <p className="empty-results">No medication matches your search.</p>}
      </div> : <>
        <div className={`selected-catalog-item ${frame(/Select a medication|display label/i) ?? ""}`.trim()}>
          <strong>{draft.label}</strong>
          <button type="button" onClick={() => { dispatch({ type: "medication-selected", code: "", codeType: "RxNorm", label: "" }); setQuery(""); }}>Change</button>
        </div>
        <TimePicker className={frame(/time/i)} label="Medication time" date={draft.date} onDateChange={(value) => dispatch({ type: "medication-draft-changed", field: "date", value })} value={draft.time} onChange={(value) => dispatch({ type: "medication-draft-changed", field: "time", value })} />
        <div className="medication-field-row">
          <label className={frame(/Dose must/i)}>Dose<input inputMode="decimal" placeholder="e.g. 4" value={draft.dose} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "dose", value: event.target.value })} /></label>
          <label className={frame(/dose unit/i)}>Unit<select value={draft.unit} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "unit", value: event.target.value })}><option value="">Select…</option>{MEDICATION_DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        </div>
        <label className={frame(/route/i)}>Route<select value={draft.route} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "route", value: event.target.value })}><option value="">Select route…</option>{MEDICATION_ROUTES.map((route) => <option key={route}>{route}</option>)}</select></label>
        <label className={frame(/response/i)}>Patient response<textarea rows={3} placeholder="e.g. pain 8 → 4; no adverse reaction" value={draft.response} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "response", value: event.target.value })} /></label>
        <div className="note-dialog-actions">
          <button type="button" onClick={() => dispatch({ type: "medication-cancelled" })}>Cancel</button>
          <button type="button" onClick={() => dispatch({ type: "medication-saved" })}>{draft.isNew ? "Add medication" : "Save changes"}</button>
        </div>
      </>}
    </section>
  </div>;
}
