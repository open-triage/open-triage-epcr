"use client";

import type { CatalogDraft, CatalogDraftElement } from "@open-triage/contracts";
import { useEffect, useMemo, useState } from "react";
import { cloneCatalogDraft, loadCatalogDraft, publishCatalogDraft, saveCatalogDraft, validateCatalogDraft } from "../app/admin-context";

export function CatalogAuthoring({ csrfToken }: { readonly csrfToken: string }) {
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadCatalogDraft(csrfToken).then(setDraft).catch(showError).finally(() => setLoaded(true)); }, [csrfToken]);
  const visible = useMemo(() => draft?.definition.elements.filter((element) =>
    element.elementId.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40) ?? [], [draft, query]);

  function showError(reason: unknown) { setError(reason instanceof Error ? reason.message : "Catalog operation failed."); }
  function edit(elementId: string, update: (element: CatalogDraftElement) => CatalogDraftElement) {
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      elements: current.definition.elements.map((element) => element.elementId === elementId ? update(element) : element) } } : current);
    setStatus("Unsaved changes"); setError("");
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  if (!loaded) return <p role="status">Loading catalog draft…</p>;
  if (!draft) return <div className="catalog-empty">
    <p>Clone the active catalog to adjust agency validation without changing clinical work.</p>
    <button type="button" disabled={busy} onClick={() => action(async () => {
      const cloned = await cloneCatalogDraft(csrfToken); setDraft(cloned); setStatus("Catalog draft created.");
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
    <div className="catalog-actions">
      <button type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, draft); setDraft(saved); setStatus(`Saved revision ${saved.revision}.`);
      })}>Save draft</button>
      <button type="button" disabled={busy || status === "Unsaved changes"} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, draft.id);
        setStatus(result.valid && result.projectionsVerified ? "Catalog is valid and projections are verified." : result.findings.join("; "));
      })}>Validate</button>
      <label htmlFor="catalog-change-note">Publication change note</label>
      <textarea id="catalog-change-note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="button" disabled={busy || !note.trim() || status !== "Catalog is valid and projections are verified."}
        onClick={() => action(async () => {
          const published = await publishCatalogDraft(csrfToken, draft, note);
          setDraft(null); setNote(""); setStatus(`Published immutable catalog ${published.version}.`);
        })}>Publish immutable catalog</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
