"use client";

import { compileValidationRule, explainValidationRule, formatValidationSource,
  type CatalogDefinitionView, type PublishedValidationVersion, type ValidationCatalog,
  type ValidationDraft, type ValidationDraftResult, type ValidationRulePage } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { activateValidationVersion, createValidationDraft, loadValidationDraft, publishValidationDraft,
  createValidationRule, loadActiveCatalogDefinition, loadValidationRules, saveValidationDraft,
  setValidationRuleEnabled, validateValidationDraft } from "../app/admin-context";

export function validationCatalog(definition: CatalogDefinitionView["definition"]): ValidationCatalog {
  return { elements: definition.elements.map(({ elementId, label, baseDatatype, storageSemantics, constraints }) => {
      const groupPath = storageSemantics.groupPath;
      return { elementId, label, baseDatatype, groupPath,
        intrinsicOccurrence: { min: constraints.minOccurs, max: constraints.maxOccurs ?? "unbounded" } };
    }),
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

export type ValidationRuleFilters = { search: string; element: string; source: string; severity: string;
  executionTarget: string; enabled: string; validity: string };

export function ValidationRuleFilterControls({ value, onChange }: {
  readonly value: ValidationRuleFilters;
  readonly onChange: (value: ValidationRuleFilters) => void;
}) {
  const change = (key: keyof ValidationRuleFilters, next: string) => onChange({ ...value, [key]: next });
  return <div className="validation-library-filters" role="search" aria-label="Filter Validation rules">
    <label>Search <input type="search" value={value.search} onChange={(event) => change("search", event.target.value)} /></label>
    <label>Element <input value={value.element} list="validation-element-references" onChange={(event) => change("element", event.target.value)} /></label>
    <label>Source <select value={value.source} onChange={(event) => change("source", event.target.value)}>
      <option value="">All sources</option><option value="agency">Agency</option><option value="nemsis">NEMSIS</option>
      <option value="catalog">Catalog</option><option value="form">Form</option><option value="platform">Platform</option></select></label>
    <label>Severity <select value={value.severity} onChange={(event) => change("severity", event.target.value)}>
      <option value="">All severities</option><option value="error">Error</option><option value="warning">Warning</option>
      <option value="information">Information</option></select></label>
    <label>Target <select value={value.executionTarget} onChange={(event) => change("executionTarget", event.target.value)}>
      <option value="">All targets</option><option value="live">Live</option><option value="sign">Sign</option>
      <option value="review">Review</option></select></label>
    <label>State <select value={value.enabled} onChange={(event) => change("enabled", event.target.value)}>
      <option value="">Any state</option><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
    <label>Validity <select value={value.validity} onChange={(event) => change("validity", event.target.value)}>
      <option value="">Any validity</option><option value="valid">Valid</option><option value="invalid">Invalid</option></select></label>
  </div>;
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
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [library, setLibrary] = useState<ValidationRulePage | null>(null);
  const [filters, setFilters] = useState({ search: "", element: "", source: "", severity: "",
    executionTarget: "", enabled: "", validity: "" });
  const [cursor, setCursor] = useState<string | undefined>();
  const draftRevision = draft?.revision;

  useEffect(() => {
    let current = true;
    Promise.all([loadValidationDraft(), loadActiveCatalogDefinition()]).then(([value, catalogDefinition]) => {
      if (current) {
        setDraft(value); setReferenceElementId(value?.rules[0]?.primaryTargetElementId ?? "");
        setCatalog(catalogDefinition ? validationCatalog(catalogDefinition.definition) : null);
      }
    })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Validation draft is unavailable."); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!draftRevision) return;
    let current = true;
    loadValidationRules({ ...filters, cursor, limit: 25 }).then((page) => { if (current) setLibrary(page); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Rule library is unavailable."); });
    return () => { current = false; };
  }, [draftRevision, filters, cursor]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Validation operation failed."); }
    finally { setBusy(false); }
  }
  function change(update: (current: ValidationDraft) => ValidationDraft) {
    setDraft((current) => current ? update(current) : current); setDirty(true); setValidation(null); setStatus("Unsaved changes.");
  }
  const selectedRule = draft?.rules[selectedRuleIndex] ?? null;
  function changeRule(update: (rule: ValidationDraft["rules"][number]) => ValidationDraft["rules"][number]) {
    change((current) => ({ ...current, rules: current.rules.map((rule, index) => index === selectedRuleIndex ? update(rule) : rule) }));
  }
  const inlineValidation = useMemo(() => draft && catalog && selectedRule
    ? compileValidationRule(selectedRule, draft.id, catalog) : null, [draft, catalog, selectedRule]);
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
    <p>Version {published.version} and its {published.ruleIds.length} rules are immutable and bound to catalog {published.catalogReleaseId}.</p>
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
    <section className="validation-library" aria-labelledby="validation-library-heading">
      <h3 id="validation-library-heading">Rule library</h3>
      <ValidationRuleFilterControls value={filters} onChange={(value) => { setCursor(undefined); setFilters(value); }} />
      <p role="status">{library ? `${library.total} matching rule${library.total === 1 ? "" : "s"}.` : "Loading rules…"}</p>
      <nav aria-label="Validation rules"><ul>{(library?.items ?? []).map((item) => {
        const index = draft.rules.findIndex(({ id }) => id === item.rule.id);
        return <li key={item.rule.id}><button type="button" disabled={index < 0}
          aria-current={index === selectedRuleIndex ? "page" : undefined} onClick={() => {
            setSelectedRuleIndex(index); setReferenceElementId(item.rule.primaryTargetElementId);
          }}>{item.rule.name} — {item.source}, {item.validity}{item.rule.enabled ? "" : " (disabled)"}</button>
          {item.diagnostics.length > 0 && <ul aria-label={`${item.rule.name} diagnostics`}>{item.diagnostics.map((diagnostic, diagnosticIndex) =>
            <li key={`${diagnostic.code}:${diagnosticIndex}`}>{diagnostic.message}</li>)}</ul>}</li>;
      })}</ul></nav>
      <div className="form-actions"><button type="button" disabled={!cursor} onClick={() => setCursor(undefined)}>First page</button>
        <button type="button" disabled={!library?.nextCursor} onClick={() => setCursor(library?.nextCursor ?? undefined)}>Next page</button>
        {canWrite && <button type="button" disabled={busy || dirty || !catalog?.elements[0]} onClick={() => action(async () => {
          const element = catalog!.elements[0]!;
          const updated = await createValidationRule(csrfToken, draft, { name: "New agency rule", enabled: false,
            severity: "warning", executionTargets: ["live"], primaryTargetElementId: element.elementId,
            message: `Review ${element.label}`, source: `require present("${element.elementId}")`, sourceKind: "agency" });
          setDraft(updated); setSelectedRuleIndex(updated.rules.length - 1); setStatus("Agency rule created disabled; edit and restore it when ready.");
        })}>Create agency rule</button>}</div>
    </section>
    {selectedRule && <fieldset disabled={!canWrite}>
      <legend>Conditional validation rule</legend>
      <label htmlFor="validation-rule-name">Rule name</label>
      <input id="validation-rule-name" value={selectedRule.name}
        onChange={(event) => changeRule((rule) => ({ ...rule, name: event.target.value }))} />
      <label><input type="checkbox" checked={selectedRule.enabled}
        onChange={(event) => changeRule((rule) => ({ ...rule, enabled: event.target.checked }))} /> Rule enabled</label>
      <label htmlFor="validation-severity">Severity</label>
      <select id="validation-severity" value={selectedRule.severity}
        onChange={(event) => changeRule((rule) => ({ ...rule, severity: event.target.value as typeof rule.severity }))}>
        <option value="error">Error</option><option value="warning">Warning</option><option value="information">Information</option>
      </select>
      <fieldset><legend>Execution targets</legend>{(["live", "sign", "review"] as const).map((target) => <label key={target}>
        <input type="checkbox" checked={selectedRule.executionTargets.includes(target)} onChange={(event) => changeRule((rule) => ({
          ...rule, executionTargets: event.target.checked ? [...new Set([...rule.executionTargets, target])] : rule.executionTargets.filter((item) => item !== target),
        }))} /> {target}</label>)}</fieldset>
      <label htmlFor="validation-element-id">Primary target element ID</label>
      <input id="validation-element-id" list="validation-element-references" value={selectedRule.primaryTargetElementId}
        onChange={(event) => changeRule((rule) => ({ ...rule, primaryTargetElementId: event.target.value }))} />
      {catalog && <ValidationReferenceAssistance catalog={catalog} elementId={referenceElementId || selectedRule.primaryTargetElementId}
        onElementIdChange={setReferenceElementId} />}
      {catalog?.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)?.intrinsicOccurrence && (() => {
        const element = catalog.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)!;
        return <p role="note"><strong>Intrinsic Catalog structure (read-only):</strong> {element.intrinsicOccurrence!.min}–{element.intrinsicOccurrence!.max} occurrence(s)
          {element.groupPath?.length ? ` in ${element.groupPath.at(-1)}` : ""}. Validation policies may be disabled or relaxed, but cannot make unsupported occurrences structurally valid.</p>;
      })()}
      <label htmlFor="validation-message">Finding message</label>
      <input id="validation-message" value={selectedRule.message}
        onChange={(event) => changeRule((rule) => ({ ...rule, message: event.target.value }))} />
      <label htmlFor="validation-source">Rule source</label>
      <textarea id="validation-source" spellCheck={false} value={selectedRule.source}
        onChange={(event) => changeRule((rule) => ({ ...rule, source: event.target.value }))} />
      <small>Use optional <code>for each(&quot;group-id&quot;)</code> and <code>when</code> clauses followed by <code>require</code>. Boolean functions may nest. Domain functions cover occurrence limits, collection predicates, membership, safe matching, cross-element and time comparison, absence facets, and occurrence order.</small>
      <button type="button" onClick={() => {
        const formatted = formatValidationSource(selectedRule.source);
        if (formatted.formatted) changeRule((rule) => ({ ...rule, source: formatted.formatted! }));
      }}>Format rule source</button>
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const updated = await setValidationRuleEnabled(csrfToken, draft, selectedRule.id, !selectedRule.enabled);
        setDraft(updated); setStatus(selectedRule.enabled ? "Rule disabled and retained in history." : "Rule restored to execution.");
      })}>{selectedRule.enabled ? "Disable rule" : "Restore rule"}</button>
    </fieldset>}
    {selectedRule?.provenance?.length ? <details><summary>NEMSIS provenance ({selectedRule.provenance.length})</summary>
      {selectedRule.provenance.map((source) => <dl key={`${source.sourceIdentity}:${source.sourceRelease}`}>
        <div><dt>Source identity</dt><dd>{source.sourceIdentity}</dd></div>
        <div><dt>Release</dt><dd>{source.sourceRelease}{source.sourceBuild ? ` (${source.sourceBuild})` : ""}</dd></div>
        <div><dt>Original expression</dt><dd><code>{source.originalExpression}</code></dd></div>
        <div><dt>Original message</dt><dd>{source.originalMessage}</dd></div>
      </dl>)}</details> : selectedRule && <p role="note">Source: {selectedRule.sourceKind ?? "agency"}. This rule has no imported provenance.</p>}
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
