"use client";

import { MetricLibrary } from "./metric-library";
import { listAccessRemoved } from "../app/list-refresh";

import { AuthoringDraftToolbar } from "./authoring-draft-toolbar";

import { FieldHelp } from "./field-help";
import { useUnsavedChanges } from "./unsaved-changes";

import { DefinitionFileImport } from "./definition-file-import";
import { importCanonicalDefinitionFile } from "../app/admin-context";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import { compileMetricLibrary, compileValidationRule, explainValidationRule, filterValidationRuleLibrary, formatValidationSource, reviewPriorityOfRule, validationRuleText, validationRuleValidity,
  type AuthoringVersionOption, type CatalogDefinitionView, type PublishedValidationVersion, type ValidationCatalog,
  type ValidationDraft, type ValidationDraftResult, type ValidationRulePage } from "@open-triage/contracts";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlatformRequestError } from "../app/platform-errors";
import { LoadingStatus } from "./loading-status";
import { activateValidationVersion, cloneValidationVersion, createValidationDraft, deleteValidationDraft, loadCatalogVersions, loadStationaryFormVersions,
  loadValidationDraft, loadValidationVersions, publishValidationDraft,
  createValidationRule, loadActiveCatalogDefinition, loadCatalogVersion, loadValidationRules, saveValidationDraft,
  setValidationRuleEnabled, validateValidationDraft } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { validationTranslationIssues, updateValidationEnglish } from "../app/translation-diagnostics";

function parseMessageParameters(input: string): Record<string, string | number> | null {
  try {
    const value: unknown = JSON.parse(input);
    if (!value || Array.isArray(value) || typeof value !== "object" ||
      Object.values(value).some((parameter) => typeof parameter !== "string" && typeof parameter !== "number")) return null;
    return value as Record<string, string | number>;
  } catch { return null; }
}

export function validationCatalog(definition: CatalogDefinitionView["definition"]): ValidationCatalog {
  return { elements: [...definition.elements.map(({ elementId, label, baseDatatype, storageSemantics, constraints }) => {
      const groupPath = storageSemantics.groupPath;
      return { elementId, label, baseDatatype, groupPath,
        intrinsicOccurrence: { min: constraints.minOccurs, max: constraints.maxOccurs ?? "unbounded" as const } };
    }), ...(definition.customElements ?? []).filter((element) => !element.retired).map((element) => ({
      elementId: `${element.namespace}.${element.slug}`, label: element.title,
      baseDatatype: element.datatype === "number" ? "decimal" : element.datatype === "other" ? "string" : element.datatype,
      groupPath: [element.groupDefinitionId
        ? (() => { const group = definition.customGroups?.find(({ id }) => id === element.groupDefinitionId);
            return group ? `${group.namespace}.${group.slug}` : element.correlatesTo ?? "PatientCareReportGroup"; })()
        : element.correlatesTo ?? "PatientCareReportGroup"],
      intrinsicOccurrence: { min: 0, max: element.recurrence === "single" ? 1 : "unbounded" as const },
    }))],
    codes: [...definition.codeLists.flatMap((list) => list.elementIds.flatMap((elementId) => list.values.map((value) => ({
      elementId, code: value.code, codeSystem: value.codeSystem, label: value.label, enabled: value.enabled,
    })))), ...(definition.customElements ?? []).flatMap((element) => element.datatype === "coded" && !element.retired
      ? element.choices.map((choice) => ({ elementId: `${element.namespace}.${element.slug}`,
        code: choice.code, codeSystem: element.codeSystem, label: choice.label, enabled: true })) : [])] };
}

export function ValidationReferenceAssistance({ catalog, elementId, onElementIdChange, idPrefix = "validation" }: {
  readonly idPrefix?: string;
  readonly catalog: ValidationCatalog;
  readonly elementId: string;
  readonly onElementIdChange: (elementId: string) => void;
}) {
  const t = useAdminText();
  const relevantCodes = (catalog.codes ?? []).filter((code) => code.elementId === elementId && code.enabled !== false);
  return <aside aria-label={t("admin.ruleReferenceAssistance")}>
    <label htmlFor={`${idPrefix}-reference-element`}><AdminText messageKey="admin.elementReference" /></label>
    <select id={`${idPrefix}-reference-element`} value={elementId}
      onChange={(event) => onElementIdChange(event.target.value)}>
      <option value=""><AdminText messageKey="admin.selectAnElement" /></option>
      {elementId && !catalog.elements.some((element) => element.elementId === elementId) &&
        <option value={elementId}>{elementId} {t("admin.notInThis")}</option>}
      {catalog.elements.map((element) =>
        <option key={element.elementId} value={element.elementId}>{element.elementId} — {element.label}</option>)}
    </select>
    <label htmlFor={`${idPrefix}-reference-code`}><AdminText messageKey="admin.codeReferenceFor" /></label>
    <input id={`${idPrefix}-reference-code`} type="search" list={`${idPrefix}-code-references`}
      placeholder="code-system|code" aria-describedby={`${idPrefix}-reference-note`} />
    <datalist id={`${idPrefix}-code-references`}>{relevantCodes.map((code) =>
      <option key={`${code.codeSystem}:${code.code}`} value={`${code.codeSystem}|${code.code}`}>{code.label}</option>)}</datalist>
    <small id={`${idPrefix}-reference-note`}><AdminText messageKey="admin.labelsAreCurrent" /></small>
  </aside>;
}

