"use client";

import { synchronizeCanonicalFiles } from "../app/admin-context";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption, FormCatalogElement, FormDraftDefinition, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import React, { useEffect, useRef, useState } from "react";
import { activateStationaryForm, cloneStationaryFormDraft, deleteStationaryFormDraft, loadCatalogVersions, loadStationaryFormDraft, loadStationaryFormVersions, loadValidationVersions, publishStationaryFormDraft, saveStationaryFormDraft, searchFormCatalog } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { addFormElement, FormElementPicker, FormSectionElements } from "./form-authoring";
import { PlatformRequestError } from "../app/platform-errors";
import { LoadingStatus } from "./loading-status";

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
  return reason instanceof Error ? reason.message : "Form operation failed.";
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
  if (definition.sections.length === 1) throw new Error("A form must contain at least one section.");
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

export function StationaryFormAuthoring({ csrfToken, capabilities, catalogReleaseId, preferredCatalogReleaseId, onActivated, active = true, language = "sv" }: {
  readonly language?: string;
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
  const [catalogVersions, setCatalogVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedTargetCatalogId, setSelectedTargetCatalogId] = useState("");
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
  const [activationReview, setActivationReview] = useState<{
    formId: string; validationId: string; note: string; rules: ReadonlyArray<{ id: string; name: string }>;
    published?: PublishedStationaryForm;
  } | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const draftId = draft?.id;

  useEffect(() => {
    if (loaded) return;
    let current = true;
    loadStationaryFormDraft().then((loadedDraft) => { if (current) setDraft(loadedDraft); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [adminError, loaded]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    (async () => {
      if (canPublish) {
        try {
          const result = await synchronizeCanonicalFiles(csrfToken, "form");
          if (current && result.errors.length) setError(result.errors.join("\n"));
        } catch (reason) { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); }
      }
      return loadStationaryFormVersions();
    })().then((items) => { if (current) {
      setVersions(items); setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); });
    return () => { current = false; };
  }, [active, adminError, canPublish, csrfToken]);
  useEffect(() => {
    if (!active || !capabilities.includes("catalog:read")) return;
    let current = true;
    loadCatalogVersions().then((items) => { if (current) setCatalogVersions(items); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); });
    return () => { current = false; };
  }, [active, adminError, capabilities]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadValidationVersions().then((items) => { if (current) setValidationVersions(items); })
      .catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); });
    return () => { current = false; };
  }, [active, adminError]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => { if (pendingRemoval !== null) confirmationRef.current?.focus(); }, [pendingRemoval]);

  useEffect(() => {
    if (!draftId || !query.trim()) return;
    let current = true;
    const timeout = window.setTimeout(() => {
      searchFormCatalog(draftId, query).then((page) => { if (current) {
        setResults(page.items);
      } }).catch((reason: unknown) => { if (current) setError(adminError(reason, "admin.stationaryFormOperation")); });
    }, 150);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [draftId, query, adminError]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(adminError(reason, "admin.stationaryFormOperation")); } finally { setBusy(false); }
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
    } catch (reason) { setError(adminError(reason, "admin.stationaryFormOperation")); }
  }
  async function activate(formId: string, validationId: string, note: string,
    publication?: PublishedStationaryForm, removedRuleIds?: readonly string[]) {
    try {
      const activation = await activateStationaryForm(csrfToken, formId, validationId, note, removedRuleIds);
      setActivationReview(null); setActivated(true); setActivationNote("");
      setVersions((current) => current.map((item) => ({ ...item, status: item.id === formId ? "active" : "published" })));
      setStatus(t("admin.stationaryFormActivatedForNewReportsExisting"));
      setValidationVersions(await loadValidationVersions());
      onActivated?.(activation, publication);
    } catch (reason) {
      if (reason instanceof PlatformRequestError && reason.code === "admin.formValidationRemovalRequired"
        && reason.impactedRules?.length) {
        setActivationReview({ formId, validationId, note, rules: reason.impactedRules, published: publication });
      } else throw reason;
    }
  }
  const activationConfirmation = activationReview && <section role="alertdialog" aria-modal="false"
    aria-labelledby="form-validation-removal-heading" className="form-remove-confirmation" tabIndex={-1}
    ref={(node) => { node?.focus(); }}>
    <h3 id="form-validation-removal-heading">{t("admin.formValidationRemovalHeading")}</h3>
    <p>{t("admin.formValidationRemovalExplanation")}</p>
    <ul>{activationReview.rules.map((rule) => <li key={rule.id}>{rule.name}</li>)}</ul>
    <button type="button" disabled={busy} onClick={() => action(() => activate(activationReview.formId,
      activationReview.validationId, activationReview.note, activationReview.published,
      activationReview.rules.map(({ id }) => id)))}>{t("admin.removeRulesAndActivate")}</button>
    <button type="button" disabled={busy} onClick={() => setActivationReview(null)}>{t("admin.cancelActivation")}</button>
  </section>;
  const selectedVersion = versions.find(({ id }) => id === selectedVersionId);
  const targetCatalogId = selectedTargetCatalogId || preferredCatalogReleaseId || selectedVersion?.catalogReleaseId || catalogReleaseId;
  const activationCatalogId = published?.catalogReleaseId ?? selectedVersion?.catalogReleaseId;
  const compatibleValidations = validationVersions.filter(({ catalogReleaseId: id }) => id === activationCatalogId);
  const selectedValidation = compatibleValidations.find(({ id }) => id === selectedValidationVersionId)
    ?? compatibleValidations.find(({ status }) => status === "active") ?? compatibleValidations[0];
  const validationChoice = <div className="authoring-version-row">
    <label htmlFor="form-activation-validation"><AdminText messageKey="admin.validationRules" /></label>
    <select id="form-activation-validation" value={selectedValidation?.id ?? ""}
      onChange={(event) => setSelectedValidationVersionId(event.target.value)} disabled={compatibleValidations.length === 0}>
      {compatibleValidations.length === 0 && <option value=""><AdminText messageKey="admin.noCompatiblePublishedRules" /></option>}
      {compatibleValidations.map((version) => <option key={version.id} value={version.id}>
        {version.displayName} · v{version.version}{version.status === "active" ? t("admin.active2") : ""}</option>)}
    </select>
  </div>;
  const versionWorkspace = <AuthoringVersionWorkspace title={t("admin.stationaryForm")} versions={versions}
    selectedId={selectedVersionId} onSelect={(id) => { setSelectedVersionId(id); setSelectedTargetCatalogId(""); }} draftName={newDisplayName}
    onDraftNameChange={setNewDisplayName} canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && !published)}
    onCreateDraft={() => action(async () => {
      const cloned = await cloneStationaryFormDraft(csrfToken, targetCatalogId, newDisplayName, selectedVersionId);
      setPublished(null); setActivated(false); setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus(t("admin.stationaryFormDraftCreated"));
    })}>
    {canWrite && !draft && catalogVersions.length > 0 && <div className="authoring-version-row">
      <label htmlFor="form-target-catalog">{language === "sv" ? "Målkatalog" : "Target catalog"}</label>
      <select id="form-target-catalog" value={targetCatalogId} onChange={(event) => setSelectedTargetCatalogId(event.target.value)}>
        {catalogVersions.map((version) => <option key={version.id} value={version.id}>
          {version.displayName} · v{version.version}{version.id === selectedVersion?.catalogReleaseId
            ? language === "sv" ? " · nuvarande formulärkatalog" : " · current form catalog" : ""}</option>)}
      </select>
    </div>}
    {selectedVersion && selectedVersion.status !== "active" && activationAllowed && !published &&
      <>{validationChoice}<AuthoringLifecycleAction title={t("admin.selectedStationaryForm")} kind="activate" note={activationNote}
        onNoteChange={setActivationNote} disabled={busy || !!activationReview || !selectedValidation} buttonLabel={t("admin.activateSelectedVersion")}
        onSubmit={() => action(async () => {
          if (!selectedValidation) return;
          await activate(selectedVersion.id, selectedValidation.id, activationNote);
        })} /></>}
  </AuthoringVersionWorkspace>;
  if (!loaded) return <LoadingStatus><AdminText messageKey="admin.loadingStationaryFormDraft" /></LoadingStatus>;
  if (!draft) return <div className="form-empty">
    {versionWorkspace}
    {activationConfirmation}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  if (published) return <div className="form-publication" aria-labelledby="published-form-heading">
    {versionWorkspace}
    {activationConfirmation}
    <h3 id="published-form-heading">{t("admin.publishedName", { name: published.displayName })}</h3>
    <p>{t("admin.sectionsSectionsAnd", { sections: published.structuralSummary.sections, elements: published.structuralSummary.fields })}</p>
    <p className="form-activation-status" role="status"><AdminText messageKey="admin.publishedVersionNotActive" /></p>
    {activationAllowed ? <>
      {validationChoice}
      <AuthoringLifecycleAction title={t("admin.stationaryForm")} kind="activate" note={activationNote}
        onNoteChange={setActivationNote} disabled={busy || activated || !!activationReview || !selectedValidation}
        detail={t("admin.activationAppliesThis")}
        buttonLabel={t(activated ? "Agency default active" : "Activate as agency default")} onSubmit={() => action(async () => {
        if (!selectedValidation) return;
        await activate(published.id, selectedValidation.id, activationNote, published);
      })} />
    </> : <p role="note"><AdminText messageKey="admin.activatingAForm" /></p>}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    {versionWorkspace}
    {activationConfirmation}
    <div className="form-actions form-editor-toolbar" role="group" aria-label={t("admin.formDraftActions")}>
      <span role="status">{busy ? t("admin.working") : dirty ? t("admin.unsavedChanges") : t("admin.allChangesSaved")}</span>
      <button type="button" disabled={busy || pendingRemoval !== null} onClick={() => {
        if (openStationaryFormPreview(draft)) setStatus(t("admin.openedStationaryForm"));
        else setError(t("admin.previewWindowBlocked"));
      }}><AdminText messageKey="admin.previewStationaryForm" /></button>
      {canWrite && <button type="button" disabled={busy || !dirty || pendingRemoval !== null} onClick={() => action(async () => {
        const saved = await saveStationaryFormDraft(csrfToken, draft);
        setDraft(saved); setDirty(false); setStatus(`Saved form draft revision ${saved.revision}.`);
      })}><AdminText messageKey="admin.saveFormDraft" /></button>}
      {canWrite && <button type="button" disabled={busy || pendingRemoval !== null} onClick={() => {
        if (!window.confirm(`Delete form draft revision ${draft.revision}? This cannot be undone.`)) return;
        void action(async () => {
          await deleteStationaryFormDraft(csrfToken, draft);
          setDraft(null); setDirty(false); setStatus(t("admin.stationaryFormDraftDeleted"));
        });
      }}><AdminText messageKey="admin.deleteFormDraft" /></button>}
    </div>
    <p>{t("admin.draftRevisionRevision", { revision: draft.revision })} {canWrite
      ? t("admin.publishedFormsRemain")
      : t("admin.formReadOnlyAccess")}</p>
    {draft.diagnostics.length > 0 && <div className="form-findings" role="alert">
      <strong><AdminText messageKey="admin.resolveClonedCatalog" /></strong>
      <ul>{draft.diagnostics.map((finding) => <li key={`${finding.code}:${finding.path}`}>{finding.message} ({finding.path})</li>)}</ul>
    </div>}
    {canWrite && <fieldset className="form-picker-container" disabled={busy}><FormElementPicker definition={draft.definition} results={results} query={query} targetSection={targetSection}
      catalogGroups={draft.catalogGroups} language={language}
      onQueryChange={(value) => { setQuery(value); setResults([]); }}
      onSectionChange={setTargetSection} onAdd={add} /></fieldset>}
    <FormSectionElements definition={draft.definition} catalogFields={draft.catalogFields} customFields={draft.customFields} catalogGroups={draft.catalogGroups}
      newChoicesByField={draft.adoption?.newChoicesByField} language={language}
      busy={busy} readOnly={!canWrite} onChange={change}
      {...(canWrite ? {
        onMoveSection: (from: number, to: number) => change(moveFormSection(draft.definition, from, to),
          `Moved ${draft.definition.sections[from]!.key} ${to < from ? "up" : "down"}.`),
        onRequestRemoveSection: setPendingRemoval
      } : {})} />
    {canWrite && pendingRemoval !== null && draft.definition.sections[pendingRemoval] && <div className="form-remove-confirmation"
      role="alertdialog" aria-modal="false" aria-labelledby="remove-section-heading"
      aria-describedby="remove-section-description" tabIndex={-1} ref={confirmationRef}>
      <h3 id="remove-section-heading">{t("admin.removeKey", { key: draft.definition.sections[pendingRemoval]!.key })}</h3>
      <p id="remove-section-description">{t("admin.removeSectionAffectedFields", { count: affectedFieldNames(draft.definition.sections[pendingRemoval]!).length })}</p>
      <ul>{affectedFieldNames(draft.definition.sections[pendingRemoval]!).map((field) => <li key={field}>{field}</li>)}</ul>
      <div><button type="button" onClick={() => {
        const index = pendingRemoval;
        const section = draft.definition.sections[index]!; const affected = affectedFieldNames(section);
        change(removeFormSection(draft.definition, index),
          `Removed ${section.key} and ${affected.length} affected ${affected.length === 1 ? "field" : "fields"}.`);
      }}><AdminText messageKey="admin.confirmRemoval" /></button><button type="button" onClick={() => {
        const section = pendingRemoval === null ? undefined : draft.definition.sections[pendingRemoval];
        setPendingRemoval(null); setStatus(section ? `Kept ${section.key}.` : t("admin.removalCanceled"));
      }}><AdminText messageKey="admin.keepSection" /></button></div>
    </div>}
    <section className="form-publication-review" aria-labelledby="form-publication-heading">
      <h3 id="form-publication-heading"><AdminText messageKey="admin.publicationReview" /></h3>
      <p>Structural summary: {formStructuralSummary(draft.definition)}.</p>
      <p><AdminText messageKey="admin.publicationCreatesAn" /></p>
      <label htmlFor="form-display-name"><AdminText messageKey="admin.formVersionDisplay" /></label>
      <input id="form-display-name" disabled={!canWrite || busy} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus(t("admin.unsavedChanges")); }} />
      {publicationAllowed ? <>
        <AuthoringLifecycleAction title={t("admin.stationaryForm")} kind="publish" note={publicationNote}
          onNoteChange={setPublicationNote} disabled={busy || dirty || !draft.displayName?.trim() || pendingRemoval !== null || draft.diagnostics.length > 0}
          buttonLabel={t("admin.publishImmutableForm")} onSubmit={() => action(async () => {
            if (!draft.displayName?.trim()) throw new Error(t("admin.enterAForm"));
            if (!publicationNote.trim()) throw new Error(t("admin.enterAPublication"));
            const result = await publishStationaryFormDraft(csrfToken, draft, draft.displayName, publicationNote);
            setPublished(result); setSelectedVersionId(result.id);
            setVersions(await loadStationaryFormVersions());
            setStatus(t("admin.stationaryFormPublished"));
          })} />
        {dirty && <p role="status"><AdminText messageKey="admin.saveTheCurrent" /></p>}
      </> : canWrite && <p role="note">{canPublish
        ? t("admin.publishingIsDisabledForThisInstallationForm")
        : t("admin.formDraftOnlyAccess")}</p>}
    </section>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
