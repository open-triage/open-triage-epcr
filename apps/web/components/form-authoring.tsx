"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { ClinicalFormConfiguration, FormCatalogElement, FormDraftDefinition, FormDraftField } from "@open-triage/contracts";
import React, { useId, useRef, useState } from "react";
import { SortableList } from "./sortable-list";
import { activateListRow } from "./list-row-action";
import { getNemsisDataElement, getNemsisGroup } from "../app/nemsis-data-model";
import { stationaryDisplayLabel } from "../app/stationary-label";
import { formChoiceLabel } from "../app/form-choice-label";
import { resolveCatalogGroupText } from "../app/catalog-localization";

export function formSectionLabel(section: FormDraftDefinition["sections"][number],
  catalogGroups?: ClinicalFormConfiguration["catalogGroups"], language = "en"): string {
  if (section.name) return section.name;
  const sourceName = getNemsisGroup(section.key)?.name;
  const catalogName = resolveCatalogGroupText(catalogGroups, section.key, language, sourceName ?? section.key);
  if (catalogName) return stationaryDisplayLabel(catalogName);
  const words = section.key.replace(/^e(?=[A-Z])/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldIdentity(field: FormDraftField): string {
  return field.source.kind === "nemsis" ? `nemsis:${field.source.elementId}` : `custom:${field.source.elementDefinitionId}`;
}

type Choice = NonNullable<FormDraftField["choicePolicy"]>[number];

function availableChoices(field: FormDraftField, catalogFields?: ClinicalFormConfiguration["catalogFields"],
  customFields?: ClinicalFormConfiguration["customFields"]): Choice[] {
  const catalog = field.source.kind === "nemsis" ? catalogFields?.[field.source.elementId] : undefined;
  const custom = field.source.kind === "custom" ? customFields?.[field.source.elementDefinitionId] : undefined;
  return [
    ...(custom?.datatype === "coded" ? [
      ...custom.choices.map(({ code }) => ({ kind: "code" as const, code, codeSystem: custom.codeSystem })),
      ...custom.permittedNotValues.filter((code) => field.allowedAbsenceStates?.includes(code))
        .map((code) => ({ kind: "not-value" as const, code })),
    ] : []),
    ...(catalog?.codeChoices ?? []).map(({ code, codeSystem }) => ({ kind: "code" as const, code, codeSystem })),
    ...(catalog?.exceptionalChoices ?? []).filter((choice) => choice.key.startsWith("not-value:"))
      .map((choice) => ({ kind: "not-value" as const, code: choice.key.slice("not-value:".length) })),
  ];
}

function choiceIdentity(choice: Choice): string {
  return `${choice.kind}:${choice.kind === "code" ? choice.codeSystem : ""}:${choice.code}`;
}

export function updateFieldChoices(definition: FormDraftDefinition, fieldKey: string, choices: Choice[]): FormDraftDefinition {
  return { ...definition, sections: definition.sections.map((section) => ({ ...section,
    fields: section.fields.map((field) => field.key === fieldKey ? { ...field, choicePolicy: choices } : field) })) };
}

export function updateFieldRequired(definition: FormDraftDefinition, fieldKey: string, required: boolean): FormDraftDefinition {
  return { ...definition, sections: definition.sections.map((section) => ({ ...section,
    fields: section.fields.map((field) => field.key === fieldKey ? { ...field, required } : field) })) };
}

export function hasFormElement(definition: FormDraftDefinition, elementId: string): boolean {
  return definition.sections.some((section) => section.fields.some((field) =>
    field.source.kind === "nemsis" && field.source.elementId === elementId));
}

export function addFormElement(definition: FormDraftDefinition, sectionKey: string,
  element: FormCatalogElement): FormDraftDefinition {
  const identity = element.customElementDefinitionId ? `custom:${element.customElementDefinitionId}` : `nemsis:${element.elementId}`;
  if (definition.sections.some((section) => section.fields.some((field) => fieldIdentity(field) === identity)))
    throw new Error(`${element.elementId} is already in the form.`);
  if (!definition.sections.some((section) => section.key === sectionKey)) throw new Error("Choose a section for the element.");
  const usedKeys = new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key)));
  let key = element.elementId;
  for (let suffix = 2; usedKeys.has(key); suffix += 1) key = `${element.elementId}-${suffix}`;
  return { ...definition, sections: definition.sections.map((section) => section.key === sectionKey
    ? { ...section, fields: [...section.fields, { key, source: element.customElementDefinitionId
      ? { kind: "custom" as const, elementDefinitionId: element.customElementDefinitionId,
        ...(element.customGroupDefinitionId ? { groupDefinitionId: element.customGroupDefinitionId } : {}) }
      : { kind: "nemsis" as const, elementId: element.elementId } }] }
    : section) };
}

