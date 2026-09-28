"use client";

import { resolveCatalogElementText } from "../app/catalog-localization";
import { resolveMessage } from "../app/localization";
import { formFieldForElement, formFieldText, type FormLanguage } from "../app/form-localization";
import type { ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import React, { createContext, useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
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
import { configuredStationaryCodedField, editStationaryCodedValue } from "../app/stationary-coded-value";
import type { CompiledStationaryGroup, StationaryElementPlacement } from "../app/stationary-layout";
import { stationaryActionLabel, stationaryDisplayLabel } from "../app/stationary-label";
import { StationaryCodedOccurrencesField, StationaryCodedValueField } from "./stationary-coded-field";
import { StationaryScalarOccurrences } from "./stationary-scalar-occurrences";
import { StationaryScalarControl } from "./stationary-scalar-control";
import type { StationarySectionFinding } from "../app/stationary-record";
import { StationaryValidationMessages, stationaryFindingSeverity } from "./stationary-validation-messages";
import { actionableStationaryFindings, stationaryReviewFindings, validateStationaryRecord } from "../app/stationary-validation";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, reviewEncounter } from "../app/standard-encounter";
import { withoutDemoProvenance } from "../app/demo-provenance";

export function stationaryDialogFindings(document: EncounterDocument, clinicalForm?: ClinicalFormConfiguration): ReadonlyArray<StationarySectionFinding> {
  const reviewFindings = reviewEncounter({ ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document } }, bundledEncounterDefinition);
  return [
    ...actionableStationaryFindings(validateStationaryRecord(document, clinicalForm, new Date().toISOString())),
    ...stationaryReviewFindings(reviewFindings, clinicalForm),
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

const FormPresentationContext = createContext<{ definition?: ClinicalFormConfiguration["definition"]; language: FormLanguage }>({ language: "en" });

function GroupField({ document, instance, placement, findings = [], initialFocus = false, catalogFields = {}, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly instance: EncounterGroupInstance;
  readonly placement: StationaryElementPlacement;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly initialFocus?: boolean;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const { definition, language } = useContext(FormPresentationContext);
  const authored = formFieldForElement(definition, placement.id);
  const labelOverride = definition && formFieldText(definition, authored, language, "label");
  const helpOverride = definition && formFieldText(definition, authored, language, "helpText");
  const sourceElement = requireNemsisDataElement(placement.id);
  const pinned = catalogFields?.[placement.id];
  const catalogElement = pinned ? { ...sourceElement,
    name: resolveCatalogElementText(pinned, placement.id, language, "label"),
    definition: resolveCatalogElementText(pinned, placement.id, language, "description") } : sourceElement;
  const element = instance.elements.find(({ id }) => id === placement.id);
  const validationFindings = elementValidationFindings(findings, placement.groupId, instance.instanceId, placement.id);
  const validationSeverity = stationaryFindingSeverity(validationFindings);
  const withValidation = (control: React.ReactNode) => <div className={`stationary-dialog-field${validationSeverity ? ` stationary-validation-state ${validationSeverity}` : ""}`} data-element-id={placement.id}>
    {control}<StationaryValidationMessages findings={validationFindings} />
  </div>;
  if (catalogElement.valueSource.kind !== "scalar") {
    const field = configuredStationaryCodedField(catalogElement, catalogFields[placement.id]);
    const translated = pinned && language === "sv";
    const presentation = { ...field, label: labelOverride ?? (translated ? catalogElement.name : placement.label ?? field.label),
      help: helpOverride ?? (translated ? catalogElement.definition : placement.help ?? field.help) };
    const values = element?.values ?? [];
    const repeatable = catalogElement.occurrence.max === "unbounded" || catalogElement.occurrence.max > 1;
    if (repeatable) return withValidation(<StationaryCodedOccurrencesField field={presentation} values={values} onChange={(value, selection) => onDocumentChange(editStationaryCodedValue(document, {
      groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id,
      ...(value ? { occurrenceId: value.occurrenceId } : {}),
      codedField: presentation,
    }, selection))} />);
    return withValidation(<div className="stationary-group-coded-occurrences" data-element-id={placement.id}>
      {[values[0]].filter((value): value is EncounterValue => Boolean(value)).map((value) => (
        <StationaryCodedValueField key={value.occurrenceId} field={presentation} value={value}
          onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
            groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id, occurrenceId: value.occurrenceId,
            codedField: presentation,
          }, selection))} />
      ))}
      {!values.length && <StationaryCodedValueField field={presentation}
        onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
          groupId: placement.groupId, instanceId: instance.instanceId, elementId: placement.id,
          codedField: presentation,
        }, selection))} />}
    </div>);
  }
  const translated = pinned && language === "sv";
  const presentation = scalarControlPresentation(catalogElement,
    labelOverride ?? (translated ? catalogElement.name : placement.label ?? catalogElement.name),
    helpOverride ?? (translated ? catalogElement.definition : placement.help ?? catalogElement.definition));
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
    onBlur={commit} />
    {placement.id === "eVitals.16" && <label className="stationary-etco2-type">ETCO₂ measurement type
      <select value={String(value?.attributes?.ETCO2Type ?? "")} disabled={!value} onChange={(event) => {
        if (!value) return;
        const attributes = { ...withoutDemoProvenance(value.attributes) };
        if (event.target.value) attributes.ETCO2Type = event.target.value;
        else delete attributes.ETCO2Type;
        const result = editScalarOccurrence(document, { groupId: placement.groupId, groupInstanceId: instance.instanceId,
          elementId: placement.id, occurrenceId: value.occurrenceId, input: value.lexical ?? String(value.value), attributes });
        if (result.ok) onDocumentChange(result.document);
        else setFindings(result.findings);
      }}>
        <option value="">Select type</option>
        <option value="3340001">mmHg</option>
        <option value="3340003">Percentage</option>
        <option value="3340005">kPa</option>
      </select>
    </label>}
  </div>;
}

