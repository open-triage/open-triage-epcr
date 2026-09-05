"use client";

import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import {
  addRepeatingGroupOccurrence,
  configuredRepeatingGroupRoots,
  ensureNestedSingleGroupOccurrence,
  eligibleRepeatingGroupParents,
  removeRepeatingGroupOccurrence,
  repeatingGroupInstances,
  repeatingGroupSummary,
  sortRepeatingGroupInstancesByTimestamp,
  type RepeatingGroupFinding,
} from "../app/stationary-repeating-group";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { editScalarOccurrence, scalarControlPresentation, stationaryDateTimeDefault, type ScalarControlPresentation, type ScalarValidationFinding } from "../app/stationary-scalar";
import { editStationaryCodedValue, stationaryCodedField } from "../app/stationary-coded-value";
import type { CompiledStationaryGroup, StationaryElementPlacement } from "../app/stationary-layout";
import { stationaryActionLabel, stationaryDisplayLabel } from "../app/stationary-label";
import { StationaryCodedOccurrencesField, StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryScalarOccurrences } from "./stationary-scalar-occurrences";
import { StationaryScalarControl } from "./stationary-scalar-control";
import type { StationarySectionFinding } from "../app/stationary-record";
import { StationaryValidationMessages, stationaryFindingSeverity } from "./stationary-validation-messages";
import { validateStationaryRecord } from "../app/stationary-validation";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, reviewEncounter } from "../app/standard-encounter";

export function stationaryDialogFindings(document: EncounterDocument): ReadonlyArray<StationarySectionFinding> {
  return [
    ...validateStationaryRecord(document),
    ...reviewEncounter({ ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document } }, bundledEncounterDefinition),
  ];
}

function groupValidationFindings(findings: ReadonlyArray<StationarySectionFinding>, groupId: string, instanceId?: string) {
  return findings.filter((finding) => {
    const targetInstance = finding.target.groupInstanceId ?? finding.target.instanceId;
    return finding.target.groupId === groupId && (!instanceId || !targetInstance || targetInstance === instanceId);
  });
}

function elementValidationFindings(findings: ReadonlyArray<StationarySectionFinding>, groupId: string, instanceId: string, elementId: string) {
  return findings.filter((finding) => {
    const targetInstance = finding.target.groupInstanceId ?? finding.target.instanceId;
    const targetElement = finding.target.fieldId ?? finding.target.elementId;
    return finding.target.groupId === groupId && targetElement === elementId && (!targetInstance || targetInstance === instanceId);
  });
}

function GroupField({ document, instance, placement, findings = [], initialFocus = false, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly instance: EncounterGroupInstance;
  readonly placement: StationaryElementPlacement;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly initialFocus?: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalogElement = requireNemsisDataElement(placement.id);
  const element = instance.elements.find(({ id }) => id === placement.id);
  const validationFindings = elementValidationFindings(findings, placement.groupId, instance.instanceId, placement.id);
  const validationSeverity = stationaryFindingSeverity(validationFindings);
  const withValidation = (control: React.ReactNode) => <div className={`stationary-dialog-field${validationSeverity ? ` stationary-validation-state ${validationSeverity}` : ""}`} data-element-id={placement.id}>
    {control}<StationaryValidationMessages findings={validationFindings} />
  </div>;
  if (catalogElement.valueSource.kind !== "scalar") {
    const field = stationaryCodedField(catalogElement);
    const presentation = { ...field, label: placement.label ?? field.label, help: placement.help ?? field.help };
    const values = element?.values ?? [];
    const repeatable = catalogElement.occurrence.max === "unbounded" || catalogElement.occurrence.max > 1;
    if (repeatable) return withValidation(<StationaryCodedOccurrencesField field={presentation} values={values} onChange={(value, selection) => onDocumentChange(editStationaryCodedValue(document, {
      groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id,
      ...(value ? { occurrenceId: value.occurrenceId } : {}),
    }, selection))} />);
    return withValidation(<div className="stationary-group-coded-occurrences" data-element-id={placement.id}>
      {[values[0]].filter((value): value is EncounterValue => Boolean(value)).map((value) => (
        <StationaryCodedValueField key={value.occurrenceId} field={presentation} value={value}
          onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
            groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id, occurrenceId: value.occurrenceId,
          }, selection))} />
      ))}
      {!values.length && <StationaryCodedValueField field={presentation}
        onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
          groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id,
        }, selection))} />}
    </div>);
  }
  const presentation = scalarControlPresentation(catalogElement, placement.label ?? catalogElement.name, placement.help ?? catalogElement.definition);
  if (presentation.repeatable) return withValidation(<StationaryScalarOccurrences document={document} groupInstanceId={instance.instanceId} presentation={presentation} onDocumentChange={onDocumentChange} />);
  const value = element?.values.find((candidate) => candidate.kind === "scalar");
  return withValidation(<SingleScalarGroupField document={document} instance={instance} placement={placement} presentation={presentation}
    value={value?.kind === "scalar" ? value : undefined} initialFocus={initialFocus} onDocumentChange={onDocumentChange} />);
}

