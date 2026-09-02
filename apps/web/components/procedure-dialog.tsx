import type { RefObject } from "react";
import type { ProcedureEventDefinition, ProcedureField } from "../app/encounter-definition";
import { searchProcedures, validateProcedure, type ProcedureDraft } from "../app/procedure";
import type { ReviewFinding, ShellAction } from "../app/standard-encounter";
import { TimePicker } from "./time-picker";

export function ProcedureDialog({ dialogRef, draft, definition, search, onSearch, dispatch, finding }: {
  readonly dialogRef: RefObject<HTMLElement | null>; readonly draft: ProcedureDraft; readonly definition: ProcedureEventDefinition;
  readonly search: string; readonly onSearch: (value: string) => void; readonly dispatch: (action: ShellAction) => void; readonly finding?: ReviewFinding;
}) {
  const results = searchProcedures(search, 30, definition);
  const validation = validateProcedure(draft, definition);
  const findingActive = !!(finding && finding.category === definition.labels.category && [...validation.errors, ...validation.warnings].includes(finding.message));
  const frameFor = (field: ProcedureField) => findingActive && (finding!.reference === definition.references[field] || (finding!.severity === "warning" && field === "complications"))
    ? `finding-frame ${finding!.severity}` : undefined;

  const renderField = (field: ProcedureField) => {
    if (field === "procedure") return !draft.procedureCode ? (
      <div key={field} className={`catalog-picker ${frameFor(field) ?? ""}`.trim()}>
        <label htmlFor="procedure-search">{definition.labels.search}</label>
        <input autoFocus data-dialog-initial-focus id="procedure-search" type="search" placeholder={definition.labels.searchPlaceholder} value={search} onChange={(event) => onSearch(event.target.value)} />
        <p className="catalog-caption">{results.length} {definition.labels.offlineCaption}</p>
        <ul className="catalog-results">{results.map((procedure) => <li key={procedure.code}><button type="button" onClick={() => dispatch({ type: "procedure-selected", code: procedure.code })}><strong>{procedure.label}</strong><span>{procedure.category}</span></button></li>)}</ul>
        {!results.length && <p className="empty-results">{definition.labels.noResults}</p>}
      </div>
    ) : <div key={field} className={`selected-catalog-item ${frameFor(field) ?? ""}`.trim()}><strong>{draft.procedureLabel}</strong><button type="button" onClick={() => { onSearch(""); dispatch({ type: "procedure-selected", code: "" }); }}>{definition.labels.change}</button></div>;
    if (!draft.procedureCode) return null;
    if (field === "time") return <TimePicker key={field} className={frameFor(field)} label={definition.labels.time} date={draft.date} onDateChange={(value) => dispatch({ type: "procedure-draft-changed", field: "date", value })} value={draft.time} onChange={(value) => dispatch({ type: "procedure-draft-changed", field: "time", value })} />;
    if (field === "attempts") return <label key={field} className={frameFor(field)}>{definition.labels.attempts}<input inputMode="numeric" min={definition.attempts.min} max={definition.attempts.max} required={definition.required.attempts} type="number" value={draft.attempts} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "attempts", value: event.target.value })} /></label>;
    if (field === "success") return <label key={field} className={frameFor(field)}>{definition.labels.success}<select required={definition.required.success} value={draft.success} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "success", value: event.target.value })}><option value="">{definition.labels.select}</option>{definition.successOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    if (field === "outcome") return <label key={field} className={frameFor(field)}>{definition.labels.outcome}<select required={definition.required.outcome} value={draft.outcome} onChange={(event) => dispatch({ type: "procedure-draft-changed", field: "outcome", value: event.target.value })}><option value="">{definition.labels.select}</option>{definition.outcomeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    return <fieldset key={field} className={`complication-options ${frameFor(field) ?? ""}`.trim()}><legend>{definition.labels.complications}</legend>{definition.complicationOptions.map((option) => <label key={option.code}><input type="checkbox" checked={draft.complications.includes(option.code)} onChange={() => dispatch({ type: "procedure-complication-toggled", code: option.code })} /><span>{option.label}</span></label>)}</fieldset>;
  };

  return <div className="dialog-backdrop" role="presentation"><section ref={dialogRef} className="note-dialog procedure-dialog" role="dialog" aria-modal="true" aria-labelledby="procedure-dialog-title">
    <div className="note-dialog-heading"><div><p className="eyebrow">{draft.isNew ? definition.labels.newEyebrow : definition.labels.editEyebrow}</p><h2 id="procedure-dialog-title">{definition.labels.editorTitle}</h2></div><button aria-label={definition.labels.closeEditor} type="button" onClick={() => dispatch({ type: "procedure-cancelled" })}>×</button></div>
    <div className="procedure-fields">{definition.fieldOrder.map(renderField)}</div>
    {draft.procedureCode && <div className="note-dialog-actions"><button type="button" onClick={() => dispatch({ type: "procedure-cancelled" })}>{definition.labels.cancel}</button><button type="button" onClick={() => dispatch({ type: "procedure-saved" })}>{draft.isNew ? definition.labels.add : definition.labels.save}</button></div>}
  </section></div>;
}
