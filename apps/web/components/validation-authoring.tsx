"use client";

import { compileValidationRule, explainValidationRule, formatValidationSource,
  type CatalogDefinitionView, type PublishedValidationVersion, type ValidationCatalog,
  type ValidationDraft, type ValidationDraftResult } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { activateValidationVersion, createValidationDraft, loadValidationDraft, publishValidationDraft,
  loadActiveCatalogDefinition, saveValidationDraft, validateValidationDraft } from "../app/admin-context";

export function validationCatalog(definition: CatalogDefinitionView["definition"]): ValidationCatalog {
  return { elements: definition.elements.map(({ elementId, label, baseDatatype }) => ({ elementId, label, baseDatatype })),
    codes: definition.codeLists.flatMap((list) => list.elementIds.flatMap((elementId) => list.values.map((value) => ({
      elementId, code: value.code, codeSystem: value.codeSystem, label: value.label, enabled: value.enabled,
    })))) };
}

export function ValidationReferenceAssistance({ catalog, elementId, onElementIdChange }: {
  readonly catalog: ValidationCatalog;
  readonly elementId: string;
  readonly onElementIdChange: (elementId: string) => void;
}) {
  const relevantCodes = (catalog.codes ?? []).filter((code) => code.elementId === elementId && code.enabled !== false);
  return <aside aria-label="Rule reference assistance">
    <label htmlFor="validation-reference-element">Element reference</label>
    <input id="validation-reference-element" type="search" list="validation-element-references" value={elementId}
      onChange={(event) => onElementIdChange(event.target.value)} />
    <datalist id="validation-element-references">{catalog.elements.map((element) =>
      <option key={element.elementId} value={element.elementId}>{element.label} — {element.baseDatatype}</option>)}</datalist>
    <label htmlFor="validation-reference-code">Code reference for selected element</label>
    <input id="validation-reference-code" type="search" list="validation-code-references"
      placeholder="code-system|code" aria-describedby="validation-reference-note" />
    <datalist id="validation-code-references">{relevantCodes.map((code) =>
      <option key={`${code.codeSystem}:${code.code}`} value={`${code.codeSystem}|${code.code}`}>{code.label}</option>)}</datalist>
    <small id="validation-reference-note">Labels are current authoring assistance. Rule source stores stable element IDs, code systems, and codes.</small>
  </aside>;
}

