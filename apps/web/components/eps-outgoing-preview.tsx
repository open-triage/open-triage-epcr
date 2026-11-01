'use client';
import {EpsSummaryPreview,type EpsPreviewBundle} from './eps-summary-preview';
import {useEffect,useRef,useState} from 'react';
import {browserRequestInit,browserRouteUrl} from '../app/browser-api';
import {resolveMessage} from '../app/localization';

type Preview={bundle:EpsPreviewBundle;patientIdentifier:{system:string;value:string}|null;findings:{code:string;severity:string}[]};
export function EpsOutgoingPreview({reportId,binding,language,disabled}:{reportId:string;binding:string;language:string;disabled:boolean}){
 const [open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 const t=(key:string)=>resolveMessage(language,`epsSubmission.${key}`);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 return <><button ref={trigger} type="button" disabled={disabled} onClick={()=>setOpen(true)}>{t('showSummary')}</button>
 {open&&!disabled&&<OutgoingDialog key={JSON.stringify([reportId,binding])} reportId={reportId} binding={binding} language={language} onClose={close}/>}</>;
}
function OutgoingDialog({reportId,binding,language,onClose}:{reportId:string;binding:string;language:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [preview,setPreview]=useState<Preview|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const t=(key:string)=>resolveMessage(language,`epsSubmission.${key}`);
 useEffect(()=>{
  if(!dialog.current?.open)dialog.current?.showModal();
  const controller=new AbortController();let current=true;
  void fetch(browserRouteUrl(`/api/reports/${reportId}/eps/outgoing?binding=${encodeURIComponent(binding)}`),browserRequestInit({signal:controller.signal}))
   .then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<Preview>;})
   .then(result=>{if(current)setPreview(result);},()=>{if(current)setFailed(true);});
  return()=>{current=false;controller.abort();};
 },[reportId,binding,attempt]);
 const close=()=>{dialog.current?.close();onClose();};
 return <dialog ref={dialog} className="eps-submission-dialog eps-outgoing-preview" aria-label={t('showSummary')} onCancel={event=>{event.preventDefault();close();}}>
  <header><h2>{t('showSummary')}</h2><button type="button" autoFocus onClick={close}>{t('close')}</button></header>
  <p>{t('draftSummary')}</p>
  {failed?<><p role="alert">{t('previewFailed')}</p><button type="button" onClick={()=>{setFailed(false);setAttempt(value=>value+1);}}>{t('refresh')}</button></>:!preview?<p role="status">{t('busy')}</p>:<>
   <p>{t('patientIdentifier')}: {preview.patientIdentifier?`${preview.patientIdentifier.system} | ${preview.patientIdentifier.value}`:resolveMessage(language,'eps.unknown')}</p>
   {preview.findings.filter(finding=>finding.severity==='error').map((finding,index)=><p role="alert" key={index}>{t(`finding.${finding.code}`)}</p>)}
   <EpsSummaryPreview bundle={preview.bundle} language={language}/>
  </>}
 </dialog>;
}
