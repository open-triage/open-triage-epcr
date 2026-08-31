"use client";

import { useMemo, useRef, useState } from "react";
import { MEDICATIONS, MEDICATION_CATALOG_PROVENANCE, MEDICATION_DOSE_UNITS, MEDICATION_ROUTES, searchMedications } from "../app/medication-catalog";
import { validateMedication, type MedicationDraft, type ShellAction } from "../app/synthetic-encounter";

type Props = { readonly draft: MedicationDraft; readonly dispatch: React.Dispatch<ShellAction> };

export function MedicationDialog({ draft, dispatch }: Props) {
  const [query, setQuery] = useState(draft.label);
  const [submitted, setSubmitted] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchMedications(query), [query]);
  const validation = validateMedication(draft);
  const hasUnacknowledgedWarning = validation.warnings.length > 0 && !draft.warningAcknowledged;

  function save() {
    setSubmitted(true);
    if (!validation.errors.length && !hasUnacknowledgedWarning) dispatch({ type: "medication-saved" });
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="note-dialog medication-dialog" role="dialog" aria-modal="true" aria-labelledby="medication-dialog-title">
        <div className="note-dialog-heading">
          <div>
            <p className="eyebrow">{draft.isNew ? "New timeline event" : "Revise timeline event"}</p>
            <h2 id="medication-dialog-title">Medication administration</h2>
          </div>
          <button aria-label="Close medication editor" type="button" onClick={() => dispatch({ type: "medication-cancelled" })}>×</button>
        </div>

        <label>
          Clinical time <span className="field-reference">eMedications.01</span>
          <input aria-invalid={submitted && validation.errors.some((error) => error.includes("eMedications.01"))} inputMode="numeric" maxLength={5} placeholder="HH:mm" value={draft.time} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "time", value: event.target.value })} />
        </label>

        <div className="medication-search">
          <label htmlFor="medication-query">Medication <span className="field-reference">eMedications.03</span></label>
          <input
            id="medication-query"
            ref={searchInput}
            aria-autocomplete="list"
            aria-controls="medication-results"
            aria-invalid={submitted && !draft.medicationCode}
            autoComplete="off"
            placeholder="Search name or code…"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== draft.label && (
            <ul id="medication-results" className="medication-results" role="listbox" aria-label="NEMSIS medications">
              {results.map((medication) => (
                <li key={`${medication.codeType}-${medication.code}`} role="option" aria-selected={draft.medicationCode === medication.code}>
                  <button type="button" onClick={() => {
                    dispatch({ type: "medication-selected", code: medication.code, codeType: medication.codeType, label: medication.displayLabel });
                    setQuery(medication.displayLabel);
                  }}>
                    <strong>{medication.displayLabel}</strong>
                    <small>{medication.codeType} {medication.code}</small>
                  </button>
                </li>
              ))}
              {!results.length && <li className="no-results">No medication in the pinned NEMSIS list.</li>}
            </ul>
          )}
          {draft.medicationCode && query === draft.label && (
            <div className="selected-medication">
              <span>Selected</span><strong>{draft.label}</strong><small>{draft.codeType} {draft.medicationCode}</small>
              <button type="button" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>Change</button>
            </div>
          )}
          <small>{MEDICATIONS.length} locally bundled choices · NEMSIS {MEDICATION_CATALOG_PROVENANCE.release}, list {MEDICATION_CATALOG_PROVENANCE.listDate}</small>
        </div>

        <div className="medication-field-row">
          <label>
            Dose <span className="field-reference">eMedications.05</span>
            <input aria-invalid={submitted && validation.errors.some((error) => error.includes("eMedications.05"))} inputMode="decimal" placeholder="e.g. 4" value={draft.dose} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "dose", value: event.target.value })} />
          </label>
          <label>
            Unit <span className="field-reference">eMedications.06</span>
            <select aria-invalid={submitted && !draft.unit} value={draft.unit} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "unit", value: event.target.value })}>
              <option value="">Select…</option>
              {MEDICATION_DOSE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
            </select>
          </label>
        </div>

        <label>
          Route <span className="field-reference">eMedications.04</span>
          <select aria-invalid={submitted && !draft.route} value={draft.route} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "route", value: event.target.value })}>
            <option value="">Select route…</option>
            {MEDICATION_ROUTES.map((route) => <option key={route}>{route}</option>)}
          </select>
        </label>
        <label>
          Patient response <span className="field-reference">eMedications.07</span>
          <textarea rows={3} placeholder="e.g. pain 8 → 4; no adverse reaction" value={draft.response} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "response", value: event.target.value })} />
        </label>

        {submitted && validation.errors.length > 0 && (
          <div className="validation-box error-box" role="alert"><strong>Fix before saving</strong><ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>
        )}
        {validation.warnings.length > 0 && (
          <div className="validation-box warning-box">
            <strong>Warning</strong><p>{validation.warnings[0]}</p>
            <label className="warning-acknowledgement"><input type="checkbox" checked={draft.warningAcknowledged} onChange={(event) => dispatch({ type: "medication-warning-acknowledged", acknowledged: event.target.checked })} /> Acknowledge and save; I’ll document the response later.</label>
          </div>
        )}

        <div className="note-dialog-actions">
          <button type="button" onClick={() => dispatch({ type: "medication-cancelled" })}>Cancel</button>
          <button type="button" onClick={save}>{draft.isNew ? "Add to timeline" : "Save changes"}</button>
        </div>
      </section>
    </div>
  );
}