/** Section identity is independent of its editable visual name. */
export function createFormSection(definition: FormDraftDefinition, name: string, key = `section-${crypto.randomUUID()}`): FormDraftDefinition {
  if (!name.trim() || name.trim().length > 120) throw new Error("Enter a section name of 1–120 characters.");
  if (definition.sections.some((section) => section.key === key)) throw new Error("Section identity already exists.");
  return { ...definition, sections: [...definition.sections, { key, name: name.trim(), fields: [] }] };
}

export function renameFormSection(definition: FormDraftDefinition, key: string, name: string): FormDraftDefinition {
  return { ...definition, sections: definition.sections.map((section) => section.key === key ? { ...section, name } : section) };
}

/** Move the complete field, including its source and rule identity, without rebinding it. */
export function transferFormElement(definition: FormDraftDefinition, sourceKey: string, fieldKey: string, targetKey: string): FormDraftDefinition {
  const source = definition.sections.find(({ key }) => key === sourceKey);
  const field = source?.fields.find(({ key }) => key === fieldKey);
  if (!field || !definition.sections.some(({ key }) => key === targetKey)) throw new Error("Choose an existing field and destination section.");
  if (sourceKey === targetKey) return definition;
  return { ...definition, sections: definition.sections.map((section) => section.key === sourceKey
    ? { ...section, fields: section.fields.filter(({ key }) => key !== fieldKey) }
    : section.key === targetKey ? { ...section, fields: [...section.fields, field] } : section) };
}

export function removeFormElement(definition: FormDraftDefinition, sectionKey: string, fieldKey: string): FormDraftDefinition {
  return { ...definition, sections: definition.sections.map((section) => section.key === sectionKey
    ? { ...section, fields: section.fields.filter((field) => field.key !== fieldKey) } : section) };
}

export function moveFormElement(definition: FormDraftDefinition, sectionKey: string, from: number, to: number): FormDraftDefinition {
  const section = definition.sections.find((candidate) => candidate.key === sectionKey);
  if (!section || from < 0 || to < 0 || from >= section.fields.length || to >= section.fields.length || from === to) return definition;
  const fields = [...section.fields];
  const [moving] = fields.splice(from, 1);
  fields.splice(to, 0, moving!);
  return { ...definition, sections: definition.sections.map((candidate) => candidate.key === sectionKey
    ? { ...candidate, fields } : candidate) };
}

export function FormElementPicker({ definition, results, query, busy = false, onQueryChange, onAdd }: {
  readonly definition: FormDraftDefinition; readonly results: readonly FormCatalogElement[]; readonly query: string;
  readonly busy?: boolean; readonly onQueryChange: (value: string) => void;
  readonly onAdd: (element: FormCatalogElement) => void;
}) {
  const t = useAdminText();
  const searchId = useId();
  const [resultLimit, setResultLimit] = useState(20);
  const placed = new Set(definition.sections.flatMap((section) => section.fields.map(fieldIdentity)));
  return <fieldset className="form-picker" disabled={busy}>
    <legend><AdminText messageKey="admin.addAnExisting" /></legend>
    <label htmlFor={searchId}><AdminText messageKey="admin.findByIdentifierName" /></label>
    <input id={searchId} type="search" autoFocus value={query} onChange={(event) => {
      setResultLimit(20); onQueryChange(event.target.value);
    }} />
    {!query.trim() && <p><AdminText messageKey="admin.searchTheCatalog" /></p>}
    {query.trim() && <ul className="form-picker-results" aria-label={t("admin.catalogElementSearch")}>
      {results.slice(0, resultLimit).map((element) => {
        const duplicate = placed.has(element.customElementDefinitionId
          ? `custom:${element.customElementDefinitionId}` : `nemsis:${element.elementId}`);
        return <li key={element.elementId}>
          <div><strong>{element.elementId} — {element.name}</strong><small>{element.baseDatatype} · {element.groupPath.join(" / ")}</small></div>
          <button type="button" disabled={duplicate} aria-label={duplicate ? `${element.elementId} is already in the form` : `Add ${element.elementId}`}
            onClick={() => onAdd(element)}>{duplicate ? t("admin.alreadyAdded") : t("admin.add")}</button>
        </li>;
      })}
    </ul>}
    {query.trim() && results.length > resultLimit && <button type="button"
      onClick={() => setResultLimit((limit) => limit + 20)}>{t("admin.showMoreElements", { count: results.length - resultLimit })}</button>}
  </fieldset>;
}

