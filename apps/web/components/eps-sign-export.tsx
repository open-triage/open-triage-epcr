'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {browserRequestConfiguration,browserRequestInit,browserRouteUrl} from '../app/browser-api';
import {resolveMessage} from '../app/localization';

/** Activation only: no patient summary fetch is needed to offer export. */
export function useEpsSigningActivation(reportId:string|undefined,csrfToken:string){
 const key=JSON.stringify([reportId,csrfToken]);
 const [value,setValue]=useState<{key:string;binding:string}|null>(null);
 useEffect(()=>{
  if(!reportId||browserRequestConfiguration().mode==='static')return;
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  async function check(){
   try{
    if(!navigator.onLine){if(!stopped)setValue(null);return;}
    const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/eps/context`),browserRequestInit({signal:controller.signal}));
    const context=response.ok?await response.json():null;
    if(!stopped)setValue(context?.binding?{key,binding:context.binding}:null);
   }catch{if(!stopped)setValue(null);}
   finally{if(!stopped)timer=setTimeout(()=>void check(),15000);}
  }
  void check();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[key,reportId]);
 return value?.key===key?value.binding:null;
}

export function EpsSigningCheckbox({language,checked,disabled,onChange,summary}:{summary?:ReactNode;language:string;checked:boolean;disabled:boolean;onChange:(checked:boolean)=>void}){
 return <div className="eps-sign-actions"><label className="review-acknowledgement eps-sign-checkbox"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>{resolveMessage(language,'epsSubmission.exportOnSign')}</label>{summary}</div>;
}

type Prepared={id:string;state:string;validation:{profile:{state:string};findings:{severity:string}[]}};
export function EpsSignedExport({reportId,snapshotId,csrfToken,onClose}:{reportId:string;snapshotId:string;csrfToken:string;language:string;onClose:()=>void}){

 const alive=useRef(true);
 const operation=useRef<Promise<Prepared>|null>(null);
 const prepared=useRef<Prepared|null>(null);
 const command=useRef<string|null>(null);
 async function request(path:string,body:unknown):Promise<Prepared>{
  const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/eps/submissions/${path}`),browserRequestInit({method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}));
  if(!response.ok){const failure=await response.json().catch(()=>({}));throw new Error(typeof failure.code==='string'&&failure.code.startsWith('epsSubmission.')?failure.code:'epsSubmission.failed');}
  return response.json();
 }
 async function exportSigned(){
  if(!prepared.current)prepared.current=await request('preview',{dataset:'synthetic',snapshotId,amendmentSequence:0});
  if(!alive.current)throw new Error('epsSubmission.failed');
  const row=prepared.current;
  if(!['pending','passed'].includes(row.validation.profile.state)||row.validation.findings.some(finding=>finding.severity==='error'))throw new Error('epsSubmission.exportValidationFailed');
  command.current??=crypto.randomUUID();
  return request('submit',{dataset:'synthetic',submissionId:row.id,commandId:command.current,confirmPublicFictional:true});
 }
 useEffect(()=>{
  alive.current=true;

  // Retain one operation across React Strict Mode's effect replay.
  if(!operation.current)operation.current=exportSigned();
  let subscribed=true;
  // The signature transaction already created persistent Review follow-up.
  void operation.current.then(()=>{if(subscribed)onClose();},()=>{if(subscribed)onClose();});
  return()=>{subscribed=false;alive.current=false;};
 // This component is keyed by signed snapshot and session by its owner.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return null;
}
