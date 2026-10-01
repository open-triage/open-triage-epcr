"use client";

import type { CatalogDraftCustomCodedElement, CatalogDraftCustomGroup, CatalogDraftDefinition } from "@open-triage/contracts";
import React, { useState } from "react";
import { customCorrelationLabel, customCorrelationOptions, customSpecialOptions } from "../app/custom-authoring-options";

export function CustomCodedAuthoring({ disabled, groups = [], catalog, editingLanguage, onAdd }: {
  readonly disabled: boolean;
  readonly groups?: ReadonlyArray<CatalogDraftCustomGroup>;
  readonly catalog: CatalogDraftDefinition;
  readonly editingLanguage: "en" | "sv";
  readonly onAdd: (definition: CatalogDraftCustomCodedElement) => void;
}) {
  const [namespace, setNamespace] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [definition, setDefinition] = useState("");
  const [codeSystem, setCodeSystem] = useState("");
  const [choices, setChoices] = useState("");
  const [nemsisElement, setNemsisElement] = useState("");
  const [notValues, setNotValues] = useState<string[]>([]);
  const [negatives, setNegatives] = useState<string[]>([]);
  const [identifying, setIdentifying] = useState("");
  const [usage, setUsage] = useState<CatalogDraftCustomCodedElement["usage"]>("Optional");
  const [recurrence, setRecurrence] = useState<CatalogDraftCustomCodedElement["recurrence"]>("single");
  const [correlatesTo, setCorrelatesTo] = useState("");
  const [groupDefinitionId, setGroupDefinitionId] = useState("");
  const [error, setError] = useState("");
  const choiceOptions = nemsisElement ? catalog.codeLists.flatMap((list) => list.elementIds.includes(nemsisElement) ? list.values.filter((value) => value.enabled) : []) : [];
  const label = (value: { label: string; localization?: { sv?: { label?: string } } }) =>
    editingLanguage === "sv" ? value.localization?.sv?.label || value.label : value.label;
  const specialSelect = (elementId: string, selected: string[], update: (codes: string[]) => void, title: string) =>
    <details className="custom-multi-select"><summary>{title}: {selected.length ?
      customSpecialOptions(catalog, elementId).filter((value) => selected.includes(value.code)).map(label).join(", ") : "None"}</summary>
      {customSpecialOptions(catalog, elementId).map((value) => <label key={value.code}>
        <input type="checkbox" checked={selected.includes(value.code)} onChange={(event) => update(event.target.checked
          ? [...selected, value.code] : selected.filter((code) => code !== value.code))} /> {label(value)}
      </label>)}
    </details>;
  return <fieldset className="custom-element-form" disabled={disabled}>
    <legend>Create custom coded element</legend>
    <label>Namespace <input required value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="org.example.ems" /></label>
    <label>Identifier <input required value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
    <label>English title <input required value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>English definition <textarea required value={definition} maxLength={255} onChange={(event) => setDefinition(event.target.value)} /></label>
    <label>Custom code system URI <input required value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} placeholder="https://example.org/ems/codes" /></label>
    <label>Choices, one per line (code | English label | optional NEMSIS code)
      <textarea required rows={5} value={choices} onChange={(event) => setChoices(event.target.value)} /></label>
    <label>Optional NEMSIS element mapping <select value={nemsisElement} onChange={(event) => setNemsisElement(event.target.value)}>
      <option value="">None</option>{catalog.elements.filter((item) => !catalog.hiddenElementIds?.includes(item.elementId) && item.elementId.startsWith("e"))
        .map((item) => <option key={item.elementId} value={item.elementId}>{label(item)}</option>)}
    </select></label>
    {specialSelect("eCustomConfiguration.07", notValues, setNotValues, "Permitted NOT values")}
    {specialSelect("eCustomConfiguration.08", negatives, setNegatives, "Permitted pertinent negatives")}
    <label>Usage <select value={usage} onChange={(event) => setUsage(event.target.value as CatalogDraftCustomCodedElement["usage"])}>
      {(["Optional", "Recommended", "Required", "Mandatory"] as const).map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label>Recurrence <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as CatalogDraftCustomCodedElement["recurrence"])}>
      <option value="single">One value per target</option><option value="multiple">Multiple values per target</option>
    </select></label>
    <label>Correlate with <select value={correlatesTo} onChange={(event) => setCorrelatesTo(event.target.value)}>
      <option value="">{customCorrelationLabel(undefined, editingLanguage)}</option>
      {customCorrelationOptions(catalog).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select></label>
    <label>Grouping <select value={groupDefinitionId} onChange={(event) => {
      const group = groups.find((candidate) => candidate.id === event.target.value);
      setGroupDefinitionId(event.target.value);
      if (group) { setNamespace(group.namespace); setCorrelatesTo(group.correlatesTo ?? ""); }
    }}><option value="">None</option>{groups.map((group) => <option key={group.id} value={group.id}>{editingLanguage === "sv" ? group.localization?.sv?.label || group.title : group.title}</option>)}</select></label>
    <label>Contains identifying information <select required value={identifying} onChange={(event) => setIdentifying(event.target.value)}>
      <option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option>
    </select></label>
    <button type="button" onClick={() => {
      const parsed = choices.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|").map((part) => part.trim()));
      if (!namespace.trim() || !slug.trim() || !title.trim() || !definition.trim() || !codeSystem.trim() || !identifying ||
        !parsed.length || parsed.some((parts) => !parts[0] || !parts[1] || parts.length > 3 ||
          parts[2] && !choiceOptions.some((value) => value.code === parts[2]))) {
        setError("Complete the coded definition. Each choice needs a code and label; any mapped code must belong to the selected NEMSIS element."); return;
      }
      onAdd({ id: crypto.randomUUID(), namespace: namespace.trim(), slug: slug.trim(), title: title.trim(),
        definition: definition.trim(), datatype: "coded", recurrence, usage,
        ...(correlatesTo ? { correlatesTo } : {}), ...(groupDefinitionId ? { groupDefinitionId } : {}),
        identifying: identifying === "yes", codeSystem: codeSystem.trim(),
        choices: parsed.map(([code, choiceLabel, nemsisCode]) => ({ code: code!, label: choiceLabel!, ...(nemsisCode ? { nemsisCode } : {}) })),
        ...(nemsisElement ? { nemsisElement } : {}), permittedNotValues: notValues, permittedPertinentNegatives: negatives });
      setError(""); setSlug(""); setTitle(""); setDefinition(""); setChoices("");
    }}>Add coded element</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
