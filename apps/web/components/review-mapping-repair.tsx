"use client";
import {useRef,useState} from 'react';
import {hospitalFieldId,type ClinicianSession,type ReviewItemDetail,type CosMappingRepairContext,type CosMappingRepairCommand} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
export function ReviewMappingRepair({item,session,dataset,language,online,onSaved}:{item:ReviewItemDetail;session:ClinicianSession;dataset:'real'|'synthetic';language:string;online:boolean;onSaved:(item:ReviewItemDetail)=>void}){
 const [context,setContext]=useState<CosMappingRepairContext|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recipient,setRecipient]=useState(false),[patient,setPatient]=useState(false);
 const pending=useRef<CosMappingRepairCommand|null>(null);
 const t=(key:string)=>resolveMessage(language,`review.mappingRepair.${key}`);
 async function preview(){setBusy(true);setError('');setContext(null);setRecipient(false);setPatient(false);pending.current=null;
  try{const response=await fetch(apiRequestUrl(`/api/review/items/${item.id}/mapping-repair?dataset=${dataset}`)!,browserRequestInit());if(!response.ok)throw new Error();setContext(await response.json());}catch{setError(t('unavailable'));}finally{setBusy(false);}}
 async function apply(){if(!context)return;setBusy(true);setError('');
  const command=pending.current??{commandId:crypto.randomUUID(),dataset,context,acceptRecipientChange:recipient,acceptPatientMappingChange:patient};pending.current=command;
  try{const response=await fetch(apiRequestUrl(`/api/review/items/${item.id}/mapping-repair`)!,browserRequestInit({method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken??''},body:JSON.stringify(command)}));if(!response.ok){setError(t(response.status===409?'stale':'unavailable'));return;}onSaved(await response.json());setContext(null);}catch{setError(t('unavailable'));}finally{setBusy(false);}}
 return <div className="review-action-form" aria-busy={busy}>
  <p>{t('help')}</p><button type="button" disabled={busy||!online} onClick={()=>void preview()}>{t('preview')}</button>
  {error&&<p role="alert">{error}</p>}
  {context&&<><p>{resolveMessage(language,'review.mappingRepair.revisions',{previous:context.previousConfigurationRevision,current:context.configurationRevision})}</p>
   <p>{t(context.missing.length?'remaining':'ready')}</p><ul>{context.missing.map(code=><li key={code}>{resolveMessage(language,`review.transmission.requirement.${code}`)}</li>)}</ul>
   {context.conflicts.includes('patientIdentifier')&&<><p>{t('patientConflict')}</p>
    {[['previousPatient',context.previousPatient],['patient',context.patient]] .map(([label,binding])=>{const value=binding as CosMappingRepairContext['patient'];return <p key={String(label)}>{t(String(label))}: <code>{hospitalFieldId(value.field)}</code> · {value.namespace} · {value.value??t('absent')}</p>;})}
    <label><input type="checkbox" checked={patient} disabled={busy} onChange={event=>{setPatient(event.target.checked);pending.current=null;}}/>{t('acceptPatient')}</label></>}
   {context.conflicts.includes('recipient')&&<><p>{t('recipientConflict')}</p><label><input type="checkbox" checked={recipient} disabled={busy} onChange={event=>{setRecipient(event.target.checked);pending.current=null;}}/>{t('acceptRecipient')}</label></>}
   {!context.safe&&<p role="alert">{t('unsafe')}</p>}
   <button type="button" className="primary" disabled={busy||!online||!context.safe||context.conflicts.includes('patientIdentifier')&&!patient||context.conflicts.includes('recipient')&&!recipient} onClick={()=>void apply()}>{t('apply')}</button>
  </>}
 </div>;
}
