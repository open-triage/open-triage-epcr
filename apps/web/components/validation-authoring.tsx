"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import { compileValidationRule, explainValidationRule, formatValidationSource, validationRuleText,
  type AuthoringVersionOption, type CatalogDefinitionView, type PublishedValidationVersion, type ValidationCatalog,
  type ValidationDraft, type ValidationDraftResult, type ValidationRulePage } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { LoadingStatus } from "./loading-status";
import { activateValidationVersion, cloneValidationVersion, createValidationDraft, deleteValidationDraft, loadStationaryFormVersions,
  loadValidationDraft, loadValidationVersions, publishValidationDraft,
  createValidationRule, loadActiveCatalogDefinition, loadCatalogVersion, loadValidationRules, saveValidationDraft,
  setValidationRuleEnabled, validateValidationDraft } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { validationTranslationIssues, updateValidationEnglish } from "../app/translation-diagnostics";
import { TranslationIssueSummary } from "./translation-issue-summary";

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
  const t = useAdminText();
  const relevantCodes = (catalog.codes ?? []).filter((code) => code.elementId === elementId && code.enabled !== false);
  return <aside aria-label={t("Rule reference assistance")}>
    <label htmlFor="validation-reference-element"><AdminText english="Element reference" /></label>
    <select id="validation-reference-element" value={elementId}
      onChange={(event) => onElementIdChange(event.target.value)}>
      <option value=""><AdminText english="Select an element" /></option>
      {elementId && !catalog.elements.some((element) => element.elementId === elementId) &&
        <option value={elementId}>{elementId} (not in this catalog)</option>}
      {catalog.elements.map((element) =>
        <option key={element.elementId} value={element.elementId}>{element.elementId} — {element.label}</option>)}
    </select>
    <label htmlFor="validation-reference-code"><AdminText english="Code reference for selected element" /></label>
    <input id="validation-reference-code" type="search" list="validation-code-references"
      placeholder="code-system|code" aria-describedby="validation-reference-note" />
    <datalist id="validation-code-references">{relevantCodes.map((code) =>
      <option key={`${code.codeSystem}:${code.code}`} value={`${code.codeSystem}|${code.code}`}>{code.label}</option>)}</datalist>
    <small id="validation-reference-note"><AdminText english="Labels are current authoring assistance. Rule source stores stable element IDs, code systems, and codes." /></small>
  </aside>;
}

export type ValidationRuleFilters = { search: string; element: string; source: string; severity: string;
  executionTarget: string; enabled: string; validity: string };

export function ValidationRuleFilterControls({ value, onChange, elements = [] }: {
  readonly value: ValidationRuleFilters;
  readonly onChange: (value: ValidationRuleFilters) => void;
  readonly elements?: ValidationCatalog["elements"];
}) {
  const t = useAdminText();
  const change = (key: keyof ValidationRuleFilters, next: string) => onChange({ ...value, [key]: next });
  return <div className="validation-library-filters" role="search" aria-label={t("Filter Validation rules")}>
    <label><AdminText english="Search" /> <input type="search" value={value.search} onChange={(event) => change("search", event.target.value)} /></label>
    <label><AdminText english="Element" /> <select value={value.element} onChange={(event) => change("element", event.target.value)}>
      <option value=""><AdminText english="All elements" /></option>
      {value.element && !elements.some(({ elementId }) => elementId === value.element) &&
        <option value={value.element}>{value.element}</option>}
      {elements.map((element) => <option key={element.elementId} value={element.elementId}>
        {element.elementId} — {element.label}</option>)}
    </select></label>
    <label><AdminText english="Source" /> <select value={value.source} onChange={(event) => change("source", event.target.value)}>
      <option value=""><AdminText english="All sources" /></option><option value="agency"><AdminText english="Agency" /></option><option value="nemsis">NEMSIS</option>
      <option value="catalog"><AdminText english="Catalog" /></option><option value="form"><AdminText english="Form" /></option><option value="platform"><AdminText english="Platform" /></option></select></label>
    <label><AdminText english="Severity" /> <select value={value.severity} onChange={(event) => change("severity", event.target.value)}>
      <option value=""><AdminText english="All severities" /></option><option value="error"><AdminText english="Error" /></option><option value="warning"><AdminText english="Warning" /></option>
      <option value="information"><AdminText english="Information" /></option></select></label>
    <label><AdminText english="Target" /> <select value={value.executionTarget} onChange={(event) => change("executionTarget", event.target.value)}>
      <option value=""><AdminText english="All targets" /></option><option value="live"><AdminText english="Live" /></option><option value="sign"><AdminText english="Sign" /></option>
      <option value="review"><AdminText english="Review" /></option></select></label>
    <label><AdminText english="State" /> <select value={value.enabled} onChange={(event) => change("enabled", event.target.value)}>
      <option value=""><AdminText english="Any state" /></option><option value="true"><AdminText english="Enabled" /></option><option value="false"><AdminText english="Disabled" /></option></select></label>
    <label><AdminText english="Validity" /> <select value={value.validity} onChange={(event) => change("validity", event.target.value)}>
      <option value=""><AdminText english="Any validity" /></option><option value="valid"><AdminText english="Valid" /></option><option value="invalid"><AdminText english="Invalid" /></option></select></label>
  </div>;
}