export type ValidationRuleFilters = { search: string; element: string; source: string; severity: string; reviewPriority: string;
  executionTarget: string; enabled: string; validity: string };

export function ValidationRuleFilterControls({ value, onChange, elements = [] }: {
  readonly value: ValidationRuleFilters;
  readonly onChange: (value: ValidationRuleFilters) => void;
  readonly elements?: ValidationCatalog["elements"];
}) {
  const t = useAdminText();
  const change = (key: keyof ValidationRuleFilters, next: string) => onChange({ ...value, [key]: next });
  return <div className="validation-library-filters" role="search" aria-label={t("admin.filterValidationRules")}>
    <label><AdminText messageKey="admin.search" /> <input type="search" value={value.search} onChange={(event) => change("search", event.target.value)} /></label>
    <label><AdminText messageKey="admin.element" /> <select value={value.element} onChange={(event) => change("element", event.target.value)}>
      <option value=""><AdminText messageKey="admin.allElements" /></option>
      {value.element && !elements.some(({ elementId }) => elementId === value.element) &&
        <option value={value.element}>{value.element}</option>}
      {elements.map((element) => <option key={element.elementId} value={element.elementId}>
        {element.elementId} — {element.label}</option>)}
    </select></label>
    <label><AdminText messageKey="admin.source" /> <select value={value.source} onChange={(event) => change("source", event.target.value)}>
      <option value=""><AdminText messageKey="admin.allSources" /></option><option value="agency"><AdminText messageKey="admin.agency" /></option><option value="nemsis">NEMSIS</option>
      <option value="catalog"><AdminText messageKey="admin.catalog" /></option><option value="form"><AdminText messageKey="admin.form" /></option><option value="platform"><AdminText messageKey="admin.platform" /></option></select></label>
    <label><AdminText messageKey="admin.severity" /> <select value={value.severity} onChange={(event) => change("severity", event.target.value)}>
      <option value=""><AdminText messageKey="admin.allSeverities" /></option><option value="none"><AdminText messageKey="admin.none" /></option><option value="error"><AdminText messageKey="admin.error" /></option><option value="warning"><AdminText messageKey="admin.warning" /></option>
      <option value="information"><AdminText messageKey="admin.information" /></option></select></label>
    <label><AdminText messageKey="admin.reviewPriority" /> <select value={value.reviewPriority} onChange={(event) => change("reviewPriority", event.target.value)}>
      <option value=""><AdminText messageKey="admin.allPriorities" /></option><option value="high"><AdminText messageKey="admin.priorityHigh" /></option>
      <option value="medium"><AdminText messageKey="admin.priorityMedium" /></option><option value="low"><AdminText messageKey="admin.priorityLow" /></option>
      <option value="none"><AdminText messageKey="admin.none" /></option></select></label>
    <label><AdminText messageKey="admin.target" /> <select value={value.executionTarget} onChange={(event) => change("executionTarget", event.target.value)}>
      <option value=""><AdminText messageKey="admin.allTargets" /></option><option value="live"><AdminText messageKey="admin.live" /></option><option value="sign"><AdminText messageKey="admin.sign" /></option>
      <option value="review"><AdminText messageKey="admin.review" /></option></select></label>
    <label><AdminText messageKey="admin.state" /> <select value={value.enabled} onChange={(event) => change("enabled", event.target.value)}>
      <option value=""><AdminText messageKey="admin.anyState" /></option><option value="true"><AdminText messageKey="admin.enabled" /></option><option value="false"><AdminText messageKey="admin.disabled" /></option></select></label>
    <label className="validation-validity-filter"><AdminText messageKey="admin.validity" /> <select value={value.validity} onChange={(event) => change("validity", event.target.value)}>
      <option value=""><AdminText messageKey="admin.anyValidity" /></option><option value="valid"><AdminText messageKey="admin.valid" /></option><option value="invalid"><AdminText messageKey="admin.invalid" /></option>
      <option value="warning"><AdminText messageKey="admin.warning" /></option>
      <option value="wording"><AdminText messageKey="admin.wordingIssues" /></option>
      <option value="missing-english"><AdminText messageKey="admin.missingEnglish" /></option>
      <option value="missing-swedish"><AdminText messageKey="admin.missingSwedish" /></option></select></label>
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
    <summary>{t("admin.showAllIssues", { issues: diagnostics.length, messages: groups.length })}</summary>
    {open && <>
      <ul>{groups.slice(0, limit).map((item, index) => <li key={index}>
        {item.message}{item.count > 1 && <strong> · {t("admin.countOccurrences", { count: item.count })}</strong>}
        {item.ruleIds.length > 0 && <details><summary>{t("admin.affectedRulesCount", { count: item.ruleIds.length })}</summary>
          <p>{item.ruleIds.join(", ")}</p></details>}
      </li>)}</ul>
      {groups.length > limit && <button type="button" onClick={() => setLimit((current) => current + 20)}><AdminText messageKey="admin.showMoreMessages" /></button>}
    </>}
  </details>;
}

