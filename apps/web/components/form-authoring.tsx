"use client";

import type { FormCatalogElement, FormDraftDefinition, FormDraftField } from "@open-triage/contracts";
import React from "react";

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

export function FormElementPicker({ definition, results, query, targetSection, onQueryChange, onSectionChange, onAdd }: {
  readonly definition: FormDraftDefinition; readonly results: readonly FormCatalogElement[]; readonly query: string;
  readonly targetSection: string; readonly onQueryChange: (value: string) => void;
  readonly onSectionChange: (value: string) => void; readonly onAdd: (element: FormCatalogElement) => void;
}) {
  const placed = new Set(definition.sections.flatMap((section) => section.fields.map(fieldIdentity)));
  return <fieldset className="form-picker">
    <legend>Add an existing catalog element</legend>
    <label htmlFor="form-target-section">Section</label>
    <select id="form-target-section" value={targetSection || definition.sections[0]?.key || ""}
      onChange={(event) => onSectionChange(event.target.value)}>
      {definition.sections.map((section) => <option key={section.key} value={section.key}>{section.key}</option>)}
    </select>
    <label htmlFor="form-element-search">Find by identifier, name, or description</label>
    <input id="form-element-search" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} />
    <ul className="form-picker-results" aria-label="Catalog element search results">
      {results.map((element) => {
        const duplicate = placed.has(`nemsis:${element.elementId}`);
        return <li key={element.elementId}>
          <div><strong>{element.elementId} — {element.name}</strong><small>{element.baseDatatype} · {element.groupPath.join(" / ")}</small></div>
          <button type="button" disabled={duplicate} aria-label={duplicate ? `${element.elementId} is already in the form` : `Add ${element.elementId}`}
            onClick={() => onAdd(element)}>{duplicate ? "Already added" : "Add"}</button>
        </li>;
      })}
    </ul>
  </fieldset>;
}

export function FormSectionElements({ definition, onChange }: {
  readonly definition: FormDraftDefinition;
  readonly onChange: (definition: FormDraftDefinition, announcement: string) => void;
}) {
  return <div className="form-fields">
    {definition.sections.map((section) => <details key={section.key} open>
      <summary>{section.key} <span>{section.fields.length} elements</span></summary>
      <ol aria-label={`${section.key} form elements`}>
        {section.fields.map((field, index) => {
          const label = field.source.kind === "nemsis" ? field.source.elementId : field.key;
          return <li key={field.key}>
            <span><strong>{label}</strong><small>{field.key}</small></span>
            <div className="form-field-actions" aria-label={`Actions for ${label}`}>
              <button type="button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index - 1), `Moved ${label} up.`)}>Move up</button>
              <button type="button" disabled={index === section.fields.length - 1} aria-label={`Move ${label} down`} onClick={() =>
                onChange(moveFormElement(definition, section.key, index, index + 1), `Moved ${label} down.`)}>Move down</button>
              <button type="button" aria-label={`Remove ${label}`} onClick={() => {
                if (window.confirm(`Remove ${label} from ${section.key}?`))
                  onChange(removeFormElement(definition, section.key, field.key), `Removed ${label}.`);
              }}>Remove</button>
            </div>
          </li>;
        })}
      </ol>
    </details>)}
  </div>;
}
