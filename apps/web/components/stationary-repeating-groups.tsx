"use client";

import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addRepeatingGroupOccurrence,
  configuredRepeatingGroups,
  eligibleRepeatingGroupParents,
  moveRepeatingGroupOccurrence,
  removeRepeatingGroupOccurrence,
  repeatingGroupInstances,
  repeatingGroupSummary,
  type RepeatingGroupFinding,
} from "../app/stationary-repeating-group";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { editScalarOccurrence, scalarControlPresentation } from "../app/stationary-scalar";
import { editStationaryCodedValue, stationaryCodedField } from "../app/stationary-coded-value";
import type { CompiledStationaryGroup, StationaryElementPlacement } from "../app/stationary-layout";
import { StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryScalarOccurrences } from "./stationary-scalar-occurrences";
import { StationaryScalarControl } from "./stationary-scalar-control";

function GroupField({ document, instance, placement, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly instance: EncounterGroupInstance;
  readonly placement: StationaryElementPlacement;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalogElement = requireNemsisDataElement(placement.id);
  const element = instance.elements.find(({ id }) => id === placement.id);
  if (catalogElement.valueSource.kind !== "scalar") {
    const field = stationaryCodedField(catalogElement);
    const values = element?.values ?? [];
    const repeatable = catalogElement.occurrence.max === "unbounded" || catalogElement.occurrence.max > 1;
    return <div className="stationary-group-coded-occurrences">
      {(repeatable ? values : [values[0]]).filter((value): value is EncounterValue => Boolean(value)).map((value) => (
        <StationaryCodedValueField key={value.occurrenceId} field={{ ...field, label: placement.label ?? field.label, help: placement.help ?? field.help }} value={value}
          onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
            groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id, occurrenceId: value.occurrenceId,
          }, selection))} />
      ))}
      {(!values.length || repeatable) && <StationaryCodedValueField field={{ ...field, label: placement.label ?? field.label, help: placement.help ?? field.help }}
        onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
          groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id,
        }, selection))} />}
    </div>;
  }
  const presentation = scalarControlPresentation(catalogElement, placement.label ?? catalogElement.name, placement.help ?? catalogElement.definition);
  if (presentation.repeatable) return <StationaryScalarOccurrences document={document} groupInstanceId={instance.instanceId} presentation={presentation} onDocumentChange={onDocumentChange} />;
  const value = element?.values.find((candidate) => candidate.kind === "scalar");
  return <StationaryScalarControl presentation={presentation} value={value?.kind === "scalar" ? value : undefined} onInput={(input) => {
    const result = editScalarOccurrence(document, {
      groupId: placement.groupId, groupInstanceId: instance.instanceId, elementId: placement.id,
      ...(value ? { occurrenceId: value.occurrenceId } : {}), input,
    });
    if (result.ok) onDocumentChange(result.document);
  }} />;
}