export function ValidationResultFeedback({ result, ruleCount, metricCount = 0 }: {
  readonly result: ValidationDraftResult;
  readonly ruleCount: number;
  readonly metricCount?: number;
}) {
  const t = useAdminText();
  const errors = result.diagnostics.filter(({ severity }) => severity === "error");
  const warnings = result.diagnostics.filter(({ severity }) => severity === "warning");
  if (result.valid) return <div className="validation-result" role="status">
    <strong><AdminText messageKey="admin.validationPassed" /></strong> {t("admin.countRulesChecked", { count: ruleCount })}
    {metricCount > 0 && <span> {t("metrics.countChecked", { count: metricCount })}</span>}
    {warnings.length > 0 && <span> {t("admin.countWarnings", { count: warnings.length })}</span>}
    {warnings.length > 0 && <>
      <p><AdminText messageKey="admin.warningsDoNot" /></p>
      <DiagnosticDetails diagnostics={warnings} />
    </>}
    {result.explanation && <details><summary><AdminText messageKey="admin.viewDetails" /></summary>
      {result.explanation && <p className="validation-result-explanation">{result.explanation}</p>}
    </details>}
  </div>;
  return <><div className="validation-result validation-result-error" role="alert">
    <strong>{t("admin.validationFoundCount", { count: errors.length })}</strong>
    <ul>{errors.slice(0, 3).map((item, index) =>
      <li key={`${item.ruleId}:${item.code}:${index}`}>{item.message}</li>)}</ul>
    {errors.length > 3 && <DiagnosticDetails diagnostics={errors} />}
  </div>
    {warnings.length > 0 && <div className="validation-result" role="status">
      <strong>{t("admin.countWarnings", { count: warnings.length })}</strong>
      <p><AdminText messageKey="admin.warningsDoNot" /></p>
      <DiagnosticDetails diagnostics={warnings} />
    </div>}
  </>;
}

