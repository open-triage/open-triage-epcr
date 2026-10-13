"use client";
import { resolveMessage } from "../app/localization";
import React, { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { PersonalAuthenticationField,usePasswordAuthentication } from "./personal-authentication";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { useUnsavedChanges } from "./unsaved-changes";

type Draft = { revision: number; name: string; issuer: string; discoveryUrl: string; clientId: string; scopes: string[];
  mappings: { displayName: string; email: string }; credentialConfigured: boolean; requiredFields: string[];
  discoveryHealth: string; discovery: Record<string, unknown> | null; discoveredAt: string | null };
type View = { activationHistory?:{actorId:string;occurredAt:string;result:string;revision:number}[];test?:{testId?:string;revision:number;result:string;identityOutcome?:string|null;ordinaryAccess?:boolean;failureCode?:string|null;completedAt:string;pkceS256:boolean;freshPersonalAuthentication:boolean}|null; groupId: string; draft: Draft | null; active: Draft | null; registration: { hosts: {origin:string;callbackUrl:string;logoutCallbackUrl:string}[]; requiredClaims:string[] };
  history:{revision:number;createdAt:string;actorId:string;credentialConfigured:boolean;discoveryHealth:string}[] };
const empty = { name:"", issuer:"", discoveryUrl:"", clientId:"", scopes:"openid",displayName:"",email:"" };
const fields = Object.keys(empty) as (keyof typeof empty)[];
async function request(csrfToken:string,path="",body?:unknown,method="PUT"):Promise<View> {
  const url=apiRequestUrl(`/api/admin/authentication/oidc${path}`); if(!url) throw new Error("OIDC administration requires a live API");
  const response=await fetch(url,browserRequestInit(body ? {method,headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok) throw await platformRequestError(response); return response.json();
}
export function OidcDraftPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}) {
  const sv=language==="sv";
  const t=(key:string)=>resolveMessage(language,key);
  const needsPassword=usePasswordAuthentication();
  const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(""),[password,setPassword]=useState("");
  const [error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const persisted=value?.draft ? {...value.draft,scopes:value.draft.scopes.join(" "),...value.draft.mappings}:empty;
  const dirty=!!secret || fields.some(field=>draft[field]!==persisted[field]);
  const confirmReload=useUnsavedChanges(dirty);
  function load(next:View) {setValue(next);setDraft(next.draft ? {...next.draft,scopes:next.draft.scopes.join(" "),...next.draft.mappings}:empty);setSecret("");setPassword("");}
  useEffect(()=>{let current=true; request(csrfToken).then(next=>{if(current)load(next);}).catch(reason=>{if(current)setError(reason.message);});return ()=>{current=false;};},[csrfToken]);
  async function refresh(){if(!confirmReload())return;setBusy(true);try{load(await request(csrfToken));setError("");}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}
  const failures:Record<string,string>=Object.fromEntries(["canceled","expired","draft_changed","origin_changed","authority_changed","provider_validation","transaction_invalid"].map(code=>[code,t(`admin.oidcFailure${code.split("_").map(part=>part[0]!.toUpperCase()+part.slice(1)).join("")}`)]));
  const healthLabels:Record<string,string>=Object.fromEntries(["unchecked","healthy","failed"].map(code=>[code,t(`admin.oidcHealth${code[0]!.toUpperCase()+code.slice(1)}`)]));
  const complete=!!draft.name && !!draft.issuer && !!draft.clientId && !!draft.displayName && draft.scopes.split(/\s+/).includes("openid") && (!!secret || !!value?.draft?.credentialConfigured);
  async function mutate(discovery=false){
    setBusy(true);setError("");setStatus("");
    try{await reauthenticateClinicianSession(password,csrfToken);setPassword("");
      const next=await request(csrfToken,discovery?"/discovery":"",discovery?{expectedRevision:value?.draft?.revision}:{expectedRevision:value?.draft?.revision ?? 0,
        name:draft.name,issuer:draft.issuer,discoveryUrl:draft.discoveryUrl,clientId:draft.clientId,scopes:draft.scopes.trim().split(/\s+/).filter(Boolean),
        mappings:{displayName:draft.displayName,email:draft.email},clientAuthentication:"client_secret_post",...(secret?{replacementSecret:secret}:{})},discovery?"POST":"PUT");
      load(next);setStatus(discovery?(next.draft?.discoveryHealth==="healthy"?(t("admin.oidcDiscoveryHealthy")):(t("admin.oidcDiscoveryFailed"))):(t("admin.oidcDraftSaved")));
    }catch(reason){setSecret("");setPassword("");setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function activate(){
    setBusy(true);setError("");setStatus("");
    try {
      await reauthenticateClinicianSession(password,csrfToken);setPassword("");
      load(await request(csrfToken,"/activate",{expectedRevision:value?.draft?.revision,testId:value?.test?.testId},"POST"));
      setStatus(t("admin.oidcActivated"));
      window.dispatchEvent(new Event("open-triage.authentication-policy-changed"));
    } catch(reason){setPassword("");setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }
  async function testLogin(){
    setBusy(true);setError("");
    try{await reauthenticateClinicianSession(password,csrfToken);setPassword("");
      const url=apiRequestUrl("/api/admin/authentication/oidc/test");if(!url)throw new Error("OIDC test requires a live API");
      const response=await fetch(url,browserRequestInit({method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify({expectedRevision:value?.draft?.revision})}));
      if(!response.ok)throw await platformRequestError(response);
      const result=await response.json();window.location.assign(result.authorizationUrl);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setBusy(false);}
  }
  return <section className="oidc-draft" aria-labelledby="oidc-heading">
    <h3 id="oidc-heading">{t("admin.oidcDraftTitle")}</h3>
    <p>{t("admin.oidcRegistrationHelp")}</p>
    <p>{t("admin.oidcDraftHelp")}</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={refresh}>{t("admin.oidcReload")}</button>
    {value && <>
      <p>{t("admin.oidcActiveProvider")}: {value.active?.name ?? (t("admin.oidcLocalLogin"))}</p>
      <form onSubmit={event=>{event.preventDefault();if(canWrite&&!busy&&(!needsPassword||password))void mutate();}}>
        <fieldset disabled={!canWrite||busy}><legend>{t("admin.oidcConfiguration")}</legend>
          {fields.map((field,index)=><label key={field} htmlFor={`oidc-${field}`}>{t(["admin.oidcName","admin.oidcIssuer","admin.oidcDiscovery","admin.oidcClient","admin.oidcScopes","admin.oidcDisplayClaim","admin.oidcEmailClaim"][index]!)}{!["discoveryUrl","email"].includes(field)?" *":""}
            <input id={`oidc-${field}`} autoCapitalize={field==="name"?"sentences":"none"} autoCorrect={field==="name"?"on":"off"} spellCheck={field==="name"} type={field==="issuer"||field==="discoveryUrl"?"url":"text"} maxLength={field==="issuer"||field==="discoveryUrl"?2048:field==="clientId"?500:field==="scopes"?2020:field==="displayName"||field==="email"?256:120} value={draft[field]} onChange={event=>setDraft(current=>({...current,[field]:event.target.value}))}/>
          </label>)}
          <p>{t("admin.oidcRequiredHelp")}</p>
          <p>{t("admin.oidcSavedSecret")}: {value.draft?.credentialConfigured?(t("admin.oidcSecretConfigured")):(t("admin.oidcSecretMissing"))}</p>
          <p>{t("admin.oidcSecretReplacementHelp")}</p>
          {canWrite && <>
            <label htmlFor="oidc-secret">{t("admin.oidcReplacementSecret")}<input id="oidc-secret" type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
            <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={resolveMessage(language,"admin.personalPasswordOidc")}/>
            <div className="form-actions"><button type="submit" disabled={!dirty||(needsPassword&&!password)||busy}>{t("admin.oidcSave")}</button>
              <button type="button" disabled={!value.draft||dirty||!complete||(needsPassword&&!password)||busy} onClick={()=>void mutate(true)}>{t("admin.oidcInspect")}</button>
              <button type="button" disabled={!value.draft||dirty||value.draft.discoveryHealth!=="healthy"||(needsPassword&&!password)||busy} onClick={()=>void testLogin()}>{t("admin.oidcTest")}</button>
              <button type="button" disabled={!value.draft||dirty||value.active?.revision===value.draft.revision||value.test?.result!=="succeeded"||value.test.revision!==value.draft.revision||!value.test.testId||value.draft.discoveryHealth!=="healthy"||(needsPassword&&!password)||busy} onClick={()=>void activate()}>{t("admin.oidcActivate")}</button>
              <button type="button" disabled={busy} onClick={()=>{load(value);setError("");}}>{t("admin.oidcCancel")}</button></div>
          </>}
        </fieldset>
      </form>
      {status && <p role="status">{status}</p>}
      {!complete && <p>{t("admin.oidcIncompleteHelp")}</p>}
      <p>{t("admin.oidcActivationHelp")}</p>
      <h4>{t("admin.oidcTestTitle")}</h4>
      <p>{value.test ? `${t("admin.oidcRevision")} ${value.test.revision}: ${value.test.result==="succeeded"?(t("admin.oidcIdentityValidated")):value.test.result==="canceled"?(t("admin.oidcCanceled")):(t("admin.oidcTestFailed"))}. S256 PKCE: ${value.test.pkceS256?(t("admin.oidcYes")):(t("admin.oidcNo"))}.` : (t("admin.oidcNoTest"))}</p>
      {value.test?.identityOutcome && <p role="status">{value.test.identityOutcome==="linked"?(t("admin.oidcIdentityLinked")):(t("admin.oidcIdentityPending"))}</p>}
      {value.test?.failureCode && <p role="alert">{failures[value.test.failureCode] ?? failures.transaction_invalid}</p>}
      <p>{t("admin.oidcDiagnosticHelp")}</p>
      <h4>{t("admin.oidcRegistrationTitle")}</h4>
      <p>{t("admin.oidcProtocolHelp")}</p>
      <p>{t("admin.oidcRequiredClaims")}: {value.registration.requiredClaims.join(", ")}</p>
      {!value.registration.hosts.length && <p>{t("admin.oidcNoHosts")}</p>}
      {value.registration.hosts.map(host=><div key={host.origin}><p>{host.origin}</p>{(["callbackUrl","logoutCallbackUrl"] as const).map(key=><label key={key} htmlFor={`oidc-${host.origin}-${key}`}>{key==="callbackUrl"?(t("admin.oidcCallback")):(t("admin.oidcLogoutCallback"))}
        <input id={`oidc-${host.origin}-${key}`} readOnly value={host[key]} onFocus={event=>event.target.select()}/></label>)}</div>)}
      <h4>{t("admin.oidcDiscoveryTitle")}</h4>
      <p>{t("admin.oidcHealth")}: {healthLabels[value.draft?.discoveryHealth ?? "unchecked"]}</p>
      {value.draft?.discovery && value.draft.discoveryHealth!=="healthy" && <p>{t("admin.oidcRetainedDiscovery")}</p>}
      {value.draft?.discovery && <dl>{Object.entries(value.draft.discovery).map(([key,item])=><div key={key}><dt>{key}</dt><dd className="oidc-metadata-value">{Array.isArray(item)?item.join(", "):String(item)}</dd></div>)}</dl>}
      <h4>{t("admin.oidcActivationHistory")}</h4>
      <ul>{(value.activationHistory??[]).map((item,index)=><li key={index}>{t("admin.oidcRevision")} {item.revision} — {t(item.result==='succeeded'?"admin.oidcActivationSucceeded":"admin.oidcActivationFailed")} — {item.actorId} — <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString(sv?"sv-SE":"en-US")}</time></li>)}</ul>
      <h4>{t("admin.oidcHistory")}</h4>
      <ul>{value.history.map(item=><li key={item.revision}>{t("admin.oidcRevision")} {item.revision} — <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(sv?"sv-SE":"en-US")}</time></li>)}</ul>
    </>}
  </section>;
}
