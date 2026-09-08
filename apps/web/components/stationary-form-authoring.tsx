"use client";

import type { FormCatalogElement, FormDraftDefinition, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import React, { useEffect, useRef, useState } from "react";
import { activateStationaryForm, cloneStationaryFormDraft, loadStationaryFormDraft, publishStationaryFormDraft, saveStationaryFormDraft, searchFormCatalog } from "../app/admin-context";
import { addFormElement, FormElementPicker, FormSectionElements } from "./form-authoring";

type FormSection = FormDraftDefinition["sections"][number];

export function openStationaryFormPreview(draft: StationaryFormDraft): boolean {
  const key = `open-triage:stationary-form-preview:${crypto.randomUUID()}`;
  localStorage.setItem(key, JSON.stringify(draft));
  const preview = window.open(`/admin-preview?draft=${encodeURIComponent(key)}`, "_blank");
  if (preview) preview.opener = null;
  if (!preview) localStorage.removeItem(key);
  return Boolean(preview);
}

function operationErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Stationary form operation failed.";
}

export function moveFormSection(definition: FormDraftDefinition, from: number, to: number): FormDraftDefinition {
  if (from < 0 || from >= definition.sections.length || to < 0 || to >= definition.sections.length || from === to) return definition;
  const sections = [...definition.sections];
  const [moving] = sections.splice(from, 1);
  sections.splice(to, 0, moving!);
  return { ...definition, sections };
}

export function removeFormSection(definition: FormDraftDefinition, index: number): FormDraftDefinition {
  if (index < 0 || index >= definition.sections.length) return definition;
  if (definition.sections.length === 1) throw new Error("A Stationary form must contain at least one section.");
  return { ...definition, sections: definition.sections.filter((_, sectionIndex) => sectionIndex !== index) };
}

export function affectedFieldNames(section: FormSection): string[] {
  return section.fields.map((field) => field.source.kind === "nemsis"
    ? `${field.key} (${field.source.elementId})`
    : `${field.key} (custom element ${field.source.elementDefinitionId})`);
}

export function formStructuralSummary(definition: FormDraftDefinition): string {
  const fields = definition.sections.reduce((count, section) => count + section.fields.length, 0);
  return `${definition.sections.length} ${definition.sections.length === 1 ? "section" : "sections"} and ${fields} ${fields === 1 ? "element" : "elements"}`;
}

export function StationarySectionControls({ definition, pendingRemoval, busy = false, confirmationRef, onMove, onRequestRemoval,
  onConfirmRemoval, onCancelRemoval }: {
  readonly definition: FormDraftDefinition;
  readonly pendingRemoval: number | null;
  readonly busy?: boolean;
  readonly confirmationRef?: React.RefObject<HTMLDivElement | null>;
  readonly onMove: (from: number, to: number) => void;
  readonly onRequestRemoval: (index: number) => void;
  readonly onConfirmRemoval: (index: number) => void;
  readonly onCancelRemoval: () => void;
}) {
  const removal = pendingRemoval === null ? null : definition.sections[pendingRemoval];
  const affected = removal ? affectedFieldNames(removal) : [];
  return <>
    <ol className="form-sections" aria-label="Stationary form sections">
      {definition.sections.map((section, index) => <li key={section.key}>
        <div className="form-section-summary">
          <div><strong>{section.key}</strong><small>{section.fields.length} {section.fields.length === 1 ? "field" : "fields"}</small></div>
          <div className="form-section-actions" aria-label={`Actions for ${section.key}`}>
            <button type="button" disabled={busy || index === 0} aria-label={`Move ${section.key} up`}
              onClick={() => onMove(index, index - 1)}>Move up</button>
            <button type="button" disabled={busy || index === definition.sections.length - 1} aria-label={`Move ${section.key} down`}
              onClick={() => onMove(index, index + 1)}>Move down</button>
            <button type="button" disabled={busy || definition.sections.length === 1}
              aria-label={`Remove ${section.key}`} onClick={() => onRequestRemoval(index)}>Remove section</button>
          </div>
        </div>
      </li>)}
    </ol>
    {removal && <div className="form-remove-confirmation" role="alertdialog" aria-modal="false"
      aria-labelledby="remove-section-heading" aria-describedby="remove-section-description" tabIndex={-1} ref={confirmationRef}>
      <h3 id="remove-section-heading">Remove {removal.key}?</h3>
      <p id="remove-section-description">This removes the section and its {affected.length} affected {affected.length === 1 ? "field" : "fields"} from this draft:</p>
      {affected.length ? <ul>{affected.map((field) => <li key={field}>{field}</li>)}</ul> : <p>This section contains no fields.</p>}
      <div>
        <button type="button" onClick={() => onConfirmRemoval(pendingRemoval!)}>Confirm removal</button>
        <button type="button" onClick={onCancelRemoval}>Keep section</button>
      </div>
    </div>}
  </>;
}

