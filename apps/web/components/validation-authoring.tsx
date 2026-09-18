"use client";

import type { PublishedValidationVersion, ValidationDraft, ValidationDraftResult } from "@open-triage/contracts";
import React, { useEffect, useState } from "react";
import { activateValidationVersion, createValidationDraft, loadValidationDraft, publishValidationDraft,
  saveValidationDraft, validateValidationDraft } from "../app/admin-context";

export function ValidationAuthoring({ csrfToken, capabilities, catalogReleaseId, onActivated }: {
  readonly csrfToken: string;
  readonly capabilities: readonly string[];
  readonly catalogReleaseId: string;
  readonly onActivated?: () => void;
}) {
  const canWrite = capabilities.includes("catalog:write");
  const canPublish = capabilities.includes("catalog:publish");
  const [draft, setDraft] = useState<ValidationDraft | null>(null);
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

  useEffect(() => {
    let current = true;
    loadValidationDraft().then((value) => { if (current) setDraft(value); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Validation draft is unavailable."); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, []);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Validation operation failed."); }
    finally { setBusy(false); }
  }
  function change(update: (current: ValidationDraft) => ValidationDraft) {
    setDraft((current) => current ? update(current) : current); setDirty(true); setValidation(null); setStatus("Unsaved changes.");
  }
  if (!loaded) return <p role="status">Loading Validation draft…</p>;
  if (!draft) return <div className="form-empty">
    {canWrite ? <>
      <p>Create a Validation draft bound to the active published Element catalog.</p>
      <label htmlFor="validation-name">Validation version display name</label>
      <input id="validation-name" maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <button type="button" disabled={busy || !catalogReleaseId || !displayName.trim()} onClick={() => action(async () => {
        setDraft(await createValidationDraft(csrfToken, catalogReleaseId, displayName));
        setStatus("Validation draft created with one required-element rule.");
      })}>Create Validation draft</button>
    </> : <p role="note">No Validation draft is available.</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </div>;

  if (published) return <div className="form-publication">
    <h3>Published {published.displayName}</h3>
    <p>Version {published.version} and rule {published.ruleId} are immutable and bound to catalog {published.catalogReleaseId}.</p>
    <label htmlFor="validation-activation-note">Activation note</label>
    <textarea id="validation-activation-note" value={activationNote} onChange={(event) => setActivationNote(event.target.value)} />
    <button type="button" disabled={busy || !canPublish || !activationNote.trim()} onClick={() => action(async () => {
      await activateValidationVersion(csrfToken, published.id, activationNote); setStatus("Validation activated for new reports."); onActivated?.();
    })}>Activate for clinical use</button>
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;

  return <div className="form-editor">
    <p>Draft revision {draft.revision}, bound to published catalog {draft.catalogReleaseId}.</p>
    <label htmlFor="validation-display-name">Validation version display name</label>
    <input id="validation-display-name" disabled={!canWrite} value={draft.displayName}
      onChange={(event) => change((current) => ({ ...current, displayName: event.target.value }))} />
    <fieldset disabled={!canWrite}>
      <legend>Unconditional required-element rule</legend>
      <label htmlFor="validation-rule-name">Rule name</label>
      <input id="validation-rule-name" value={draft.rule.name}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, name: event.target.value } }))} />
      <label htmlFor="validation-element-id">Primary target element ID</label>
      <input id="validation-element-id" value={draft.rule.primaryTargetElementId}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, primaryTargetElementId: event.target.value } }))} />
      <label htmlFor="validation-message">Finding message</label>
      <input id="validation-message" value={draft.rule.message}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, message: event.target.value } }))} />
      <label htmlFor="validation-source">Rule source</label>
      <textarea id="validation-source" spellCheck={false} value={draft.rule.source}
        onChange={(event) => change((current) => ({ ...current, rule: { ...current.rule, source: event.target.value } }))} />
      <small>Grammar: assert present(&quot;element-id&quot;). The rule runs live and during signing as an error.</small>
    </fieldset>
    {validation && <div role={validation.valid ? "status" : "alert"}>
      {validation.valid ? <p>Rule source, catalog reference, compiled representation, and finding target are valid.</p>
        : <ul>{validation.diagnostics.map((item) => <li key={`${item.ruleId}:${item.code}`}>{item.message}</li>)}</ul>}
    </div>}
    <div className="form-actions">
      {canWrite && <button type="button" disabled={busy || !dirty} onClick={() => action(async () => {
        const saved = await saveValidationDraft(csrfToken, draft); setDraft(saved); setDirty(false); setStatus(`Saved draft revision ${saved.revision}.`);
      })}>Save Validation draft</button>}
      <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateValidationDraft(csrfToken, draft.id); setValidation(result);
        setStatus(result.valid ? "Validation succeeded." : "Validation found errors.");
      })}>Validate rule</button>
    </div>
    {canPublish && <section className="form-publication-review">
      <h3>Publication review</h3>
      <p>Publication creates immutable version and rule identities. Activation is a separate action.</p>
      <label htmlFor="validation-change-note">Publication note</label>
      <textarea id="validation-change-note" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
      <button type="button" disabled={busy || dirty || !validation?.valid || !changeNote.trim()} onClick={() => action(async () => {
        setPublished(await publishValidationDraft(csrfToken, draft, changeNote)); setStatus("Validation version published.");
      })}>Publish immutable Validation version</button>
    </section>}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
  </div>;
}