function RepeatingGroupDialog({ placement, draft, instanceId, isNew, returnFocus, clinicalForm, onDraftChange, onCancel, onSave }: {
  readonly placement: CompiledStationaryGroup;
  readonly draft: EncounterDocument;
  readonly instanceId: string;
  readonly isNew: boolean;
  readonly returnFocus?: HTMLElement | null;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly onDraftChange: (document: EncounterDocument) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);
  const [focusTarget] = useState(returnFocus);
  const { language } = useContext(FormPresentationContext);
  const t = (key: string, parameters: Record<string, string | number> = {}) => resolveMessage(language, key, parameters);
  const cancelDialog = useEffectEvent(onCancel);
  const instance = repeatingGroupInstances(draft, placement.id).find((candidate) => candidate.instanceId === instanceId);
  const liveFindings = useMemo(() => stationaryDialogFindings(draft, clinicalForm), [clinicalForm, draft]);
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
        <div><p className="eyebrow">{t(isNew ? "stationary.newRow" : editable ? "stationary.editRow" : "stationary.viewRow")}</p><h2 id={titleId}>{t(isNew ? "stationary.addNamed" : editable ? "stationary.editNamed" : "stationary.viewNamed", { label: actionLabel })}</h2></div>
        <button className="stationary-dialog-close" type="button" aria-label={t("stationary.closeDialog")} title={t("stationary.close")} onClick={onCancel}>×</button>
      </div>
      <div className="stationary-group-dialog-fields">
        {placement.elements.map((element, index) => editable
          ? <GroupField key={element.id} document={draft} instance={instance} placement={element} findings={validationFindings} initialFocus={index === 0} catalogFields={clinicalForm?.catalogFields} onDocumentChange={onDraftChange} />
          : <div key={element.id}><strong>{element.label ?? requireNemsisDataElement(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : t("stationary.exceptionalValue")).join(", ") || t("stationary.notRecorded")}</p></div>)}
        {!placement.elements.length && <p>{t("stationary.noDirectFields")}</p>}
      </div>
      <NestedGroupContents document={draft} placement={placement} parentInstanceId={instance.instanceId} findings={liveFindings} clinicalForm={clinicalForm} onDocumentChange={onDraftChange} />
      {editable && <div className="note-dialog-actions">
        <button type="button" onClick={onCancel}>{t("stationary.cancel")}</button>
        <button type="button" onClick={onSave}>{t(isNew ? "stationary.addRow" : "stationary.saveChanges")}</button>
      </div>}
      <StationaryValidationMessages findings={groupOnlyFindings} />
    </section>
  </div>;
}