export function ValidationAuthoring({ csrfToken, capabilities, catalogReleaseId, onActivated }: {
  readonly csrfToken: string;
  readonly capabilities: readonly string[];
  readonly catalogReleaseId: string;
  readonly onActivated?: () => void;
}) {
  const canWrite = capabilities.includes("validation:write");
  const canPublish = capabilities.includes("validation:publish");
  const [draft, setDraft] = useState<ValidationDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [activationNote, setActivationNote] = useState("");
  const [validation, setValidation] = useState<ValidationDraftResult | null>(null);
  const [published, setPublished] = useState<PublishedValidationVersion | null>(null);
  const [catalog, setCatalog] = useState<ValidationCatalog | null>(null);
  const [referenceElementId, setReferenceElementId] = useState("");

  useEffect(() => {
    let current = true;
    Promise.all([loadValidationDraft(), loadActiveCatalogDefinition()]).then(([value, catalogDefinition]) => {
      if (current) {
        setDraft(value); setReferenceElementId(value?.rule.primaryTargetElementId ?? "");
        setCatalog(catalogDefinition ? validationCatalog(catalogDefinition.definition) : null);
      }
    })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Validation draft is unavailable."); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, []);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Validation operation failed."); }
    finally { setBusy(false); }
  }
  function change(update: (current: ValidationDraft) => ValidationDraft) {
    setDraft((current) => current ? update(current) : current); setDirty(true); setValidation(null); setStatus("Unsaved changes.");
  }
  const inlineValidation = useMemo(() => draft && catalog
    ? compileValidationRule(draft.rule, draft.id, catalog) : null, [draft, catalog]);
  const explanation = inlineValidation?.compiled && catalog ? explainValidationRule(inlineValidation.compiled, catalog) : null;
  if (!loaded) return <p role="status">Loading Validation draft…</p>;
  if (!draft) return <div className="form-empty">
    {canWrite ? <>
      <p>Create a Validation draft bound to the active published Element catalog.</p>
      <label htmlFor="validation-name">Validation version display name</label>
      <input id="validation-name" maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <button type="button" disabled={busy || !catalogReleaseId || !displayName.trim()} onClick={() => action(async () => {
        setDraft(await createValidationDraft(csrfToken, catalogReleaseId, displayName));
        setStatus("Validation draft created with one required-element rule.");
      })}>Create Validation draft</button>
    </> : <p role="note">No Validation draft is available.</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </div>;

  if (published) return <div className="form-publication">
    <h3>Published {published.displayName}</h3>
    <p>Version {published.version} and rule {published.ruleId} are immutable and bound to catalog {published.catalogReleaseId}.</p>
    <label htmlFor="validation-activation-note">Activation note</label>
    <textarea id="validation-activation-note" value={activationNote} onChange={(event) => setActivationNote(event.target.value)} />
    <button type="button" disabled={busy || !canPublish || !activationNote.trim()} onClick={() => action(async () => {
      await activateValidationVersion(csrfToken, published.id, activationNote); setStatus("Validation activated for new reports."); onActivated?.();
    })}>Activate for clinical use</button>
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    <p>Draft revision {draft.revision}, bound to published catalog {draft.catalogReleaseId}.</p>
    <label htmlFor="validation-display-name">Validation version display name</label>
    <input id="validation-display-name" disabled={!canWrite} value={draft.displayName}
      onChange={(event) => change((current) => ({ ...current, displayName: event.target.value }))} />
    <fieldset disabled={!canWrite}>
      <legend>Conditional validation rule</legend>
      <label htmlFor="validation-rule-name">Rule name</label>
      <input id="validation-rule-name" value={draft.rule.name}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, name: event.target.value } }))} />
      <label htmlFor="validation-element-id">Primary target element ID</label>
      <input id="validation-element-id" list="validation-element-references" value={draft.rule.primaryTargetElementId}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, primaryTargetElementId: event.target.value } }))} />
      {catalog && <ValidationReferenceAssistance catalog={catalog} elementId={referenceElementId || draft.rule.primaryTargetElementId}
        onElementIdChange={setReferenceElementId} />}
      <label htmlFor="validation-message">Finding message</label>
      <input id="validation-message" value={draft.rule.message}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, message: event.target.value } }))} />
      <label htmlFor="validation-source">Rule source</label>
      <textarea id="validation-source" spellCheck={false} value={draft.rule.source}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, source: event.target.value } }))} />
      <small>Use an optional <code>when</code> condition followed by <code>require</code>. Boolean functions may nest: <code>all</code>, <code>any</code>, <code>not</code>, <code>present</code>, <code>coded</code>, and <code>equals</code>. A blank or omitted <code>when</code> always applies.</small>
      <button type="button" onClick={() => {
        const formatted = formatValidationSource(draft.rule.source);
        if (formatted.formatted) change((current) => ({ ...current, rule: { ...current.rule, source: formatted.formatted! } }));
      }}>Format rule source</button>
    </fieldset>
    {inlineValidation && inlineValidation.diagnostics.length > 0 && <div role="alert" aria-label="Inline rule diagnostics"><ul>
      {inlineValidation.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>
        {item.line ? `Line ${item.line}, column ${item.column}: ` : ""}{item.message}</li>)}
    </ul></div>}
    {explanation && <section aria-label="Generated rule explanation"><h3>Explanation</h3><p>{explanation}</p></section>}
    {validation && <div role={validation.valid ? "status" : "alert"}>
      {validation.valid ? <><p>Rule source, catalog references, datatypes, compiled representation, and finding target are valid.</p>
        {validation.explanation && <p>{validation.explanation}</p>}</>
        : <ul>{validation.diagnostics.map((item) => <li key={`${item.ruleId}:${item.code}`}>{item.message}</li>)}</ul>}
    </div>}
    <div className="form-actions">
      {canWrite && <button type="button" disabled={busy || !dirty} onClick={() => action(async () => {
        const saved = await saveValidationDraft(csrfToken, draft); setDraft(saved); setDirty(false); setStatus(`Saved draft revision ${saved.revision}.`);
      })}>Save Validation draft</button>}
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateValidationDraft(csrfToken, draft.id); setValidation(result);
        setStatus(result.valid ? "Validation succeeded." : "Validation found errors.");
      })}>Validate rule</button>
    </div>
    {canPublish && <section className="form-publication-review">
      <h3>Publication review</h3>
      <p>Publication creates immutable version and rule identities. Activation is a separate action.</p>
      <label htmlFor="validation-change-note">Publication note</label>
      <textarea id="validation-change-note" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
      <button type="button" disabled={busy || dirty || !validation?.valid || !changeNote.trim()} onClick={() => action(async () => {
        setPublished(await publishValidationDraft(csrfToken, draft, changeNote)); setStatus("Validation version published.");
      })}>Publish immutable Validation version</button>
    </section>}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;
}
