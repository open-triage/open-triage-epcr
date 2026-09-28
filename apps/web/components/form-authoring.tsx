"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { ClinicalFormConfiguration, FormCatalogElement, FormDraftDefinition, FormDraftField } from "@open-triage/contracts";
import React, { useState } from "react";
import { getNemsisDataElement, getNemsisGroup } from "../app/nemsis-data-model";
import { stationaryDisplayLabel } from "../app/stationary-label";
import { resolveCatalogGroupText } from "../app/catalog-localization";

export function formSectionLabel(section: FormDraftDefinition["sections"][number],
  catalogGroups?: ClinicalFormConfiguration["catalogGroups"], language = "en"): string {
  const sourceName = getNemsisGroup(section.key)?.name;
  const catalogName = resolveCatalogGroupText(catalogGroups, section.key, language, sourceName ?? section.key);
  if (catalogName) return stationaryDisplayLabel(catalogName);
  const words = section.key.replace(/^e(?=[A-Z])/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldIdentity(field: FormDraftField): string {
  return field.source.kind === "nemsis" ? `nemsis:${field.source.elementId}` : `custom:${field.source.elementDefinitionId}`;
}

export function hasFormElement(definition: FormDraftDefinition, elementId: string): boolean {
  return definition.sections.some((section) => section.fields.some((field) =>
    field.source.kind === "nemsis" && field.source.elementId === elementId));
}

export function addFormElement(definition: FormDraftDefinition, sectionKey: string,
  element: FormCatalogElement): FormDraftDefinition {
  if (hasFormElement(definition, element.elementId)) throw new Error(`${element.elementId} is already in the form.`);
  if (!definition.sections.some((section) => section.key === sectionKey)) throw new Error("Choose a section for the element.");
  const usedKeys = new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key)));
  let key = element.elementId;
  for (let suffix = 2; usedKeys.has(key); suffix += 1) key = `${element.elementId}-${suffix}`;
  return { ...definition, sections: definition.sections.map((section) => section.key === sectionKey
    ? { ...section, fields: [...section.fields, { key, source: { kind: "nemsis", elementId: element.elementId } }] }
    : section) };
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
        const duplicate = placed.has(`nemsis:${element.elementId}`);
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

export function FormSectionElements({ definition, catalogGroups, language = "en", busy = false, readOnly = false, onChange, onMoveSection, onRequestRemoveSection }: {
  readonly definition: FormDraftDefinition;
  readonly catalogGroups?: ClinicalFormConfiguration["catalogGroups"]; readonly language?: string;
  readonly busy?: boolean;
  readonly readOnly?: boolean;
  readonly onChange: (definition: FormDraftDefinition, announcement: string) => void;
  readonly onMoveSection?: (from: number, to: number) => void;
  readonly onRequestRemoveSection?: (index: number) => void;
}) {
  const t = useAdminText();
  const [expandedSection, setExpandedSection] = useState<string | null>(definition.sections[0]?.key ?? null);
  const selectedKey = definition.sections.some(({ key }) => key === expandedSection)
    ? expandedSection : expandedSection === null ? null : definition.sections[0]?.key ?? null;
  return <div className="form-fields">
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
      {open && <ol aria-label={`${section.key} form elements`}>
        {section.fields.map((field, index) => {
          const label = field.source.kind === "nemsis" ? field.source.elementId : field.key;
          const clinicalLabel = field.source.kind === "nemsis" ? getNemsisDataElement(field.source.elementId)?.name : t("admin.customElement");
          return <li key={field.key}>
            <span><strong>{label}</strong><small>{clinicalLabel ?? t("admin.unknownCatalogElement")}</small></span>
            {!readOnly && <div className="form-field-actions" aria-label={`Actions for ${label}`}>
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
