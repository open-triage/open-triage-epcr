"use client";
import { ProductionWorkflowPanel } from "./production-workflow";
import { resolveMessage } from "../app/localization";
import React, { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { PersonalAuthenticationField,usePasswordAuthentication } from "./personal-authentication";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { useUnsavedChanges } from "./unsaved-changes";

import { OidcDraftPanel } from "./oidc-draft";

type Policy = import("@open-triage/contracts").GroupAuthenticationPolicyView;
const fields = ["maximumSessionHours", "temporaryPasswordHours", "accountAttemptsPer15Minutes", "networkAttemptsPer5Minutes"] as const;
const fieldLabels = {maximumSessionHours: "admin.authenticationMaximumSessionHours", temporaryPasswordHours: "admin.authenticationTemporaryPasswordHours", accountAttemptsPer15Minutes: "admin.authenticationAccountAttemptsPer15Minutes", networkAttemptsPer5Minutes: "admin.authenticationNetworkAttemptsPer5Minutes"} as const;
async function request(language: string, csrfToken: string, body?: unknown): Promise<Policy> {
  const url = apiRequestUrl("/api/admin/authentication");
  if (!url) throw new Error(resolveMessage(language,"admin.authenticationApiRequired"));
  const response = await fetch(url, browserRequestInit(body ? { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) } : {}));
  if (!response.ok) throw await platformRequestError(response);
  return response.json();
}
export function AuthenticationPolicyPanel({ language, csrfToken, canWrite }: { language: string; csrfToken: string; canWrite: boolean }) {
  const sv = language === "sv";
  const t = (key: string) => resolveMessage(language,key);
  const needsPassword=usePasswordAuthentication();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = !!policy && fields.some(field => draft[field] !== String(policy[field]));
  const confirmReload = useUnsavedChanges(dirty);
  function loaded(value: Policy) { setPolicy(value); setDraft(Object.fromEntries(fields.map(field => [field, String(value[field])]))); }
  useEffect(() => { let current = true; request(language, csrfToken).then(value => { if (current) loaded(value); }).catch(reason => { if (current) setError(reason.message); }); return () => { current = false; }; }, [csrfToken,language]);
  useEffect(()=>{
    const refresh=()=>{request(language, csrfToken).then(loaded).catch(reason=>setError(reason.message));};
    window.addEventListener("open-triage.authentication-policy-changed",refresh);
    return ()=>window.removeEventListener("open-triage.authentication-policy-changed",refresh);
  },[csrfToken,language]);
  const valid = fields.every((field, index) => Number.isInteger(Number(draft[field])) && Number(draft[field]) >= 1 && Number(draft[field]) <= (index < 2 ? 168 : 1000));
  return <section className="admin-configuration agency-settings authentication-policy" aria-labelledby="authentication-heading">
    <h2 id="authentication-heading">{t("admin.authentication")}</h2>
    {error && <><p role="alert" className="admin-error">{error}</p><button type="button" disabled={busy} onClick={() => { if (!confirmReload()) return; setBusy(true); request(language, csrfToken).then(value => { loaded(value); setError(""); }).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>{t("admin.authenticationReloadPolicy")}</button></>}
    {!policy && <button type="button" disabled={busy} onClick={() => { setBusy(true); request(language, csrfToken).then(loaded).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>{t("admin.authenticationLoadPolicy")}</button>}
    {policy && <>
      <p>{resolveMessage(language,policy.mode==="oidc"?"admin.authenticationModeOidc":"admin.authenticationModeLocal")}</p>
      <p>{t("admin.authenticationOwningGroup")}: {policy.groupName} {policy.inherited && t("admin.authenticationInherited")}</p>
      <p>{t("admin.authenticationPasswordRules")}</p>
      <form onSubmit={async event => {
        event.preventDefault(); if (!valid || !canWrite || busy) return;
        setBusy(true); setError(""); setStatus("");
        try {
          await reauthenticateClinicianSession(password, csrfToken); setPassword("");
          const updated = await request(language, csrfToken, { expectedRevision: policy.revision, ...Object.fromEntries(fields.map(field => [field, Number(draft[field])])) });
          loaded(updated); setStatus(t("admin.authenticationSaved"));
        } catch (reason) { setPassword(""); setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={!canWrite || busy}>
          <legend>{t("admin.authenticationEffectivePolicy")}</legend>
          {fields.map((field,index) => <label key={field} htmlFor={`auth-${field}`}>{t(fieldLabels[field])}
            <input id={`auth-${field}`} type="number" min="1" max={index < 2 ? 168 : 1000} required step="1" value={draft[field] ?? ""}
              onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /></label>)}
          {canWrite && <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={resolveMessage(language,"admin.personalPasswordToSave")}/>}
          {!valid && <p role="alert">{t("admin.authenticationValidNumbers")}</p>}
          {canWrite && <div className="form-actions"><button type="submit" disabled={!dirty || !valid || (needsPassword && !password) || busy}>{t("admin.authenticationSavePolicy")}</button>
            <button type="button" disabled={busy} onClick={() => { loaded(policy); setPassword(""); setError(""); }}>{t("admin.cancel")}</button></div>}
        </fieldset>
      </form>
      <p role="status">{status}</p>
      <h3>{t("admin.authenticationHistory")}</h3>
      <ul className="authentication-policy-history">{policy.history.map((event,index) => <li key={index}><details><summary>{event.displayName ?? event.actorId} — <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString(sv ? "sv-SE" : "en-US")}</time></summary><dl>{fields.map((field) => <div key={field}><dt>{t(fieldLabels[field])}</dt><dd>{event.details.prior?.[field]} → {event.details.policy?.[field]}</dd></div>)}</dl></details></li>)}</ul>
    <ProductionWorkflowPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>
    <OidcDraftPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>
    </>}
  </section>;
}
