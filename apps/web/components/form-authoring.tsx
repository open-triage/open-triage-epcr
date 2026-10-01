"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { ClinicalFormConfiguration, FormCatalogElement, FormDraftDefinition, FormDraftField } from "@open-triage/contracts";
import React, { useState } from "react";
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

export function FormElementPicker({ definition, results, query, targetSection, catalogGroups, language = "en", onQueryChange, onSectionChange, onAdd }: {
  readonly definition: FormDraftDefinition; readonly results: readonly FormCatalogElement[]; readonly query: string;
  readonly catalogGroups?: ClinicalFormConfiguration["catalogGroups"]; readonly language?: string;
  readonly targetSection: string; readonly onQueryChange: (value: string) => void;
  readonly onSectionChange: (value: string) => void; readonly onAdd: (element: FormCatalogElement) => void;
}) {
  const t = useAdminText();
  const [resultLimit, setResultLimit] = useState(20);
  const placed = new Set(definition.sections.flatMap((section) => section.fields.map(fieldIdentity)));
  return <fieldset className="form-picker">
    <legend><AdminText messageKey="admin.addAnExisting" /></legend>
    <label htmlFor="form-target-section"><AdminText messageKey="admin.section" /></label>
    <select id="form-target-section" value={targetSection || definition.sections[0]?.key || ""}
      onChange={(event) => onSectionChange(event.target.value)}>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>{formSectionLabel(section, catalogGroups, language)}</option>)}
    </select>
    <label htmlFor="form-element-search"><AdminText messageKey="admin.findByIdentifierName" /></label>
    <input id="form-element-search" type="search" value={query} onChange={(event) => {
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

export function FormSectionElements({ definition, catalogFields, customFields, catalogGroups, newChoicesByField, language = "en", busy = false, readOnly = false, onChange, onMoveSection, onRequestRemoveSection }: {
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
}) {
  const t = useAdminText();
  const [newSectionName, setNewSectionName] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(definition.sections[0]?.key ?? null);
  const selectedKey = definition.sections.some(({ key }) => key === expandedSection)
    ? expandedSection : expandedSection === null ? null : definition.sections[0]?.key ?? null;
  return <div className="form-fields">
    {!readOnly && <fieldset disabled={busy}>
      <label htmlFor="new-section-name">{t("admin.newSectionName")}</label>
      <input id="new-section-name" maxLength={120} value={newSectionName} onChange={(event) => setNewSectionName(event.target.value)} />
      <button type="button" disabled={!newSectionName.trim()} onClick={() => {
        const next = createFormSection(definition, newSectionName);
        onChange(next, t("admin.sectionCreated")); setExpandedSection(next.sections.at(-1)!.key); setNewSectionName("");
      }}>{t("admin.createSection")}</button>
    </fieldset>}
    <label htmlFor="form-section-navigation"><AdminText messageKey="admin.goToSection" /></label>
    <select id="form-section-navigation" value={selectedKey ?? ""} onChange={(event) => setExpandedSection(event.target.value || null)}>
      <option value=""><AdminText messageKey="admin.allSectionsCollapsed" /></option>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>
        {formSectionLabel(section, catalogGroups, language)} ({t("admin.countElements", { count: section.fields.length })})</option>)}
    </select>
    {definition.sections.map((section, sectionIndex) => {
      const open = selectedKey === section.key;
      return <section className="form-section" key={section.key}>
      <header className="form-section-header">
        <button type="button" className="form-section-toggle" aria-expanded={open}
          onClick={() => setExpandedSection(open ? null : section.key)}>
          {formSectionLabel(section, catalogGroups, language)} <small>{section.key}</small> <span>{t("admin.countElements", { count: section.fields.length })}</span>
        </button>
        {onMoveSection && onRequestRemoveSection && <div className="form-section-actions" aria-label={`Actions for ${section.key}`}>
          <button type="button" disabled={busy || sectionIndex === 0} aria-label={`Move ${section.key} up`}
            onClick={() => onMoveSection(sectionIndex, sectionIndex - 1)}><AdminText messageKey="admin.moveUp" /></button>
          <button type="button" disabled={busy || sectionIndex === definition.sections.length - 1} aria-label={`Move ${section.key} down`}
            onClick={() => onMoveSection(sectionIndex, sectionIndex + 1)}><AdminText messageKey="admin.moveDown" /></button>
          <button type="button" disabled={busy || definition.sections.length === 1} aria-label={`Remove ${section.key}`}
            onClick={() => onRequestRemoveSection(sectionIndex)}><AdminText messageKey="admin.removeSection" /></button>
        </div>}
      </header>
      {open && !readOnly && <label>{t("admin.sectionName")}
        <input aria-label={t("admin.sectionName")} disabled={busy} maxLength={120} value={section.name ?? formSectionLabel(section, catalogGroups, language)}
          onChange={(event) => onChange(renameFormSection(definition, section.key, event.target.value), t("admin.sectionRenamed"))} />
      </label>}
      {open && <ol aria-label={`${section.key} form elements`}>
        {section.fields.map((field, index) => {
          const label = field.source.kind === "nemsis" ? field.source.elementId : field.key;
          const clinicalLabel = field.source.kind === "nemsis" ? getNemsisDataElement(field.source.elementId)?.name : t("admin.customElement");
          const available = availableChoices(field, catalogFields, customFields);
          const selected = field.choicePolicy ?? available;
          const availableIds = new Set(available.map(choiceIdentity));
          const newIds = new Set((newChoicesByField?.[field.key] ?? []).map(choiceIdentity));
          const selectedIds = new Set(selected.map(choiceIdentity));
          const reviewChoices = [...selected, ...available.filter((choice) => !selectedIds.has(choiceIdentity(choice)))];
          const catalog = field.source.kind === "nemsis" ? catalogFields?.[field.source.elementId] : undefined;
          const custom = field.source.kind === "custom" ? customFields?.[field.source.elementDefinitionId] : undefined;
          const catalogRequired = catalog ? catalog.minOccurs > 0 || catalog.agencyRequired ||
            catalog.usage === "Mandatory" || catalog.usage === "Required"
            : custom ? custom.usage === "Mandatory" || custom.usage === "Required" : false;
          return <li key={field.key}>
            <span><strong>{label}</strong><small>{clinicalLabel ?? t("admin.unknownCatalogElement")}</small></span>
            {!readOnly && <div className="form-field-actions" aria-label={`Actions for ${label}`}>
              <label><input type="checkbox" checked={catalogRequired || field.required === true} disabled={busy || catalogRequired}
                onChange={(event) => onChange(updateFieldRequired(definition, field.key, event.target.checked),
                  `Updated completion requirement for ${label}.`)} />{language === "sv" ? "Obligatoriskt i detta formulär" : "Required on this form"}</label>
              {catalogRequired && <small>{language === "sv" ? "Krävs av katalogen" : "Required by the catalog"}</small>}
              {reviewChoices.length > 0 && <details><summary>{language === "sv" ? "Aktiva val och ordning" : "Enabled choices and order"}
                {newIds.size > 0 && ` · ${newIds.size} ${language === "sv" ? "nya val" : "new choices"}`}</summary>
                <ol aria-label={`Choices for ${label}`}>{reviewChoices.map((choice) => {
                  const identity = choiceIdentity(choice);
                  const position = selected.findIndex((candidate) => choiceIdentity(candidate) === identity);
                  const unavailable = !availableIds.has(identity);
                  const choiceLabel = formChoiceLabel(choice, field, catalogFields, customFields, language);
                  return <li key={identity}><label><input type="checkbox" checked={position >= 0} disabled={busy || unavailable && position < 0}
                    onChange={(event) => onChange(updateFieldChoices(definition, field.key,
                      event.target.checked ? [...selected, choice] : selected.filter((candidate) => choiceIdentity(candidate) !== identity)),
                    `Updated choices for ${label}.`)} />{choiceLabel}</label>
                    {newIds.has(identity) && <small>{position >= 0
                      ? language === "sv" ? "Ny i målkatalogen · aktiverad" : "New in target catalog · enabled"
                      : language === "sv" ? "Ny i målkatalogen · avstängd tills du väljer den" : "New in target catalog · disabled until selected"}</small>}
                    {unavailable && <small role="alert">{language === "sv" ? "Inte tillgänglig i målkatalogen; avmarkera för att lösa" : "Unavailable in target catalog; uncheck to resolve"}</small>}
                    {position >= 0 && <><button type="button" disabled={busy || position === 0} aria-label={`Move ${choiceLabel} choice up`}
                      onClick={() => { const next = [...selected]; [next[position - 1], next[position]] = [next[position]!, next[position - 1]!];
                        onChange(updateFieldChoices(definition, field.key, next), `Moved ${choiceLabel} up.`); }}>↑</button>
                    <button type="button" disabled={busy || position === selected.length - 1} aria-label={`Move ${choiceLabel} choice down`}
                      onClick={() => { const next = [...selected]; [next[position], next[position + 1]] = [next[position + 1]!, next[position]!];
                        onChange(updateFieldChoices(definition, field.key, next), `Moved ${choiceLabel} down.`); }}>↓</button></>}
                  </li>;
                })}</ol>
              </details>}
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
              <label>{t("admin.moveToSection")}
                <select aria-label={`${t("admin.moveToSection")} ${label}`} disabled={busy} value={section.key}
                  onChange={(event) => onChange(transferFormElement(definition, section.key, field.key, event.target.value), t("admin.fieldMoved"))}>
                  {definition.sections.map((target) => <option key={target.key} value={target.key}>{formSectionLabel(target, catalogGroups, language)}</option>)}
                </select>
              </label>
              <small>{t("admin.dataBinding")}: {field.source.kind === "nemsis" ? getNemsisDataElement(field.source.elementId)?.groupPath.join(" / ") : field.source.groupDefinitionId ?? field.source.elementDefinitionId}</small>
              <button type="button" disabled={busy || index === 0} aria-label={`Move ${label} up`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index - 1), `Moved ${label} up.`)}><AdminText messageKey="admin.moveUp" /></button>
              <button type="button" disabled={busy || index === section.fields.length - 1} aria-label={`Move ${label} down`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index + 1), `Moved ${label} down.`)}><AdminText messageKey="admin.moveDown" /></button>
              <button type="button" disabled={busy} aria-label={`Remove ${label}`} onClick={() => {
                if (window.confirm(`Remove ${label} from ${section.key}?`))
                  onChange(removeFormElement(definition, section.key, field.key), `Removed ${label}.`);
              }}><AdminText messageKey="admin.remove" /></button>
            </div>}
          </li>;
        })}
      </ol>}
    </section>; })}
  </div>;
}
