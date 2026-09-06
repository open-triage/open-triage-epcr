"use client";

import type { CatalogDraft, CatalogDraftCodeList, CatalogDraftElement } from "@open-triage/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { cloneCatalogDraft, loadCatalogDraft, publishCatalogDraft, saveCatalogDraft, validateCatalogDraft } from "../app/admin-context";

export function CatalogAuthoring({ csrfToken }: { readonly csrfToken: string }) {
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedListId, setSelectedListId] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { loadCatalogDraft(csrfToken).then(setDraft).catch(showError).finally(() => setLoaded(true)); }, [csrfToken]);
  const visible = useMemo(() => draft?.definition.elements.filter((element) =>
    element.elementId.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40) ?? [], [draft, query]);

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

  if (!loaded) return <p role="status">Loading catalog draft…</p>;
  if (!draft) return <div className="catalog-empty">
    <p>Clone the active catalog to adjust agency validation without changing clinical work.</p>
    <button type="button" disabled={busy} onClick={() => action(async () => {
      const cloned = await cloneCatalogDraft(csrfToken); setDraft(cloned); setDirty(false); setStatus("Catalog draft created.");
    })}>Clone active catalog</button>
  </div>;

  return <div className="catalog-editor">
    <p>Draft revision {draft.revision}. Stable identity, datatype, and storage semantics are read-only.</p>
    <label htmlFor="catalog-search">Find element</label>
    <input id="catalog-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="catalog-elements" aria-label="Editable catalog elements">
      {visible.map((element) => <fieldset key={element.elementId}>
        <legend>{element.elementId}</legend>
        <p>{element.baseDatatype} · {element.storageSemantics.analyticalLocation}</p>
        <label><input type="checkbox" checked={element.agencyRequired} onChange={(event) => edit(element.elementId,
          (value) => ({ ...value, agencyRequired: event.target.checked }))} /> Agency required</label>
        <label>Minimum occurrences <input type="number" min={0} value={element.constraints.minOccurs}
          onChange={(event) => edit(element.elementId, (value) => ({ ...value, constraints: { ...value.constraints,
            minOccurs: Number(event.target.value) } }))} /></label>
        <label>Maximum occurrences <input type="number" min={1} value={element.constraints.maxOccurs ?? ""}
          aria-describedby={`${element.elementId}-maximum-help`}
          onChange={(event) => edit(element.elementId, (value) => ({ ...value, constraints: { ...value.constraints,
            maxOccurs: event.target.value === "" ? null : Number(event.target.value) } }))} /></label>
        <small id={`${element.elementId}-maximum-help`}>Blank means unbounded when supported by the source catalog.</small>
      </fieldset>)}
    </div>
    {draft.definition.codeLists.length > 0 && <section className="code-list-editor" aria-labelledby="code-list-heading">
      <h3 id="code-list-heading">Recommended and agency-maintained code lists</h3>
      <p>Codes remain permanently resolvable after publication. Disable a value to hide it from future selection.</p>
      <label htmlFor="code-list-select">Code list</label>
      <select id="code-list-select" value={selectedListId || draft.definition.codeLists[0]!.listId}
        onChange={(event) => setSelectedListId(event.target.value)}>
        {draft.definition.codeLists.map((list) => <option key={list.listId} value={list.listId}>{list.name}</option>)}
      </select>
      <CatalogCodeListEditor list={draft.definition.codeLists.find((list) => list.listId === selectedListId) ?? draft.definition.codeLists[0]!}
        onChange={editCodeList} />
    </section>}
    <div className="catalog-actions">
      <button type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, draft); setDraft(saved); setDirty(false); setStatus(`Saved revision ${saved.revision}.`);
      })}>Save draft</button>
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, draft.id);
        setStatus(result.valid && result.projectionsVerified ? "Catalog is valid and projections are verified." : result.findings.join("; "));
      })}>Validate</button>
      <label htmlFor="catalog-change-note">Publication change note</label>
      <textarea id="catalog-change-note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="button" disabled={busy || dirty || !note.trim() || status !== "Catalog is valid and projections are verified."}
        onClick={() => action(async () => {
          const published = await publishCatalogDraft(csrfToken, draft, note);
          setDraft(null); setDirty(false); setNote(""); setStatus(`Published immutable catalog ${published.version}.`);
        })}>Publish immutable catalog</button>
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

export function CatalogCodeListEditor({ list, onChange }: {
  readonly list: CatalogDraftCodeList;
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
    onChange({ ...list, values: [...list.values, { code: nextCode, codeSystem: nextSystem, label: nextLabel,
      sourceLabel: nextLabel, category: null, enabled: true }] }, `Added ${nextLabel}. Save the draft to keep this change.`);
    setCode(""); setCodeSystem(""); setLabel("");
  }

  return <div className="code-list-values">
    <fieldset className="code-list-add">
      <legend>Add value</legend>
      <label>Code <input value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label>Code system <input value={codeSystem} onChange={(event) => setCodeSystem(event.target.value)} /></label>
      <label>Label <input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="button" onClick={addValue}>Add value</button>
    </fieldset>
    <ol aria-label={`${list.name} values`}>
      {list.values.map((value, index) => {
        const key = valueKey(value);
        const isDefault = list.defaultValue ? valueKey(list.defaultValue) === key : false;
        return <li key={key}>
          <div><strong>{value.code}</strong>{value.codeSystem && <small>{value.codeSystem}</small>}</div>
          <label>Label <input aria-label={`Label for ${value.code}`} value={value.label} onChange={(event) => updateValue(index,
            (current) => ({ ...current, label: event.target.value }), `Changed the label for ${value.code}.`)} /></label>
          <label><input type="checkbox" aria-label={`${value.label} enabled`} checked={value.enabled} onChange={(event) => updateValue(index,
            (current) => ({ ...current, enabled: event.target.checked }), `${event.target.checked ? "Enabled" : "Disabled"} ${value.label}.`)} /> Enabled</label>
          <label><input type="radio" name={`${list.listId}-default`} aria-label={`Use ${value.label} as default`} checked={isDefault} disabled={!value.enabled}
            onChange={() => onChange({ ...list, defaultValue: { code: value.code, codeSystem: value.codeSystem } },
              `Set ${value.label} as the default.`)} /> Default</label>
          <div className="code-list-order" aria-label={`Reorder ${value.label}`}>
            <button type="button" disabled={index === 0} aria-label={`Move ${value.label} up`} onClick={() => onChange(
              moveCodeValue(list, index, index - 1), `Moved ${value.label} up.`)}>Move up</button>
            <button type="button" disabled={index === list.values.length - 1} aria-label={`Move ${value.label} down`} onClick={() => onChange(
              moveCodeValue(list, index, index + 1), `Moved ${value.label} down.`)}>Move down</button>
          </div>
        </li>;
      })}
    </ol>
    <button type="button" disabled={list.defaultValue === null} onClick={() => onChange({ ...list, defaultValue: null }, "Cleared the code-list default.")}>Clear default</button>
  </div>;
}
