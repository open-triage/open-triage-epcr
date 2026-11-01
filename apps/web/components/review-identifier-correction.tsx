"use client";
import { useEffect, useRef, useState } from "react";
import type { ClinicianSession, ReviewItemDetail, ReviewIdentifierCorrectionContext, ReviewIdentifierCorrectionCommand } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { confirmDiscardChanges, useUnsavedChanges } from "./unsaved-changes";

export function ReviewIdentifierCorrection({item,session,dataset,language,online,onSaved}:{item:ReviewItemDetail;session:ClinicianSession;dataset:"real"|"synthetic";language:AgencyLanguage;online:boolean;onSaved:(item:ReviewItemDetail)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[context,setContext]=useState<ReviewIdentifierCorrectionContext|null>(null);
 const [value,setValue]=useState(""),[reason,setReason]=useState(""),[attested,setAttested]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const pending=useRef<ReviewIdentifierCorrectionCommand|null>(null);
 useUnsavedChanges(open && (!!value || !!reason || attested));
 const t=(key:string)=>resolveMessage(language,`review.identifier.${key}`);
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 async function load() {
  setContext(null);setAttested(false);setError(null);setBusy(true);
  try {const response=await fetch(apiRequestUrl(`/api/review/items/${item.id}/identifier-correction?dataset=${dataset}`)!,browserRequestInit());if(!response.ok)throw new Error();setContext(await response.json() as ReviewIdentifierCorrectionContext);pending.current=null;}
  catch{setError(t("unavailable"));}finally{setBusy(false);}
 }
 function close(){if(busy||!confirmDiscardChanges(!!value||!!reason||attested))return;setOpen(false);trigger.current?.focus();}
 return <>
  <button ref={trigger} type="button" disabled={!online} onClick={()=>{setValue("");setReason("");setAttested(false);setOpen(true);void load();}}>{t("action")}</button>
  <dialog ref={dialog} aria-labelledby={`identifier-heading-${item.id}`} className="unit-dialog" onCancel={event=>{event.preventDefault();close();}}>
   <form className="review-action-form" aria-busy={busy} onSubmit={async event=>{
    event.preventDefault();if(!context||busy||!online||!value.trim()||!reason.trim()||!attested)return;
    const command:ReviewIdentifierCorrectionCommand={commandId:pending.current?.commandId??crypto.randomUUID(),dataset,context,namespace:context.namespace,value,reason,attested};pending.current=command;setBusy(true);setError(null);
    try{const response=await fetch(apiRequestUrl(`/api/review/items/${item.id}/identifier-correction`)!,browserRequestInit({method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken??session.accessToken??""},body:JSON.stringify(command)}));
     if(!response.ok){setError(t(response.status===409?"stale":"invalid"));return;}
     onSaved(await response.json() as ReviewItemDetail);setOpen(false);trigger.current?.focus();
    }catch{setError(t("unavailable"));}finally{setBusy(false);}
   }}>
    <h3 id={`identifier-heading-${item.id}`}>{t("action")}</h3><p>{t("explanation")}</p>
    {context&&<><p>{context.label} · {t("mapping")} {context.mappingRevision}</p><label>{t("namespace")}<input readOnly value={context.namespace}/></label>
     <label>{t("value")}<input required maxLength={512} autoComplete="off" disabled={busy} value={value} onChange={event=>{setValue(event.target.value);pending.current=null;}}/></label>
     <label>{t("reason")}<textarea required maxLength={2000} disabled={busy} value={reason} onChange={event=>{setReason(event.target.value);pending.current=null;}}/></label>
     <label><input type="checkbox" checked={attested} disabled={busy} onChange={event=>{setAttested(event.target.checked);pending.current=null;}}/>{t("attestation")}</label></>}
    {error&&<p role="alert">{error}</p>}
    <div className="admin-role-editor-actions"><button type="button" disabled={busy} onClick={close}>{t("cancel")}</button><button type="button" disabled={busy||!online} onClick={()=>void load()}>{t("refresh")}</button><button className="primary" type="submit" disabled={busy||!online||!context||!value.trim()||!reason.trim()||!attested}>{t("submit")}</button></div>
   </form>
  </dialog>
 </>;
}
