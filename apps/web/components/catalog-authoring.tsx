"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption, CatalogDefinitionView, CatalogDraft, CatalogDraftCodeList, CatalogDraftElement } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { LoadingStatus } from "./loading-status";
import { cloneCatalogDraft, loadActiveCatalogDefinition, loadCatalogDraft, loadCatalogVersion, loadCatalogVersions, publishCatalogDraft, saveCatalogDraft, validateCatalogDraft } from "../app/admin-context";
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
  readonly language?: "en" | "sv";
  readonly csrfToken: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly onPublished?: (catalogReleaseId: string) => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
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
  const hasAuthoringDraft = Boolean(draft && "revision" in draft);
  useEffect(() => {
    const load = async () => canWrite
      ? await loadCatalogDraft() ?? await loadActiveCatalogDefinition()
      : loadActiveCatalogDefinition();
    load().then(setDraft).catch(showError).finally(() => setLoaded(true));
  }, [canWrite]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadCatalogVersions().then((items) => { if (current) {
      setVersions(items);
      setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [active]);
  useEffect(() => {
    if (!loaded || !selectedVersionId || hasAuthoringDraft) return;
    let current = true;
    loadCatalogVersion(selectedVersionId).then((value) => { if (current) setDraft(value); })
      .catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [loaded, selectedVersionId, hasAuthoringDraft]);
  const issues = draft ? catalogTranslationIssues(draft.definition, language) : [];
  const visible = useMemo(() => draft?.definition.elements.filter((element) =>
    !draft.definition.hiddenElementIds?.includes(element.elementId) &&
    (!showMissing || !(editingLanguage === "en" ? element.label : element.localization?.sv?.label)?.trim()) &&
    `${element.elementId} ${element.label} ${element.localization?.sv?.label ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [draft, query, editingLanguage, showMissing]);
  const listOptions = useMemo(() => draft?.definition.codeLists.flatMap((list) =>
    (list.elementIds.length ? list.elementIds : [list.name])
      .filter((elementId) => !draft.definition.hiddenElementIds?.includes(elementId)).map((elementId) => ({
      key: `${list.listId}\u0000${elementId}`, elementId, list
    }))) ?? [], [draft]);
  const selectedList = listOptions.find(({ key }) => key === selectedListKey)?.list ?? listOptions[0]?.list;

  function showError(reason: unknown) { setError(reason instanceof Error ? reason.message : t("Catalog operation failed.")); }
  function edit(elementId: string, update: (element: CatalogDraftElement) => CatalogDraftElement) {
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      elements: current.definition.elements.map((element) => element.elementId === elementId ? update(element) : element) } } : current);
    setDirty(true); setStatus(t("Unsaved changes")); setError("");
  }
  function editCodeList(next: CatalogDraftCodeList, announcement: string) {
    if (draft?.definition.codeLists.find((list) => list.listId === next.listId) === next) {
      setStatus(announcement); setError(""); return;
    }
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      codeLists: current.definition.codeLists.map((list) => list.listId === next.listId ? next : list) } } : current);
    setDirty(true); setStatus(`Unsaved changes. ${announcement}`); setError("");
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
      setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus(t("Catalog draft created."));
    })}>
      <p role="note"><AdminText english="A published catalog becomes active when you activate a stationary form pinned to it." /></p>
    </AuthoringVersionWorkspace>;

  if (!loaded) return <LoadingStatus><AdminText english="Loading catalog draft…" /></LoadingStatus>;
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
    <p>{"revision" in draft ? `Draft revision ${draft.revision}. Stable identity, datatype, and storage semantics are read-only.`
      : canWrite ? `${draft.status === "active" ? t("Active") : t("Published")} Catalog ${draft.displayName}, version ${draft.version}. Create a draft to edit it.`
        : `${draft.status === "active" ? t("Active") : t("Published")} Catalog ${draft.displayName}, version ${draft.version}. You have read-only access to this definition.`}</p>
    <section className="catalog-element-editor" aria-labelledby="element-catalog-heading">
    <h3 id="element-catalog-heading"><AdminText english="Element catalog" /></h3>
    <label htmlFor="catalog-edit-language"><AdminText english="Editing language" /></label>
    <select id="catalog-edit-language" value={editingLanguage} onChange={(event) => { setEditingLanguage(event.target.value as "en" | "sv"); setElementPage(0); }}>
      <option value="en"><AdminText english="English source" /></option><option value="sv"><AdminText english="Swedish translation" /></option>
    </select>
    <TranslationIssueSummary issues={issues} filter={issueFilter} onFilter={setIssueFilter} onNavigate={(issue) => {
      setEditingLanguage(issue.kind === "english" ? "en" : "sv"); setShowMissing(false); setQuery(issue.id); setElementPage(0);
      if (issue.field === "name" || issue.field.includes(" ")) setSelectedListKey(listOptions.find(({ list }) => list.listId === issue.id)?.key ?? "");
      requestAnimationFrame(() => document.getElementById(issue.field === "name" || issue.field.includes(" ") ? "code-list-select" : "catalog-search")?.focus());
    }} />
    <label><input type="checkbox" checked={showMissing} onChange={(event) => { setShowMissing(event.target.checked); setElementPage(0); }} /> {t("Show fields missing {language} labels", { language: t(editingLanguage === "en" ? "English" : "Swedish") })}</label>
    <label htmlFor="catalog-search"><AdminText english="Find by identifier or label" /></label>
    <input id="catalog-search" type="search" value={query} onChange={(event) => {
      setQuery(event.target.value); setElementPage(0);
    }} />
    <div className="catalog-elements" aria-label={t(canEdit ? "Editable catalog elements" : "Catalog elements")}>
      <p className="catalog-table-warning" role="note"><AdminText english="Requiredness and documented occurrence policy are managed in Validation. Intrinsic occurrence structure is shown here for reference." /></p>
      <table>
        <colgroup><col className="catalog-element-column" /><col className="catalog-label-column" />
          <col className="catalog-type-column" />
          <col className="catalog-occurrence-column" /><col className="catalog-occurrence-column" /></colgroup>
        <thead><tr><th><AdminText english="Element" /></th><th><AdminText english="Label and description" /></th><th><AdminText english="Type and storage" /></th><th><AdminText english="Intrinsic minimum" /></th><th><AdminText english="Intrinsic maximum" /></th></tr></thead>
        <tbody>{visible.slice(currentPage * 25, (currentPage + 1) * 25).map((element) => <tr key={element.elementId}>
        <th scope="row">{element.elementId}</th>
        <td>
          <label><span className="visually-hidden">{editingLanguage === "en" ? t("English") : t("Swedish")} label for {element.elementId}</span>
            <input disabled={!canEdit} value={editingLanguage === "en" ? element.label : element.localization?.sv?.label ?? ""}
              onChange={(event) => edit(element.elementId, (value) => editingLanguage === "en"
                ? updateCatalogEnglish(value, "label", event.target.value)
                : { ...value, localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                    label: event.target.value, reviewedSource: { ...value.localization?.sv?.reviewedSource, label: value.label } } } })} />
          </label>
          <label><span className="visually-hidden">{editingLanguage === "en" ? t("English") : t("Swedish")} description for {element.elementId}</span>
            <textarea disabled={!canEdit} value={editingLanguage === "en" ? element.description ?? "" : element.localization?.sv?.description ?? ""}
              onChange={(event) => edit(element.elementId, (value) => editingLanguage === "en"
                ? updateCatalogEnglish(value, "description", event.target.value)
                : { ...value, localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                    description: event.target.value, reviewedSource: { ...value.localization?.sv?.reviewedSource, description: value.description ?? "" } } } })} />
          </label>
          {element.specialChoices?.map((choice) => <label key={`${choice.kind}:${choice.code}`}>
            <span>{choice.kind} {choice.code}</span>
            <input disabled={!canEdit || editingLanguage === "en"}
              aria-label={`Swedish ${choice.kind} label for ${element.elementId} ${choice.code}`}
              value={editingLanguage === "sv" ? choice.localization?.sv?.label ?? "" : choice.label}
              onChange={(event) => edit(element.elementId, (value) => ({ ...value,
                specialChoices: value.specialChoices?.map((item) => item.kind === choice.kind && item.code === choice.code
                  ? { ...item, localization: { schemaVersion: 1, sv: { label: event.target.value,
                    reviewedSource: { label: item.label } } } } : item) }))} />
          </label>)}
          {!(editingLanguage === "en" ? element.label : element.localization?.sv?.label)?.trim() &&
            <small role="note">{t("Missing {language} label; clinical display will use fallback text.", { language: t(editingLanguage === "en" ? "English" : "Swedish") })}</small>}
          {issues.filter((issue) => issue.id === element.elementId).map((issue, index) =>
            <small role="note" key={`${issue.field}:${issue.kind}:${index}`}>{issue.field}: {issue.message}</small>)}
          {editingLanguage === "sv" && element.localization?.sv?.reviewedSource &&
            ((element.localization.sv.label && element.localization.sv.reviewedSource.label !== element.label) ||
              (element.localization.sv.description && element.localization.sv.reviewedSource.description !== (element.description ?? ""))) &&
            <p role="note">{t("English source changed. Review Swedish text.")} {canEdit && <button type="button" onClick={() => edit(element.elementId, (value) => ({ ...value,
              localization: { schemaVersion: 1, sv: { ...value.localization?.sv,
                reviewedSource: { label: value.label, description: value.description ?? "" } } } }))}><AdminText english="Confirm review" /></button>}</p>}
        </td>
        <td>{element.baseDatatype} · {element.storageSemantics.analyticalLocation}</td>
        <td>{element.constraints.minOccurs}</td>
        <td>{element.constraints.maxOccurs ?? t("Unbounded")}</td>
      </tr>)}</tbody></table>
    </div>
    {visible.length > 25 && <nav className="form-actions" aria-label={t("Catalog element pages")}>
      <button type="button" disabled={currentPage === 0} onClick={() => setElementPage(currentPage - 1)}><AdminText english="Previous elements" /></button>
      <span>{t("Page {page} of {pages} · {count} elements", { page: currentPage + 1, pages: Math.ceil(visible.length / 25), count: visible.length })}</span>
      <button type="button" disabled={(currentPage + 1) * 25 >= visible.length}
        onClick={() => setElementPage(currentPage + 1)}><AdminText english="Next elements" /></button>
    </nav>}
    </section>
    {draft.definition.codeLists.length > 0 && <section className="code-list-editor" aria-labelledby="code-list-heading">
      <h3 id="code-list-heading"><AdminText english="Recommended and agency-maintained code lists" /></h3>
      <p><AdminText english="Codes remain permanently resolvable after publication. Disable a value to hide it from future selection." /></p>
      <label htmlFor="code-list-select"><AdminText english="Code list" /></label>
      <select id="code-list-select" value={selectedListKey || listOptions[0]?.key}
        onChange={(event) => setSelectedListKey(event.target.value)}>
        {listOptions.map(({ key, elementId, list }) => <option key={key} value={key}>{elementId} — {list.name}</option>)}
      </select>
      {selectedList && <CatalogCodeListEditor list={selectedList} issues={issues.filter((issue) => issue.id === selectedList.listId)} language={editingLanguage} readOnly={!canEdit} onChange={editCodeList} />}
    </section>}
    <div className="catalog-actions">
      {canEdit && authoringDraft && <button type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, authoringDraft); setDraft(saved); setDirty(false); setStatus(`Saved revision ${saved.revision}.`);
      })}><AdminText english="Save draft" /></button>}
      {authoringDraft && <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, authoringDraft.id);
        setStatus(result.valid && result.projectionsVerified ? `Catalog is valid. ${result.warnings?.length ?? 0} localization warnings.` : result.findings.join("; "));
      })}><AdminText english="Validate" /></button>}
      <label htmlFor="catalog-display-name"><AdminText english="Catalog version display name" /></label>
      <input id="catalog-display-name" disabled={!canEdit} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus(t("Unsaved changes")); }} />
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
        ? t("Publishing is disabled for this installation. Catalog drafts can still be created, edited, validated, and saved.")
        : t("Your Catalog access permits draft authoring but not publication or activation.")}</p>}
      {authoringDraft && dirty && <p role="status"><AdminText english="Save the current draft before publishing." /></p>}
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
    const selected = list.defaultValue && valueKey(list.defaultValue) === valueKey(values[index]!);
    const defaultValue = selected && !values[index]!.enabled ? null : list.defaultValue;
    onChange({ ...list, values, defaultValue }, announcement);
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
    <label>{t("List name")} {t(language === "sv" ? "(Swedish)" : "(English source)")}<input disabled={readOnly || language === "en"}
      value={language === "sv" ? list.localization?.sv?.name ?? "" : list.name}
      onChange={(event) => onChange({ ...list, localization: { schemaVersion: 1, sv: {
        name: event.target.value, reviewedSource: { name: list.name } } } }, `Changed Swedish name for ${list.listId}.`)} /></label>
    {issues.filter((issue) => issue.field === "name").map((issue) => <small role="note" key={issue.kind}>{issue.message}</small>)}
    {language === "sv" && list.localization?.sv?.reviewedSource?.name !== undefined &&
      list.localization.sv.reviewedSource.name !== list.name && <p role="note"><AdminText english="English list name changed. Review Swedish text." />
        <button type="button" disabled={readOnly} onClick={() => onChange({ ...list, localization: { schemaVersion: 1,
          sv: { ...list.localization?.sv, reviewedSource: { name: list.name } } } }, `Reviewed ${list.listId}.`)}><AdminText english="Confirm review" /></button></p>}
    <fieldset className="code-list-add">
      <legend><AdminText english="Add value" /></legend>
      <label><AdminText english="Code" /> <input disabled={readOnly} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label><AdminText english="Code system" /> <input disabled={readOnly} value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} /></label>
      <label><AdminText english="Label" /> <input disabled={readOnly} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="button" disabled={readOnly} onClick={addValue}><AdminText english="Add value" /></button>
    </fieldset>
    <ol aria-label={`${list.name} values`}>
      {list.values.map((value, index) => {
        const key = valueKey(value);
        const isDefault = list.defaultValue ? valueKey(list.defaultValue) === key : false;
        return <li key={key}>
          <div><strong>{value.code}</strong>{value.codeSystem && <small>{value.codeSystem}</small>}</div>
          <label><AdminText english="Label" /> <input disabled={readOnly} aria-label={`${language === "sv" ? t("Swedish") : t("English")} label for ${list.listId} ${value.codeSystem} ${value.code}`}
            value={language === "sv" ? value.localization?.sv?.label ?? "" : value.label} onChange={(event) => updateValue(index,
            (current) => language === "sv" ? { ...current, localization: { schemaVersion: 1,
              sv: { label: event.target.value, reviewedSource: { label: current.label } } } } :
              updateCatalogChoiceEnglish(current, event.target.value), `Changed the ${language === "sv" ? t("Swedish") : t("English")} label for ${value.code}.`)} /></label>
          {issues.filter((issue) => issue.field === `${value.codeSystem} ${value.code}`).map((issue) =>
            <small role="note" key={issue.kind}>{issue.message}</small>)}
          {language === "sv" && !value.localization?.sv?.label?.trim() && <small role="note"><AdminText english="Missing Swedish choice label; English will be shown." /></small>}
          {language === "sv" && value.localization?.sv?.reviewedSource && value.localization.sv.reviewedSource.label !== value.label &&
            <p role="note"><AdminText english="English choice changed. Review Swedish text." /> <button type="button" disabled={readOnly}
              onClick={() => updateValue(index, (current) => ({ ...current, localization: { schemaVersion: 1,
                sv: { ...current.localization?.sv, reviewedSource: { label: current.label } } } }), `Reviewed ${value.code}.`)}><AdminText english="Confirm review" /></button></p>}
          <label><input disabled={readOnly} type="checkbox" aria-label={`${value.label} enabled`} checked={value.enabled} onChange={(event) => updateValue(index,
            (current) => ({ ...current, enabled: event.target.checked }), `${event.target.checked ? t("Enabled") : t("Disabled")} ${value.label}.`)} /> <AdminText english="Enabled" /></label>
          <label><input type="radio" name={`${list.listId}-default`} aria-label={`Use ${value.label} as default`} checked={isDefault} disabled={readOnly || !value.enabled}
            onChange={() => {
              onChange({ ...list, defaultValue: { code: value.code, codeSystem: value.codeSystem } },
                `Set ${value.label} as the default.`);
            }} /> <AdminText english="Default" /></label>
          <div className="code-list-order" aria-label={`Reorder ${value.label}`}>
            <button type="button" disabled={readOnly || index === 0} aria-label={`Move ${value.label} up`} onClick={() => onChange(
              moveCodeValue(list, index, index - 1), `Moved ${value.label} up.`)}><AdminText english="Move up" /></button>
            <button type="button" disabled={readOnly || index === list.values.length - 1} aria-label={`Move ${value.label} down`} onClick={() => onChange(
              moveCodeValue(list, index, index + 1), `Moved ${value.label} down.`)}><AdminText english="Move down" /></button>
          </div>
        </li>;
      })}
    </ol>
    <button type="button" disabled={readOnly || list.defaultValue === null} onClick={() => onChange({ ...list, defaultValue: null }, t("Cleared the code-list default."))}><AdminText english="Clear default" /></button>
  </div>;
}
