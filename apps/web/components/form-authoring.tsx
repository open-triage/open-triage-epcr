"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { FormCatalogElement, FormDraftDefinition, FormDraftField } from "@open-triage/contracts";
import React, { useState } from "react";
import { getNemsisDataElement } from "../app/nemsis-data-model";
import { pruneFormTranslations } from "../app/form-localization";
import { formTranslationIssues } from "../app/translation-diagnostics";
import { TranslationIssueSummary } from "./translation-issue-summary";

export function formSectionLabel(section: FormDraftDefinition["sections"][number]): string {
  const title = section.presentation?.title;
  if (typeof title === "string" && title.trim()) return title;
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
  return pruneFormTranslations({ ...definition, sections: definition.sections.map((section) => section.key === sectionKey
    ? { ...section, fields: section.fields.filter((field) => field.key !== fieldKey) } : section) });
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

export function FormElementPicker({ definition, results, query, targetSection, onQueryChange, onSectionChange, onAdd }: {
  readonly definition: FormDraftDefinition; readonly results: readonly FormCatalogElement[]; readonly query: string;
  readonly targetSection: string; readonly onQueryChange: (value: string) => void;
  readonly onSectionChange: (value: string) => void; readonly onAdd: (element: FormCatalogElement) => void;
}) {
  const t = useAdminText();
  const [resultLimit, setResultLimit] = useState(20);
  const placed = new Set(definition.sections.flatMap((section) => section.fields.map(fieldIdentity)));
  return <fieldset className="form-picker">
    <legend><AdminText english="Add an existing catalog element" /></legend>
    <label htmlFor="form-target-section"><AdminText english="Section" /></label>
    <select id="form-target-section" value={targetSection || definition.sections[0]?.key || ""}
      onChange={(event) => onSectionChange(event.target.value)}>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>{formSectionLabel(section)}</option>)}
    </select>
    <label htmlFor="form-element-search"><AdminText english="Find by identifier, name, or description" /></label>
    <input id="form-element-search" type="search" value={query} onChange={(event) => {
      setResultLimit(20); onQueryChange(event.target.value);
    }} />
    {!query.trim() && <p><AdminText english="Search the catalog to add an element." /></p>}
    {query.trim() && <ul className="form-picker-results" aria-label={t("Catalog element search results")}>
      {results.slice(0, resultLimit).map((element) => {
        const duplicate = placed.has(`nemsis:${element.elementId}`);
        return <li key={element.elementId}>
          <div><strong>{element.elementId} — {element.name}</strong><small>{element.baseDatatype} · {element.groupPath.join(" / ")}</small></div>
          <button type="button" disabled={duplicate} aria-label={duplicate ? `${element.elementId} is already in the form` : `Add ${element.elementId}`}
            onClick={() => onAdd(element)}>{duplicate ? t("Already added") : t("Add")}</button>
        </li>;
      })}
    </ul>}
    {query.trim() && results.length > resultLimit && <button type="button"
      onClick={() => setResultLimit((limit) => limit + 20)}>{t("Show more elements ({count} remaining)", { count: results.length - resultLimit })}</button>}
  </fieldset>;
}