export function FormSectionElements({ definition, catalogFields, customFields, catalogGroups, newChoicesByField, language = "en", busy = false, readOnly = false, onChange, onMoveSection, onRequestRemoveSection, renderElementPicker }: {
  readonly definition: FormDraftDefinition;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
  readonly customFields?: ClinicalFormConfiguration["customFields"];
  readonly catalogGroups?: ClinicalFormConfiguration["catalogGroups"]; readonly language?: string;
  readonly newChoicesByField?: Record<string, NonNullable<FormDraftField["choicePolicy"]>>;
  readonly busy?: boolean;
  readonly readOnly?: boolean;
  readonly onChange: (definition: FormDraftDefinition, announcement: string) => void;
  readonly onMoveSection?: (from: number, to: number) => void;
  readonly onRequestRemoveSection?: (index: number) => void;
  readonly renderElementPicker?: (sectionKey: string) => React.ReactNode;
}) {
  const t = useAdminText();
  const [newSectionName, setNewSectionName] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(definition.sections[0]?.key ?? null);
  const [expandedChoices, setExpandedChoices] = useState<ReadonlySet<string>>(() => new Set());
  const choicesId = useId();
  const [sectionAction, setSectionAction] = useState<{ key: string; kind: "rename" | "add" } | null>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  function closeAction() {
    setSectionAction(null);
    requestAnimationFrame(() => actionTrigger.current?.focus({ preventScroll: true }));
  }
  const selectedKey = definition.sections.some(({ key }) => key === expandedSection)
    ? expandedSection : expandedSection === null ? null : definition.sections[0]?.key ?? null;
  return <div className="form-fields">
    {!readOnly && <fieldset className="form-create-section" disabled={busy}>
      <label htmlFor="new-section-name">{t("admin.newSectionName")}</label>
      <input id="new-section-name" maxLength={120} value={newSectionName} onChange={(event) => setNewSectionName(event.target.value)} />
      <button type="button" disabled={!newSectionName.trim()} onClick={() => {
        const next = createFormSection(definition, newSectionName);
        onChange(next, t("admin.sectionCreated")); setExpandedSection(next.sections.at(-1)!.key); setNewSectionName("");
      }}>{t("admin.createSection")}</button>
    </fieldset>}
    <label htmlFor="form-section-navigation"><AdminText messageKey="admin.goToSection" /></label>
    <select id="form-section-navigation" value={selectedKey ?? ""} onChange={(event) => {
      setExpandedSection(event.target.value || null); setSectionAction(null);
    }}>
      <option value=""><AdminText messageKey="admin.allSectionsCollapsed" /></option>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>
        {formSectionLabel(section, catalogGroups, language)} ({t("admin.countElements", { count: section.fields.length })})</option>)}
    </select>
    <SortableList items={definition.sections} identity={(section) => section.key}
      label={(section) => section.key} language={language} disabled={busy || readOnly || !onMoveSection}
      onMove={(from, to) => onMoveSection?.(from, to)} renderItem={(section, sectionIndex, sectionHandle) => {
      const open = selectedKey === section.key;
      const renaming = !readOnly && sectionAction?.key === section.key && sectionAction.kind === "rename";
      const adding = !readOnly && open && sectionAction?.key === section.key && sectionAction.kind === "add";
      return <section className="form-section" key={section.key}>
      <header className="form-section-header" onClick={activateListRow}>
        {renaming ? <label className="form-section-name">{t("admin.sectionName")}
          <input autoFocus disabled={busy} maxLength={120} value={section.name ?? formSectionLabel(section, catalogGroups, language)}
            onChange={(event) => onChange(renameFormSection(definition, section.key, event.target.value), t("admin.sectionRenamed"))}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); closeAction(); } }} />
        </label> : <div className="form-section-heading">
          {formSectionLabel(section, catalogGroups, language)} <small>{section.key}</small> <span>{t("admin.countElements", { count: section.fields.length })}</span>
        </div>}
        <button type="button" className="form-section-toggle" data-list-row-action aria-expanded={open}
          onClick={() => { setExpandedSection(open ? null : section.key); setSectionAction(null); }}>
          {t(open ? "list.collapse" : "list.expand")}
        </button>
        {!readOnly && <div className="form-section-actions" role="group" aria-label={`Actions for ${section.key}`}>
          <button type="button" disabled={busy} onClick={(event) => {
            if (renaming) { closeAction(); return; }
            actionTrigger.current = event.currentTarget; setSectionAction({ key: section.key, kind: "rename" });
          }}>{t(renaming ? "admin.doneEditingGroup" : "admin.renameGroup")}</button>
          {renderElementPicker && <button type="button" className={adding ? "button-primary" : undefined} disabled={busy} aria-expanded={adding} onClick={(event) => {
            if (adding) { closeAction(); return; }
            actionTrigger.current = event.currentTarget; setExpandedSection(section.key); setSectionAction({ key: section.key, kind: "add" });
          }}>{t("admin.addElements")}</button>}
          {onMoveSection && sectionHandle}
          {onRequestRemoveSection && <button className="button-danger" type="button" disabled={busy || definition.sections.length === 1} aria-label={`Remove ${section.key}`}
            onClick={() => onRequestRemoveSection(sectionIndex)}><AdminText messageKey="admin.removeSection" /></button>}
        </div>}
      </header>
      {adding && <div className="form-section-picker" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAction(); }
      }}>{renderElementPicker?.(section.key)}</div>}
      {open && <div className={`form-element-group${readOnly ? " is-read-only" : ""}`}>
      {!readOnly && <div className="form-element-columns" aria-hidden="true">
        <span>{t("admin.element")}</span><span>{t("admin.formChoices")}</span>
        <span>{t("admin.moveToSection")}</span><span>{t("admin.formActions")}</span>
      </div>}
      <SortableList ordered className={`form-element-list${readOnly ? " is-read-only" : ""}`} items={section.fields} identity={(field) => field.key}
        label={(field) => field.source.kind === "nemsis" ? field.source.elementId : field.key}
        language={language} disabled={busy || readOnly} ariaLabel={`${section.key} form elements`}
        onItemClick={readOnly ? undefined : (_field, event) => {
          if ((event.target as HTMLElement).closest(".form-choice-lists")) return;
          activateListRow(event);
        }}
        onMove={(from, to) => onChange(moveFormElement(definition, section.key, from, to), t("admin.fieldMoved"))}
        renderItem={(field, _index, fieldHandle) => {
          const label = field.source.kind === "nemsis" ? field.source.elementId : field.key;
          const clinicalLabel = field.source.kind === "nemsis" ? getNemsisDataElement(field.source.elementId)?.name : t("admin.customElement");
          const available = availableChoices(field, catalogFields, customFields);
          const selected = field.choicePolicy ?? available;
          const availableIds = new Set(available.map(choiceIdentity));
          const newIds = new Set((newChoicesByField?.[field.key] ?? []).map(choiceIdentity));
          const selectedIds = new Set(selected.map(choiceIdentity));
          const selectedPositions = new Map(selected.map((choice, index) => [choiceIdentity(choice), index]));
          const reviewChoices = [...selected, ...available.filter((choice) => !selectedIds.has(choiceIdentity(choice)))];
          const choicesOpen = expandedChoices.has(field.key);
          const choicesPanelId = `${choicesId}-${field.key}`;
          return <>
            <span className="form-element-identity"><strong>{label}</strong><small>{clinicalLabel ?? t("admin.unknownCatalogElement")}</small></span>
            {!readOnly && <>
              <div className="form-element-choices" data-label={t("admin.formChoices")}>
              {reviewChoices.length > 0 && <button type="button" className={`form-choices-toggle${choicesOpen ? " button-primary" : ""}`}
                data-list-row-action aria-expanded={choicesOpen} aria-controls={choicesPanelId}
                onClick={() => setExpandedChoices((previous) => {
                  const next = new Set(previous);
                  if (next.has(field.key)) next.delete(field.key); else next.add(field.key);
                  return next;
                })}>{choicesOpen ? language === "sv" ? "Stäng val och ordning" : "Close choices and order"
                  : language === "sv" ? "Redigera val och ordning" : "Edit choices and order"}
                {newIds.size > 0 && ` · ${newIds.size} ${language === "sv" ? "nya val" : "new choices"}`}</button>}
              {field.source.kind === "custom" && customFields?.[field.source.elementDefinitionId]?.datatype === "coded" &&
                <details><summary>Permitted exceptional values</summary>
                  {(() => {
                    const custom = customFields[field.source.elementDefinitionId];
                    if (custom?.datatype !== "coded") return null;
                    return [...custom.permittedNotValues.map((code) => ({ code, kind: "NOT" })),
                      ...custom.permittedPertinentNegatives.map((code) => ({ code, kind: "PN" }))].map(({ code, kind }) =>
                      <label key={`${kind}:${code}`}><input type="checkbox" disabled={busy} checked={field.allowedAbsenceStates?.includes(code) ?? false}
                        onChange={(event) => onChange({ ...definition, sections: definition.sections.map((section) => ({ ...section,
                          fields: section.fields.map((candidate) => candidate.key !== field.key ? candidate : {
                            ...candidate, allowedAbsenceStates: event.target.checked
                              ? [...(candidate.allowedAbsenceStates ?? []), code]
                              : (candidate.allowedAbsenceStates ?? []).filter((value) => value !== code),
                          }) })) }, `Updated exceptional values for ${label}.`)} />{formChoiceLabel({ kind: kind === "NOT" ? "not-value" : "pertinent-negative", code }, field, catalogFields, customFields, language)}
                        {kind === "NOT" && newIds.has(`not-value::${code}`) && <small>{language === "sv"
                          ? "Ny i målkatalogen" : "New in target catalog"}</small>}</label>);
                  })()}
                </details>}
              {reviewChoices.length === 0 && <span aria-label={t("admin.formNoChoices")}>—</span>}
              </div>
              {reviewChoices.length > 0 && <div className="form-choice-lists" id={choicesPanelId} hidden={!choicesOpen}>
                  {choicesOpen && (["code", "not-value"] as const).map((kind) => {
                    const choices = reviewChoices.filter((choice) => choice.kind === kind);
                    if (choices.length === 0) return null;
                    return <div className="form-choice-list" key={kind}>
                      <strong>{kind === "code" ? language === "sv" ? "Ordinarie värden" : "Ordinary values"
                        : language === "sv" ? "NOT-värden" : "NOT values"}</strong>
                      <SortableList ordered items={choices} identity={choiceIdentity}
                        label={(choice) => `${formChoiceLabel(choice, field, catalogFields, customFields, language)} choice`}
                        language={language} disabled={busy} canDrag={(choice) => selectedIds.has(choiceIdentity(choice))}
                        ariaLabel={kind === "code" ? `Choices for ${label}` : `NOT values for ${label}`} onMove={(from, to) => {
                          const reordered = selected.filter((choice) => choice.kind === kind);
                          const [moving] = reordered.splice(from, 1); reordered.splice(to, 0, moving!);
                          let index = 0;
                          const next = selected.map((choice) => choice.kind === kind ? reordered[index++]! : choice);
                          onChange(updateFieldChoices(definition, field.key, next), `Reordered choices for ${label}.`);
                        }} renderItem={(choice, _index, choiceHandle) => {
                          const identity = choiceIdentity(choice);
                          const position = selectedPositions.get(identity) ?? -1;
                          const unavailable = !availableIds.has(identity);
                          const choiceLabel = formChoiceLabel(choice, field, catalogFields, customFields, language);
                          return <><label><input type="checkbox" checked={position >= 0} disabled={busy || unavailable && position < 0}
                            onChange={(event) => onChange(updateFieldChoices(definition, field.key,
                              event.target.checked ? [...selected, choice] : selected.filter((candidate) => choiceIdentity(candidate) !== identity)),
                            `Updated choices for ${label}.`)} />{choiceLabel}</label>
                            {newIds.has(identity) && <small>{position >= 0
                              ? language === "sv" ? "Ny i målkatalogen · aktiverad" : "New in target catalog · enabled"
                              : language === "sv" ? "Ny i målkatalogen · avstängd tills du väljer den" : "New in target catalog · disabled until selected"}</small>}
                            {unavailable && <small role="alert">{language === "sv" ? "Inte tillgänglig i målkatalogen; avmarkera för att lösa" : "Unavailable in target catalog; uncheck to resolve"}</small>}
                            {choiceHandle}
                          </>;
                        }} />
                    </div>;
                  })}
              </div>}
              <label className="form-element-destination"><span className="sr-only">{t("admin.moveToSection")}</span>
                <select aria-label={`${t("admin.moveToSection")} ${label}`} disabled={busy} value={section.key}
                  onChange={(event) => onChange(transferFormElement(definition, section.key, field.key, event.target.value), t("admin.fieldMoved"))}>
                  {definition.sections.map((target) => <option key={target.key} value={target.key}>{formSectionLabel(target, catalogGroups, language)}</option>)}
                </select>
              </label>
              <div className="form-field-actions" aria-label={`Actions for ${label}`}>
              {fieldHandle}
              <button className="button-danger" type="button" disabled={busy} aria-label={`Remove ${label}`} onClick={() => {
                if (window.confirm(`Remove ${label} from ${section.key}?`))
                  onChange(removeFormElement(definition, section.key, field.key), `Removed ${label}.`);
              }}><AdminText messageKey="admin.remove" /></button>
              </div>
            </>}
          </>;
        }} />
      </div>}
    </section>; }} />
  </div>;
}
