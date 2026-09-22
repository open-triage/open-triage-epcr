"use client";

import type { AuthoringVersionOption, CatalogDefinitionView, CatalogDraft, CatalogDraftCodeList, CatalogDraftElement } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { cloneCatalogDraft, loadActiveCatalogDefinition, loadCatalogDraft, loadCatalogVersion, loadCatalogVersions, publishCatalogDraft, saveCatalogDraft, validateCatalogDraft } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";

export function catalogAuthority(capabilities: ReadonlyArray<string>): {
  readonly canRead: boolean; readonly canWrite: boolean; readonly canPublish: boolean;
} {
  const canRead = capabilities.includes("catalog:read");
  const canWrite = canRead && capabilities.includes("catalog:write");
  return { canRead, canWrite, canPublish: canWrite && capabilities.includes("catalog:publish") };
}

export function CatalogAuthoring({ csrfToken, capabilities, onPublished }: {
  readonly csrfToken: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly onPublished?: (catalogReleaseId: string) => void;
}) {
  const { canWrite, canPublish } = catalogAuthority(capabilities);
  const publicationAllowed = canPublish;
  const [draft, setDraft] = useState<CatalogDraft | CatalogDefinitionView | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
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
    loadCatalogVersions().then((items) => { setVersions(items); setSelectedVersionId(items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? ""); })
      .catch(showError);
  }, []);
  useEffect(() => {
    if (!loaded || !selectedVersionId || hasAuthoringDraft) return;
    let current = true;
    loadCatalogVersion(selectedVersionId).then((value) => { if (current) setDraft(value); })
      .catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [loaded, selectedVersionId, hasAuthoringDraft]);
  const visible = useMemo(() => draft?.definition.elements.filter((element) =>
    !draft.definition.hiddenElementIds?.includes(element.elementId) &&
    `${element.elementId} ${element.label}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [draft, query]);
  const listOptions = useMemo(() => draft?.definition.codeLists.flatMap((list) =>
    (list.elementIds.length ? list.elementIds : [list.name])
      .filter((elementId) => !draft.definition.hiddenElementIds?.includes(elementId)).map((elementId) => ({
      key: `${list.listId}\u0000${elementId}`, elementId, list
    }))) ?? [], [draft]);
  const selectedList = listOptions.find(({ key }) => key === selectedListKey)?.list ?? listOptions[0]?.list;

  function showError(reason: unknown) { setError(reason instanceof Error ? reason.message : "Catalog operation failed."); }
  function edit(elementId: string, update: (element: CatalogDraftElement) => CatalogDraftElement) {
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      elements: current.definition.elements.map((element) => element.elementId === elementId ? update(element) : element) } } : current);
    setDirty(true); setStatus("Unsaved changes"); setError("");
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
      setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus("Catalog draft created.");
    })}>
      <p role="note">A published catalog becomes active when you activate a stationary form pinned to it.</p>
    </AuthoringVersionWorkspace>;

  if (!loaded) return <p role="status">Loading catalog draft…</p>;
  if (!draft) return <div className="catalog-empty">
    {versionWorkspace}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  const authoringDraft = "revision" in draft ? draft : null;
  const canEdit = canWrite && authoringDraft !== null;

  return <div className="catalog-editor">
    {versionWorkspace}
    <p>{"revision" in draft ? `Draft revision ${draft.revision}. Stable identity, datatype, and storage semantics are read-only.`
      : canWrite ? `${draft.status === "active" ? "Active" : "Published"} Catalog ${draft.displayName}, version ${draft.version}. Create a draft to edit it.`
        : `${draft.status === "active" ? "Active" : "Published"} Catalog ${draft.displayName}, version ${draft.version}. You have read-only access to this definition.`}</p>
    <section className="catalog-element-editor" aria-labelledby="element-catalog-heading">
    <h3 id="element-catalog-heading">Element catalog</h3>
    <label htmlFor="catalog-search">Find by identifier or label</label>
    <input id="catalog-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="catalog-elements" aria-label={canEdit ? "Editable catalog elements" : "Catalog elements"}>
      <p className="catalog-table-warning" role="note">Requiredness and documented occurrence policy are managed in Validation. Intrinsic occurrence structure is shown here for reference.</p>
      <table>
        <colgroup><col className="catalog-element-column" /><col className="catalog-label-column" />
          <col className="catalog-type-column" />
          <col className="catalog-occurrence-column" /><col className="catalog-occurrence-column" /></colgroup>
        <thead><tr><th>Element</th><th>Label</th><th>Type and storage</th><th>Intrinsic minimum</th><th>Intrinsic maximum</th></tr></thead>
        <tbody>{visible.map((element) => <tr key={element.elementId}>
        <th scope="row">{element.elementId}</th>
        <td><label><span className="visually-hidden">Label for {element.elementId}</span><input disabled={!canEdit} value={element.label}
          onChange={(event) => edit(element.elementId, (value) => ({ ...value, label: event.target.value }))} /></label></td>
        <td>{element.baseDatatype} · {element.storageSemantics.analyticalLocation}</td>
        <td>{element.constraints.minOccurs}</td>
        <td>{element.constraints.maxOccurs ?? "Unbounded"}</td>
      </tr>)}</tbody></table>
    </div>
    </section>
    {draft.definition.codeLists.length > 0 && <section className="code-list-editor" aria-labelledby="code-list-heading">
      <h3 id="code-list-heading">Recommended and agency-maintained code lists</h3>
      <p>Codes remain permanently resolvable after publication. Disable a value to hide it from future selection.</p>
      <label htmlFor="code-list-select">Code list</label>
      <select id="code-list-select" value={selectedListKey || listOptions[0]?.key}
        onChange={(event) => setSelectedListKey(event.target.value)}>
        {listOptions.map(({ key, elementId, list }) => <option key={key} value={key}>{elementId} — {list.name}</option>)}
      </select>
      {selectedList && <CatalogCodeListEditor list={selectedList} readOnly={!canEdit} onChange={editCodeList} />}
    </section>}
    <div className="catalog-actions">
      {canEdit && authoringDraft && <button type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, authoringDraft); setDraft(saved); setDirty(false); setStatus(`Saved revision ${saved.revision}.`);
      })}>Save draft</button>}
      {authoringDraft && <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, authoringDraft.id);
        setStatus(result.valid && result.projectionsVerified ? "Catalog is valid and projections are verified." : result.findings.join("; "));
      })}>Validate</button>}
      <label htmlFor="catalog-display-name">Catalog version display name</label>
      <input id="catalog-display-name" disabled={!canEdit} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus("Unsaved changes"); }} />
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
        ? "Publishing is disabled for this installation. Catalog drafts can still be created, edited, validated, and saved."
        : "Your Catalog access permits draft authoring but not publication or activation."}</p>}
      {authoringDraft && dirty && <p role="status">Save the current draft before publishing.</p>}
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

export function CatalogCodeListEditor({ list, readOnly = false, onChange }: {
  readonly list: CatalogDraftCodeList;
  readonly readOnly?: boolean;
  readonly onChange: (next: CatalogDraftCodeList, announcement: string) => void;
}) {
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
    <fieldset className="code-list-add">
      <legend>Add value</legend>
      <label>Code <input disabled={readOnly} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label>Code system <input disabled={readOnly} value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} /></label>
      <label>Label <input disabled={readOnly} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="button" disabled={readOnly} onClick={addValue}>Add value</button>
    </fieldset>
    <ol aria-label={`${list.name} values`}>
      {list.values.map((value, index) => {
        const key = valueKey(value);
        const isDefault = list.defaultValue ? valueKey(list.defaultValue) === key : false;
        return <li key={key}>
          <div><strong>{value.code}</strong>{value.codeSystem && <small>{value.codeSystem}</small>}</div>
          <label>Label <input disabled={readOnly} aria-label={`Label for ${value.code}`} value={value.label} onChange={(event) => updateValue(index,
            (current) => ({ ...current, label: event.target.value }), `Changed the label for ${value.code}.`)} /></label>
          <label><input disabled={readOnly} type="checkbox" aria-label={`${value.label} enabled`} checked={value.enabled} onChange={(event) => updateValue(index,
            (current) => ({ ...current, enabled: event.target.checked }), `${event.target.checked ? "Enabled" : "Disabled"} ${value.label}.`)} /> Enabled</label>
          <label><input type="radio" name={`${list.listId}-default`} aria-label={`Use ${value.label} as default`} checked={isDefault} disabled={readOnly || !value.enabled}
            onChange={() => {
              onChange({ ...list, defaultValue: { code: value.code, codeSystem: value.codeSystem } },
                `Set ${value.label} as the default.`);
            }} /> Default</label>
          <div className="code-list-order" aria-label={`Reorder ${value.label}`}>
            <button type="button" disabled={readOnly || index === 0} aria-label={`Move ${value.label} up`} onClick={() => onChange(
              moveCodeValue(list, index, index - 1), `Moved ${value.label} up.`)}>Move up</button>
            <button type="button" disabled={readOnly || index === list.values.length - 1} aria-label={`Move ${value.label} down`} onClick={() => onChange(
              moveCodeValue(list, index, index + 1), `Moved ${value.label} down.`)}>Move down</button>
          </div>
        </li>;
      })}
    </ol>
    <button type="button" disabled={readOnly || list.defaultValue === null} onClick={() => onChange({ ...list, defaultValue: null }, "Cleared the code-list default.")}>Clear default</button>
  </div>;
}