export function FormSectionElements({ definition, busy = false, readOnly = false, onChange, onMoveSection, onRequestRemoveSection }: {
  readonly definition: FormDraftDefinition;
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
    <label htmlFor="form-section-navigation"><AdminText english="Go to section" /></label>
    <select id="form-section-navigation" value={selectedKey ?? ""} onChange={(event) => setExpandedSection(event.target.value || null)}>
      <option value=""><AdminText english="All sections collapsed" /></option>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>
        {formSectionLabel(section)} ({t("{count} elements", { count: section.fields.length })})</option>)}
    </select>
    {definition.sections.map((section, sectionIndex) => {
      const open = selectedKey === section.key;
      return <section className="form-section" key={section.key}>
      <header className="form-section-header">
        <button type="button" className="form-section-toggle" aria-expanded={open}
          onClick={() => setExpandedSection(open ? null : section.key)}>
          {formSectionLabel(section)} <small>{section.key}</small> <span>{t("{count} elements", { count: section.fields.length })}</span>
        </button>
        {onMoveSection && onRequestRemoveSection && <div className="form-section-actions" aria-label={`Actions for ${section.key}`}>
          <button type="button" disabled={busy || sectionIndex === 0} aria-label={`Move ${section.key} up`}
            onClick={() => onMoveSection(sectionIndex, sectionIndex - 1)}><AdminText english="Move up" /></button>
          <button type="button" disabled={busy || sectionIndex === definition.sections.length - 1} aria-label={`Move ${section.key} down`}
            onClick={() => onMoveSection(sectionIndex, sectionIndex + 1)}><AdminText english="Move down" /></button>
          <button type="button" disabled={busy || definition.sections.length === 1} aria-label={`Remove ${section.key}`}
            onClick={() => onRequestRemoveSection(sectionIndex)}><AdminText english="Remove section" /></button>
        </div>}
      </header>
      {open && <ol aria-label={`${section.key} form elements`}>
        {section.fields.map((field, index) => {
          const label = field.source.kind === "nemsis" ? field.source.elementId : field.key;
          const clinicalLabel = field.source.kind === "nemsis" ? getNemsisDataElement(field.source.elementId)?.name : t("Custom element");
          return <li key={field.key}>
            <span><strong>{label}</strong><small>{clinicalLabel ?? t("Unknown catalog element")}</small></span>
            {!readOnly && <div className="form-field-actions" aria-label={`Actions for ${label}`}>
              <button type="button" disabled={busy || index === 0} aria-label={`Move ${label} up`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index - 1), `Moved ${label} up.`)}><AdminText english="Move up" /></button>
              <button type="button" disabled={busy || index === section.fields.length - 1} aria-label={`Move ${label} down`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index + 1), `Moved ${label} down.`)}><AdminText english="Move down" /></button>
              <button type="button" disabled={busy} aria-label={`Remove ${label}`} onClick={() => {
                if (window.confirm(`Remove ${label} from ${section.key}?`))
                  onChange(removeFormElement(definition, section.key, field.key), `Removed ${label}.`);
              }}><AdminText english="Remove" /></button>
            </div>}
          </li>;
        })}
      </ol>}
    </section>; })}
  </div>;
}