function RepeatingGroupDialog({ placement, draft, instanceId, isNew, onDraftChange, onCancel, onSave }: {
  readonly placement: CompiledStationaryGroup;
  readonly draft: EncounterDocument;
  readonly instanceId: string;
  readonly isNew: boolean;
  readonly onDraftChange: (document: EncounterDocument) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);
  const instance = repeatingGroupInstances(draft, placement.id).find((candidate) => candidate.instanceId === instanceId);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const animationFrame = window.requestAnimationFrame(() => {
      frame.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab" || !frame.current) return;
      const controls = [...frame.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
      if (!controls.length) return;
      const first = controls[0]!; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { window.cancelAnimationFrame(animationFrame); document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onCancel]);
  if (!instance) return null;
  const editable = placement.mode !== "read-only";
  return <div className="dialog-backdrop" role="presentation">
    <section ref={frame} className="note-dialog stationary-group-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-group-instance-id={instance.instanceId}>
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{isNew ? "New row" : editable ? "Edit row" : "View row"}</p><h2 id={titleId}>{isNew ? placement.presentation.dialog?.addLabel : placement.presentation.dialog?.editLabel}</h2></div>
        <button type="button" onClick={onCancel}>Close</button>
      </div>
      <p>{placement.presentation.help}</p>
      <div className="stationary-group-dialog-fields">
        {placement.elements.map((element) => editable
          ? <GroupField key={element.id} document={draft} instance={instance} placement={element} onDocumentChange={onDraftChange} />
          : <div key={element.id}><strong>{element.label ?? requireNemsisDataElement(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : "Exceptional value").join(", ") || "Not recorded"}</p></div>)}
        {!placement.elements.length && <p>No fields are stored directly on this structural group.</p>}
      </div>
      <div className="note-dialog-actions">
        <button type="button" onClick={onCancel}>{editable ? "Cancel" : "Close"}</button>
        {editable && <button type="button" onClick={onSave}>{isNew ? "Add row" : "Save changes"}</button>}
      </div>
    </section>
  </div>;
}

function RepeatingGroupTable({ document, placement, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const headingId = useId();
  const instances = repeatingGroupInstances(document, placement.id);
  const parents = eligibleRepeatingGroupParents(document, placement.id);
  const [parentId, setParentId] = useState(parents[0]?.instanceId ?? "");
  const [dialogState, setDialogState] = useState<{ draft: EncounterDocument; instanceId: string; isNew: boolean }>();
  const [finding, setFinding] = useState<RepeatingGroupFinding>();
  const editable = placement.mode !== "read-only";
  const openAdd = () => {
    const result = addRepeatingGroupOccurrence(document, placement.id, parentId || undefined);
    if (!result.ok) return setFinding(result.findings[0]);
    setFinding(undefined);
    setDialogState({ draft: result.document, instanceId: result.instanceId, isNew: true });
  };
  return <section className="stationary-repeating-group" aria-labelledby={headingId} data-group-id={placement.id}>
    <div className="section-heading">
      <div><h2 id={headingId}>{placement.presentation.label}</h2><p>{placement.presentation.help}</p></div>
      {editable && <div className="stationary-group-add-controls">
        {parents.length > 1 && <label>Parent row<select aria-label={`${placement.presentation.label} parent row`} value={parentId} onChange={(event) => setParentId(event.target.value)}>{parents.map((parent, index) => <option key={parent.instanceId} value={parent.instanceId}>Parent {index + 1}</option>)}</select></label>}
        <button type="button" disabled={!parents.length} onClick={openAdd}>{placement.presentation.dialog?.addLabel ?? `Add ${placement.presentation.label}`}</button>
      </div>}
    </div>
    <div className="stationary-table-scroll" tabIndex={0} role="region" aria-label={`${placement.presentation.label} table`}>
      <table><thead><tr>{(placement.presentation.columns ?? []).map((column) => <th key={column.elementId} style={{ width: column.width }}>{column.label ?? requireNemsisDataElement(column.elementId).name}</th>)}<th>Actions</th></tr></thead>
        <tbody>{instances.map((instance) => {
          const siblings = instances.filter(({ parentInstanceId }) => parentInstanceId === instance.parentInstanceId);
          const index = siblings.findIndex(({ instanceId }) => instanceId === instance.instanceId);
          return <tr key={instance.instanceId} data-group-instance-id={instance.instanceId}>
            {repeatingGroupSummary(document, placement, instance).map((cell) => <td key={cell.elementId} data-element-id={cell.elementId}>{cell.values.length ? cell.values.map((value) => <span key={value.occurrenceId} data-occurrence-id={value.occurrenceId}>{value.text}</span>) : <span>Not recorded</span>}</td>)}
            <td><div className="stationary-row-actions"><button type="button" onClick={() => setDialogState({ draft: document, instanceId: instance.instanceId, isNew: false })}>{editable ? "Edit" : "View"}</button>
              {editable && <><button type="button" disabled={index === 0} onClick={() => { const result = moveRepeatingGroupOccurrence(document, placement.id, instance.instanceId, index - 1); if (result.ok) onDocumentChange(result.document); }}>Move up</button>
                <button type="button" disabled={index === siblings.length - 1} onClick={() => { const result = moveRepeatingGroupOccurrence(document, placement.id, instance.instanceId, index + 1); if (result.ok) onDocumentChange(result.document); }}>Move down</button>
                <button type="button" onClick={() => { const result = removeRepeatingGroupOccurrence(document, placement.id, instance.instanceId); if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]); }}>Remove</button></>}</div></td>
          </tr>;
        })}</tbody></table>
    </div>
    {!instances.length && <p className="stationary-empty-table">No rows.</p>}
    {finding && <p role="alert">{finding.message}</p>}
    {dialogState && <RepeatingGroupDialog key={`${dialogState.instanceId}:${dialogState.isNew}`} placement={placement} draft={dialogState.draft} instanceId={dialogState.instanceId} isNew={dialogState.isNew}
      onDraftChange={(draft) => setDialogState((current) => current ? { ...current, draft } : current)} onCancel={() => setDialogState(undefined)}
      onSave={() => { onDocumentChange(dialogState.draft); setDialogState(undefined); }} />}
  </section>;
}

/** Renders every catalogue-configured repeating group through canonical instance identities. */
export function StationaryRepeatingGroups({ document, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const groups = useMemo(() => configuredRepeatingGroups(), []);
  return <div className="stationary-repeating-groups">{groups.map((group) => <RepeatingGroupTable key={group.id} document={document} placement={group} onDocumentChange={onDocumentChange} />)}</div>;
}