export function groupValidationDiagnostics(diagnostics: ValidationDraftResult["diagnostics"]) {
  const groups = new Map<string, { code: string; severity: string; message: string; count: number; ruleIds: string[] }>();
  for (const item of diagnostics) {
    const key = JSON.stringify([item.severity, item.code, item.message]);
    const group = groups.get(key) ?? { code: item.code, severity: item.severity, message: item.message, count: 0, ruleIds: [] };
    group.count += 1;
    if (item.ruleId && !group.ruleIds.includes(item.ruleId)) group.ruleIds.push(item.ruleId);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function DiagnosticDetails({ diagnostics }: { readonly diagnostics: ValidationDraftResult["diagnostics"] }) {
  const t = useAdminText();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(20);
  const groups = useMemo(() => groupValidationDiagnostics(diagnostics), [diagnostics]);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("Show all {issues} issues ({messages} distinct messages)", { issues: diagnostics.length, messages: groups.length })}</summary>
    {open && <>
      <ul>{groups.slice(0, limit).map((item, index) => <li key={index}>
        {item.message}{item.count > 1 && <strong> · {t("{count} occurrences", { count: item.count })}</strong>}
        {item.ruleIds.length > 0 && <details><summary>{t("Affected rules ({count})", { count: item.ruleIds.length })}</summary>
          <p>{item.ruleIds.join(", ")}</p></details>}
      </li>)}</ul>
      {groups.length > limit && <button type="button" onClick={() => setLimit((current) => current + 20)}><AdminText english="Show more messages" /></button>}
    </>}
  </details>;
}

export function ValidationResultFeedback({ result, ruleCount }: {
  readonly result: ValidationDraftResult;
  readonly ruleCount: number;
}) {
  const t = useAdminText();
  const warnings = result.diagnostics.filter(({ severity }) => severity === "warning");
  if (result.valid) return <div className="validation-result" role="status">
    <strong><AdminText english="Validation passed." /></strong> {t("{count} rules checked.", { count: ruleCount })}
    {warnings.length > 0 && <span> {t("{count} warnings.", { count: warnings.length })}</span>}
    {warnings.length > 0 && <>
      <p><AdminText english="Warnings do not block publication. Review the affected rules before publishing." /></p>
      <DiagnosticDetails diagnostics={warnings} />
    </>}
    {result.explanation && <details><summary><AdminText english="View details" /></summary>
      {result.explanation && <p className="validation-result-explanation">{result.explanation}</p>}
    </details>}
  </div>;
  return <div className="validation-result validation-result-error" role="alert">
    <strong>{t("Validation found {count} issues.", { count: result.diagnostics.length })}</strong>
    <ul>{result.diagnostics.slice(0, 3).map((item, index) =>
      <li key={`${item.ruleId}:${item.code}:${index}`}>{item.message}</li>)}</ul>
    {result.diagnostics.length > 3 && <DiagnosticDetails diagnostics={result.diagnostics} />}
  </div>;
}

export function ValidationAuthoring({ csrfToken, capabilities, catalogReleaseId, onActivated, active = true, language = "sv" }: {
  readonly language?: "en" | "sv";
  readonly csrfToken: string;
  readonly capabilities: readonly string[];
  readonly catalogReleaseId: string;
  readonly onActivated?: () => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
  const canWrite = capabilities.includes("validation:write");
  const canPublish = capabilities.includes("validation:publish");
  const [draft, setDraft] = useState<ValidationDraft | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [formVersions, setFormVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedFormVersionId, setSelectedFormVersionId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
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
  const [hiddenElementIds, setHiddenElementIds] = useState<readonly string[]>([]);
  const [referenceElementId, setReferenceElementId] = useState("");
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [wordingLanguage, setWordingLanguage] = useState<"en" | "sv">("en");
  const [wordingIssueFilter, setWordingIssueFilter] = useState("all");
  const [library, setLibrary] = useState<ValidationRulePage | null>(null);
  const [filters, setFilters] = useState({ search: "", element: "", source: "", severity: "",
    executionTarget: "", enabled: "", validity: "" });
  const draftRevision = draft?.revision;

  useEffect(() => {
    let current = true;
    Promise.all([loadValidationDraft(), loadActiveCatalogDefinition()]).then(async ([value, activeDefinition]) => {
      const catalogDefinition = value?.catalogReleaseId
        ? await loadCatalogVersion(value.catalogReleaseId) : activeDefinition;
      if (current) {
        setDraft(value); setReferenceElementId(value?.rules[0]?.primaryTargetElementId ?? "");
        setCatalog(catalogDefinition ? validationCatalog(catalogDefinition.definition) : null);
        setHiddenElementIds(catalogDefinition?.definition.hiddenElementIds ?? []);
      }
    })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : t("Validation draft is unavailable.")); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadValidationVersions().then((items) => { if (current) {
      setVersions(items); setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : t("Validation versions are unavailable.")); });
    return () => { current = false; };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadStationaryFormVersions().then((items) => { if (current) setFormVersions(items); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : t("Form versions are unavailable.")); });
    return () => { current = false; };
  }, [active]);

  useEffect(() => {
    if (!draftRevision) return;
    let current = true;
    loadValidationRules({ ...filters, limit: "all" }).then((page) => { if (current) setLibrary(page); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : t("Rule library is unavailable.")); });
    return () => { current = false; };
  }, [draftRevision, filters]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : t("Validation operation failed.")); }
    finally { setBusy(false); }
  }
  function change(update: (current: ValidationDraft) => ValidationDraft) {
    setDraft((current) => current ? update(current) : current); setDirty(true); setValidation(null); setStatus(t("Unsaved changes."));
  }
  const selectedRule = draft?.rules[selectedRuleIndex] ?? null;
  const wordingIssues = draft ? validationTranslationIssues(draft.rules, language) : [];
  function changeRule(update: (rule: ValidationDraft["rules"][number]) => ValidationDraft["rules"][number]) {
    change((current) => ({ ...current, rules: current.rules.map((rule, index) => index === selectedRuleIndex ? update(rule) : rule) }));
  }
  const inlineValidation = useMemo(() => draft && catalog && selectedRule
    ? compileValidationRule(selectedRule, draft.id, catalog) : null, [draft, catalog, selectedRule]);
  const explanation = inlineValidation?.compiled && catalog ? explainValidationRule(inlineValidation.compiled, catalog) : null;
  const visibleCatalogElements = catalog?.elements.filter(({ elementId }) => !hiddenElementIds.includes(elementId)) ?? [];
  const selectedVersion = versions.find(({ id }) => id === selectedVersionId);
  const activationCatalogId = published?.catalogReleaseId ?? selectedVersion?.catalogReleaseId ?? "";
  const compatibleForms = formVersions.filter(({ catalogReleaseId: id }) => id === activationCatalogId);
  const selectedForm = compatibleForms.find(({ id }) => id === selectedFormVersionId)
    ?? compatibleForms.find(({ status }) => status === "active") ?? compatibleForms[0];
  const formActivationChoice = <div className="authoring-version-row">
    <label htmlFor="validation-activation-form"><AdminText english="Stationary form" /></label>
    <select id="validation-activation-form" value={selectedForm?.id ?? ""}
      onChange={(event) => setSelectedFormVersionId(event.target.value)} disabled={compatibleForms.length === 0}>
      {compatibleForms.length === 0 && <option value=""><AdminText english="No compatible published form" /></option>}
      {compatibleForms.map((form) => <option key={form.id} value={form.id}>
        {form.displayName} · v{form.version}{form.status === "active" ? t(" · Active") : ""}</option>)}
    </select>
  </div>;
  const versionWorkspace = <AuthoringVersionWorkspace title="Validation rules" versions={versions}
    selectedId={selectedVersionId} onSelect={setSelectedVersionId} draftName={displayName}
    onDraftNameChange={setDisplayName} canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && !published)}
    canCreateWithoutSource={Boolean(catalogReleaseId)}
    onCreateDraft={() => action(async () => {
      const cloned = selectedVersion
        ? await cloneValidationVersion(csrfToken, selectedVersion.id,
          selectedVersion.catalogReleaseId ?? catalogReleaseId, displayName)
        : await createValidationDraft(csrfToken, catalogReleaseId, displayName);
      const definition = await loadCatalogVersion(cloned.catalogReleaseId);
      setCatalog(validationCatalog(definition.definition));
      setHiddenElementIds(definition.definition.hiddenElementIds ?? []);
      setPublished(null); setDraft(cloned); setDisplayName(""); setDirty(false); setStatus(t("Validation draft created."));
    })}>
    {selectedVersion && selectedVersion.status !== "active" && canPublish && !draft && !published &&
      <>{formActivationChoice}<AuthoringLifecycleAction title="Selected Validation rules" kind="activate" note={activationNote}
        onNoteChange={setActivationNote} disabled={busy || !selectedForm} buttonLabel="Activate selected version"
        onSubmit={() => action(async () => {
          if (!selectedForm || !selectedVersion.catalogReleaseId) return;
          await activateValidationVersion(csrfToken, selectedVersion.id, selectedForm.id,
            selectedVersion.catalogReleaseId, activationNote);
          setVersions((current) => current.map((item) => ({ ...item, status: item.id === selectedVersion.id ? "active" : "published" })));
          setActivationNote(""); setStatus(t("Validation activated for new reports.")); onActivated?.();
        })} /></>}
  </AuthoringVersionWorkspace>;
  if (!loaded) return <LoadingStatus><AdminText english="Loading Validation draft…" /></LoadingStatus>;
  if (!draft) return <div className="form-empty">
    {versionWorkspace}
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </div>;

  if (published) return <div className="form-publication">
    {versionWorkspace}
    <h3>{t("Published {name}", { name: published.displayName })}</h3>
    <p>{t("Version {version} and its {count} rules are immutable and bound to catalog {catalog}.", { version: published.version, count: published.ruleIds.length, catalog: published.catalogReleaseId })}</p>
    {formActivationChoice}
    <AuthoringLifecycleAction title="Validation rules" kind="activate" note={activationNote}
      onNoteChange={setActivationNote} disabled={busy || !canPublish || !selectedForm} buttonLabel={t("Activate for clinical use")}
      onSubmit={() => action(async () => {
      if (!selectedForm) return;
      await activateValidationVersion(csrfToken, published.id, selectedForm.id, published.catalogReleaseId, activationNote);
      setVersions((current) => current.map((item) => ({ ...item, status: item.id === published.id ? "active" : "published" })));
      setStatus(t("Validation activated for new reports.")); onActivated?.();
    })} />
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    {versionWorkspace}
    <p>{t("Draft revision {revision}, bound to published catalog {catalog}.", { revision: draft.revision, catalog: draft.catalogReleaseId })}</p>
    <label htmlFor="validation-display-name"><AdminText english="Validation version display name" /></label>
    <input id="validation-display-name" disabled={!canWrite} value={draft.displayName}
      onChange={(event) => change((current) => ({ ...current, displayName: event.target.value }))} />
    <TranslationIssueSummary issues={wordingIssues} filter={wordingIssueFilter} onFilter={setWordingIssueFilter} onNavigate={(issue) => {
      setSelectedRuleIndex(draft.rules.findIndex((rule) => rule.id === issue.id));
      setWordingLanguage(issue.kind === "english" ? "en" : "sv");
      requestAnimationFrame(() => document.getElementById(`validation-rule-${issue.field}`)?.focus());
    }} />
    <section className="validation-library" aria-labelledby="validation-library-heading">
      <h3 id="validation-library-heading"><AdminText english="Rule library" /></h3>
      <ValidationRuleFilterControls value={filters} elements={visibleCatalogElements}
        onChange={(value) => { setLibrary(null); setFilters(value); }} />
      <p role="status">{library ? `${library.total} matching rule${library.total === 1 ? "" : "s"}.` : t("Loading rules…")}</p>
      <div className="validation-rule-table-scroll"><table className="validation-rule-table">
        <caption className="sr-only"><AdminText english="Validation rules" /></caption><thead><tr><th scope="col"><AdminText english="Rule" /></th><th scope="col"><AdminText english="Element" /></th>
          <th scope="col"><AdminText english="Source" /></th><th scope="col"><AdminText english="Severity" /></th><th scope="col"><AdminText english="Targets" /></th>
          <th scope="col"><AdminText english="State" /></th><th scope="col"><AdminText english="Validity" /></th></tr></thead><tbody>{(library?.items ?? []).map((item) => {
        const index = draft.rules.findIndex(({ id }) => id === item.rule.id);
        return <tr key={item.rule.id} className={index === selectedRuleIndex ? "is-selected" : undefined}>
          <th scope="row"><button type="button" disabled={index < 0}
          aria-current={index === selectedRuleIndex ? "page" : undefined} onClick={() => {
            setSelectedRuleIndex(index); setReferenceElementId(item.rule.primaryTargetElementId);
          }}>{validationRuleText(item.rule, wordingLanguage, "name")}</button></th><td><code>{item.rule.primaryTargetElementId}</code></td>
          <td>{item.source}</td><td>{item.rule.severity}</td><td>{item.rule.executionTargets.join(", ")}</td>
          <td>{item.rule.enabled ? t("Enabled") : t("Disabled")}</td><td>{item.validity}
            {item.diagnostics.length > 0 && <span className="validation-help" tabIndex={0}
              aria-label={`${item.rule.name} diagnostics: ${item.diagnostics.map(({ message }) => message).join("; ")}`}
              title={item.diagnostics.map(({ message }) => message).join("\n")}>ⓘ</span>}</td></tr>;
      })}</tbody></table></div>
      <div className="form-actions">{canWrite && <button type="button" disabled={busy || dirty || !visibleCatalogElements[0]} onClick={() => action(async () => {
          const element = visibleCatalogElements[0]!;
          const updated = await createValidationRule(csrfToken, draft, { name: t("New agency rule"), enabled: false,
            severity: "warning", executionTargets: ["live"], primaryTargetElementId: element.elementId,
            message: `Review ${element.label}`, source: `require present("${element.elementId}")`, sourceKind: "agency" });
          setDraft(updated); setSelectedRuleIndex(updated.rules.length - 1); setStatus(t("Agency rule created disabled; edit and restore it when ready."));
        })}><AdminText english="Create agency rule" /></button>}</div>
    </section>
    {selectedRule && <fieldset className="validation-rule-editor" disabled={!canWrite}>
      <legend><AdminText english="Conditional validation rule" /></legend>
      <div className="validation-rule-row"><label htmlFor="validation-wording-language"><AdminText english="Wording language" /></label>
        <select id="validation-wording-language" value={wordingLanguage}
          onChange={(event) => setWordingLanguage(event.target.value as "en" | "sv")}>
          <option value="en"><AdminText english="English" /></option><option value="sv"><AdminText english="Swedish" /></option>
        </select></div>
      <div className="validation-rule-row"><label htmlFor="validation-rule-name">Name ({wordingLanguage})</label>
      <input id="validation-rule-name" value={wordingLanguage === "en" ? selectedRule.name : selectedRule.localization?.sv?.name ?? ""}
        onChange={(event) => changeRule((rule) => wordingLanguage === "en" ? updateValidationEnglish(rule, "name", event.target.value) :
          { ...rule, localization: { schemaVersion: 1, ...rule.localization, sv: { ...rule.localization?.sv,
            name: event.target.value, reviewedSource: { ...rule.localization?.sv?.reviewedSource, name: rule.name } } } })} /></div>
      {wordingIssues.filter((issue) => issue.id === selectedRule.id && issue.field === "name").map((issue) =>
        <small role="note" key={issue.kind}>{issue.message}</small>)}
      <div className="validation-rule-row"><label><span><AdminText english="Enabled" /></span><input type="checkbox" checked={selectedRule.enabled}
        onChange={(event) => changeRule((rule) => ({ ...rule, enabled: event.target.checked }))} /></label></div>
      <div className="validation-rule-row"><label htmlFor="validation-severity"><AdminText english="Severity" /></label>
      <select id="validation-severity" value={selectedRule.severity}
        onChange={(event) => changeRule((rule) => ({ ...rule, severity: event.target.value as typeof rule.severity }))}>
        <option value="error"><AdminText english="Error" /></option><option value="warning"><AdminText english="Warning" /></option><option value="information"><AdminText english="Information" /></option>
      </select></div>
      <div className="validation-rule-row"><span id="validation-targets-label"><AdminText english="Targets" /></span><div role="group" aria-labelledby="validation-targets-label" className="validation-targets">{(["live", "sign", "review"] as const).map((target) => <label key={target}>
        <input type="checkbox" checked={selectedRule.executionTargets.includes(target)} onChange={(event) => changeRule((rule) => ({
          ...rule, executionTargets: event.target.checked ? [...new Set([...rule.executionTargets, target])] : rule.executionTargets.filter((item) => item !== target),
        }))} /> {target}</label>)}</div></div>
      <div className="validation-rule-row"><label htmlFor="validation-element-id"><AdminText english="Element ID" /></label>
      <select id="validation-element-id" value={selectedRule.primaryTargetElementId}
        onChange={(event) => changeRule((rule) => ({ ...rule, primaryTargetElementId: event.target.value }))}>
        {!visibleCatalogElements.some(({ elementId }) => elementId === selectedRule.primaryTargetElementId) &&
          <option value={selectedRule.primaryTargetElementId}>{selectedRule.primaryTargetElementId} (not in this catalog)</option>}
        {visibleCatalogElements.map((element) => <option key={element.elementId} value={element.elementId}>
          {element.elementId} — {element.label}</option>)}
      </select></div>
      {catalog && <details className="validation-reference-details"><summary><AdminText english="Element and code references" /></summary>
        <ValidationReferenceAssistance catalog={{ ...catalog, elements: visibleCatalogElements,
          codes: catalog.codes?.filter(({ elementId }) => !hiddenElementIds.includes(elementId)) }}
          elementId={referenceElementId || selectedRule.primaryTargetElementId}
          onElementIdChange={setReferenceElementId} /></details>}
      {catalog?.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)?.intrinsicOccurrence && (() => {
        const element = catalog.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)!;
        return <div className="validation-rule-row"><span><AdminText english="Catalog limits" /></span><span>{element.intrinsicOccurrence!.min}–{element.intrinsicOccurrence!.max} occurrences
          {element.groupPath?.length ? ` in ${element.groupPath.at(-1)}` : ""} <span className="validation-help" tabIndex={0}
            aria-label="Catalog structure is read-only. Validation policies cannot make unsupported occurrences structurally valid."
            title="Catalog structure is read-only. Validation policies cannot make unsupported occurrences structurally valid.">ⓘ</span></span></div>;
      })()}
      <div className="validation-rule-row"><label htmlFor="validation-message">Message ({wordingLanguage})</label>
      <input id="validation-message" value={wordingLanguage === "en" ? selectedRule.message : selectedRule.localization?.sv?.message ?? ""}
        onChange={(event) => changeRule((rule) => wordingLanguage === "en" ? updateValidationEnglish(rule, "message", event.target.value) :
          { ...rule, localization: { schemaVersion: 1, ...rule.localization, sv: { ...rule.localization?.sv,
            message: event.target.value, reviewedSource: { ...rule.localization?.sv?.reviewedSource, message: rule.message } } } })} /></div>
      {wordingIssues.filter((issue) => issue.id === selectedRule.id && issue.field === "message").map((issue) =>
        <small role="note" key={issue.kind}>{issue.message}</small>)}
      <div className="validation-rule-row"><label htmlFor="validation-message-parameters"><AdminText english="Named message parameters (JSON)" /></label>
        <textarea id="validation-message-parameters" key={selectedRule.id}
          defaultValue={JSON.stringify(selectedRule.messageParameters ?? {}, null, 2)} rows={3}
          onBlur={(event) => { try { const parameters = JSON.parse(event.target.value) as Record<string, string | number>;
            if (!parameters || Array.isArray(parameters) || typeof parameters !== "object") throw new Error();
            changeRule((rule) => ({ ...rule, messageParameters: parameters })); setError("");
          } catch { setError(t("Named message parameters must be a JSON object.")); } }} /></div>
      {wordingLanguage === "sv" && <div className="validation-rule-row"><span><AdminText english="Source review" /></span>
        {!selectedRule.localization?.sv?.reviewedSource && <span role="note"><AdminText english="Swedish wording needs source and terminology review." /></span>}
        <button type="button" onClick={() => changeRule((rule) => ({ ...rule,
          localization: { schemaVersion: 1, ...rule.localization, sv: { ...rule.localization?.sv,
            reviewedSource: { name: rule.name, message: rule.message } } } }))}>
          Mark English source reviewed</button></div>}
      <div className="validation-rule-row validation-source-row"><label htmlFor="validation-source"><AdminText english="Rule source" /> <span className="validation-help"
        tabIndex={0} aria-label="Use optional for each and when clauses followed by require. Boolean functions may nest. Domain functions cover occurrence limits, collection predicates, membership, safe matching, cross-element and time comparison, absence facets, and occurrence order."
        title="Use optional for each and when clauses followed by require. Boolean functions may nest. Domain functions cover occurrence limits, collection predicates, membership, safe matching, cross-element and time comparison, absence facets, and occurrence order.">ⓘ</span></label>
      <textarea id="validation-source" spellCheck={false} rows={3} value={selectedRule.source}
        onChange={(event) => changeRule((rule) => ({ ...rule, source: event.target.value }))} /></div>
      <div className="form-actions validation-rule-actions">
      <button type="button" onClick={() => {
        const formatted = formatValidationSource(selectedRule.source);
        if (formatted.formatted) changeRule((rule) => ({ ...rule, source: formatted.formatted! }));
      }}><AdminText english="Format rule source" /></button>
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const updated = await setValidationRuleEnabled(csrfToken, draft, selectedRule.id, !selectedRule.enabled);
        setDraft(updated); setStatus(selectedRule.enabled ? t("Rule disabled and retained in history.") : t("Rule restored to execution."));
      })}>{selectedRule.enabled ? t("Disable rule") : t("Restore rule")}</button></div>
    </fieldset>}
    {selectedRule?.provenance?.length ? <details><summary>NEMSIS provenance ({selectedRule.provenance.length})</summary>
      {selectedRule.provenance.map((source) => <dl key={`${source.sourceIdentity}:${source.sourceRelease}`}>
        <div><dt><AdminText english="Source identity" /></dt><dd>{source.sourceIdentity}</dd></div>
        <div><dt><AdminText english="Release" /></dt><dd>{source.sourceRelease}{source.sourceBuild ? ` (${source.sourceBuild})` : ""}</dd></div>
        <div><dt><AdminText english="Original expression" /></dt><dd><code>{source.originalExpression}</code></dd></div>
        <div><dt><AdminText english="Original message" /></dt><dd>{source.originalMessage}</dd></div>
      </dl>)}</details> : null}
    {inlineValidation && inlineValidation.diagnostics.length > 0 && <div role="alert" aria-label="Inline rule diagnostics"><ul>
      {inlineValidation.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>
        {item.line ? `Line ${item.line}, column ${item.column}: ` : ""}{item.message}</li>)}
    </ul></div>}
    {explanation && <details aria-label="Generated rule explanation"><summary><AdminText english="Explanation" /></summary><p>{explanation}</p></details>}
    {validation && <ValidationResultFeedback result={validation} ruleCount={draft.rules.length} />}
    <div className="form-actions">
      {canWrite && <button type="button" disabled={busy || !dirty} onClick={() => action(async () => {
        const saved = await saveValidationDraft(csrfToken, draft); setDraft(saved); setDirty(false); setStatus(`Saved draft revision ${saved.revision}.`);
      })}><AdminText english="Save Validation draft" /></button>}
      {canWrite && <button type="button" disabled={busy} onClick={() => {
        if (!window.confirm(`Delete Validation draft ${draft.displayName}? This cannot be undone.`)) return;
        void action(async () => {
          await deleteValidationDraft(csrfToken, draft);
          setDraft(null); setDirty(false); setValidation(null); setLibrary(null);
          setStatus(t("Validation draft deleted. You can now start a draft from a selected version."));
        });
      }}><AdminText english="Delete draft" /></button>}
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateValidationDraft(csrfToken, draft.id); setValidation(result);
        setStatus("");
      })}><AdminText english="Validate draft" /></button>
    </div>
    {canPublish && <section className="form-publication-review">
      <h3><AdminText english="Publication review" /></h3>
      <p><AdminText english="Publication creates immutable version and rule identities. Activation is a separate action." /></p>
      <AuthoringLifecycleAction title="Validation rules" kind="publish" note={changeNote}
        onNoteChange={setChangeNote} disabled={busy || dirty || !validation?.valid}
        buttonLabel="Publish immutable Validation version" onSubmit={() => action(async () => {
        const result = await publishValidationDraft(csrfToken, draft, changeNote);
        setPublished(result); setSelectedVersionId(result.id); setVersions(await loadValidationVersions());
        setStatus(t("Validation version published."));
      })} />
    </section>}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;
}
