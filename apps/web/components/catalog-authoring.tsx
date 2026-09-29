"use client";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption, CatalogDefinitionView, CatalogDraft, CatalogDraftCodeList, CatalogDraftElement, CatalogDraftCustomTextElement } from "@open-triage/contracts";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingStatus } from "./loading-status";
import { cloneCatalogDraft, loadActiveCatalogDefinition, loadCatalogDraft, loadCatalogVersion, loadCatalogVersions, publishCatalogDraft, saveCatalogDraft, deleteCatalogDraft, validateCatalogDraft } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { catalogTranslationIssues, updateCatalogEnglish, updateCatalogChoiceEnglish, type TranslationIssue } from "../app/translation-diagnostics";
import { TranslationIssueSummary } from "./translation-issue-summary";

export function catalogAuthority(capabilities: ReadonlyArray<string>): {
  readonly canRead: boolean; readonly canWrite: boolean; readonly canPublish: boolean;
} {
  const canRead = capabilities.includes("catalog:read");
  const canWrite = canRead && capabilities.includes("catalog:write");
  return { canRead, canWrite, canPublish: canWrite && capabilities.includes("catalog:publish") };
}

export function CatalogAuthoring({ csrfToken, capabilities, onPublished, active = true, language = "sv" }: {
  readonly language?: string;
  readonly csrfToken: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly onPublished?: (catalogReleaseId: string) => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const { canWrite, canPublish } = catalogAuthority(capabilities);
  const publicationAllowed = canPublish;
  const [draft, setDraft] = useState<CatalogDraft | CatalogDefinitionView | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [editingLanguage, setEditingLanguage] = useState<"en" | "sv">("en");
  const [showMissing, setShowMissing] = useState(false);
  const [issueFilter, setIssueFilter] = useState("all");
  const [elementPage, setElementPage] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedListKey, setSelectedListKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [customText, setCustomText] = useState({ namespace: "", slug: "", title: "", definition: "",
    swedishTitle: "", swedishDefinition: "", usage: "Optional" as CatalogDraftCustomTextElement["usage"],
    identifying: "", minLength: "", maxLength: "", pattern: "" });
  const hasAuthoringDraft = Boolean(draft && "revision" in draft);
  const showError = useCallback((reason: unknown) => { setError(adminError(reason, "admin.catalogOperationFailed")); }, [adminError]);
  useEffect(() => {
    const load = async () => canWrite
      ? await loadCatalogDraft() ?? await loadActiveCatalogDefinition()
      : loadActiveCatalogDefinition();
    load().then(setDraft).catch(showError).finally(() => setLoaded(true));
  }, [canWrite, showError]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadCatalogVersions().then((items) => { if (current) {
      setVersions(items);
      setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [active, showError]);
  useEffect(() => {
    if (!loaded || !selectedVersionId || hasAuthoringDraft) return;
    let current = true;
    loadCatalogVersion(selectedVersionId).then((value) => { if (current) setDraft(value); })
      .catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [loaded, selectedVersionId, hasAuthoringDraft, showError]);
  const issues = draft ? catalogTranslationIssues(draft.definition, language === "sv" ? "sv" : "en") : [];
  const visible = useMemo(() => draft?.definition.elements.filter((element) =>
    !draft.definition.hiddenElementIds?.includes(element.elementId) &&
    (!showMissing || !(editingLanguage === "en" ? element.label : element.localization?.sv?.label)?.trim()) &&
    `${element.elementId} ${element.label} ${element.localization?.sv?.label ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [draft, query, editingLanguage, showMissing]);
  const listOptions = useMemo(() => {
    if (!draft) return [];
    const options: { key: string; elementId: string; list?: CatalogDraftCodeList }[] = draft.definition.codeLists.flatMap((list) =>
      (list.elementIds.length ? list.elementIds : [list.name])
        .filter((elementId) => !draft.definition.hiddenElementIds?.includes(elementId))
        .map((elementId) => ({ key: `${list.listId}\u0000${elementId}`, elementId, list })));
    for (const element of draft.definition.elements) {
      if (!draft.definition.hiddenElementIds?.includes(element.elementId) &&
        element.specialChoices?.length &&
        !options.some((option) => option.elementId === element.elementId)) {
        options.push({ key: `special\u0000${element.elementId}`, elementId: element.elementId });
      }
    }
    return options;
  }, [draft]);
  const selectedOption = listOptions.find(({ key }) => key === selectedListKey) ?? listOptions[0];
  const selectedList = selectedOption?.list;
  const selectedElement = draft?.definition.elements.find((element) => element.elementId === selectedOption?.elementId);

  function edit(elementId: string, update: (element: CatalogDraftElement) => CatalogDraftElement) {
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      elements: current.definition.elements.map((element) => element.elementId === elementId ? update(element) : element) } } : current);
    setDirty(true); setStatus(t("admin.unsavedChanges")); setError("");
  }
  function editCodeList(next: CatalogDraftCodeList, announcement: string) {
    if (draft?.definition.codeLists.find((list) => list.listId === next.listId) === next) {
      setStatus(announcement); setError(""); return;
    }
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      codeLists: current.definition.codeLists.map((list) => list.listId === next.listId ? next : list) } } : current);
    setDirty(true); setStatus(`Unsaved changes. ${announcement}`); setError("");
  }
  function addCustomText() {
    if (!draft || !canWrite || !("revision" in draft)) return;
    const namespace = customText.namespace.trim(); const slug = customText.slug.trim();
    if (!namespace || !slug || !customText.title.trim() || !customText.definition.trim() || !customText.identifying) {
      setError(t("admin.customMissingDetails")); return;
    }
    if (draft.definition.customElements?.some((item) => item.namespace === namespace && item.slug === slug)) {
      setError(t("admin.customDuplicateIdentity")); return;
    }
    const element: CatalogDraftCustomTextElement = { id: crypto.randomUUID(), namespace, slug,
      title: customText.title.trim(), definition: customText.definition.trim(), datatype: "string", recurrence: "single",
      usage: customText.usage, identifying: customText.identifying === "yes",
      constraints: { ...(customText.minLength ? { minLength: Number(customText.minLength) } : {}),
        ...(customText.maxLength ? { maxLength: Number(customText.maxLength) } : {}),
        ...(customText.pattern ? { pattern: customText.pattern } : {}) },
      ...(customText.swedishTitle.trim() ? { localization: { schemaVersion: 1, sv: {
        label: customText.swedishTitle.trim(), description: customText.swedishDefinition.trim(),
        reviewedSource: { label: customText.title.trim(), description: customText.definition.trim() } } } } : {}) };
    setDraft({ ...draft, definition: { ...draft.definition,
      customElements: [...(draft.definition.customElements ?? []), element] } });
    setDirty(true); setError(""); setStatus(t("admin.customAdded", { identity: `${namespace}.${slug}` }));
    setCustomText({ namespace: "", slug: "", title: "", definition: "", swedishTitle: "", swedishDefinition: "",
      usage: "Optional", identifying: "", minLength: "", maxLength: "", pattern: "" });
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  const versionWorkspace = <AuthoringVersionWorkspace title="Catalog" versions={versions} selectedId={selectedVersionId}
    onSelect={setSelectedVersionId} draftName={newDisplayName} onDraftNameChange={setNewDisplayName}
    canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && "revision" in draft)}
    onCreateDraft={() => action(async () => {
      const cloned = await cloneCatalogDraft(csrfToken, newDisplayName, selectedVersionId);
      setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus(t("admin.catalogDraftCreated"));
    })}>
      <p role="note"><AdminText messageKey="admin.publishedCatalogActivatedWithForm" /></p>
    </AuthoringVersionWorkspace>;

  if (!loaded) return <LoadingStatus><AdminText messageKey="admin.loadingCatalogDraft" /></LoadingStatus>;
  if (!draft) return <div className="catalog-empty">
    {versionWorkspace}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  const authoringDraft = "revision" in draft ? draft : null;
  const canEdit = canWrite && authoringDraft !== null;
  const currentPage = Math.min(elementPage, Math.max(0, Math.ceil(visible.length / 25) - 1));

  return <div className="catalog-editor">
    {versionWorkspace}
    <section aria-labelledby="custom-text-heading">
      <h3 id="custom-text-heading">{t("admin.customTextElements")}</h3>
      <ul>{(draft.definition.customElements ?? []).map((item) => <li key={item.id}>
        <strong>{item.namespace}.{item.slug} — {language === "sv" ? item.localization?.sv?.label || item.title : item.title}</strong>
        {` (${item.usage}; ${t("admin.customIdentifying")}: ${t(item.identifying ? "admin.customYes" : "admin.customNo")})`}
        <p>{item.definition}</p>
      </li>)}</ul>
      {canEdit && <fieldset disabled={busy}>
        <legend>{t("admin.createStandaloneText")}</legend>
        <label>{t("admin.customNamespace")} <input required value={customText.namespace} placeholder="org.example.ems"
          onChange={(event) => setCustomText({ ...customText, namespace: event.target.value })} /></label>
        <label>{t("admin.customIdentifier")} <input required value={customText.slug} placeholder="LocalNote"
          onChange={(event) => setCustomText({ ...customText, slug: event.target.value })} /></label>
        <label>{t("admin.customEnglishTitle")} <input required maxLength={100} value={customText.title}
          onChange={(event) => setCustomText({ ...customText, title: event.target.value })} /></label>
        <label>{t("admin.customEnglishDefinition")} <textarea required maxLength={255} value={customText.definition}
          onChange={(event) => setCustomText({ ...customText, definition: event.target.value })} /></label>
        <label>{t("admin.customSwedishTitle")} <input maxLength={100} value={customText.swedishTitle}
          onChange={(event) => setCustomText({ ...customText, swedishTitle: event.target.value })} /></label>
        <label>{t("admin.customSwedishDefinition")} <textarea maxLength={255} value={customText.swedishDefinition}
          onChange={(event) => setCustomText({ ...customText, swedishDefinition: event.target.value })} /></label>
        <label>{t("admin.customUsage")} <select value={customText.usage} onChange={(event) => setCustomText({ ...customText,
          usage: event.target.value as CatalogDraftCustomTextElement["usage"] })}>
          {["Optional", "Recommended", "Required", "Mandatory"].map((usage) => <option key={usage}>{usage}</option>)}
        </select></label>
        <label>{t("admin.customIdentifying")} <select required value={customText.identifying}
          onChange={(event) => setCustomText({ ...customText, identifying: event.target.value })}>
          <option value="">{t("admin.customChooseClassification")}</option><option value="yes">{t("admin.customYes")}</option><option value="no">{t("admin.customNo")}</option>
        </select></label>
        <label>{t("admin.customMinimumLength")} <input type="number" min="0" value={customText.minLength}
          onChange={(event) => setCustomText({ ...customText, minLength: event.target.value })} /></label>
        <label>{t("admin.customMaximumLength")} <input type="number" min="0" value={customText.maxLength}
          onChange={(event) => setCustomText({ ...customText, maxLength: event.target.value })} /></label>
        <label>{t("admin.customPattern")} <input value={customText.pattern}
          onChange={(event) => setCustomText({ ...customText, pattern: event.target.value })} /></label>
        <button type="button" onClick={addCustomText}>{t("admin.customAddText")}</button>
      </fieldset>}
    </section>
    <p>{"revision" in draft ? `Draft revision ${draft.revision}. Stable identity, datatype, and storage semantics are read-only.`
      : canWrite ? `${draft.status === "active" ? t("admin.active") : t("admin.published")} Catalog ${draft.displayName}, version ${draft.version}. Create a draft to edit it.`
        : `${draft.status === "active" ? t("admin.active") : t("admin.published")} Catalog ${draft.displayName}, version ${draft.version}. You have read-only access to this definition.`}</p>
    <section className="catalog-element-editor" aria-labelledby="element-catalog-heading">
    <h3 id="element-catalog-heading"><AdminText messageKey="admin.elementCatalog" /></h3>
    <label htmlFor="catalog-edit-language"><AdminText messageKey="admin.editingLanguage" /></label>
    <select id="catalog-edit-language" value={editingLanguage} onChange={(event) => { setEditingLanguage(event.target.value as "en" | "sv"); setElementPage(0); }}>
      <option value="en"><AdminText messageKey="admin.englishSource" /></option><option value="sv"><AdminText messageKey="admin.swedishTranslation" /></option>
    </select>
    <TranslationIssueSummary issues={issues} filter={issueFilter} onFilter={setIssueFilter} onNavigate={(issue) => {
      setEditingLanguage(issue.kind === "english" ? "en" : "sv"); setShowMissing(false); setQuery(issue.id); setElementPage(0);
      if (issue.field === "name" || issue.field.includes(" ")) setSelectedListKey(listOptions.find(({ list, elementId }) => issue.field.startsWith("pertinent-negative ") || issue.field.startsWith("not-value ") ? elementId === issue.id : list?.listId === issue.id)?.key ?? "");
      requestAnimationFrame(() => document.getElementById(issue.field === "name" || issue.field.includes(" ") ? "code-list-select" : "catalog-search")?.focus());
    }} />
    <label><input type="checkbox" checked={showMissing} onChange={(event) => { setShowMissing(event.target.checked); setElementPage(0); }} /> {t("admin.showFieldsMissing", { language: t(editingLanguage === "en" ? "English" : "Swedish") })}</label>
    <label htmlFor="catalog-search"><AdminText messageKey="admin.findByIdentifierOr" /></label>
    <input id="catalog-search" type="search" value={query} onChange={(event) => {
      setQuery(event.target.value); setElementPage(0);
    }} />
    <div className="catalog-elements" aria-label={t(canEdit ? "Editable catalog elements" : "Catalog elements")}>
      <p className="catalog-table-warning" role="note"><AdminText messageKey="admin.requirednessAndDocumented" /></p>
      <table>
        <colgroup><col className="catalog-element-column" /><col className="catalog-label-column" />
          <col className="catalog-type-column" /></colgroup>
        <thead><tr><th><AdminText messageKey="admin.element" /></th><th><AdminText messageKey="admin.labelAndDescription" /></th><th><AdminText messageKey="admin.typeAndStorage" /></th></tr></thead>
        <tbody>{visible.slice(currentPage * 25, (currentPage + 1) * 25).map((element) => <tr key={element.elementId}>
        <th scope="row">{element.elementId}</th>
        <td>
          <label><span className="visually-hidden">{t("admin.languageLabelFor", { language: t(editingLanguage === "en" ? "English" : "Swedish"), id: element.elementId })}</span>
            <input disabled={!canEdit} value={editingLanguage === "en" ? element.label : element.localization?.sv?.label ?? ""}
              onChange={(event) => edit(element.elementId, (value) => editingLanguage === "en"
                ? updateCatalogEnglish(value, "label", event.target.value)
                : { ...value, localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                    label: event.target.value, reviewedSource: { ...value.localization?.sv?.reviewedSource, label: value.label } } } })} />
          </label>
          <label><span className="visually-hidden">{t("admin.languageDescriptionFor", { language: t(editingLanguage === "en" ? "English" : "Swedish"), id: element.elementId })}</span>
            <textarea disabled={!canEdit} value={editingLanguage === "en" ? element.description ?? "" : element.localization?.sv?.description ?? ""}
              onChange={(event) => edit(element.elementId, (value) => editingLanguage === "en"
                ? updateCatalogEnglish(value, "description", event.target.value)
                : { ...value, localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                    description: event.target.value, reviewedSource: { ...value.localization?.sv?.reviewedSource, description: value.description ?? "" } } } })} />
          </label>
          {!(editingLanguage === "en" ? element.label : element.localization?.sv?.label)?.trim() &&
            <small role="note">{t("Missing {language} label; clinical display will use fallback text.", { language: t(editingLanguage === "en" ? "English" : "Swedish") })}</small>}
          {issues.filter((issue) => issue.id === element.elementId && !issue.field.startsWith("pertinent-negative ") && !issue.field.startsWith("not-value ")).map((issue, index) =>
            <small role="note" key={`${issue.field}:${issue.kind}:${index}`}>{issue.field}: {issue.message}</small>)}
          {editingLanguage === "sv" && element.localization?.sv?.reviewedSource &&
            ((element.localization.sv.label && element.localization.sv.reviewedSource.label !== element.label) ||
              (element.localization.sv.description && element.localization.sv.reviewedSource.description !== (element.description ?? ""))) &&
            <p role="note">{t("admin.englishSourceChangedReviewSwedishText")} {canEdit && <button type="button" onClick={() => edit(element.elementId, (value) => ({ ...value,
              localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                reviewedSource: { label: value.label, description: value.description ?? "" } } } }))}><AdminText messageKey="admin.confirmReview" /></button>}</p>}
        </td>
        <td>{element.baseDatatype} · {element.storageSemantics.analyticalLocation}</td>
      </tr>)}</tbody></table>
    </div>
    {visible.length > 25 && <nav className="form-actions" aria-label={t("admin.catalogElementPages")}>
      <button type="button" disabled={currentPage === 0} onClick={() => setElementPage(currentPage - 1)}><AdminText messageKey="admin.previousElements" /></button>
      <span>{t("admin.pagePageOf", { page: currentPage + 1, pages: Math.ceil(visible.length / 25), count: visible.length })}</span>
      <button type="button" disabled={(currentPage + 1) * 25 >= visible.length}
        onClick={() => setElementPage(currentPage + 1)}><AdminText messageKey="admin.nextElements" /></button>
    </nav>}
    </section>
    {listOptions.length > 0 && <section className="code-list-editor" aria-labelledby="code-list-heading">
      <h3 id="code-list-heading"><AdminText messageKey="admin.recommendedAndAgency" /></h3>
      <p><AdminText messageKey="admin.codesRemainPermanently" /></p>
      <label htmlFor="code-list-select"><AdminText messageKey="admin.codeList" /></label>
      <select id="code-list-select" value={selectedOption?.key}
        onChange={(event) => setSelectedListKey(event.target.value)}>
        {listOptions.map(({ key, elementId, list }) => <option key={key} value={key}>{elementId} — {list?.name ?? t("admin.specialValues")}</option>)}
      </select>
      {selectedElement?.specialChoices?.length && <fieldset>
        <legend><AdminText messageKey="admin.specialValues" /></legend>
        {selectedElement.specialChoices.map((choice) => <label key={`${choice.kind}:${choice.code}`}>
          <span>{choice.kind === "pertinent-negative" ? "PN" : "NV"} {choice.code}</span>
          <input disabled={!canEdit || editingLanguage === "en"}
            aria-label={`${t(editingLanguage === "sv" ? "admin.swedish" : "admin.english")} ${choice.kind === "pertinent-negative" ? "PN" : "NV"} ${selectedElement.elementId} ${choice.code}`}
            value={editingLanguage === "sv" ? choice.localization?.sv?.label ?? "" : choice.label}
            onChange={(event) => edit(selectedElement.elementId, (value) => ({ ...value,
              specialChoices: value.specialChoices?.map((item) => item.kind === choice.kind && item.code === choice.code
                ? { ...item, localization: { schemaVersion: 1, sv: { label: event.target.value,
                  reviewedSource: { label: item.label } } } } : item) }))} />
          {issues.filter((issue) => issue.id === selectedElement.elementId && issue.field === `${choice.kind} ${choice.code}`).map((issue) =>
            <small role="note" key={issue.kind}>{issue.message}</small>)}
        </label>)}
      </fieldset>}
      {selectedList && <CatalogCodeListEditor list={selectedList} issues={issues.filter((issue) => issue.id === selectedList.listId)} language={editingLanguage} readOnly={!canEdit} onChange={editCodeList} />}
    </section>}
    <div className="catalog-actions">
      {canEdit && authoringDraft && <button type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, authoringDraft); setDraft(saved); setDirty(false); setStatus(`Saved revision ${saved.revision}.`);
      })}><AdminText messageKey="admin.saveDraft" /></button>}
      {canEdit && authoringDraft && <button type="button" disabled={busy} onClick={() => {
        if (!window.confirm(t("admin.deleteCatalogDraftConfirm"))) return;
        void action(async () => {
          await deleteCatalogDraft(csrfToken, authoringDraft);
          const [activeCatalog, items] = await Promise.all([loadActiveCatalogDefinition(), loadCatalogVersions()]);
          setDraft(activeCatalog); setVersions(items); setDirty(false); setNote("");
          setSelectedVersionId(items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
          setStatus(t("admin.catalogDraftDeleted"));
        });
      }}><AdminText messageKey="admin.deleteCatalogDraft" /></button>}
      {authoringDraft && <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, authoringDraft.id);
        setStatus(result.valid && result.projectionsVerified ? `Catalog is valid. ${result.warnings?.length ?? 0} localization warnings.` : result.findings.join("; "));
      })}><AdminText messageKey="admin.validate" /></button>}
      <label htmlFor="catalog-display-name"><AdminText messageKey="admin.catalogVersionDisplay" /></label>
      <input id="catalog-display-name" disabled={!canEdit} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus(t("admin.unsavedChanges")); }} />
      {publicationAllowed && authoringDraft ? <>
        <AuthoringLifecycleAction title="Catalog" kind="publish" note={note} onNoteChange={setNote}
          disabled={busy || dirty || !draft.displayName?.trim()}
          buttonLabel="Publish immutable catalog" onSubmit={() => action(async () => {
            const published = await publishCatalogDraft(csrfToken, authoringDraft, authoringDraft.displayName!, note);
            onPublished?.(published.id);
            setDraft(null); setDirty(false); setNote(""); setStatus(`Published ${published.displayName}.`);
            const items = await loadCatalogVersions(); setVersions(items); setSelectedVersionId(published.id);
          })} />
      </> : canEdit && <p role="note">{canPublish
        ? t("admin.publishingIsDisabledForThisInstallationCatalog")
        : t("admin.catalogDraftOnlyAccess")}</p>}
      {authoringDraft && dirty && <p role="status"><AdminText messageKey="admin.saveTheCurrent" /></p>}
    </div>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}

export function moveCodeValue(list: CatalogDraftCodeList, from: number, to: number): CatalogDraftCodeList {
  if (from < 0 || from >= list.values.length || to < 0 || to >= list.values.length || from === to) return list;
  const values = [...list.values];
  const [moving] = values.splice(from, 1);
  values.splice(to, 0, moving!);
  return { ...list, values };
}

export function CatalogCodeListEditor({ list, issues = [], language = "en", readOnly = false, onChange }: {
  readonly issues?: ReadonlyArray<TranslationIssue>;
  readonly list: CatalogDraftCodeList;
  readonly readOnly?: boolean;
  readonly language?: "en" | "sv";
  readonly onChange: (next: CatalogDraftCodeList, announcement: string) => void;
}) {
  const t = useAdminText();
  const [code, setCode] = useState("");
  const [codeSystem, setCodeSystem] = useState("");
  const [label, setLabel] = useState("");
  const valueKey = (value: { code: string; codeSystem: string }) => `${value.codeSystem}\u0000${value.code}`;

  function updateValue(index: number, update: (value: CatalogDraftCodeList["values"][number]) => CatalogDraftCodeList["values"][number], announcement: string) {
    const values = list.values.map((value, valueIndex) => valueIndex === index ? update(value) : value);
    onChange({ ...list, values }, announcement);
  }

  function addValue() {
    const nextCode = code.trim(); const nextSystem = codeSystem.trim(); const nextLabel = label.trim();
    if (!nextCode || !nextLabel) return onChange(list, "A code and label are required.");
    if (list.values.some((value) => value.code === nextCode && value.codeSystem === nextSystem))
      return onChange(list, `Duplicate code ${nextCode} was not added.`);
    onChange({ ...list, values: [{ code: nextCode, codeSystem: nextSystem, label: nextLabel,
      sourceLabel: nextLabel, category: null, enabled: true }, ...list.values] },
    `Added ${nextLabel}. Save, validate, and publish the catalog before creating the form.`);
    setCode(""); setCodeSystem(""); setLabel("");
  }

  return <div className="code-list-values">
    <label>{t("admin.listName")} {t(language === "sv" ? "(Swedish)" : "(English source)")}<input disabled={readOnly || language === "en"}
      value={language === "sv" ? list.localization?.sv?.name ?? "" : list.name}
      onChange={(event) => onChange({ ...list, localization: { schemaVersion: 1, sv: {
        name: event.target.value, reviewedSource: { name: list.name } } } }, `Changed Swedish name for ${list.listId}.`)} /></label>
    {issues.filter((issue) => issue.field === "name").map((issue) => <small role="note" key={issue.kind}>{issue.message}</small>)}
    {language === "sv" && list.localization?.sv?.reviewedSource?.name !== undefined &&
      list.localization.sv.reviewedSource.name !== list.name && <p role="note"><AdminText messageKey="admin.englishListName" />
        <button type="button" disabled={readOnly} onClick={() => onChange({ ...list, localization: { schemaVersion: 1,
          sv: { ...list.localization?.sv, reviewedSource: { name: list.name } } } }, `Reviewed ${list.listId}.`)}><AdminText messageKey="admin.confirmReview" /></button></p>}
    <fieldset className="code-list-add">
      <legend><AdminText messageKey="admin.addValue" /></legend>
      <label><AdminText messageKey="admin.code" /> <input disabled={readOnly} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label><AdminText messageKey="admin.codeSystem" /> <input disabled={readOnly} value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} /></label>
      <label><AdminText messageKey="admin.label" /> <input disabled={readOnly} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="button" disabled={readOnly} onClick={addValue}><AdminText messageKey="admin.addValue" /></button>
    </fieldset>
    <ol aria-label={`${list.name} values`}>
      {list.values.map((value, index) => {
        const key = valueKey(value);
        return <li key={key}>
          <div><strong>{value.code}</strong>{value.codeSystem && <small>{value.codeSystem}</small>}</div>
          <label><AdminText messageKey="admin.label" /> <input disabled={readOnly} aria-label={`${language === "sv" ? t("admin.swedish") : t("admin.english")} label for ${list.listId} ${value.codeSystem} ${value.code}`}
            value={language === "sv" ? value.localization?.sv?.label ?? "" : value.label} onChange={(event) => updateValue(index,
            (current) => language === "sv" ? { ...current, localization: { schemaVersion: 1,
              sv: { label: event.target.value, reviewedSource: { label: current.label } } } } :
              updateCatalogChoiceEnglish(current, event.target.value), `Changed the ${language === "sv" ? t("admin.swedish") : t("admin.english")} label for ${value.code}.`)} /></label>
          {issues.filter((issue) => issue.field === `${value.codeSystem} ${value.code}`).map((issue) =>
            <small role="note" key={issue.kind}>{issue.message}</small>)}
          {language === "sv" && !value.localization?.sv?.label?.trim() && <small role="note"><AdminText messageKey="admin.missingSwedishChoice" /></small>}
          {language === "sv" && value.localization?.sv?.reviewedSource && value.localization.sv.reviewedSource.label !== value.label &&
            <p role="note"><AdminText messageKey="admin.englishChoiceChanged" /> <button type="button" disabled={readOnly}
              onClick={() => updateValue(index, (current) => ({ ...current, localization: { schemaVersion: 1,
                sv: { ...current.localization?.sv, reviewedSource: { label: current.label } } } }), `Reviewed ${value.code}.`)}><AdminText messageKey="admin.confirmReview" /></button></p>}
          <label><input disabled={readOnly} type="checkbox" aria-label={`${value.label} enabled`} checked={value.enabled} onChange={(event) => updateValue(index,
            (current) => ({ ...current, enabled: event.target.checked }), `${event.target.checked ? t("admin.enabled") : t("admin.disabled")} ${value.label}.`)} /> <AdminText messageKey="admin.enabled" /></label>
          <div className="code-list-order" aria-label={`Reorder ${value.label}`}>
            <button type="button" disabled={readOnly || index === 0} aria-label={`Move ${value.label} up`} onClick={() => onChange(
              moveCodeValue(list, index, index - 1), `Moved ${value.label} up.`)}><AdminText messageKey="admin.moveUp" /></button>
            <button type="button" disabled={readOnly || index === list.values.length - 1} aria-label={`Move ${value.label} down`} onClick={() => onChange(
              moveCodeValue(list, index, index + 1), `Moved ${value.label} down.`)}><AdminText messageKey="admin.moveDown" /></button>
          </div>
        </li>;
      })}
    </ol>
  </div>;
}
