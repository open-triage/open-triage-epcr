"use client";

import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import {
  addRepeatingGroupOccurrence,
  configuredRepeatingGroupRoots,
  ensureNestedSingleGroupOccurrence,
  eligibleRepeatingGroupParents,
  moveRepeatingGroupOccurrence,
  removeRepeatingGroupOccurrence,
  removeNestedGroupOccurrence,
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

function GroupField({ document, instance, placement, initialFocus = false, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly instance: EncounterGroupInstance;
  readonly placement: StationaryElementPlacement;
  readonly initialFocus?: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalogElement = requireNemsisDataElement(placement.id);
  const element = instance.elements.find(({ id }) => id === placement.id);
  if (catalogElement.valueSource.kind !== "scalar") {
    const field = stationaryCodedField(catalogElement);
    const values = element?.values ?? [];
    const repeatable = catalogElement.occurrence.max === "unbounded" || catalogElement.occurrence.max > 1;
    return <div className="stationary-group-coded-occurrences" data-element-id={placement.id}>
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
  if (presentation.repeatable) return <div data-element-id={placement.id}><StationaryScalarOccurrences document={document} groupInstanceId={instance.instanceId} presentation={presentation} onDocumentChange={onDocumentChange} /></div>;
  const value = element?.values.find((candidate) => candidate.kind === "scalar");
  return <div data-element-id={placement.id}><StationaryScalarControl presentation={presentation} value={value?.kind === "scalar" ? value : undefined} initialFocus={initialFocus} onInput={(input) => {
    const result = editScalarOccurrence(document, {
      groupId: placement.groupId, groupInstanceId: instance.instanceId, elementId: placement.id,
      ...(value ? { occurrenceId: value.occurrenceId } : {}), input,
    });
    if (result.ok) onDocumentChange(result.document);
  }} /></div>;
}

function RepeatingGroupDialog({ placement, draft, instanceId, isNew, returnFocus, onDraftChange, onCancel, onSave }: {
  readonly placement: CompiledStationaryGroup;
  readonly draft: EncounterDocument;
  readonly instanceId: string;
  readonly isNew: boolean;
  readonly returnFocus?: HTMLElement | null;
  readonly onDraftChange: (document: EncounterDocument) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);
  const [focusTarget] = useState(returnFocus);
  const cancelDialog = useEffectEvent(onCancel);
  const instance = repeatingGroupInstances(draft, placement.id).find((candidate) => candidate.instanceId === instanceId);
  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const initial = frame.current?.querySelector<HTMLElement>("[autofocus]")
        ?? frame.current?.querySelector<HTMLElement>("input, select, textarea")
        ?? frame.current?.querySelector<HTMLElement>("button");
      initial?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      if (dialogs.item(dialogs.length - 1) !== frame.current) return;
      if (event.key === "Escape") { event.preventDefault(); cancelDialog(); return; }
      if (event.key !== "Tab" || !frame.current) return;
      const controls = [...frame.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
      if (!controls.length) return;
      const first = controls[0]!; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", keydown);
      const target = focusTarget;
      const focusKey = target?.dataset.dialogReturnFocus;
      const currentTarget = focusKey
        ? [...document.querySelectorAll<HTMLElement>("[data-dialog-return-focus]")].find((candidate) => candidate.dataset.dialogReturnFocus === focusKey)
        : undefined;
      window.requestAnimationFrame(() => (target?.isConnected ? target : currentTarget)?.focus());
    };
  }, [focusTarget]);
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
        {placement.elements.map((element, index) => editable
          ? <GroupField key={element.id} document={draft} instance={instance} placement={element} initialFocus={index === 0} onDocumentChange={onDraftChange} />
          : <div key={element.id}><strong>{element.label ?? requireNemsisDataElement(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : "Exceptional value").join(", ") || "Not recorded"}</p></div>)}
        {!placement.elements.length && <p>No fields are stored directly on this structural group.</p>}
      </div>
      <NestedGroupContents document={draft} placement={placement} parentInstanceId={instance.instanceId} onDocumentChange={onDraftChange} />
      <div className="note-dialog-actions">
        <button type="button" onClick={onCancel}>{editable ? "Cancel" : "Close"}</button>
        {editable && <button type="button" onClick={onSave}>{isNew ? "Add row" : "Save changes"}</button>}
      </div>
    </section>
  </div>;
}

function NestedSingleGroup({ document, placement, parentInstanceId, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const headingId = useId();
  const catalog = requireNemsisDataElement;
  const instance = document.groups.find(({ id }) => id === placement.id)?.instances.find((candidate) => candidate.parentInstanceId === parentInstanceId);
  const [finding, setFinding] = useState<RepeatingGroupFinding>();
  const editable = placement.mode !== "read-only";
  if (!instance) return <section className="stationary-nested-single" aria-labelledby={headingId} data-group-id={placement.id} data-parent-instance-id={parentInstanceId}>
    <div className="section-heading"><h3 id={headingId}>{placement.presentation.label ?? placement.id}</h3>
      {editable && <button type="button" onClick={() => {
        const result = ensureNestedSingleGroupOccurrence(document, placement.id, parentInstanceId);
        if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]);
      }}>Add {placement.presentation.label ?? placement.id}</button>}
    </div>
    {finding && <p role="alert">{finding.message}</p>}
  </section>;
  return <section className="stationary-nested-single" aria-labelledby={headingId} data-group-id={placement.id} data-group-instance-id={instance.instanceId} data-parent-instance-id={parentInstanceId}>
    <div className="section-heading"><h3 id={headingId}>{placement.presentation.label ?? placement.id}</h3>
      {editable && <button type="button" onClick={() => {
        const result = removeNestedGroupOccurrence(document, placement.id, instance.instanceId);
        if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]);
      }}>Remove {placement.presentation.label ?? placement.id}</button>}
    </div>
    <div className="stationary-group-dialog-fields">
      {placement.elements.map((element) => editable
        ? <GroupField key={element.id} document={document} instance={instance} placement={element} onDocumentChange={onDocumentChange} />
        : <div key={element.id}><strong>{element.label ?? catalog(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : "Exceptional value").join(", ") || "Not recorded"}</p></div>)}
    </div>
    <NestedGroupContents document={document} placement={placement} parentInstanceId={instance.instanceId} onDocumentChange={onDocumentChange} />
    {finding && <p role="alert">{finding.message}</p>}
  </section>;
}

