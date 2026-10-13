"use client";
import React, { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { useUnsavedChanges } from "./unsaved-changes";

type Draft = { revision: number; name: string; issuer: string; discoveryUrl: string; clientId: string; scopes: string[];
  mappings: { displayName: string; email: string }; credentialConfigured: boolean; requiredFields: string[];
  discoveryHealth: string; discovery: Record<string, unknown> | null; discoveredAt: string | null };
type View = { groupId: string; draft: Draft | null; active: Draft | null; registration: { hosts: {origin:string;callbackUrl:string;logoutCallbackUrl:string}[]; requiredClaims:string[] };
  history:{revision:number;createdAt:string;actorId:string;credentialConfigured:boolean;discoveryHealth:string}[] };
const empty = { name:"", issuer:"", discoveryUrl:"", clientId:"", scopes:"openid",displayName:"",email:"" };
const fields = Object.keys(empty) as (keyof typeof empty)[];
const labels = { en:["Provider name", "Issuer address", "Discovery address (optional)", "Client ID", "Scopes (space separated)", "Display name claim", "Email claim (optional)"],
  sv:["Leverantörens namn", "Utfärdaradress", "Discovery-adress (valfri)", "Klient-ID", "Scopes (blankstegsseparerade)", "Claim för visningsnamn", "Claim för e-post (valfri)"] };
async function request(csrfToken:string,path="",body?:unknown,method="PUT"):Promise<View> {
  const url=apiRequestUrl(`/api/admin/authentication/oidc${path}`); if(!url) throw new Error("OIDC administration requires a live API");
  const response=await fetch(url,browserRequestInit(body ? {method,headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok) throw await platformRequestError(response); return response.json();
}
export function OidcDraftPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}) {
  const sv=language==="sv";
  const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(""),[password,setPassword]=useState("");
  const [error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const persisted=value?.draft ? {...value.draft,scopes:value.draft.scopes.join(" "),...value.draft.mappings}:empty;
  const dirty=!!secret || fields.some(field=>draft[field]!==persisted[field]);
  const confirmReload=useUnsavedChanges(dirty);
  function load(next:View) {setValue(next);setDraft(next.draft ? {...next.draft,scopes:next.draft.scopes.join(" "),...next.draft.mappings}:empty);setSecret("");setPassword("");}
  useEffect(()=>{let current=true; request(csrfToken).then(next=>{if(current)load(next);}).catch(reason=>{if(current)setError(reason.message);});return ()=>{current=false;};},[csrfToken]);
  async function refresh(){if(!confirmReload())return;setBusy(true);try{load(await request(csrfToken));setError("");}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}
  const healthLabels: Record<string,string> = sv ? {unchecked:"Inte kontrollerad",healthy:"Fungerar",failed:"Misslyckades"} : {unchecked:"Unchecked",healthy:"Healthy",failed:"Failed"};
  const complete=!!draft.name && !!draft.issuer && !!draft.clientId && !!draft.displayName && draft.scopes.split(/\s+/).includes("openid") && (!!secret || !!value?.draft?.credentialConfigured);
  async function mutate(discovery=false){
    setBusy(true);setError("");setStatus("");
    try{await reauthenticateClinicianSession(password,csrfToken);setPassword("");
      const next=await request(csrfToken,discovery?"/discovery":"",discovery?{expectedRevision:value?.draft?.revision}:{expectedRevision:value?.draft?.revision ?? 0,
        name:draft.name,issuer:draft.issuer,discoveryUrl:draft.discoveryUrl,clientId:draft.clientId,scopes:draft.scopes.trim().split(/\s+/).filter(Boolean),
        mappings:{displayName:draft.displayName,email:draft.email},clientAuthentication:"client_secret_post",...(secret?{replacementSecret:secret}:{})},discovery?"POST":"PUT");
      load(next);setStatus(discovery?(next.draft?.discoveryHealth==="healthy"?(sv?"Discovery fungerar":"Discovery healthy"):(sv?"Discovery misslyckades. Aktiv konfiguration behålls.":"Discovery failed. Active configuration retained.")):(sv?"Utkast sparat":"Draft saved"));
    }catch(reason){setSecret("");setPassword("");setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  return <section className="oidc-draft" aria-labelledby="oidc-heading">
    <h3 id="oidc-heading">{sv?"OIDC-leverantörens utkast":"OIDC provider draft"}</h3>
    <p>{sv?"Regional IT måste bekräfta utfärdare, klient-ID, hemlighet, ytterligare scopes och profil-claims. Endast standardens obligatoriska openid-scope är förifylld.":"Regional IT must confirm the issuer, client ID, credential, additional scopes and profile claims. Only the standard required openid scope is prefilled."}</p>
    <p>{sv?"Utkast ändrar inte aktiv inloggning. En riktig testinloggning krävs innan senare aktivering.":"Drafts preserve active login. A real test login is required before later activation."}</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={refresh}>{sv?"Läs om OIDC-utkast":"Reload OIDC draft"}</button>
    {value && <>
      <p>{sv?"Aktiv leverantör":"Active provider"}: {value.active?.name ?? (sv?"Lokal inloggning":"Local login")}</p>
      <form onSubmit={event=>{event.preventDefault();if(canWrite&&!busy&&password)void mutate();}}>
        <fieldset disabled={!canWrite||busy}><legend>{sv?"Leverantörskonfiguration":"Provider configuration"}</legend>
          {fields.map((field,index)=><label key={field} htmlFor={`oidc-${field}`}>{labels[sv?"sv":"en"][index]}{!["discoveryUrl","email"].includes(field)?" *":""}
            <input id={`oidc-${field}`} autoCapitalize={field==="name"?"sentences":"none"} autoCorrect={field==="name"?"on":"off"} spellCheck={field==="name"} type={field==="issuer"||field==="discoveryUrl"?"url":"text"} maxLength={field==="issuer"||field==="discoveryUrl"?2048:field==="clientId"?500:field==="scopes"?2020:field==="displayName"||field==="email"?256:120} value={draft[field]} onChange={event=>setDraft(current=>({...current,[field]:event.target.value}))}/>
          </label>)}
          <p>{sv?"* Krävs för discovery. Ofullständiga utkast kan sparas.":"* Required for discovery. Incomplete drafts can be saved."}</p>
          <p>{sv?"Sparad klienthemlighet":"Saved client secret"}: {value.draft?.credentialConfigured?(sv?"Konfigurerad (dold)":"Configured (hidden)"):(sv?"Inte konfigurerad":"Not configured")}</p>
          <p>{sv?"Byte av utfärdare eller klient-ID kräver en ny hemlighet.":"Changing the issuer or client ID requires a replacement secret."}</p>
          {canWrite && <>
            <label htmlFor="oidc-secret">{sv?"Ersätt klienthemlighet":"Replacement client secret"}<input id="oidc-secret" type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
            <label htmlFor="oidc-password">{sv?"Ditt lösenord för OIDC-ändringar":"Your password for OIDC changes"}<input id="oidc-password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
            <div className="form-actions"><button type="submit" disabled={!dirty||!password||busy}>{sv?"Spara OIDC-utkast":"Save OIDC draft"}</button>
              <button type="button" disabled={!value.draft||dirty||!complete||!password||busy} onClick={()=>void mutate(true)}>{sv?"Kontrollera discovery":"Check discovery"}</button>
              <button type="button" disabled={busy} onClick={()=>{load(value);setError("");}}>{sv?"Avbryt OIDC-ändringar":"Cancel OIDC changes"}</button></div>
          </>}
        </fieldset>
      </form>
      {status && <p role="status">{status}</p>}
      {!complete && <p>{sv?"Discovery kräver namn, HTTPS-utfärdare, klient-ID, openid-scope, visningsnamn och klienthemlighet.":"Discovery requires a name, HTTPS issuer, client ID, openid scope, display name claim and client secret."}</p>}
      <h4>{sv?"Registreringsuppgifter för IT":"Registration details for IT"}</h4>
      <p>{sv?"Authorization code, client_secret_post; S256 PKCE måste bekräftas med regional AD FS v6. Logout-adresser aktiverar inte global regional utloggning.":"Authorization code, client_secret_post; confirm S256 PKCE with regional AD FS v6. Logout addresses do not enable global regional logout."}</p>
      <p>{sv?"Obligatoriska claims":"Required claims"}: {value.registration.requiredClaims.join(", ")}</p>
      {!value.registration.hosts.length && <p>{sv?"Inga registrerade myndighetsvärdar i gruppen.":"No registered agency hosts in this group."}</p>}
      {value.registration.hosts.map(host=><div key={host.origin}><p>{host.origin}</p>{(["callbackUrl","logoutCallbackUrl"] as const).map(key=><label key={key} htmlFor={`oidc-${host.origin}-${key}`}>{key==="callbackUrl"?(sv?"Callback-adress":"Callback URL"):(sv?"Logout callback-adress":"Logout callback URL")}
        <input id={`oidc-${host.origin}-${key}`} readOnly value={host[key]} onFocus={event=>event.target.select()}/></label>)}</div>)}
      <h4>{sv?"Discovery-metadata (skrivskyddad)":"Discovery metadata (read-only)"}</h4>
      <p>{sv?"Status":"Health"}: {healthLabels[value.draft?.discoveryHealth ?? "unchecked"]}</p>
      {value.draft?.discovery && value.draft.discoveryHealth!=="healthy" && <p>{sv?"Visar metadata från den senaste lyckade discovery-kontrollen.":"Showing metadata retained from the last successful discovery check."}</p>}
      {value.draft?.discovery && <dl>{Object.entries(value.draft.discovery).map(([key,item])=><div key={key}><dt>{key}</dt><dd className="oidc-metadata-value">{Array.isArray(item)?item.join(", "):String(item)}</dd></div>)}</dl>}
      <h4>{sv?"Versionshistorik":"Version history"}</h4>
      <ul>{value.history.map(item=><li key={item.revision}>{sv?"Version":"Revision"} {item.revision} — <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(sv?"sv-SE":"en-US")}</time></li>)}</ul>
    </>}
  </section>;
}
