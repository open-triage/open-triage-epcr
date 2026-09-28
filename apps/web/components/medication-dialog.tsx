"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { MEDICATIONS, searchMedicationCatalog } from "../app/medication-catalog";
import type { EncounterDefinition, MedicationFieldId } from "../app/encounter-definition";
import { validateMedication, type MedicationDraft, type ReviewFinding, type ShellAction } from "../app/standard-encounter";
import { displayDecimal, useRegionalFormat } from "../app/regional-format";
import { TimePicker } from "./time-picker";
import { DialogValidationMessage } from "./dialog-validation-message";

type Props = {
  readonly draft: MedicationDraft;
  readonly dispatch: React.Dispatch<ShellAction>;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly definition: EncounterDefinition;
  readonly finding?: Pick<ReviewFinding, "severity" | "message">;
};

export function MedicationDialog({ draft, dispatch, dialogRef, definition, finding }: Props) {
  const region = useRegionalFormat();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const medication = definition.events.medication;
  const results = useMemo(() => searchMedicationCatalog(medication.terminology.catalog, query), [medication.terminology.catalog, query]);
  const currentFindings = validateMedication(draft, definition);
  const findingActive = finding ? [...currentFindings.errors, ...currentFindings.warnings].includes(finding.message) : false;
  const findingField = findingActive
    ? [...currentFindings.errorFindings, ...currentFindings.warningFindings].find((candidate) => candidate.message === finding?.message)?.field
    : undefined;
  const frame = (field: MedicationFieldId) => finding && findingField === field ? `finding-frame ${finding.severity}` : undefined;
  const validation = (field: MedicationFieldId) => <DialogValidationMessage finding={finding && findingField === field ? finding : undefined} />;

  const renderField = (field: typeof medication.fields[number]): ReactNode => {
    switch (field.id) {
      case "medication":
        return !draft.medicationCode ? <div key={field.id} className={`catalog-picker ${frame(field.id) ?? ""}`.trim()}>
          <label htmlFor="medication-query">{field.label}</label>
          <input id="medication-query" ref={searchInput} autoFocus data-dialog-initial-focus autoComplete="off" placeholder={field.placeholder} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <p className="catalog-caption">{results.length} shown · {MEDICATIONS.length} {medication.labels.availableOffline}</p>
          <ul className="catalog-results" aria-label={medication.labels.searchResults}>
            {results.map((option) => <li key={`${option.codeType}-${option.code}`}>
              <button type="button" onClick={() => dispatch({ type: "medication-selected", code: option.code, codeType: option.codeType, label: option.displayLabel })}><strong>{option.displayLabel}</strong></button>
            </li>)}
          </ul>
          {!results.length && <p className="empty-results">{medication.labels.noMatches}</p>}
          {validation(field.id)}
        </div> : <div key={field.id} className={`selected-catalog-item ${frame(field.id) ?? ""}`.trim()}>
          <strong>{draft.label}</strong>
          <button type="button" onClick={() => { dispatch({ type: "medication-selected", code: "", codeType: "RxNorm", label: "" }); setQuery(""); }}>{medication.labels.change}</button>
          {validation(field.id)}
        </div>;
      case "time":
        return <div className="dialog-field" key={field.id}><TimePicker className={frame(field.id)} label={field.label} date={draft.date} onDateChange={(value) => dispatch({ type: "medication-draft-changed", field: "date", value })} value={draft.time} onChange={(value) => dispatch({ type: "medication-draft-changed", field: "time", value })} />{validation(field.id)}</div>;
      case "dose":
        return <div className="dialog-field" key={field.id}><label className={frame(field.id)}>{field.label}<input inputMode="decimal" placeholder={field.placeholder} value={displayDecimal(draft.dose, region)} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "dose", value: event.target.value })} /></label>{validation(field.id)}</div>;
      case "unit":
        return <div className="dialog-field" key={field.id}><label className={frame(field.id)}>{field.label}<select value={draft.unit} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "unit", value: event.target.value })}><option value="">{medication.labels.select}</option>{medication.doseUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></label>{validation(field.id)}</div>;
      case "route":
        return <div className="dialog-field" key={field.id}><label className={frame(field.id)}>{field.label}<select value={draft.route} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "route", value: event.target.value })}><option value="">{medication.labels.selectRoute}</option>{medication.routes.map((route) => <option key={route}>{route}</option>)}</select></label>{validation(field.id)}</div>;
      case "response":
        return <div className="dialog-field" key={field.id}><label className={frame(field.id)}>{field.label}<textarea rows={3} placeholder={field.placeholder} value={draft.response} onChange={(event) => dispatch({ type: "medication-draft-changed", field: "response", value: event.target.value })} /></label>{validation(field.id)}</div>;
    }
  };

  return <div className="dialog-backdrop" role="presentation">
    <section ref={dialogRef} className="note-dialog medication-dialog" role="dialog" aria-modal="true" aria-labelledby="medication-dialog-title">
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{draft.isNew ? medication.labels.newEyebrow : medication.labels.editEyebrow}</p><h2 id="medication-dialog-title">{medication.labels.editorTitle}</h2></div>
        <button className="remove-entry-button" type="button" onClick={() => dispatch({ type: "medication-removed" })}>{medication.labels.remove}</button>
      </div>
      {medication.fields.map(renderField)}
      <div className="note-dialog-actions">
        <button type="button" onClick={() => dispatch({ type: "medication-cancelled" })}>{medication.labels.cancel}</button>
        <button type="button" onClick={() => dispatch({ type: "medication-saved" })}>{draft.isNew ? medication.labels.add : medication.labels.save}</button>
      </div>
    </section>
  </div>;
}