function NestedGroupContents({ document, placement, parentInstanceId, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  if (!placement.children.length) return null;
  return <div className="stationary-nested-groups">
    {placement.children.map((child) => child.presentation.kind === "table"
      ? <RepeatingGroupTable key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} onDocumentChange={onDocumentChange} />
      : <NestedSingleGroup key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} onDocumentChange={onDocumentChange} />)}
  </div>;
}

export function RepeatingGroupTable({ document, placement, parentInstanceId, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId?: string;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const headingId = useId();
  const instances = repeatingGroupInstances(document, placement.id, parentInstanceId);
  const parents = parentInstanceId ? [] : eligibleRepeatingGroupParents(document, placement.id);
  const [selectedParentId, setSelectedParentId] = useState(parents[0]?.instanceId ?? "");
  const [dialogState, setDialogState] = useState<{ draft: EncounterDocument; instanceId: string; isNew: boolean; returnFocus: HTMLElement }>();
  const [finding, setFinding] = useState<RepeatingGroupFinding>();
  const editable = placement.mode !== "read-only";
  const openAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    const result = addRepeatingGroupOccurrence(document, placement.id, parentInstanceId ?? (selectedParentId || undefined));
    if (!result.ok) return setFinding(result.findings[0]);
    setFinding(undefined);
    setDialogState({ draft: result.document, instanceId: result.instanceId, isNew: true, returnFocus: event.currentTarget });
  };
  return <section className="stationary-repeating-group" aria-labelledby={headingId} data-group-id={placement.id} {...(parentInstanceId ? { "data-parent-instance-id": parentInstanceId } : {})}>
    <div className="section-heading">
      <div><h2 id={headingId}>{placement.presentation.label}</h2><p>{placement.presentation.help}</p></div>
      {editable && <div className="stationary-group-add-controls">
        {parents.length > 1 && <label>Parent row<select aria-label={`${placement.presentation.label} parent row`} value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}>{parents.map((parent, index) => <option key={parent.instanceId} value={parent.instanceId}>Parent {index + 1}</option>)}</select></label>}
        <button type="button" data-dialog-return-focus={`${placement.id}:${parentInstanceId ?? "record"}:add`} onClick={openAdd}>{placement.presentation.dialog?.addLabel ?? `Add ${placement.presentation.label}`}</button>
      </div>}
    </div>
    <div className="stationary-table-scroll" tabIndex={0} role="region" aria-label={`${placement.presentation.label} table`}>
      <table><thead><tr>{(placement.presentation.columns ?? []).map((column) => <th key={column.elementId} style={{ width: column.width }}>{column.label ?? requireNemsisDataElement(column.elementId).name}</th>)}<th>Actions</th></tr></thead>
        <tbody>{instances.map((instance) => {
          const siblings = instances.filter(({ parentInstanceId }) => parentInstanceId === instance.parentInstanceId);
          const index = siblings.findIndex(({ instanceId }) => instanceId === instance.instanceId);
          return <tr key={instance.instanceId} data-group-instance-id={instance.instanceId}>
            {repeatingGroupSummary(document, placement, instance).map((cell) => <td key={cell.elementId} data-element-id={cell.elementId}>{cell.values.length ? cell.values.map((value) => <span key={value.occurrenceId} data-occurrence-id={value.occurrenceId}>{value.text}</span>) : <span>Not recorded</span>}</td>)}
            <td><div className="stationary-row-actions"><button type="button" data-dialog-return-focus={`${placement.id}:${instance.instanceId}:edit`} onClick={(event) => setDialogState({ draft: document, instanceId: instance.instanceId, isNew: false, returnFocus: event.currentTarget })}>{editable ? "Edit" : "View"}</button>
              {editable && <><button type="button" disabled={index === 0} onClick={() => { const result = moveRepeatingGroupOccurrence(document, placement.id, instance.instanceId, index - 1); if (result.ok) onDocumentChange(result.document); }}>Move up</button>
                <button type="button" disabled={index === siblings.length - 1} onClick={() => { const result = moveRepeatingGroupOccurrence(document, placement.id, instance.instanceId, index + 1); if (result.ok) onDocumentChange(result.document); }}>Move down</button>
                <button type="button" onClick={() => { const result = removeRepeatingGroupOccurrence(document, placement.id, instance.instanceId); if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]); }}>Remove</button></>}</div></td>
          </tr>;
        })}</tbody></table>
    </div>
    {!instances.length && <p className="stationary-empty-table">No rows.</p>}
    {finding && <p role="alert">{finding.message}</p>}
    {dialogState && <RepeatingGroupDialog key={`${dialogState.instanceId}:${dialogState.isNew}`} placement={placement} draft={dialogState.draft} instanceId={dialogState.instanceId} isNew={dialogState.isNew} returnFocus={dialogState.returnFocus}
      onDraftChange={(draft) => setDialogState((current) => current ? { ...current, draft } : current)} onCancel={() => setDialogState(undefined)}
      onSave={() => { onDocumentChange(dialogState.draft); setDialogState(undefined); }} />}
  </section>;
}

/** Renders every catalogue-configured repeating group through canonical instance identities. */
export function StationaryRepeatingGroups({ document, groups: configuredGroups, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groups?: ReadonlyArray<CompiledStationaryGroup>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const defaultGroups = useMemo(() => configuredRepeatingGroupRoots(), []);
  const groups = configuredGroups ?? defaultGroups;
  return <div className="stationary-repeating-groups">{groups.map((group) => <RepeatingGroupTable key={group.id} document={document} placement={group} onDocumentChange={onDocumentChange} />)}</div>;
}