/** Edits source text and Swedish presentation by stable section/field keys. */
export function FormLocalizedEditor({ definition, readOnly, onChange, language: agencyLanguage = "sv" }: {
  readonly language?: "en" | "sv";
  readonly definition: FormDraftDefinition;
  readonly readOnly: boolean;
  readonly onChange: (definition: FormDraftDefinition, announcement: string) => void;
}) {
  const t = useAdminText();
  const [language, setLanguage] = useState<"en" | "sv">("en");
  const [issueFilter, setIssueFilter] = useState("all");
  const issues = formTranslationIssues(definition, agencyLanguage);
  const locale = definition.locales?.find(({ locale }) => locale === "sv");
  function update(scope: "sections" | "fields", key: string, property: "title" | "label" | "helpText", value: string) {
    let next: FormDraftDefinition;
    if (language === "en") {
      next = { ...definition, sections: definition.sections.map((section) => scope === "sections" && section.key === key
        ? { ...section, presentation: { ...section.presentation, title: value } }
        : { ...section, fields: section.fields.map((field) => scope === "fields" && field.key === key
          ? { ...field, configuration: { ...field.configuration, [property]: value } } : field) }) };
      if (locale && value !== (scope === "sections" ? definition.sections.find((item) => item.key === key)?.presentation?.title
        : definition.sections.flatMap((item) => item.fields).find((item) => item.key === key)?.configuration?.[property])) next = { ...next, locales: (next.locales ?? []).map((item) => item.locale === "sv"
        ? { ...item, sourceReview: { ...item.sourceReview, [`${scope}.${key}.${property}`]: false } } : item) };
    } else {
      const translations = locale?.translations ?? {};
      const entries = translations[scope] ?? {};
      const nextEntry: Record<string, string> = { ...entries[key], [property]: value };
      if (!value.trim()) delete nextEntry[property];
      const nextEntries = { ...entries, [key]: nextEntry };
      if (!Object.keys(nextEntry).length) delete nextEntries[key];
      const reviewKey = `${scope}.${key}.${property}`;
      const updated = { locale: "sv" as const, translations: { ...translations, [scope]: nextEntries },
        sourceReview: { ...locale?.sourceReview, [reviewKey]: Boolean(value.trim()) } };
      next = { ...definition, locales: [...(definition.locales ?? []).filter(({ locale }) => locale !== "sv"), updated] };
    }
    onChange(next, `Updated ${language === "en" ? t("English") : t("Swedish")} ${property} for ${key}.`);
  }
  function review(scope: "sections" | "fields", key: string, property: string, checked: boolean) {
    const updated = { locale: "sv" as const, translations: locale?.translations ?? {},
      sourceReview: { ...locale?.sourceReview, [`${scope}.${key}.${property}`]: checked } };
    onChange({ ...definition, locales: [...(definition.locales ?? []).filter(({ locale }) => locale !== "sv"), updated] },
      `Updated source review for ${key}.`);
  }
  function editor(scope: "sections" | "fields", key: string, property: "title" | "label" | "helpText", source: unknown) {
    const translated = scope === "sections" ? locale?.translations.sections?.[key]?.title
      : locale?.translations.fields?.[key]?.[property as "label" | "helpText"];
    const value = language === "en" ? source : translated;
    const id = `form-text-${scope}-${key}-${property}`.replaceAll(/[^A-Za-z0-9_-]/g, "-");
    return <div key={id} className="form-localized-text">
      <label htmlFor={id}>{property === "title" ? "Heading" : property === "label" ? "Label override" : "Help text"}</label>
      <input id={id} disabled={readOnly} maxLength={500} value={typeof value === "string" ? value : ""}
        placeholder={language === "sv" && typeof source === "string" ? source : undefined}
        onChange={(event) => update(scope, key, property, event.target.value)} />
      {issues.filter((issue) => issue.id === key && issue.field === property).map((issue) =>
        <small role="note" key={issue.kind}>{t(issue.message)}</small>)}
      {language === "sv" && typeof source === "string" && source.trim() && <label>
        <input type="checkbox" disabled={readOnly || !translated?.trim()} checked={locale?.sourceReview?.[`${scope}.${key}.${property}`] === true}
          onChange={(event) => review(scope, key, property, event.target.checked)} /><AdminText english="Source reviewed" />
      </label>}
    </div>;
  }
  return <section className="form-localized-editor" aria-label={t("Form wording")}>
    <h3><AdminText english="Form wording" /></h3>
    <TranslationIssueSummary issues={issues} filter={issueFilter} onFilter={setIssueFilter} onNavigate={(issue) => {
      setLanguage(issue.kind === "english" ? "en" : "sv");
      const scope = issue.field === "title" ? "sections" : "fields";
      requestAnimationFrame(() => document.getElementById(`form-text-${scope}-${issue.id}-${issue.field}`.replaceAll(/[^A-Za-z0-9_-]/g, "-"))?.focus());
    }} />
    <label htmlFor="form-wording-language"><AdminText english="Language" /></label>
    <select id="form-wording-language" value={language} onChange={(event) => setLanguage(event.target.value as "en" | "sv")}>
      <option value="en"><AdminText english="English source" /></option><option value="sv"><AdminText english="Swedish translation" /></option>
    </select>
    {definition.sections.map((section) => <fieldset key={section.key}>
      <legend>{section.key}</legend>
      {editor("sections", section.key, "title", section.presentation?.title)}
      {section.fields.map((field) => <div key={field.key} className="form-localized-field">
        <h4>{field.key}</h4>
        {editor("fields", field.key, "label", field.configuration?.label)}
        {editor("fields", field.key, "helpText", field.configuration?.helpText)}
      </div>)}
    </fieldset>)}
  </section>;
}
