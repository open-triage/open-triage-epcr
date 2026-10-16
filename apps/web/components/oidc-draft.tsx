"use client";
import { resolveMessage } from "../app/localization";
import React, { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { platformRequestError } from "../app/platform-errors";
import { useUnsavedChanges } from "./unsaved-changes";

type Draft = { revision: number; name: string; issuer: string; discoveryUrl: string; clientId: string; scopes: string[];
  mappings: { displayName: string; email: string; username?: string }; credentialConfigured: boolean; requiredFields: string[];
  personalProof?:{id:string;acr:string|null;requiredAmr:string[];purposeClaim?:string;purposes?:{login:string;switch:string;reauthenticate:string}}|null;
  privateOrigins?:string[];
  discoveryHealth: string; discovery: Record<string, unknown> | null; discoveredAt: string | null };
type View = { groupName?:string;agencyCount?:number;credentialKeyVersion?:number;activeSnapshotReady?:boolean;activationHistory?:{actorId:string;actorName?:string|null;occurredAt:string;result:string;revision:number}[];test?:{testId?:string;revision:number;result:string;identityOutcome?:string|null;ordinaryAccess?:boolean;failureCode?:string|null;completedAt:string;pkceS256:boolean;freshPersonalAuthentication:boolean}|null; groupId: string; draft: Draft | null; active: Draft | null; registration: { hosts: {origin:string;callbackUrl:string;logoutCallbackUrl:string}[]; requiredClaims:string[] };
  identityImpact?:{integrationChanged:boolean;activeRevision:number|null;draftRevision:number|null;linkedIdentities:number};
  history:{revision:number;createdAt:string;actorId:string;actorName?:string|null;credentialConfigured:boolean;discoveryHealth:string;status?:string;changedFields?:string[];credentialReplaced?:boolean}[] };
const providerFields=["name","issuer","discoveryUrl","clientId","scopes","displayName","email","username"] as const;
const empty = { name:"", issuer:"", discoveryUrl:"", clientId:"", scopes:"openid",displayName:"",email:"",username:"preferred_username",
  proofEnabled:"no",proofId:"agency-personal-contract-v1",requireAcr:"yes",acr:"",amr:"",purposeClaim:"",loginPurpose:"",switchPurpose:"",reauthenticatePurpose:"",privateOrigins:"" };
function editable(value:Draft|null|undefined){
 if(!value)return empty;
 const proof=value.personalProof;
 return {...empty,...value,scopes:value.scopes.join(" "),...value.mappings,username:value.mappings.username??"preferred_username",proofEnabled:proof?"yes":"no",proofId:proof?.id??empty.proofId,
  requireAcr:proof?.acr===null?"no":"yes",acr:proof?.acr??"",amr:proof?.requiredAmr.join(" ")??"",purposeClaim:proof?.purposeClaim??"",
  loginPurpose:proof?.purposes?.login??"",switchPurpose:proof?.purposes?.switch??"",reauthenticatePurpose:proof?.purposes?.reauthenticate??"",privateOrigins:value.privateOrigins?.join("\n")??""};
}
const fields = Object.keys(empty) as (keyof typeof empty)[];
async function request(csrfToken:string,path="",body?:unknown,method="PUT"):Promise<View> {
  const url=apiRequestUrl(`/api/admin/authentication/oidc${path}`); if(!url) throw new Error("OIDC administration requires a live API");
  const response=await fetch(url,browserRequestInit(body ? {method,headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok) throw await platformRequestError(response); return response.json();
}
export function OidcDraftPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}) {
  const t=(key:string)=>resolveMessage(language,key);
  const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState("");
  const [error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const [identityAcknowledged,setIdentityAcknowledged]=useState(false);
  const persisted=editable(value?.draft);
  const dirty=!!secret || fields.some(field=>draft[field]!==persisted[field]);
  const confirmReload=useUnsavedChanges(dirty);
  function load(next:View) {setValue(next);setDraft(editable(next.draft));setSecret("");setIdentityAcknowledged(false);}
  useEffect(()=>{let current=true; request(csrfToken).then(next=>{if(current)load(next);}).catch(reason=>{if(current)setError(reason.message);});return ()=>{current=false;};},[csrfToken]);
  async function refresh(){if(!confirmReload())return;setBusy(true);try{load(await request(csrfToken));setError("");}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}
  const failures:Record<string,string>=Object.fromEntries(["canceled","expired","draft_changed","origin_changed","authority_changed","provider_validation","transaction_invalid"].map(code=>[code,t(`admin.oidcFailure${code.split("_").map(part=>part[0]!.toUpperCase()+part.slice(1)).join("")}`)]));
  const complete=!!draft.name && !!draft.issuer && !!draft.clientId && !!draft.displayName && draft.scopes.split(/\s+/).includes("openid") && (!!secret || !!value?.draft?.credentialConfigured);
  const discoveryBlocker=busy?null:!value?.draft?"admin.oidcDiscoverySaveFirst":dirty?"admin.oidcDiscoverySaveChanges":!complete?"admin.oidcIncompleteHelp":null;
  const integrationChanging=!!value?.active && (draft.issuer!==value.active.issuer || draft.clientId!==value.active.clientId || !dirty&&!!value.identityImpact?.integrationChanged);
  const hasNewDraft=!!value?.draft && value.draft.revision!==value.active?.revision;
  const tested=!!value?.draft && value.test?.revision===value.draft.revision && value.test.result==="succeeded" && !!value.test.testId;
  const nextAction=dirty || !hasNewDraft ? null : value?.draft?.discoveryHealth!=="healthy" ? "discovery" : tested ? "activate" : "test";
  async function copyActive(){
    if(!value?.active || !confirmReload())return;
    setBusy(true);setError("");setStatus("");
    try{
      load(await request(csrfToken,"",{expectedRevision:value.draft?.revision??0,copyActiveRevision:value.active.revision}));
      setStatus(t("admin.oidcDraftSaved"));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function mutate(discovery=false){
    setBusy(true);setError("");setStatus("");
    try{
      const next=await request(csrfToken,discovery?"/discovery":"",discovery?{expectedRevision:value?.draft?.revision}:{expectedRevision:value?.draft?.revision ?? 0,
        name:draft.name,issuer:draft.issuer,discoveryUrl:draft.discoveryUrl,clientId:draft.clientId,scopes:draft.scopes.trim().split(/\s+/).filter(Boolean),
        mappings:{displayName:draft.displayName,email:draft.email,username:draft.username},
        personalProof:draft.proofEnabled==="yes"?{id:draft.proofId,acr:draft.requireAcr==="yes"?draft.acr:null,requiredAmr:draft.amr.trim().split(/\s+/).filter(Boolean),
          ...(draft.purposeClaim?{purposeClaim:draft.purposeClaim,purposes:{login:draft.loginPurpose,switch:draft.switchPurpose,reauthenticate:draft.reauthenticatePurpose}}:{})}:null,
        privateOrigins:draft.privateOrigins.trim().split(/\s+/).filter(Boolean),clientAuthentication:"client_secret_post",...(secret?{replacementSecret:secret}:{})},discovery?"POST":"PUT");
      load(next);setStatus(discovery?(next.draft?.discoveryHealth==="healthy"?(t("admin.oidcDiscoveryHealthy")):(t("admin.oidcDiscoveryFailed"))):(t("admin.oidcDraftSaved")));
    }catch(reason){setSecret("");setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function rotateKey(){
    setBusy(true);setError("");setStatus("");
    try{load(await request(csrfToken,"/keys/rotate",{expectedVersion:value?.credentialKeyVersion??0},"POST"));setStatus(t("admin.oidcKeyRotated"));}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function activate(){
    setBusy(true);setError("");setStatus("");
    try {

      load(await request(csrfToken,"/activate",{expectedRevision:value?.draft?.revision,testId:value?.test?.testId,
        ...(value?.identityImpact?.integrationChanged && identityAcknowledged?{identityChangeAcknowledgment:{activeRevision:value.identityImpact.activeRevision,draftRevision:value.identityImpact.draftRevision}}:{})},"POST"));
      setStatus(t("admin.oidcActivated"));
      window.dispatchEvent(new Event("open-triage.authentication-policy-changed"));
    } catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }
  async function testLogin(){
    setBusy(true);setError("");
    try{
      const url=apiRequestUrl("/api/admin/authentication/oidc/test");if(!url)throw new Error("OIDC test requires a live API");
      const response=await fetch(url,browserRequestInit({method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify({expectedRevision:value?.draft?.revision})}));
      if(!response.ok)throw await platformRequestError(response);
      const result=await response.json();window.location.assign(result.authorizationUrl);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);} // A canceled beforeunload prompt leaves this document open.
  }
  return <section className="oidc-draft" aria-labelledby="oidc-heading">
    <h3 id="oidc-heading">{t("admin.oidcDraftTitle")}</h3>
    {error && !value && <p className="admin-error" role="alert">{error}</p>}
    {error && <button type="button" disabled={busy} onClick={refresh}>{t("admin.oidcReload")}</button>}
    {value && <>
      <p>{t("admin.oidcActiveProvider")}: {value.active?.name ?? (t("admin.oidcLocalLogin"))}</p>
      {value.active && <p>{t("admin.oidcActiveRevision")}: {value.active.revision}</p>}
      {value.active && value.activeSnapshotReady===false && <p role="alert">{t("admin.oidcActiveEvidenceRequired")}</p>}
      {canWrite && value.active && <div className="form-actions"><button type="button" disabled={busy} onClick={()=>void copyActive()}>{t("admin.oidcCopyActive")}</button></div>}
      <form onSubmit={event=>{event.preventDefault();if(canWrite&&dirty&&!busy)void mutate();}}>
        <fieldset disabled={!canWrite||busy}><legend>{t("admin.oidcConfiguration")}</legend>
          {providerFields.map((field,index)=><label key={field} htmlFor={`oidc-${field}`}>{t(["admin.oidcName","admin.oidcIssuer","admin.oidcDiscovery","admin.oidcClient","admin.oidcScopes","admin.oidcDisplayClaim","admin.oidcEmailClaim","admin.oidcUsernameClaim"][index]!)}{!["discoveryUrl","email","username"].includes(field)?" *":""}
            <input id={`oidc-${field}`} autoCapitalize={field==="name"?"sentences":"none"} autoCorrect={field==="name"?"on":"off"} spellCheck={field==="name"} type={field==="issuer"||field==="discoveryUrl"?"url":"text"} maxLength={field==="issuer"||field==="discoveryUrl"?2048:field==="clientId"?500:field==="scopes"?2020:field==="displayName"||field==="email"||field==="username"?256:120} value={draft[field]} onChange={event=>setDraft(current=>({...current,[field]:event.target.value}))}/>
          </label>)}
          <fieldset><legend>{t("admin.oidcPersonalProofSettings")}</legend>
            <label className="oidc-checkbox"><input type="checkbox" checked={draft.proofEnabled==="yes"} onChange={event=>setDraft(current=>({...current,proofEnabled:event.target.checked?"yes":"no"}))}/>{t("admin.oidcApprovePersonalProof")}</label>
            {draft.proofEnabled==="yes" && <>
              <label>{t("admin.oidcProofId")}<input required maxLength={256} value={draft.proofId} onChange={event=>setDraft(current=>({...current,proofId:event.target.value}))}/></label>
              <label>{t("admin.oidcRequiredAmr")}<input required maxLength={2000} value={draft.amr} onChange={event=>setDraft(current=>({...current,amr:event.target.value}))}/></label>
              <label className="oidc-checkbox"><input type="checkbox" checked={draft.requireAcr==="yes"} onChange={event=>setDraft(current=>({...current,requireAcr:event.target.checked?"yes":"no"}))}/>{t("admin.oidcRequireAcr")}</label>
              {draft.requireAcr==="yes"&&<label>{t("admin.oidcRequiredAcr")}<input required maxLength={256} value={draft.acr} onChange={event=>setDraft(current=>({...current,acr:event.target.value}))}/></label>}
              <label>{t("admin.oidcPurposeClaim")}<input maxLength={256} value={draft.purposeClaim} onChange={event=>setDraft(current=>({...current,purposeClaim:event.target.value}))}/></label>
              {draft.purposeClaim&&(["loginPurpose","switchPurpose","reauthenticatePurpose"] as const).map((field,index)=><label key={field}>{t(["admin.oidcLoginPurpose","admin.oidcSwitchPurpose","admin.oidcReauthenticatePurpose"][index]!)}<input required maxLength={256} value={draft[field]} onChange={event=>setDraft(current=>({...current,[field]:event.target.value}))}/></label>)}
            </>}
          </fieldset>
          <label>{t("admin.oidcPrivateOrigins")}<textarea rows={2} value={draft.privateOrigins} onChange={event=>setDraft(current=>({...current,privateOrigins:event.target.value}))}/></label>
          <p>{t("admin.oidcRequiredHelp")}</p>
          <p>{t("admin.oidcSavedSecret")}: {value.draft?.credentialConfigured?(t("admin.oidcSecretConfigured")):(t("admin.oidcSecretMissing"))}</p>
          <p>{t("admin.oidcSecretReplacementHelp")}</p>
          {integrationChanging && <div role="note"><p>{t("admin.oidcIdentityChangeHelp")}</p><p>{resolveMessage(language,"admin.oidcIdentityLinkImpact",{count:value.identityImpact?.linkedIdentities??0})}</p></div>}
          {canWrite && <>
            <label htmlFor="oidc-secret">{t("admin.oidcReplacementSecret")}<input id="oidc-secret" type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
            {value.identityImpact?.integrationChanged && !dirty && <label className="oidc-identity-acknowledgment"><input type="checkbox" checked={identityAcknowledged} onChange={event=>setIdentityAcknowledged(event.target.checked)}/>{t("admin.oidcIdentityAcknowledgment")}</label>}
            <p>{resolveMessage(language,"admin.oidcCredentialKeyVersion",{version:value.credentialKeyVersion??0})}</p>
            <button type="button" disabled={dirty||busy} onClick={()=>void rotateKey()}>{t(value.credentialKeyVersion?"admin.oidcRotateKey":"admin.oidcGenerateKey")}</button>
            <div className="form-actions"><button type="submit" disabled={!dirty||busy}>{t("admin.oidcSave")}</button>
              {nextAction==="discovery" && <button type="button" aria-describedby={discoveryBlocker?"oidc-discovery-requirement":undefined} disabled={!complete||busy} onClick={()=>void mutate(true)}>{t("admin.oidcInspect")}</button>}
              {nextAction==="test" && <button type="button" disabled={busy} onClick={()=>void testLogin()}>{t("admin.oidcTest")}</button>}
              {nextAction==="activate" && <button type="button" disabled={busy||(!!value.identityImpact?.integrationChanged&&!identityAcknowledged)} onClick={()=>void activate()}>{t("admin.oidcActivate")}</button>}
              </div>
            {discoveryBlocker&&<p id="oidc-discovery-requirement" role="note">{t(discoveryBlocker)}</p>}
          </>}
          {error&&<p className="admin-error" role="alert">{error}</p>}
        </fieldset>
      </form>
      {status && <p role="status">{status}</p>}
      {!complete && <p>{t("admin.oidcIncompleteHelp")}</p>}
      {value.test?.failureCode && <p role="alert">{failures[value.test.failureCode] ?? failures.transaction_invalid}</p>}
      <section className="oidc-registration" aria-labelledby="oidc-registration-heading">
        <h4 id="oidc-registration-heading">{t("admin.oidcRegistrationTitle")}</h4>
        <p>{t("admin.oidcItSetupHelp")}</p>
        <p>{t("admin.oidcRequiredClaims")}: <code>{value.registration.requiredClaims.join(", ")}</code></p>
        <p>{t("admin.oidcItProofHelp")}</p>
        {!value.registration.hosts.length && <p>{t("admin.oidcNoHosts")}</p>}
        {value.registration.hosts.map(host=><label key={host.origin} htmlFor={`oidc-${host.origin}-callbackUrl`}>{t("admin.oidcCallback")}
          <input id={`oidc-${host.origin}-callbackUrl`} readOnly value={host.callbackUrl} onFocus={event=>event.target.select()}/></label>)}
      </section>

    </>}
  </section>;
}