function NestedSingleGroup({ document, placement, parentInstanceId, findings, clinicalForm, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly findings: ReadonlyArray<StationarySectionFinding>;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalog = requireNemsisDataElement;
  const { language } = useContext(FormPresentationContext);
  const t = (key: string, parameters: Record<string, string | number> = {}) => resolveMessage(language, key, parameters);
  const label = stationaryDisplayLabel(placement.presentation.label ?? placement.id);
  const instance = document.groups.find(({ id }) => id === placement.id)?.instances.find((candidate) => candidate.parentInstanceId === parentInstanceId);
  const editable = placement.mode !== "read-only";
  const validationFindings = groupValidationFindings(findings, placement.id, instance?.instanceId);
  if (!instance) return <div className="stationary-nested-single stationary-nested-single-empty" aria-label={t("stationary.fields", { label })} data-group-id={placement.id} data-parent-instance-id={parentInstanceId}>
    {editable && <button type="button" onClick={() => {
      const result = ensureNestedSingleGroupOccurrence(document, placement.id, parentInstanceId);
      if (result.ok) onDocumentChange(result.document);
    }}>{t("stationary.addFields", { label })}</button>}
    <StationaryValidationMessages findings={validationFindings} />
  </div>;
  return <div className="stationary-nested-single" aria-label={t("stationary.fields", { label })} data-group-id={placement.id} data-group-instance-id={instance.instanceId} data-parent-instance-id={parentInstanceId}>
    <div className="stationary-group-dialog-fields">
      {placement.elements.map((element) => editable
        ? <GroupField key={element.id} document={document} instance={instance} placement={element} findings={validationFindings} catalogFields={clinicalForm?.catalogFields} onDocumentChange={onDocumentChange} />
        : <div key={element.id}><strong>{element.label ?? catalog(element.id).name}</strong><p>{instance.elements.find(({ id }) => id === element.id)?.values.map((value) => value.kind === "scalar" ? String(value.value) : value.kind === "coded" ? value.display ?? value.code : t("stationary.exceptionalValue")).join(", ") || t("stationary.notRecorded")}</p></div>)}
    </div>
    <NestedGroupContents document={document} placement={placement} parentInstanceId={instance.instanceId} findings={findings} clinicalForm={clinicalForm} onDocumentChange={onDocumentChange} />
    <StationaryValidationMessages findings={validationFindings.filter((finding) => !(finding.target.fieldId ?? finding.target.elementId))} />
  </div>;
}

function NestedGroupContents({ document, placement, parentInstanceId, findings, clinicalForm, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId: string;
  readonly findings: ReadonlyArray<StationarySectionFinding>;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  if (!placement.children.length) return null;
  return <div className="stationary-nested-groups">
    {placement.children.map((child) => child.presentation.kind === "table"
      ? <RepeatingGroupTable key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} findings={findings} clinicalForm={clinicalForm} onDocumentChange={onDocumentChange} />
      : <NestedSingleGroup key={child.id} document={document} placement={child} parentInstanceId={parentInstanceId} findings={findings} clinicalForm={clinicalForm} onDocumentChange={onDocumentChange} />)}
  </div>;
}

export function RepeatingGroupTable({ document, placement, parentInstanceId, findings = [], clinicalForm, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly placement: CompiledStationaryGroup;
  readonly parentInstanceId?: string;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const headingId = useId();
  const { language } = useContext(FormPresentationContext);
  const t = (key: string, parameters: Record<string, string | number> = {}) => resolveMessage(language, key, parameters);
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
  const columnLabel = (elementId: string, fallback?: string) => {
    const authored = formFieldForElement(clinicalForm?.definition, elementId);
    const formLabel = clinicalForm?.definition && formFieldText(clinicalForm.definition, authored, language, "label");
    const pinned = clinicalForm?.catalogFields?.[elementId];
    return formLabel ?? (pinned ? resolveCatalogElementText(pinned, elementId, language, "label") : fallback ?? requireNemsisDataElement(elementId).name);
  };
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
        {parents.length > 1 && <label>{t("stationary.parentRow")}<select aria-label={t("stationary.parentFor", { label })} value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}>{parents.map((parent, index) => <option key={parent.instanceId} value={parent.instanceId}>{t("stationary.parentNumber", { number: index + 1 })}</option>)}</select></label>}
        <button type="button" data-dialog-return-focus={`${placement.id}:${parentInstanceId ?? "record"}:add`} onClick={openAdd}>{t("stationary.addNamed", { label: actionLabel })}</button>
      </div>}
    </div>
    <div className="stationary-table-scroll" tabIndex={0} role="region" aria-label={t("stationary.table", { label })}>
      <table><thead><tr>{(placement.presentation.columns ?? []).map((column) => <th key={column.elementId}>{columnLabel(column.elementId, column.label)}</th>)}<th>{t("stationary.actions")}</th></tr></thead>
        <tbody>{instances.map((instance) => {
          const rowSeverity = stationaryFindingSeverity(groupValidationFindings(validationFindings, placement.id, instance.instanceId));
          return <tr key={instance.instanceId} data-group-instance-id={instance.instanceId}
            className={rowSeverity ? `stationary-validation-state ${rowSeverity}` : undefined}>
            {repeatingGroupSummary(document, placement, instance).map((cell) => <td key={cell.elementId} data-element-id={cell.elementId}>{cell.values.length ? cell.values.map((value) => <span key={value.occurrenceId} data-occurrence-id={value.occurrenceId}>{value.text}</span>) : <span>{t("stationary.notRecorded")}</span>}</td>)}
            <td className="stationary-table-actions"><div className="stationary-row-actions"><button className="stationary-icon-action edit" type="button" aria-label={t(editable ? "stationary.editNamedRow" : "stationary.viewNamedRow", { label: actionLabel })} title={t(editable ? "stationary.edit" : "stationary.view")} data-dialog-return-focus={`${placement.id}:${instance.instanceId}:edit`} onClick={(event) => setDialogState({ draft: document, instanceId: instance.instanceId, isNew: false, returnFocus: event.currentTarget })}><span aria-hidden="true">{editable ? "✎" : t("stationary.view")}</span></button>
              {editable && <button className="stationary-icon-action remove" type="button" aria-label={t("stationary.removeNamedRow", { label: actionLabel })} title={t("stationary.remove")} onClick={() => { const result = removeRepeatingGroupOccurrence(document, placement.id, instance.instanceId); if (result.ok) { setFinding(undefined); onDocumentChange(result.document); } else setFinding(result.findings[0]); }}><span aria-hidden="true">×</span></button>}</div></td>
          </tr>;
        })}</tbody></table>
    </div>
    {!instances.length && <p className="stationary-empty-table">{t("stationary.noRows")}</p>}
    <StationaryValidationMessages findings={validationFindings} />
    {dialogState && <RepeatingGroupDialog key={`${dialogState.instanceId}:${dialogState.isNew}`} placement={placement} draft={dialogState.draft} instanceId={dialogState.instanceId} isNew={dialogState.isNew} returnFocus={dialogState.returnFocus} clinicalForm={clinicalForm}
      onDraftChange={(draft) => setDialogState((current) => current ? { ...current, draft } : current)} onCancel={() => setDialogState(undefined)}
      onSave={() => { onDocumentChange(dialogState.draft); setDialogState(undefined); }} />}
  </section>;
}

/** Renders every catalogue-configured repeating group through canonical instance identities. */
export function StationaryRepeatingGroups({ document, groups: configuredGroups, findings = [], clinicalForm, language = "en", onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groups?: ReadonlyArray<CompiledStationaryGroup>;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly language?: FormLanguage;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const defaultGroups = useMemo(() => configuredRepeatingGroupRoots(), []);
  const groups = configuredGroups ?? defaultGroups;
  return <FormPresentationContext.Provider value={{ definition: clinicalForm?.definition, language }}><div className="stationary-repeating-groups">{groups.map((group) => <RepeatingGroupTable key={group.id} document={document} placement={group} findings={findings} clinicalForm={clinicalForm} onDocumentChange={onDocumentChange} />)}</div></FormPresentationContext.Provider>;
}
