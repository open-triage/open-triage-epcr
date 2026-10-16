"use client";
import { useEffect, useRef, useState } from "react";
import type { ProductionWorkflowReadiness } from "@open-triage/contracts";
import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration, InstallationContextChangedError } from "../app/installation-transition-generation";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage } from "../app/localization";
import { platformRequestError } from "../app/platform-errors";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { PersonalAuthenticationField, usePasswordAuthentication } from "./personal-authentication";

export function ProductionWorkflowPanel({language,csrfToken,canWrite}: {language:string;csrfToken:string;canWrite:boolean}) {
  const [readiness,setReadiness]=useState<ProductionWorkflowReadiness|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[password,setPassword]=useState("");
  const needsPassword=usePasswordAuthentication();
  const t=(key:string,params?:Record<string,string|number>)=>resolveMessage(language,key,params);
  const epoch=useRef(0);
  const context=()=>({epoch:epoch.current,generation:authenticationInstallationGeneration()});
  const current=(stamp:ReturnType<typeof context>)=>{
    if(stamp.epoch!==epoch.current)return false;
    try{assertAuthenticationInstallationGeneration(stamp.generation);return true;}catch{return false;}
  };
  async function request(stamp:ReturnType<typeof context>,command?:unknown,offset=0) {
    if(!current(stamp))throw new InstallationContextChangedError();
    const url=apiRequestUrl(`/api/admin/authentication/workflow?offset=${offset}`);
    if(!url)throw new Error(t("admin.workflowUnavailable"));
    const response=await fetch(url,browserRequestInit(command?{method:"PUT",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(command)}:{}));
    if(!response.ok)throw await platformRequestError(response);
    const value=await response.json() as ProductionWorkflowReadiness;
    if(!current(stamp))throw new InstallationContextChangedError();
    return value;
  }
  useEffect(()=>{const stamp=context();request(stamp).then(setReadiness).catch(reason=>{if(current(stamp))setError(reason.message);});
    return()=>{epoch.current+=1;};},[csrfToken]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refresh(offset=readiness?.offset??0) {
    const stamp=context();setBusy(true);
    try{setReadiness(await request(stamp,undefined,offset));setError("");}
    catch(reason){if(current(stamp))setError((reason as Error).message);}
    finally{if(current(stamp))setBusy(false);}
  }
  return <section className="production-workflow" aria-labelledby="production-workflow-heading">
    <h3 id="production-workflow-heading">{t("admin.workflowHeading")}</h3>
    {error&&<p role="alert" className="admin-error">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>void refresh()}>{t("admin.workflowRefresh")}</button>
    {readiness&&<>
      <p>{t(readiness.state==="enabled"?"admin.workflowEnabled":"admin.workflowPreparation")}</p>
      {!readiness.providerReady&&<p>{t("admin.workflowProviderRequired")}</p>}
      <div className="admin-table-scroll" tabIndex={0} aria-label={t("admin.workflowHeading")}><table className="admin-table"><thead><tr><th>{t("admin.workflowAgency")}</th><th>{t("calls.unit")}</th><th>{t("admin.workflowSchedule")}</th><th>{t("admin.workflowEnrollment")}</th></tr></thead><tbody>
        {readiness.units.map(unit=><tr key={unit.id}><td>{unit.agencyName}</td><td>{unit.callSign}</td><td>{t(unit.scheduleSelected?"admin.workflowReady":"admin.workflowScheduleMissing")}</td><td>{t(unit.enrolled?"admin.workflowReady":"admin.workflowEnrollmentMissing")}</td></tr>)}
      </tbody></table></div>
      <p>{t("admin.workflowCounts",{total:readiness.totalUnits,schedules:readiness.missingSchedules,enrollment:readiness.unenrolledUnits})}</p>
      <div className="form-actions"><button type="button" disabled={busy||readiness.offset===0} onClick={()=>void refresh(Math.max(0,readiness.offset-50))}>{t("admin.workflowPrevious")}</button>
        <button type="button" disabled={busy||readiness.offset+50>=readiness.totalUnits} onClick={()=>void refresh(readiness.offset+50)}>{t("admin.workflowNext")}</button></div>
      <p>{t("admin.workflowBoundaries")}</p>
      {canWrite&&readiness.state==="preparation"&&<form onSubmit={async event=>{
        event.preventDefault();if(busy||!readiness.canEnable)return;const stamp=context();setBusy(true);setError("");
        try{await reauthenticateClinicianSession(password,csrfToken);if(!current(stamp))throw new InstallationContextChangedError();setPassword("");setReadiness(await request(stamp,{expectedRevision:readiness.revision,confirm:true}));window.dispatchEvent(new Event("open-triage.production-workflow-changed"));}
        catch(reason){if(current(stamp)){setError((reason as Error).message);setPassword("");}}finally{if(current(stamp))setBusy(false);}
      }}><fieldset disabled={busy}><legend>{t("admin.workflowConfirm")}</legend>
        <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={t("admin.personalPasswordToSave")}/>
        <button type="submit" disabled={!readiness.canEnable||(needsPassword&&!password)}>{t("admin.workflowEnable")}</button>
      </fieldset></form>}
      <p>{t("admin.workflowDeploymentPending")}</p>
    </>}
  </section>;
}
