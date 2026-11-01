'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {browserRequestConfiguration,browserRequestInit,browserRouteUrl} from '../app/browser-api';
import type {EpsDeliverySummary,EpsDeliveryIssue} from '../app/draft-report';
import {resolveMessage} from '../app/localization';

/** Activation only: no patient summary fetch is needed to offer export. */
export function useEpsSigningActivation(reportId:string|undefined,csrfToken:string,integration:'eps'|'cos'='eps'){
 const key=JSON.stringify([reportId,csrfToken,integration]);
 const [value,setValue]=useState<{key:string;binding:string}|null>(null);
 useEffect(()=>{
  if(!reportId||browserRequestConfiguration().mode==='static')return;
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  async function check(){
   try{
    if(!navigator.onLine)return;
    const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/${integration}/context`),browserRequestInit({signal:controller.signal}));
    if(!response.ok&&!([401,403,404].includes(response.status)))return;
    const context=response.ok?await response.json():null;
    if(!stopped)setValue(context?.binding?{key,binding:context.binding}:null);
   }catch{/* Retain this report's activation through transient network failures. */}
   finally{if(!stopped)timer=setTimeout(()=>void check(),15000);}
  }
  void check();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[key,reportId,integration]);
 return value?.key===key?value.binding:null;
}

export function EpsSigningCheckbox({language,checked,disabled,onChange,summary,result,integration='eps'}:{integration?:'eps'|'cos';summary?:ReactNode;result?:ReactNode;language:string;checked:boolean;disabled:boolean;onChange:(checked:boolean)=>void}){
 return <div className="eps-sign-actions"><label className="review-acknowledgement eps-sign-checkbox"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>{resolveMessage(language,integration==='cos'?'cosSigning.exportOnSign':'epsSubmission.exportOnSign')}</label>{summary}{result&&<div className="eps-sign-result">{result}</div>}</div>;
}

/** Default each newly activated binding to selected; polling never undoes an explicit opt-out. */
export function useSigningExportSelection(binding:string|null,reportId:string|undefined,csrfToken:string){
 const key=JSON.stringify([reportId,csrfToken,binding]);
 const [choice,setChoice]=useState<{key:string;checked:boolean}|null>(null);
 return [!!binding&&(choice?.key!==key||choice.checked),(checked:boolean)=>setChoice({key,checked})] as const;
}

export function EpsDeliveryStatus({language,delivery,onEdit,onConfigure,disabled=false}:{language:string;delivery?:EpsDeliverySummary|null;onEdit?:(issue:EpsDeliveryIssue)=>void;onConfigure?:()=>void;disabled?:boolean}){
 if(!delivery)return null;
 const t=(key:string)=>resolveMessage(language,`epsSubmission.${key}`);
 const message=(code:string)=>{for(const key of [`finding.${code}`,`issue.${code}`]){const value=t(key);if(value!==`epsSubmission.${key}`)return value;}return t('validationError');};
 return <section aria-label={t('latestDelivery')}><p role="status"><strong>{t('latestDelivery')}: </strong>{t(delivery.state)}</p>
  {!!delivery?.issues.length&&<ul className="review-findings">{delivery.issues.map((issue,index)=><li className="error" key={JSON.stringify(issue)}>
   <p role={index===0?'alert':undefined}>{message(issue.code)}</p>
   {issue.action==='edit'&&onEdit?<button type="button" disabled={disabled} onClick={()=>onEdit(issue)}>{t('correctField')}</button>:
    issue.action==='configuration'&&onConfigure?<button type="button" disabled={disabled} onClick={onConfigure}>{t('correctSettings')}</button>:<p>{issue.action==='configuration'?resolveMessage(language,'cosSigning.administratorRequired'):t('correctionInReview')}</p>}
  </li>)}</ul>}
 </section>;
}
