"use client";
import { resolveMessage } from "../app/localization";
import React, { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { PersonalAuthenticationField,usePasswordAuthentication } from "./personal-authentication";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { useUnsavedChanges } from "./unsaved-changes";

import { RegionalIdentitiesPanel } from "./regional-identities";
import { OidcDraftPanel } from "./oidc-draft";

type Policy = import("@open-triage/contracts").GroupAuthenticationPolicyView;
const fields = ["maximumSessionHours", "temporaryPasswordHours", "accountAttemptsPer15Minutes", "networkAttemptsPer5Minutes"] as const;
const labels = { en: ["Maximum session duration (hours)", "Temporary password expiry (hours)", "Account attempts per 15 minutes", "Network attempts per 5 minutes"],
  sv: ["Maximal sessionslängd (timmar)", "Tillfälligt lösenords giltighet (timmar)", "Kontoförsök per 15 minuter", "Nätverksförsök per 5 minuter"] };
async function request(csrfToken: string, body?: unknown): Promise<Policy> {
  const url = apiRequestUrl("/api/admin/authentication");
  if (!url) throw new Error("Authentication administration requires a live API");
  const response = await fetch(url, browserRequestInit(body ? { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) } : {}));
  if (!response.ok) throw await platformRequestError(response);
  return response.json();
}
export function AuthenticationPolicyPanel({ language, csrfToken, canWrite, canReviewIdentities=false, canLinkIdentities=false, canApproveIdentities=false }: { language: string; csrfToken: string; canWrite: boolean; canReviewIdentities?:boolean;canLinkIdentities?:boolean;canApproveIdentities?:boolean }) {
  const sv = language === "sv";
  const needsPassword=usePasswordAuthentication();
  const [tab,setTab]=useState<"provider"|"identities">("provider");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = !!policy && fields.some(field => draft[field] !== String(policy[field]));
  const confirmReload = useUnsavedChanges(dirty);
  function loaded(value: Policy) { setPolicy(value); setDraft(Object.fromEntries(fields.map(field => [field, String(value[field])]))); }
  useEffect(() => { let current = true; request(csrfToken).then(value => { if (current) loaded(value); }).catch(reason => { if (current) setError(reason.message); }); return () => { current = false; }; }, [csrfToken]);
  const valid = fields.every((field, index) => Number.isInteger(Number(draft[field])) && Number(draft[field]) >= 1 && Number(draft[field]) <= (index < 2 ? 168 : 1000));
  return <section className="admin-configuration agency-settings authentication-policy" aria-labelledby="authentication-heading">
    <h2 id="authentication-heading">{sv ? "Autentisering" : "Authentication"}</h2>
    {canReviewIdentities&&<nav className="form-actions" aria-label={sv?"Autentiseringsuppgifter":"Authentication tasks"}><button type="button" aria-pressed={tab==="provider"} onClick={()=>setTab("provider")}>{sv?"Policy och leverantör":"Policy and provider"}</button><button type="button" aria-pressed={tab==="identities"} onClick={()=>setTab("identities")}>{sv?"Regionala identiteter":"Regional identities"}</button></nav>}
    <div hidden={tab!=="provider"}>
    {error && <><p role="alert" className="admin-error">{error}</p><button type="button" disabled={busy} onClick={() => { if (!confirmReload()) return; setBusy(true); request(csrfToken).then(value => { loaded(value); setError(""); }).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>{sv ? "Läs om effektiv policy" : "Reload effective policy"}</button></>}
    {!policy && <button type="button" disabled={busy} onClick={() => { setBusy(true); request(csrfToken).then(loaded).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>{sv ? "Läs in policy" : "Load policy"}</button>}
    {policy && <>
      <p>{sv ? "Lokal inloggning. Gruppens policy gäller för alla underliggande organisationer." : "Local login. The group policy applies to every child agency."}</p>
      <p>{sv ? "Ägande grupp" : "Owning group"}: {policy.groupName} {policy.inherited && (sv ? "(ärvd)" : "(inherited)")}</p>
      <p>{sv ? "Minst 12 tecken. Befintliga lösenordsregler gäller." : "Minimum 12 characters. Existing password rules apply."}</p>
      <form onSubmit={async event => {
        event.preventDefault(); if (!valid || !canWrite || busy) return;
        setBusy(true); setError(""); setStatus("");
        try {
          await reauthenticateClinicianSession(password, csrfToken); setPassword("");
          const updated = await request(csrfToken, { expectedRevision: policy.revision, ...Object.fromEntries(fields.map(field => [field, Number(draft[field])])) });
          loaded(updated); setStatus(sv ? "Sparad" : "Saved");
        } catch (reason) { setPassword(""); setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={!canWrite || busy}>
          <legend>{sv ? "Effektiv gruppolicy" : "Effective group policy"}</legend>
          {fields.map((field,index) => <label key={field} htmlFor={`auth-${field}`}>{labels[sv ? "sv" : "en"][index]}
            <input id={`auth-${field}`} type="number" min="1" max={index < 2 ? 168 : 1000} required step="1" value={draft[field] ?? ""}
              onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /></label>)}
          {canWrite && <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={resolveMessage(language,"admin.personalPasswordToSave")}/>}
          {!valid && <p role="alert">{sv ? "Ange heltal: 1–168 timmar och 1–1000 försök." : "Enter whole numbers: 1–168 hours and 1–1000 attempts."}</p>}
          {canWrite && <div className="form-actions"><button type="submit" disabled={!dirty || !valid || (needsPassword && !password) || busy}>{sv ? "Spara gruppolicy" : "Save group policy"}</button>
            <button type="button" disabled={busy} onClick={() => { loaded(policy); setPassword(""); setError(""); }}>{sv ? "Avbryt" : "Cancel"}</button></div>}
        </fieldset>
      </form>
      <p role="status">{status}</p>
      <h3>{sv ? "Ändringshistorik" : "Change history"}</h3>
      <ul className="authentication-policy-history">{policy.history.map((event,index) => <li key={index}><details><summary>{event.displayName ?? event.actorId} — <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString(sv ? "sv-SE" : "en-US")}</time></summary><dl>{fields.map((field, index) => <div key={field}><dt>{labels[sv ? "sv" : "en"][index]}</dt><dd>{event.details.prior?.[field]} → {event.details.policy?.[field]}</dd></div>)}</dl></details></li>)}</ul>
    <OidcDraftPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>
    </>}
    </div>
    {canReviewIdentities&&<div hidden={tab!=="identities"}><RegionalIdentitiesPanel language={language} csrfToken={csrfToken} canLink={canLinkIdentities} canApprove={canApproveIdentities}/></div>}
  </section>;
}