export function StationaryFormAuthoring({ csrfToken, catalogReleaseId, onActivated }: {
  readonly csrfToken: string;
  readonly catalogReleaseId: string;
  readonly onActivated?: (activation: StationaryFormActivation, published: PublishedStationaryForm) => void;
}) {
  const [draft, setDraft] = useState<StationaryFormDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FormCatalogElement[]>([]);
  const [targetSection, setTargetSection] = useState("");
  const [publicationNote, setPublicationNote] = useState("");
  const [activationNote, setActivationNote] = useState("");
  const [published, setPublished] = useState<PublishedStationaryForm | null>(null);
  const [activated, setActivated] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const draftId = draft?.id;

  useEffect(() => {
    let current = true;
    loadStationaryFormDraft(csrfToken).then((loadedDraft) => { if (current) setDraft(loadedDraft); })
      .catch((reason: unknown) => { if (current) setError(operationErrorMessage(reason)); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [csrfToken]);

  useEffect(() => { if (pendingRemoval !== null) confirmationRef.current?.focus(); }, [pendingRemoval]);

  useEffect(() => {
    if (!draftId) return;
    let current = true;
    const timeout = window.setTimeout(() => {
      searchFormCatalog(csrfToken, draftId, query).then((page) => { if (current) {
        setResults(page.items);
      } }).catch((reason: unknown) => { if (current) setError(operationErrorMessage(reason)); });
    }, 150);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [csrfToken, draftId, query]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(operationErrorMessage(reason)); } finally { setBusy(false); }
  }
  function change(next: FormDraftDefinition, announcement: string) {
    setDraft((current) => current ? { ...current, definition: next } : current);
    setDirty(true); setStatus(`Unsaved changes. ${announcement}`); setError(""); setPendingRemoval(null);
  }
  function add(element: FormCatalogElement) {
    if (!draft) return;
    try {
      change(addFormElement(draft.definition, targetSection || draft.definition.sections[0]?.key || "", element),
        `Added ${element.elementId}.`);
    } catch (reason) { setError(operationErrorMessage(reason)); }
  }
  if (!loaded) return <p role="status">Loading Stationary form draft…</p>;
  if (!draft) return <div className="form-empty">
    <p>Clone the active Stationary form to change its section sequence without changing the published form.</p>
    <button type="button" disabled={busy || !catalogReleaseId} onClick={() => action(async () => {
      const cloned = await cloneStationaryFormDraft(csrfToken, catalogReleaseId);
      setDraft(cloned); setDirty(false); setStatus("Stationary form draft created.");
    })}>Clone active Stationary form</button>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  if (published) return <div className="form-publication" aria-labelledby="published-form-heading">
    <h3 id="published-form-heading">Published Stationary form version {published.version}</h3>
    <p>{published.structuralSummary.sections} sections and {published.structuralSummary.fields} elements were published as immutable content.</p>
    <p role="status">This version is published but is not active. New reports still use the existing agency default.</p>
    <label htmlFor="form-activation-note">Activation note</label>
    <textarea id="form-activation-note" value={activationNote} onChange={(event) => setActivationNote(event.target.value)} />
    <button type="button" disabled={busy || activated || !activationNote.trim()} onClick={() => action(async () => {
      const activation = await activateStationaryForm(csrfToken, published.id, activationNote);
      setActivated(true);
      setStatus("Stationary form activated for new reports. Existing reports remain pinned to their original versions.");
      onActivated?.(activation, published);
    })}>{activated ? "Agency default active" : "Activate as agency default"}</button>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    <p>Draft revision {draft.revision}. Published forms remain immutable and existing reports keep their pinned form version.</p>
    {draft.diagnostics.length > 0 && <div className="form-findings" role="alert">
      <strong>Resolve cloned catalog references before saving:</strong>
      <ul>{draft.diagnostics.map((finding) => <li key={`${finding.code}:${finding.path}`}>{finding.message} ({finding.path})</li>)}</ul>
    </div>}
    <FormElementPicker definition={draft.definition} results={results} query={query} targetSection={targetSection}
      onQueryChange={(value) => { setQuery(value); setResults([]); }}
      onSectionChange={setTargetSection} onAdd={add} />
    <FormSectionElements definition={draft.definition} busy={busy} onChange={change}
      onMoveSection={(from, to) => change(moveFormSection(draft.definition, from, to),
        `Moved ${draft.definition.sections[from]!.key} ${to < from ? "up" : "down"}.`)}
      onRequestRemoveSection={setPendingRemoval} />
    {pendingRemoval !== null && draft.definition.sections[pendingRemoval] && <div className="form-remove-confirmation"
      role="alertdialog" aria-modal="false" aria-labelledby="remove-section-heading"
      aria-describedby="remove-section-description" tabIndex={-1} ref={confirmationRef}>
      <h3 id="remove-section-heading">Remove {draft.definition.sections[pendingRemoval]!.key}?</h3>
      <p id="remove-section-description">This removes the section and its {affectedFieldNames(draft.definition.sections[pendingRemoval]!).length} affected fields from this draft.</p>
      <ul>{affectedFieldNames(draft.definition.sections[pendingRemoval]!).map((field) => <li key={field}>{field}</li>)}</ul>
      <div><button type="button" onClick={() => {
        const index = pendingRemoval;
        const section = draft.definition.sections[index]!; const affected = affectedFieldNames(section);
        change(removeFormSection(draft.definition, index),
          `Removed ${section.key} and ${affected.length} affected ${affected.length === 1 ? "field" : "fields"}.`);
      }}>Confirm removal</button><button type="button" onClick={() => {
        const section = pendingRemoval === null ? undefined : draft.definition.sections[pendingRemoval];
        setPendingRemoval(null); setStatus(section ? `Kept ${section.key}.` : "Removal canceled.");
      }}>Keep section</button></div>
    </div>}
    <div className="form-actions">
      <button type="button" disabled={busy || pendingRemoval !== null} onClick={() => {
        if (openStationaryFormPreview(draft)) setStatus("Opened Stationary form preview in a new window.");
        else setError("The preview window was blocked. Allow pop-ups and try again.");
      }}>Preview Stationary form</button>
      <button type="button" disabled={busy || !dirty || pendingRemoval !== null} onClick={() => action(async () => {
        const saved = await saveStationaryFormDraft(csrfToken, draft);
        setDraft(saved); setDirty(false); setStatus(`Saved form draft revision ${saved.revision}.`);
      })}>Save form draft</button>
    </div>
    <section className="form-publication-review" aria-labelledby="form-publication-heading">
      <h3 id="form-publication-heading">Publication review</h3>
      <p>Structural summary: {formStructuralSummary(draft.definition)}.</p>
      <p>Publication creates an immutable form pinned to this catalog. It will not activate the form.</p>
      <label htmlFor="form-publication-note">Publication note</label>
      <textarea id="form-publication-note" required value={publicationNote}
        onChange={(event) => setPublicationNote(event.target.value)} />
      <small>A publication note is required. Publishing is available to administrators in the demo.</small>
      <button type="button" disabled={busy || dirty || pendingRemoval !== null || draft.diagnostics.length > 0}
        onClick={() => action(async () => {
          if (!publicationNote.trim()) throw new Error("Enter a publication note before publishing.");
          const result = await publishStationaryFormDraft(csrfToken, draft, publicationNote);
          setPublished(result); setStatus("Stationary form published. Activate it separately when ready.");
        })}>Publish immutable form</button>
      {dirty && <p role="status">Save the current draft before publishing.</p>}
    </section>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
