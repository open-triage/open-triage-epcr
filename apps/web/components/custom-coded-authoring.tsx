"use client";

import type { CatalogDraftCustomCodedElement, CatalogDraftCustomGroup } from "@open-triage/contracts";
import React, { useState } from "react";

export function CustomCodedAuthoring({ disabled, groups = [], onAdd }: {
  readonly disabled: boolean;
  readonly groups?: ReadonlyArray<CatalogDraftCustomGroup>;
  readonly onAdd: (definition: CatalogDraftCustomCodedElement) => void;
}) {
  const [namespace, setNamespace] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [definition, setDefinition] = useState("");
  const [codeSystem, setCodeSystem] = useState("");
  const [choices, setChoices] = useState("");
  const [nemsisElement, setNemsisElement] = useState("");
  const [notValues, setNotValues] = useState("");
  const [negatives, setNegatives] = useState("");
  const [identifying, setIdentifying] = useState("");
  const [usage, setUsage] = useState<CatalogDraftCustomCodedElement["usage"]>("Optional");
  const [recurrence, setRecurrence] = useState<CatalogDraftCustomCodedElement["recurrence"]>("single");
  const [correlatesTo, setCorrelatesTo] = useState("");
  const [groupDefinitionId, setGroupDefinitionId] = useState("");
  const [error, setError] = useState("");
  return <fieldset disabled={disabled}>
    <legend>Create custom coded element</legend>
    <label>Namespace <input required value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="org.example.ems" /></label>
    <label>Identifier <input required value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
    <label>English title <input required value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>English definition <textarea required value={definition} maxLength={255} onChange={(event) => setDefinition(event.target.value)} /></label>
    <label>Custom code system URI <input required value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} placeholder="https://example.org/ems/codes" /></label>
    <label>Choices, one per line (code | English label | optional NEMSIS code | optional Swedish label)
      <textarea required rows={5} value={choices} onChange={(event) => setChoices(event.target.value)} /></label>
    <label>Optional NEMSIS element mapping <input value={nemsisElement} onChange={(event) => setNemsisElement(event.target.value)} placeholder="eVitals.26" /></label>
    <label>Permitted NOT codes (comma separated) <input value={notValues} onChange={(event) => setNotValues(event.target.value)} placeholder="7701001, 7701003" /></label>
    <label>Permitted pertinent negative codes (comma separated) <input value={negatives} onChange={(event) => setNegatives(event.target.value)} placeholder="8801019" /></label>
    <label>Usage <select value={usage} onChange={(event) => setUsage(event.target.value as CatalogDraftCustomCodedElement["usage"])}>
      {(["Optional", "Recommended", "Required", "Mandatory"] as const).map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label>Recurrence <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as CatalogDraftCustomCodedElement["recurrence"])}>
      <option value="single">One value per target</option><option value="multiple">Multiple values per target</option>
    </select></label>
    <label>Correlate with <select value={correlatesTo} onChange={(event) => setCorrelatesTo(event.target.value)}>
      <option value="">Patient report</option><option value="eMedications.MedicationGroup">Medication entry</option>
      <option value="eExam.AssessmentGroup">Assessment entry</option>
    </select></label>
    <label>Grouping <select value={groupDefinitionId} onChange={(event) => {
      const group = groups.find((candidate) => candidate.id === event.target.value);
      setGroupDefinitionId(event.target.value);
      if (group) { setNamespace(group.namespace); setCorrelatesTo(group.correlatesTo ?? ""); }
    }}><option value="">None</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
    <label>Contains identifying information <select required value={identifying} onChange={(event) => setIdentifying(event.target.value)}>
      <option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option>
    </select></label>
    <button type="button" onClick={() => {
      const parsed = choices.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split("|").map((part) => part.trim()));
      if (!namespace.trim() || !slug.trim() || !title.trim() || !definition.trim() || !codeSystem.trim() || !identifying ||
        !parsed.length || parsed.some((parts) => !parts[0] || !parts[1] || parts.length > 4)) {
        setError("Complete the coded definition and enter each choice as code | label | optional NEMSIS code | optional Swedish label."); return;
      }
      const values = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);
      const permittedNotValues = values(notValues);
      const permittedPertinentNegatives = values(negatives);
      onAdd({ id: crypto.randomUUID(), namespace: namespace.trim(), slug: slug.trim(), title: title.trim(),
        definition: definition.trim(), datatype: "coded", recurrence, usage,
        ...(correlatesTo ? { correlatesTo: correlatesTo as NonNullable<CatalogDraftCustomCodedElement["correlatesTo"]> } : {}),
        ...(groupDefinitionId ? { groupDefinitionId } : {}),
        identifying: identifying === "yes", codeSystem: codeSystem.trim(),
        choices: parsed.map(([code, label, nemsisCode, swedishLabel]) => ({ code: code!, label: label!,
          ...(nemsisCode ? { nemsisCode } : {}), ...(swedishLabel ? { localization: { schemaVersion: 1 as const,
            sv: { label: swedishLabel, reviewedSource: { label: label! } } } } : {}) })),
        ...(nemsisElement.trim() ? { nemsisElement: nemsisElement.trim() } : {}),
        permittedNotValues, permittedPertinentNegatives });
      setError(""); setSlug(""); setTitle(""); setDefinition(""); setChoices("");
    }}>Add coded element</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