function SingleScalarGroupField({ document, instance, placement, presentation, value, initialFocus, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly instance: EncounterGroupInstance;
  readonly placement: StationaryElementPlacement;
  readonly presentation: ScalarControlPresentation;
  readonly value?: Extract<EncounterValue, { kind: "scalar" }>;
  readonly initialFocus: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const [raw, setRaw] = useState<string | boolean>();
  const [findings, setFindings] = useState<ReadonlyArray<ScalarValidationFinding>>([]);
  const commit = (input: string | boolean) => {
    const result = editScalarOccurrence(document, {
      groupId: placement.groupId, groupInstanceId: instance.instanceId, elementId: placement.id,
      ...(value ? { occurrenceId: value.occurrenceId } : {}), input,
    });
    if (!result.ok) return setFindings(result.findings);
    setFindings([]);
    setRaw(undefined);
    onDocumentChange(result.document);
  };
  return <div data-element-id={placement.id}><StationaryScalarControl presentation={presentation} value={value} inputValue={raw} findings={findings} initialFocus={initialFocus}
    defaultDateTime={presentation.family === "datetime" ? stationaryDateTimeDefault(document, {
      groupId: placement.groupId, groupInstanceId: instance.instanceId, excludedOccurrenceId: value?.occurrenceId,
    }) : undefined}
    onInput={(input) => {
      setRaw(input);
      setFindings([]);
      if (presentation.family === "datetime") commit(input);
    }}
    onBlur={commit} /></div>;
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
  const liveFindings = useMemo(() => stationaryDialogFindings(draft), [draft]);
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
  const label = stationaryDisplayLabel(placement.presentation.label ?? placement.id);
  const actionLabel = stationaryActionLabel(placement.presentation.label ?? placement.id);
  const validationFindings = groupValidationFindings(liveFindings, placement.id, instance.instanceId);
  const groupOnlyFindings = validationFindings.filter((finding) => !(finding.target.fieldId ?? finding.target.elementId));
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <section ref={frame} className="note-dialog stationary-group-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-group-instance-id={instance.instanceId}>
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{isNew ? "New row" : editable ? "Edit row" : "View row"}</p><h2 id={titleId}>{isNew ? `Add ${actionLabel}` : `${editable ? "Edit" : "View"} ${actionLabel}`}</h2></div>
        <button className="stationary-dialog-close" type="button" aria-label="Close dialog" title="Close" onClick={onCancel}>×</button>
      </div>
      <div className="stationary-group-dialog-fields">
        {placement.elements.map((element, index) => editable
          ? <GroupField key={element.id} document={draft} instance={instance} placement={element} findings={validationFindings} initialFocus={index === 0} onDocumentChange={onDraftChange} />
          : <div key={element.id}><strong>{element.label ?? requireNemsisDataElement(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : "Exceptional value").join(", ") || "Not recorded"}</p></div>)}
        {!placement.elements.length && <p>No fields are stored directly on this structural group.</p>}
      </div>
      <NestedGroupContents document={draft} placement={placement} parentInstanceId={instance.instanceId} findings={liveFindings} onDocumentChange={onDraftChange} />
      {editable && <div className="note-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={onSave}>{isNew ? "Add row" : "Save changes"}</button>
      </div>}
      <StationaryValidationMessages findings={groupOnlyFindings} />
    </section>
  </div>;
}

function NestedSingleGroup({ document, placement, parentInstanceId, findings, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly findings: ReadonlyArray<StationarySectionFinding>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalog = requireNemsisDataElement;
  const label = stationaryDisplayLabel(placement.presentation.label ?? placement.id);
  const instance = document.groups.find(({ id }) => id === placement.id)?.instances.find((candidate) => candidate.parentInstanceId === parentInstanceId);
  const editable = placement.mode !== "read-only";
  const validationFindings = groupValidationFindings(findings, placement.id, instance?.instanceId);
  if (!instance) return <div className="stationary-nested-single stationary-nested-single-empty" aria-label={`${label} fields`} data-group-id={placement.id} data-parent-instance-id={parentInstanceId}>
    {editable && <span className="stationary-single-group-loading" role="status">Loading {label} fields…</span>}
    <StationaryValidationMessages findings={validationFindings} />
  </div>;
  return <div className="stationary-nested-single" aria-label={`${label} fields`} data-group-id={placement.id} data-group-instance-id={instance.instanceId} data-parent-instance-id={parentInstanceId}>
    <div className="stationary-group-dialog-fields">
      {placement.elements.map((element) => editable
        ? <GroupField key={element.id} document={document} instance={instance} placement={element} findings={validationFindings} onDocumentChange={onDocumentChange} />
        : <div key={element.id}><strong>{element.label ?? catalog(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : "Exceptional value").join(", ") || "Not recorded"}</p></div>)}
    </div>
    <NestedGroupContents document={document} placement={placement} parentInstanceId={instance.instanceId} findings={findings} onDocumentChange={onDocumentChange} />
    <StationaryValidationMessages findings={validationFindings.filter((finding) => !(finding.target.fieldId ?? finding.target.elementId))} />
  </div>;
}

function NestedGroupContents({ document, placement, parentInstanceId, findings, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly findings: ReadonlyArray<StationarySectionFinding>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  useEffect(() => {
    let next = document;
    let changed = false;
    for (const child of placement.children) {
      if (child.presentation.kind === "table" || child.mode === "read-only") continue;
      const exists = next.groups.find(({ id }) => id === child.id)?.instances.some((instance) => instance.parentInstanceId === parentInstanceId);
      if (exists) continue;
      const result = ensureNestedSingleGroupOccurrence(next, child.id, parentInstanceId);
      if (result.ok) {
        next = result.document;
        changed = true;
      }
    }
    if (changed) onDocumentChange(next);
  }, [document, onDocumentChange, parentInstanceId, placement.children]);
  if (!placement.children.length) return null;
  return <div className="stationary-nested-groups">
    {placement.children.map((child) => child.presentation.kind === "table"
      ? <RepeatingGroupTable key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} findings={findings} onDocumentChange={onDocumentChange} />
      : <NestedSingleGroup key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} findings={findings} onDocumentChange={onDocumentChange} />)}
  </div>;
}

export function RepeatingGroupTable({ document, placement, parentInstanceId, findings = [], onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId?: string;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const headingId = useId();
  const instances = sortRepeatingGroupInstancesByTimestamp(document, repeatingGroupInstances(document, placement.id, parentInstanceId));
  const parents = parentInstanceId ? [] : eligibleRepeatingGroupParents(document, placement.id);
  const [selectedParentId, setSelectedParentId] = useState(parents[0]?.instanceId ?? "");
  const [dialogState, setDialogState] = useState<{ draft: EncounterDocument; instanceId: string; isNew: boolean; returnFocus: HTMLElement }>();
  const [finding, setFinding] = useState<RepeatingGroupFinding>();
  const editable = placement.mode !== "read-only";
  const label = stationaryDisplayLabel(placement.presentation.label ?? placement.id);
  const actionLabel = stationaryActionLabel(placement.presentation.label ?? placement.id);
  const localFindings: ReadonlyArray<StationarySectionFinding> = finding ? [{ severity: "error", message: finding.message, target: { groupId: placement.id } }] : [];
  const validationFindings = [...groupValidationFindings(findings, placement.id), ...localFindings];
  const validationSeverity = stationaryFindingSeverity(validationFindings);
  const openAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    const result = addRepeatingGroupOccurrence(document, placement.id, parentInstanceId ?? (selectedParentId || undefined));
    if (!result.ok) return setFinding(result.findings[0]);
    setFinding(undefined);
    setDialogState({ draft: result.document, instanceId: result.instanceId, isNew: true, returnFocus: event.currentTarget });
  };
  return <section className={`stationary-repeating-group${validationSeverity ? ` stationary-validation-state ${validationSeverity}` : ""}`} aria-labelledby={headingId} data-group-id={placement.id} {...(parentInstanceId ? { "data-parent-instance-id": parentInstanceId } : {})}>
    <div className="section-heading">
      <h2 id={headingId}>{label}</h2>
      {editable && <div className="stationary-group-add-controls">
        {parents.length > 1 && <label>Parent row<select aria-label={`${label} parent row`} value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}>{parents.map((parent, index) => <option key={parent.instanceId} value={parent.instanceId}>Parent {index + 1}</option>)}</select></label>}
        <button type="button" data-dialog-return-focus={`${placement.id}:${parentInstanceId ?? "record"}:add`} onClick={openAdd}>Add {actionLabel}</button>
      </div>}
    </div>
    <div className="stationary-table-scroll" tabIndex={0} role="region" aria-label={`${label} table`}>
      <table><thead><tr>{(placement.presentation.columns ?? []).map((column) => <th key={column.elementId} style={{ width: column.width }}>{column.label ?? requireNemsisDataElement(column.elementId).name}</th>)}<th>Actions</th></tr></thead>
        <tbody>{instances.map((instance) => <tr key={instance.instanceId} data-group-instance-id={instance.instanceId}>
            {repeatingGroupSummary(document, placement, instance).map((cell) => <td key={cell.elementId} data-element-id={cell.elementId}>{cell.values.length ? cell.values.map((value) => <span key={value.occurrenceId} data-occurrence-id={value.occurrenceId}>{value.text}</span>) : <span>Not recorded</span>}</td>)}
            <td className="stationary-table-actions"><div className="stationary-row-actions"><button className="stationary-icon-action edit" type="button" aria-label={`${editable ? "Edit" : "View"} ${actionLabel} row`} title={editable ? "Edit" : "View"} data-dialog-return-focus={`${placement.id}:${instance.instanceId}:edit`} onClick={(event) => setDialogState({ draft: document, instanceId: instance.instanceId, isNew: false, returnFocus: event.currentTarget })}><span aria-hidden="true">{editable ? "✎" : "View"}</span></button>
              {editable && <button className="stationary-icon-action remove" type="button" aria-label={`Remove ${actionLabel} row`} title="Remove" onClick={() => { const result = removeRepeatingGroupOccurrence(document, placement.id, instance.instanceId); if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]); }}><span aria-hidden="true">×</span></button>}</div></td>
          </tr>)}</tbody></table>
    </div>
    {!instances.length && <p className="stationary-empty-table">No rows.</p>}
    <StationaryValidationMessages findings={validationFindings} />
    {dialogState && <RepeatingGroupDialog key={`${dialogState.instanceId}:${dialogState.isNew}`} placement={placement} draft={dialogState.draft} instanceId={dialogState.instanceId} isNew={dialogState.isNew} returnFocus={dialogState.returnFocus}
      onDraftChange={(draft) => setDialogState((current) => current ? { ...current, draft } : current)} onCancel={() => setDialogState(undefined)}
      onSave={() => { onDocumentChange(dialogState.draft); setDialogState(undefined); }} />}
  </section>;
}

/** Renders every catalogue-configured repeating group through canonical instance identities. */
export function StationaryRepeatingGroups({ document, groups: configuredGroups, findings = [], onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groups?: ReadonlyArray<CompiledStationaryGroup>;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const defaultGroups = useMemo(() => configuredRepeatingGroupRoots(), []);
  const groups = configuredGroups ?? defaultGroups;
  return <div className="stationary-repeating-groups">{groups.map((group) => <RepeatingGroupTable key={group.id} document={document} placement={group} findings={findings} onDocumentChange={onDocumentChange} />)}</div>;
}