export function ValidationAuthoring({ csrfToken, capabilities, catalogReleaseId, onActivated, active = true, language = "sv" }: {
  readonly language?: string;
  readonly csrfToken: string;
  readonly capabilities: readonly string[];
  readonly catalogReleaseId: string;
  readonly onActivated?: () => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const canWrite = capabilities.includes("validation:write");
  const canPublish = capabilities.includes("validation:publish");
  const [draft, setDraft] = useState<ValidationDraft | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [catalogVersions, setCatalogVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedTargetCatalogId, setSelectedTargetCatalogId] = useState("");
  const [formVersions, setFormVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedFormVersionId, setSelectedFormVersionId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const invalidParameters = Object.values(parameterDrafts).some((input) => parseMessageParameters(input) === null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [activationNote, setActivationNote] = useState("");
  const [activationReview, setActivationReview] = useState<{
    validationId: string; formId: string; catalogId: string; note: string;
    rules: ReadonlyArray<{ id: string; name: string }>;
  } | null>(null);
  const activationReviewRef = useRef<HTMLElement>(null);
  const [validation, setValidation] = useState<ValidationDraftResult | null>(null);
  const [published, setPublished] = useState<PublishedValidationVersion | null>(null);
  const [catalog, setCatalog] = useState<ValidationCatalog | null>(null);
  const [hiddenElementIds, setHiddenElementIds] = useState<readonly string[]>([]);
  const [referenceElementId, setReferenceElementId] = useState("");
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [wordingLanguage, setWordingLanguage] = useState<"en" | "sv">("en");
  const [library, setLibrary] = useState<ValidationRulePage | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [loadedLibraryVersion, setLoadedLibraryVersion] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: "", element: "", source: "", severity: "", reviewPriority: "",
    executionTarget: "", enabled: "", validity: "" });
  const libraryVersion = draft ? `${draft.id}:${draft.revision}` : null;
  const visibleRules = useMemo(() => library ? filterValidationRuleLibrary(library.items, filters) : [], [library, filters]);
  const ruleIndexes = useMemo(() => new Map(draft?.rules.map((rule, index) => [rule.id, index])), [draft?.rules]);
  useUnsavedChanges(dirty || !!changeNote || !!displayName || !!activationNote);

  useEffect(() => { activationReviewRef.current?.focus(); }, [activationReview]);

  useEffect(() => {
    if (loaded) return;
    let current = true;
    loadValidationDraft().then(async (value) => {
      const catalogDefinition = value?.catalogReleaseId
        ? await loadCatalogVersion(value.catalogReleaseId) : await loadActiveCatalogDefinition();
      if (current) {
        setDraft(value); setReferenceElementId(value?.rules[0]?.primaryTargetElementId ?? "");
        setCatalog(catalogDefinition ? validationCatalog(catalogDefinition.definition) : null);
        setHiddenElementIds(catalogDefinition?.definition.hiddenElementIds ?? []);
      }
    })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.validationDraftIs")); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [adminError, loaded]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadValidationVersions().then((items) => { if (current) {
      setVersions(items); setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.validationVersionsAre")); });
    return () => { current = false; };
  }, [active, adminError]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadCatalogVersions().then((items) => { if (current) setCatalogVersions(items); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.validationOperationFailed")); });
    return () => { current = false; };
  }, [active, adminError]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadStationaryFormVersions().then((items) => { if (current) setFormVersions(items); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.formVersionsAre")); });
    return () => { current = false; };
  }, [active, adminError]);

  useEffect(() => {
    if (!libraryVersion) return;
    let current = true;
    loadValidationRules({ limit: "all" }).then((page) => { if (current) {
      setLibrary(page); setLoadedLibraryVersion(libraryVersion); setLibraryError(false);
    } })
      .catch((reason: unknown) => { if (current) {
        if (listAccessRemoved(reason)) setLibrary(null);
        setLibraryError(true);
      } });
    return () => { current = false; };
  }, [libraryVersion, libraryRefresh]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(adminError(reason, "admin.validationOperationFailed")); }
    finally { setBusy(false); }
  }
  async function activate(validationId: string, formId: string, catalogId: string, note: string,
    removedRuleIds?: readonly string[]) {
    setActivationReview(null);
    try {
      const activation = await activateValidationVersion(csrfToken, validationId, formId, catalogId, note, removedRuleIds);
      setSelectedVersionId(activation.validationVersionId);
      setDraft(null); setPublished(null); setActivationNote(""); setParameterDrafts({});
      setStatus(t("admin.validationActivatedFor")); onActivated?.();
      setVersions(await loadValidationVersions());
    } catch (reason) {
      if (reason instanceof PlatformRequestError && reason.code === "admin.formValidationRemovalRequired"
        && reason.impactedRules?.length) {
        setActivationReview({ validationId, formId, catalogId, note, rules: reason.impactedRules });
      } else throw reason;
    }
  }
  function changeActivationNote(note: string) {
    setActivationNote(note); setActivationReview(null);
  }
  const activationConfirmation = activationReview && <section role="alertdialog" aria-modal="false"
    aria-labelledby="validation-removal-heading" className="form-remove-confirmation" tabIndex={-1}
    ref={activationReviewRef}>
    <h3 id="validation-removal-heading">{t("admin.formValidationRemovalHeading")}</h3>
    <p>{t("admin.formValidationRemovalExplanation")}</p>
    <p>{t("admin.affectedRulesCount", { count: activationReview.rules.length })}</p>
    <ul style={{ maxHeight: "20rem", overflowY: "auto" }}>{activationReview.rules.map((rule) =>
      <li key={rule.id}>{rule.name}</li>)}</ul>
    <button type="button" disabled={busy || !canPublish || !canWrite} onClick={() => action(() => activate(
      activationReview.validationId, activationReview.formId, activationReview.catalogId, activationReview.note,
      activationReview.rules.map(({ id }) => id)))}>{t("admin.removeRulesAndActivate")}</button>
    <button type="button" disabled={busy} onClick={() => setActivationReview(null)}>{t("admin.cancelActivation")}</button>
  </section>;
  function change(update: (current: ValidationDraft) => ValidationDraft) {
    setDraft((current) => current ? update(current) : current); setDirty(true); setValidation(null); setStatus(t("admin.unsavedChanges2"));
  }
  const selectedRule = draft?.rules[selectedRuleIndex] ?? null;
  const wordingIssues = useMemo(() => draft ? validationTranslationIssues(draft.rules, language === "sv" ? "sv" : "en") : [], [draft, language]);
  function changeRule(update: (rule: ValidationDraft["rules"][number]) => ValidationDraft["rules"][number]) {
    change((current) => ({ ...current, rules: current.rules.map((rule, index) => index === selectedRuleIndex ? update(rule) : rule) }));
  }
  const inlineValidation = useMemo(() => draft && catalog && selectedRule
    ? compileValidationRule(selectedRule, draft.id, catalog, compileMetricLibrary(draft.metrics ?? [], draft.id, catalog).metrics) : null, [draft, catalog, selectedRule]);
  const explanation = inlineValidation?.compiled && catalog ? explainValidationRule(inlineValidation.compiled, catalog) : null;
  const visibleCatalogElements = useMemo(() => {
    const hidden = new Set(hiddenElementIds);
    return catalog?.elements.filter(({ elementId }) => !hidden.has(elementId)) ?? [];
  }, [catalog, hiddenElementIds]);
  const selectedVersion = versions.find(({ id }) => id === selectedVersionId);
  const targetCatalogId = selectedTargetCatalogId || selectedVersion?.catalogReleaseId || catalogReleaseId;
  const activationCatalogId = published?.catalogReleaseId ?? selectedVersion?.catalogReleaseId ?? "";
  const compatibleForms = formVersions.filter(({ catalogReleaseId: id }) => id === activationCatalogId);
  const selectedForm = compatibleForms.find(({ id }) => id === selectedFormVersionId)
    ?? compatibleForms.find(({ status }) => status === "active") ?? compatibleForms[0];
  const formActivationChoice = <div className="authoring-version-row">
    <label htmlFor="validation-activation-form"><AdminText messageKey="admin.stationaryForm" /></label>
    <select id="validation-activation-form" value={selectedForm?.id ?? ""}
      onChange={(event) => { setSelectedFormVersionId(event.target.value); setActivationReview(null); }}
      disabled={busy || compatibleForms.length === 0}>
      {compatibleForms.length === 0 && <option value=""><AdminText messageKey="admin.noCompatiblePublishedForm" /></option>}
      {compatibleForms.map((form) => <option key={form.id} value={form.id}>
        {form.displayName} · v{form.version}{form.status === "active" ? t("admin.active2") : ""}</option>)}
    </select>
  </div>;
  const versionWorkspace = <AuthoringVersionWorkspace title="Validation rules" versions={versions}
    selectedId={selectedVersionId} onSelect={(id) => {
      setSelectedVersionId(id); setSelectedTargetCatalogId(""); setActivationReview(null);
    }} draftName={displayName}
    onDraftNameChange={setDisplayName} canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && !published)}
    canCreateWithoutSource={Boolean(catalogReleaseId)}
    onCreateDraft={() => action(async () => {
      const cloned = selectedVersion
        ? await cloneValidationVersion(csrfToken, selectedVersion.id, targetCatalogId, displayName)
        : await createValidationDraft(csrfToken, targetCatalogId, displayName);
      const definition = await loadCatalogVersion(cloned.catalogReleaseId);
      setCatalog(validationCatalog(definition.definition));
      setHiddenElementIds(definition.definition.hiddenElementIds ?? []);
      setActivationReview(null); setPublished(null); setDraft(cloned); setDisplayName(""); setDirty(false); setParameterDrafts({}); setStatus(t("admin.validationDraftCreated"));
    })}>
    {canPublish && <DefinitionFileImport enabled={loaded && active} kind="validation" busy={busy} hasDraft={Boolean(draft && !published)}
      onImport={(file) => action(async () => {
        const imported = await importCanonicalDefinitionFile(csrfToken, "validation", file, targetCatalogId || undefined);
        setStatus(t("admin.definitionImported"));
        try {
          setVersions(await loadValidationVersions()); setSelectedVersionId(imported.id);
        } catch { setError(t("admin.definitionImportedRefreshFailed")); }
        setSelectedTargetCatalogId(""); setActivationReview(null);
      })} />}
    {canWrite && !draft && catalogVersions.length > 0 && <div className="authoring-version-row">
      <label htmlFor="validation-target-catalog">{language === "sv" ? "Målkatalog" : "Target catalog"}</label>
      <select id="validation-target-catalog" value={targetCatalogId}
        onChange={(event) => setSelectedTargetCatalogId(event.target.value)}>
        {catalogVersions.map((version) => <option key={version.id} value={version.id}>
          {version.displayName} · v{version.version}</option>)}
      </select>
    </div>}
    {selectedVersion && selectedVersion.status !== "active" && canPublish && !draft && !published &&
      <>{formActivationChoice}<AuthoringLifecycleAction title="Selected Validation rules" kind="activate" note={activationNote}
        onNoteChange={changeActivationNote} disabled={busy || !selectedForm} buttonLabel="Activate selected version"
        onSubmit={() => action(async () => {
          if (!selectedForm || !selectedVersion.catalogReleaseId) return;
          await activate(selectedVersion.id, selectedForm.id,
            selectedVersion.catalogReleaseId, activationNote);
        })} /></>}
    <p><AdminText messageKey="admin.ruleScopeHelp" /></p>
  </AuthoringVersionWorkspace>;
  if (!loaded) return <LoadingStatus><AdminText messageKey="admin.loadingValidationDraft" /></LoadingStatus>;
  if (!draft) return <div className="form-empty">
    {versionWorkspace}
    {activationConfirmation}
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </div>;

  if (published) return <div className="form-publication">
    {versionWorkspace}
    <h3>{t("admin.publishedName", { name: published.displayName })}</h3>
    <p>{t("admin.versionVersionAnd", { version: published.version, count: published.ruleIds.length, catalog: published.catalogReleaseId })}</p>
    {formActivationChoice}
    <AuthoringLifecycleAction title="Validation rules" kind="activate" note={activationNote}
      onNoteChange={changeActivationNote} disabled={busy || !canPublish || !selectedForm} buttonLabel={t("admin.activateForClinical")}
      onSubmit={() => action(async () => {
      if (!selectedForm) return;
      await activate(published.id, selectedForm.id, published.catalogReleaseId, activationNote);
    })} />
    {activationConfirmation}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    {versionWorkspace}
    <AuthoringDraftToolbar label={t("admin.validationDraftActions")} busy={busy} dirty={dirty}>
      {canWrite && <button className="button-primary" type="button" disabled={busy || !dirty || invalidParameters} onClick={() => action(async () => {
        const saved = await saveValidationDraft(csrfToken, draft); setDraft(saved); setDirty(false); setParameterDrafts({}); setStatus(`Saved draft revision ${saved.revision}.`);
      })}><AdminText messageKey="admin.saveValidationDraft" /></button>}
      {canWrite && <button className="button-danger" type="button" disabled={busy} onClick={() => {
        if (!window.confirm(`Delete Validation draft ${draft.displayName}? This cannot be undone.`)) return;
        void action(async () => {
          await deleteValidationDraft(csrfToken, draft);
          setDraft(null); setDirty(false); setValidation(null); setLibrary(null); setParameterDrafts({});
          setStatus(t("admin.validationDraftDeleted"));
        });
      }}><AdminText messageKey="admin.deleteDraft" /></button>}
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateValidationDraft(csrfToken, draft.id); setValidation(result);
        setStatus("");
      })}><AdminText messageKey="admin.validateDraft" /></button>
    </AuthoringDraftToolbar>
    <p>{t("admin.draftRevisionRevisionBound", { revision: draft.revision, catalog: draft.catalogReleaseId })}</p>
    <MetricLibrary draft={draft} catalog={catalog} canWrite={canWrite} busy={busy}
      onChange={(metrics) => change((current) => ({ ...current, metrics }))}
      assistance={catalog && <ValidationReferenceAssistance idPrefix="metric" catalog={catalog} elementId={referenceElementId} onElementIdChange={setReferenceElementId} />} />
    <section className="validation-library" aria-labelledby="validation-library-heading">
      <h3 id="validation-library-heading"><AdminText messageKey="admin.ruleLibrary" /></h3>
      <ValidationRuleFilterControls value={filters} elements={visibleCatalogElements}
        onChange={setFilters} />
      {library && loadedLibraryVersion !== libraryVersion && <p role="status">{t("list.refreshRetained")}</p>}
      {libraryError && <><p role="alert">{t("admin.ruleLibraryIs")}{library && ` ${t("list.refreshRetained")}`}</p>
        <button type="button" onClick={() => setLibraryRefresh((value) => value + 1)}>{t("list.retry")}</button></>}
      <p role="status">{library ? `${visibleRules.length} matching rule${visibleRules.length === 1 ? "" : "s"}.` : t("admin.loadingRules")}</p>
      <div className="validation-rule-table-scroll" tabIndex={0} role="region" aria-label={t("admin.validationRules")}><table className="validation-rule-table">
        <caption className="sr-only"><AdminText messageKey="admin.validationRules" /></caption>
        <colgroup>{["name", "element", "source", "severity", "priority", "targets", "state", "validity"].map((column) =>
          <col key={column} className={`validation-rule-${column}-column`} />)}</colgroup>
        <thead><tr><th scope="col"><AdminText messageKey="admin.rule" /></th><th scope="col"><AdminText messageKey="admin.element" /></th>
          <th scope="col"><AdminText messageKey="admin.source" /></th><th scope="col"><AdminText messageKey="admin.severity" /></th><th scope="col"><AdminText messageKey="admin.reviewPriority" /></th><th scope="col"><AdminText messageKey="admin.targets" /></th>
          <th scope="col"><AdminText messageKey="admin.state" /></th><th scope="col"><AdminText messageKey="admin.validity" /></th></tr></thead><tbody>{visibleRules.map((item) => {
        const index = ruleIndexes.get(item.rule.id) ?? -1;
        const validity = validationRuleValidity(item.rule, item.validity !== "invalid", item.diagnostics);
        const validityLabel = t(validity === "invalid" ? "admin.invalid" : validity === "warning" ? "admin.warning" : "admin.valid");
        const issues = [...new Set([
          ...item.diagnostics.map(({ message }) => message),
          ...validationTranslationIssues([item.rule], "sv").map((issue) =>
            `${t(issue.field === "name" ? "admin.nameLanguage" : "admin.messageLanguage", { language: issue.kind === "english" ? "en" : "sv" })}: ${t(issue.message)}`),
        ])];
        const selectRule = () => {
          if (index < 0) return;
          setSelectedRuleIndex(index); setReferenceElementId(item.rule.primaryTargetElementId);
        };
        return <tr key={item.rule.id} className={index === selectedRuleIndex ? "is-selected" : undefined}
          tabIndex={index < 0 ? undefined : 0} aria-disabled={index < 0 ? true : undefined}
          aria-selected={index === selectedRuleIndex}
          aria-label={`${t(canWrite ? "admin.edit" : "admin.viewDetails")}: ${validationRuleText(item.rule, wordingLanguage, "name")}`}
          onClick={(event) => {
            if (index < 0 || (event.target as HTMLElement).closest("button, summary, [data-tooltip-trigger]")) return;
            selectRule();
          }} onKeyDown={(event) => {
            if (event.target !== event.currentTarget || index < 0 || !["Enter", " "].includes(event.key)) return;
            event.preventDefault(); selectRule();
          }}>
          <th scope="row">{validationRuleText(item.rule, wordingLanguage, "name")}</th><td><code>{item.rule.primaryTargetElementId}</code></td>
          <td>{item.source}</td><td>{item.rule.severity}</td><td>{item.rule.executionTargets.includes("review") ? t({ high: "admin.priorityHigh", medium: "admin.priorityMedium", low: "admin.priorityLow", none: "admin.none" }[reviewPriorityOfRule(item.rule)]) : "—"}</td><td>{item.rule.executionTargets.join(", ")}</td>
          <td>{item.rule.enabled ? t("admin.enabled") : t("admin.disabled")}</td><td>
            {issues.length > 0 ? <FieldHelp label={validityLabel} className={`validation-library-status ${validity}`}
              text={issues.join("; ")} /> : validityLabel}</td></tr>;
      })}</tbody></table></div>
      <div className="form-actions">{canWrite && <button type="button" disabled={busy || dirty || !visibleCatalogElements[0]} onClick={() => action(async () => {
          const element = visibleCatalogElements[0]!;
          const updated = await createValidationRule(csrfToken, draft, { name: "New agency rule", enabled: false,
            severity: "warning", executionTargets: ["live"], primaryTargetElementId: element.elementId,
            message: `Review ${element.label}`, source: `require present("${element.elementId}")`, sourceKind: "agency" });
          setDraft(updated); setSelectedRuleIndex(updated.rules.length - 1); setStatus(t("admin.agencyRuleCreated"));
        })}><AdminText messageKey="admin.createAgencyRule" /></button>}</div>
    </section>
    {selectedRule && <fieldset className="validation-rule-editor" disabled={!canWrite}>
      <legend><AdminText messageKey="admin.conditionalValidationRule" /></legend>
      {!!draft.metrics?.length && <details><summary>{t("metrics.references")}</summary>
        <ul>{draft.metrics.map((metric) => <li key={metric.id}>{metric.name} ({metric.unit})
          <pre><code>{`metricAvailable("${metric.id}")\nmetricCompare("${metric.id}", "less-or-equal", 60, "${metric.unit}")`}</code></pre></li>)}</ul>
      </details>}
      {!!selectedRule.unresolved?.length && <label className="validation-rule-row">{t("metrics.unresolved")}<textarea rows={4}
        value={selectedRule.unresolved.join("\n")} onChange={(event) => changeRule((rule) => ({ ...rule, unresolved: event.target.value.split("\n").filter((line) => line.trim()) }))} /></label>}

      <div className="validation-rule-row"><label htmlFor="validation-wording-language"><AdminText messageKey="admin.wordingLanguage" /></label>
        <select id="validation-wording-language" value={wordingLanguage}
          onChange={(event) => setWordingLanguage(event.target.value as "en" | "sv")}>
          <option value="en"><AdminText messageKey="admin.english" /></option><option value="sv"><AdminText messageKey="admin.swedish" /></option>
        </select></div>
      <div className="validation-rule-row"><label htmlFor="validation-rule-name">{t("admin.nameLanguage", { language: wordingLanguage })}</label>
      <input id="validation-rule-name" value={wordingLanguage === "en" ? selectedRule.name : selectedRule.localization?.sv?.name ?? ""}
        onChange={(event) => changeRule((rule) => wordingLanguage === "en" ? updateValidationEnglish(rule, "name", event.target.value) :
          { ...rule, localization: { schemaVersion: 1, ...rule.localization, sv: { ...rule.localization?.sv,
            name: event.target.value, reviewedSource: { ...rule.localization?.sv?.reviewedSource, name: rule.name } } } })} /></div>
      {wordingIssues.filter((issue) => issue.id === selectedRule.id && issue.field === "name").map((issue) =>
        <small role="note" key={issue.kind}>{issue.message}</small>)}
      <div className="validation-rule-row"><label><span><AdminText messageKey="admin.enabled" /></span><input type="checkbox" checked={selectedRule.enabled}
        onChange={(event) => changeRule((rule) => ({ ...rule, enabled: event.target.checked }))} /></label></div>
      <div className="validation-rule-row"><label htmlFor="validation-severity"><AdminText messageKey="admin.severity" /></label>
      <select id="validation-severity" value={selectedRule.severity}
        onChange={(event) => changeRule((rule) => ({ ...rule, severity: event.target.value as typeof rule.severity }))}>
        <option value="none"><AdminText messageKey="admin.none" /></option><option value="error"><AdminText messageKey="admin.error" /></option><option value="warning"><AdminText messageKey="admin.warning" /></option><option value="information"><AdminText messageKey="admin.information" /></option>
      </select></div>
      {selectedRule.executionTargets.includes("review") && <div className="validation-rule-row">
        <label htmlFor="validation-review-priority"><AdminText messageKey="admin.reviewPriority" /></label>
        <select id="validation-review-priority" value={reviewPriorityOfRule(selectedRule)}
          onChange={(event) => changeRule((rule) => ({ ...rule, reviewPriority: event.target.value as "none" | "high" | "medium" | "low" }))}>
          <option value="none"><AdminText messageKey="admin.none" /></option><option value="high"><AdminText messageKey="admin.priorityHigh" /></option>
          <option value="medium"><AdminText messageKey="admin.priorityMedium" /></option>
          <option value="low"><AdminText messageKey="admin.priorityLow" /></option>
        </select></div>}
      <div className="validation-rule-row"><span id="validation-targets-label"><AdminText messageKey="admin.targets" /></span><div role="group" aria-labelledby="validation-targets-label" className="validation-targets">{(["live", "sign", "review"] as const).map((target) => <label key={target}>
        <input type="checkbox" checked={selectedRule.executionTargets.includes(target)} onChange={(event) => changeRule((rule) => ({
          ...rule, executionTargets: event.target.checked ? [...new Set([...rule.executionTargets, target])] : rule.executionTargets.filter((item) => item !== target),
        }))} /> {target}</label>)}</div></div>
      <div className="validation-rule-row"><label htmlFor="validation-element-id"><AdminText messageKey="admin.elementID" /></label>
      <select id="validation-element-id" value={selectedRule.primaryTargetElementId}
        onChange={(event) => changeRule((rule) => ({ ...rule, primaryTargetElementId: event.target.value }))}>
        {!visibleCatalogElements.some(({ elementId }) => elementId === selectedRule.primaryTargetElementId) &&
          <option value={selectedRule.primaryTargetElementId}>{selectedRule.primaryTargetElementId} {t("admin.notInThis")}</option>}
        {visibleCatalogElements.map((element) => <option key={element.elementId} value={element.elementId}>
          {element.elementId} — {element.label}</option>)}
      </select></div>
      {catalog && <details className="validation-reference-details"><summary><AdminText messageKey="admin.elementAndCode" /></summary>
        <ValidationReferenceAssistance catalog={{ ...catalog, elements: visibleCatalogElements,
          codes: catalog.codes?.filter(({ elementId }) => !hiddenElementIds.includes(elementId)) }}
          elementId={referenceElementId || selectedRule.primaryTargetElementId}
          onElementIdChange={setReferenceElementId} /></details>}
      {catalog?.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)?.intrinsicOccurrence && (() => {
        const element = catalog.elements.find(({ elementId }) => elementId === selectedRule.primaryTargetElementId)!;
        return <div className="validation-rule-row"><span><AdminText messageKey="admin.catalogLimits" /></span>
          <FieldHelp text={t("admin.catalogStructureIs")} label={<>{element.intrinsicOccurrence!.min}–{element.intrinsicOccurrence!.max} <AdminText messageKey="admin.occurrences" />
            {element.groupPath?.length ? ` in ${element.groupPath.at(-1)}` : ""}</>} /></div>;
      })()}
      <div className="validation-rule-row"><label htmlFor="validation-message">{t("admin.messageLanguage", { language: wordingLanguage })}</label>
      <input id="validation-message" value={wordingLanguage === "en" ? selectedRule.message : selectedRule.localization?.sv?.message ?? ""}
        onChange={(event) => changeRule((rule) => wordingLanguage === "en" ? updateValidationEnglish(rule, "message", event.target.value) :
          { ...rule, localization: { schemaVersion: 1, ...rule.localization, sv: { ...rule.localization?.sv,
            message: event.target.value, reviewedSource: { ...rule.localization?.sv?.reviewedSource, message: rule.message } } } })} /></div>
      {wordingIssues.filter((issue) => issue.id === selectedRule.id && issue.field === "message").map((issue) =>
        <small role="note" key={issue.kind}>{issue.message}</small>)}
      <div className="validation-rule-row"><label htmlFor="validation-message-parameters"><AdminText messageKey="admin.namedMessageParametersJSON" /></label>
        <textarea id="validation-message-parameters" key={selectedRule.id}
          value={parameterDrafts[selectedRule.id] ?? JSON.stringify(selectedRule.messageParameters ?? {}, null, 2)} rows={3}
          aria-invalid={parameterDrafts[selectedRule.id] !== undefined && parseMessageParameters(parameterDrafts[selectedRule.id]!) === null}
          onChange={(event) => {
            const input = event.target.value;
            setParameterDrafts((current) => ({ ...current, [selectedRule.id]: input }));
            const parameters = parseMessageParameters(input);
            if (parameters) changeRule((rule) => ({ ...rule, messageParameters: parameters }));
            else { setDirty(true); setValidation(null); setStatus(t("admin.unsavedChanges2")); }
          }}
          onBlur={() => setError(invalidParameters ? t("admin.namedMessageParametersMust") : "")} /></div>
      <div className="validation-rule-row validation-source-row"><label htmlFor="validation-source"><FieldHelp label={t("admin.ruleSource")} text={t("admin.useOptionalFor")} /></label>
      <textarea id="validation-source" spellCheck={false} rows={3} value={selectedRule.source}
        onChange={(event) => changeRule((rule) => ({ ...rule, source: event.target.value }))} /></div>
      <div className="form-actions validation-rule-actions">
      <button type="button" onClick={() => {
        const formatted = formatValidationSource(selectedRule.source);
        if (formatted.formatted) changeRule((rule) => ({ ...rule, source: formatted.formatted! }));
      }}><AdminText messageKey="admin.formatRuleSource" /></button>
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const updated = await setValidationRuleEnabled(csrfToken, draft, selectedRule.id, !selectedRule.enabled);
        setDraft(updated); setStatus(selectedRule.enabled ? t("admin.ruleDisabledAnd") : t("admin.ruleRestoredTo"));
      })}>{selectedRule.enabled ? t("admin.disableRule") : t("admin.restoreRule")}</button></div>
    </fieldset>}
    {selectedRule?.provenance?.length ? <details><summary>{t("admin.nemsisProvenanceCount", { count: selectedRule.provenance.length })}</summary>
      {selectedRule.provenance.map((source) => <dl key={`${source.sourceIdentity}:${source.sourceRelease}`}>
        <div><dt><AdminText messageKey="admin.sourceIdentity" /></dt><dd>{source.sourceIdentity}</dd></div>
        <div><dt><AdminText messageKey="admin.release" /></dt><dd>{source.sourceRelease}{source.sourceBuild ? ` (${source.sourceBuild})` : ""}</dd></div>
        <div><dt><AdminText messageKey="admin.originalExpression" /></dt><dd><code>{source.originalExpression}</code></dd></div>
        <div><dt><AdminText messageKey="admin.originalMessage" /></dt><dd>{source.originalMessage}</dd></div>
      </dl>)}</details> : null}
    {inlineValidation && inlineValidation.diagnostics.length > 0 && <div role="alert" aria-label={t("admin.inlineRuleDiagnostics")}><ul>
      {inlineValidation.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>
        {item.line ? `Line ${item.line}, column ${item.column}: ` : ""}{item.message}</li>)}
    </ul></div>}
    {explanation && <details aria-label={t("admin.generatedRuleExplanation")}><summary><AdminText messageKey="admin.explanation" /></summary><p>{explanation}</p></details>}
    {validation && <ValidationResultFeedback result={validation} ruleCount={draft.rules.length} metricCount={draft.metrics?.length} />}

    <section className="form-publication-review">
      {canPublish && <>
        <h3><AdminText messageKey="admin.publicationReview" /></h3>
        <p><AdminText messageKey="admin.publicationCreatesImmutable" /></p>
      </>}
      <label htmlFor="validation-display-name"><AdminText messageKey="admin.validationVersionDisplay" /></label>
      <input id="validation-display-name" disabled={!canWrite} value={draft.displayName}
        onChange={(event) => change((current) => ({ ...current, displayName: event.target.value }))} />
      {canPublish && <AuthoringLifecycleAction title="Validation rules" kind="publish" note={changeNote}
        onNoteChange={setChangeNote} disabled={busy || dirty || !validation?.valid}
        disabledReason={[
          dirty ? t("admin.publicationSaveFirst") : !validation ? t("admin.publicationValidateFirst")
            : !validation.valid ? t("admin.publicationResolveErrors") : "",
          !changeNote.trim() ? t("admin.publicationNoteRequired") : "",
        ].filter(Boolean).join(" ")}
        buttonLabel="Publish immutable Validation version" onSubmit={() => action(async () => {
        const result = await publishValidationDraft(csrfToken, draft, changeNote);
        setPublished(result); setChangeNote(""); setDisplayName(""); setSelectedVersionId(result.id); setVersions(await loadValidationVersions());
        setStatus(t("admin.validationVersionPublished"));
      })} />}
    </section>
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;
}
