"use client";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption, FormCatalogElement, FormDraftDefinition, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import React, { useEffect, useRef, useState } from "react";
import { activateStationaryForm, cloneStationaryFormDraft, deleteStationaryFormDraft, loadStationaryFormDraft, loadStationaryFormVersions, loadValidationVersions, publishStationaryFormDraft, saveStationaryFormDraft, searchFormCatalog } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { addFormElement, FormElementPicker, FormLocalizedEditor, FormSectionElements } from "./form-authoring";
import { LoadingStatus } from "./loading-status";
import { pruneFormTranslations } from "../app/form-localization";

type FormSection = FormDraftDefinition["sections"][number];

export function formAuthority(capabilities: ReadonlyArray<string>): {
  readonly canRead: boolean; readonly canWrite: boolean; readonly canPublish: boolean;
} {
  const canRead = capabilities.includes("forms:read");
  const canWrite = canRead && capabilities.includes("forms:write");
  return { canRead, canWrite, canPublish: canWrite && capabilities.includes("forms:publish") };
}

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
  return pruneFormTranslations({ ...definition, sections: definition.sections.filter((_, sectionIndex) => sectionIndex !== index) });
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

export function StationaryFormAuthoring({ csrfToken, capabilities, catalogReleaseId, preferredCatalogReleaseId, onActivated, active = true, language = "sv" }: {
  readonly language?: "en" | "sv";
  readonly csrfToken: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly catalogReleaseId: string;
  readonly preferredCatalogReleaseId?: string;
  readonly onActivated?: (activation: StationaryFormActivation, published?: PublishedStationaryForm) => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const { canWrite, canPublish } = formAuthority(capabilities);
  const publicationAllowed = canPublish;
  const activationAllowed = canPublish && capabilities.includes("validation:publish");
  const [draft, setDraft] = useState<StationaryFormDraft | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [validationVersions, setValidationVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedValidationVersionId, setSelectedValidationVersionId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
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
  const [newDisplayName, setNewDisplayName] = useState("");
  const [activationNote, setActivationNote] = useState("");
  const [published, setPublished] = useState<PublishedStationaryForm | null>(null);
  const [activated, setActivated] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const draftId = draft?.id;

  useEffect(() => {
    let current = true;
    loadStationaryFormDraft().then((loadedDraft) => { if (current) setDraft(loadedDraft); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "Stationary form operation failed.")); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [adminError]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadStationaryFormVersions().then((items) => { if (current) {
      setVersions(items); setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) setError(adminError(reason, "Stationary form operation failed.")); });
    return () => { current = false; };
  }, [active, adminError]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadValidationVersions().then((items) => { if (current) setValidationVersions(items); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "Stationary form operation failed.")); });
    return () => { current = false; };
  }, [active, adminError]);

  useEffect(() => { if (pendingRemoval !== null) confirmationRef.current?.focus(); }, [pendingRemoval]);

  useEffect(() => {
    if (!draftId || !query.trim()) return;
    let current = true;
    const timeout = window.setTimeout(() => {
      searchFormCatalog(draftId, query).then((page) => { if (current) {
        setResults(page.items);
      } }).catch((reason: unknown) => { if (current) setError(adminError(reason, "Stationary form operation failed.")); });
    }, 150);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [draftId, query, adminError]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(adminError(reason, "Stationary form operation failed.")); } finally { setBusy(false); }
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
    } catch (reason) { setError(adminError(reason, "Stationary form operation failed.")); }
  }
  const selectedVersion = versions.find(({ id }) => id === selectedVersionId);
  const activationCatalogId = published?.catalogReleaseId ?? selectedVersion?.catalogReleaseId;
  const compatibleValidations = validationVersions.filter(({ catalogReleaseId: id }) => id === activationCatalogId);
  const selectedValidation = compatibleValidations.find(({ id }) => id === selectedValidationVersionId)
    ?? compatibleValidations.find(({ status }) => status === "active") ?? compatibleValidations[0];
  const validationChoice = <div className="authoring-version-row">
    <label htmlFor="form-activation-validation"><AdminText english="Validation rules" /></label>
    <select id="form-activation-validation" value={selectedValidation?.id ?? ""}
      onChange={(event) => setSelectedValidationVersionId(event.target.value)} disabled={compatibleValidations.length === 0}>
      {compatibleValidations.length === 0 && <option value=""><AdminText english="No compatible published rules" /></option>}
      {compatibleValidations.map((version) => <option key={version.id} value={version.id}>
        {version.displayName} · v{version.version}{version.status === "active" ? t(" · Active") : ""}</option>)}
    </select>
  </div>;
  const versionWorkspace = <AuthoringVersionWorkspace title="Stationary form" versions={versions}
    selectedId={selectedVersionId} onSelect={setSelectedVersionId} draftName={newDisplayName}
    onDraftNameChange={setNewDisplayName} canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && !published)}
    onCreateDraft={() => action(async () => {
      const cloned = await cloneStationaryFormDraft(csrfToken,
        preferredCatalogReleaseId || selectedVersion?.catalogReleaseId || catalogReleaseId, newDisplayName, selectedVersionId);
      setPublished(null); setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus(t("Stationary form draft created."));
    })}>
    {selectedVersion && selectedVersion.status !== "active" && activationAllowed && !published &&
      <>{validationChoice}<AuthoringLifecycleAction title="Selected Stationary form" kind="activate" note={activationNote}
        onNoteChange={setActivationNote} disabled={busy || !selectedValidation} buttonLabel={t("Activate selected version")}
        onSubmit={() => action(async () => {
          if (!selectedValidation) return;
          const activation = await activateStationaryForm(csrfToken, selectedVersion.id, selectedValidation.id, activationNote);
          setStatus(t("Stationary form activated for new reports.")); setActivationNote("");
          setVersions((current) => current.map((item) => ({ ...item, status: item.id === selectedVersion.id ? "active" : "published" })));
          onActivated?.(activation);
        })} /></>}
  </AuthoringVersionWorkspace>;
  if (!loaded) return <LoadingStatus><AdminText english="Loading Stationary form draft…" /></LoadingStatus>;
  if (!draft) return <div className="form-empty">
    {versionWorkspace}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  if (published) return <div className="form-publication" aria-labelledby="published-form-heading">
    {versionWorkspace}
    <h3 id="published-form-heading">{t("Published {name}", { name: published.displayName })}</h3>
    <p>{t("{sections} sections and {elements} elements were published as immutable content.", { sections: published.structuralSummary.sections, elements: published.structuralSummary.fields })}</p>
    <p className="form-activation-status" role="status"><AdminText english="This version is published but is not active. New reports still use the existing agency default." /></p>
    {activationAllowed ? <>
      {validationChoice}
      <AuthoringLifecycleAction title="Stationary form" kind="activate" note={activationNote}
        onNoteChange={setActivationNote} disabled={busy || activated || !selectedValidation}
        detail={t("Activation applies this form, its catalog, and the selected validation rules to new reports.")}
        buttonLabel={t(activated ? "Agency default active" : "Activate as agency default")} onSubmit={() => action(async () => {
        if (!selectedValidation) return;
        const activation = await activateStationaryForm(csrfToken, published.id, selectedValidation.id, activationNote);
        setActivated(true);
        setVersions((current) => current.map((item) => ({ ...item, status: item.id === published.id ? "active" : "published" })));
        setStatus(t("Stationary form activated for new reports. Existing reports remain pinned to their original versions."));
        onActivated?.(activation, published);
      })} />
    </> : <p role="note"><AdminText english="Activating a form requires Forms and Validation publication access." /></p>}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    {versionWorkspace}
    <div className="form-actions form-editor-toolbar" role="group" aria-label={t("Form draft actions")}>
      <span role="status">{busy ? t("Working…") : dirty ? t("Unsaved changes") : t("All changes saved")}</span>
      <button type="button" disabled={busy || pendingRemoval !== null} onClick={() => {
        if (openStationaryFormPreview(draft)) setStatus(t("Opened Stationary form preview in a new window."));
        else setError(t("The preview window was blocked. Allow pop-ups and try again."));
      }}><AdminText english="Preview Stationary form" /></button>
      {canWrite && <button type="button" disabled={busy || !dirty || pendingRemoval !== null} onClick={() => action(async () => {
        const saved = await saveStationaryFormDraft(csrfToken, draft);
        setDraft(saved); setDirty(false); setStatus(`Saved form draft revision ${saved.revision}.`);
      })}><AdminText english="Save form draft" /></button>}
      {canWrite && <button type="button" disabled={busy || pendingRemoval !== null} onClick={() => {
        if (!window.confirm(`Delete form draft revision ${draft.revision}? This cannot be undone.`)) return;
        void action(async () => {
          await deleteStationaryFormDraft(csrfToken, draft);
          setDraft(null); setDirty(false); setStatus(t("Stationary form draft deleted."));
        });
      }}><AdminText english="Delete form draft" /></button>}
    </div>
    <p>{t("Draft revision {revision}.", { revision: draft.revision })} {canWrite
      ? t("Published forms remain immutable and existing reports keep their pinned form version.")
      : t("You have read-only access to this form definition.")}</p>
    {draft.diagnostics.length > 0 && <div className="form-findings" role="alert">
      <strong><AdminText english="Resolve cloned catalog references before saving:" /></strong>
      <ul>{draft.diagnostics.map((finding) => <li key={`${finding.code}:${finding.path}`}>{finding.message} ({finding.path})</li>)}</ul>
    </div>}
    {canWrite && <fieldset className="form-picker-container" disabled={busy}><FormElementPicker definition={draft.definition} results={results} query={query} targetSection={targetSection}
      onQueryChange={(value) => { setQuery(value); setResults([]); }}
      onSectionChange={setTargetSection} onAdd={add} /></fieldset>}
    <FormLocalizedEditor language={language} definition={draft.definition} readOnly={!canWrite || busy} onChange={change} />
    <FormSectionElements definition={draft.definition} busy={busy} readOnly={!canWrite} onChange={change}
      {...(canWrite ? {
        onMoveSection: (from: number, to: number) => change(moveFormSection(draft.definition, from, to),
          `Moved ${draft.definition.sections[from]!.key} ${to < from ? "up" : "down"}.`),
        onRequestRemoveSection: setPendingRemoval
      } : {})} />
    {canWrite && pendingRemoval !== null && draft.definition.sections[pendingRemoval] && <div className="form-remove-confirmation"
      role="alertdialog" aria-modal="false" aria-labelledby="remove-section-heading"
      aria-describedby="remove-section-description" tabIndex={-1} ref={confirmationRef}>
      <h3 id="remove-section-heading">{t("Remove {key}?", { key: draft.definition.sections[pendingRemoval]!.key })}</h3>
      <p id="remove-section-description">{t("This removes the section and its {count} affected fields from this draft.", { count: affectedFieldNames(draft.definition.sections[pendingRemoval]!).length })}</p>
      <ul>{affectedFieldNames(draft.definition.sections[pendingRemoval]!).map((field) => <li key={field}>{field}</li>)}</ul>
      <div><button type="button" onClick={() => {
        const index = pendingRemoval;
        const section = draft.definition.sections[index]!; const affected = affectedFieldNames(section);
        change(removeFormSection(draft.definition, index),
          `Removed ${section.key} and ${affected.length} affected ${affected.length === 1 ? "field" : "fields"}.`);
      }}><AdminText english="Confirm removal" /></button><button type="button" onClick={() => {
        const section = pendingRemoval === null ? undefined : draft.definition.sections[pendingRemoval];
        setPendingRemoval(null); setStatus(section ? `Kept ${section.key}.` : t("Removal canceled."));
      }}><AdminText english="Keep section" /></button></div>
    </div>}
    <section className="form-publication-review" aria-labelledby="form-publication-heading">
      <h3 id="form-publication-heading"><AdminText english="Publication review" /></h3>
      <p>Structural summary: {formStructuralSummary(draft.definition)}.</p>
      <p><AdminText english="Publication creates an immutable form pinned to this catalog. It will not activate the form." /></p>
      <label htmlFor="form-display-name"><AdminText english="Form version display name" /></label>
      <input id="form-display-name" disabled={!canWrite || busy} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus(t("Unsaved changes")); }} />
      {publicationAllowed ? <>
        <AuthoringLifecycleAction title="Stationary form" kind="publish" note={publicationNote}
          onNoteChange={setPublicationNote} disabled={busy || dirty || !draft.displayName?.trim() || pendingRemoval !== null || draft.diagnostics.length > 0}
          buttonLabel={t("Publish immutable form")} onSubmit={() => action(async () => {
            if (!draft.displayName?.trim()) throw new Error(t("Enter a form version display name before publishing."));
            if (!publicationNote.trim()) throw new Error(t("Enter a publication note before publishing."));
            const result = await publishStationaryFormDraft(csrfToken, draft, draft.displayName, publicationNote);
            setPublished(result); setSelectedVersionId(result.id);
            setVersions(await loadStationaryFormVersions());
            setStatus(t("Stationary form published. Activate it separately when ready."));
          })} />
        {dirty && <p role="status"><AdminText english="Save the current draft before publishing." /></p>}
      </> : canWrite && <p role="note">{canPublish
        ? t("Publishing is disabled for this installation. Form drafts can still be created, edited, previewed, and saved.")
        : t("Your Forms access permits draft authoring but not publication or activation.")}</p>}
    </section>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
