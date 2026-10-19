"use client";
import { useEffect, useRef, useState } from 'react';
import type { EpsContext, EpsLookup } from '@open-triage/contracts';
import { browserRequestConfiguration, browserRequestInit, browserRouteUrl } from '../app/browser-api';
import { resolveMessage, type AgencyLanguage } from '../app/localization';

type State = {key:string; status:string; result?:EpsLookup};
export function PatientSummaryButton({reportId, organizationId, userId, documentKey, ready, language}: {
  reportId:string; organizationId:string; userId:string; documentKey:string; ready:boolean; language:AgencyLanguage;
}) {
  const t=(key:string)=>resolveMessage(language,`eps.${key}`);
  const key=JSON.stringify([reportId,organizationId,userId,documentKey,ready]);
  const [state,setState]=useState<State>({key:'',status:'checking'});
  const [openKey,setOpenKey]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const activeScope=useRef('');
  useEffect(()=>{activeScope.current=key;return()=>{activeScope.current='';};},[key]);
  const current=state.key===key?state:{key,status:'checking'};
  const open=openKey===key && current.status==='available';
  useEffect(()=>{
    if(browserRequestConfiguration().mode==='static' || !ready)return;
    const controller=new AbortController();
    let stopped=false, timer:ReturnType<typeof setTimeout>;
    let binding:string|undefined;
    async function read<T>(path:string):Promise<T>{
      const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/eps${path}`),browserRequestInit({signal:controller.signal}));
      if(!response.ok)throw new Error();return response.json() as Promise<T>;
    }
    async function check(){
      try {
        const context=await read<EpsContext|null>('/context');
        if(stopped)return;
        if(!context){setState({key,status:'disabled'});return;}
        if(context.organizationId!==organizationId||context.reportId!==reportId)throw new Error();
        if(context.binding===binding)return;
        setState({key,status:'checking'});setOpenKey(null);
        const result=await read<EpsLookup>(`?binding=${encodeURIComponent(context.binding)}`);
        if(stopped)return;
        if(result.context?.binding!==context.binding)throw new Error();
        binding=context.binding;
        setState({key,status:result.status,result});
      }catch{if(!stopped){binding=undefined;setState({key,status:'failed'});setOpenKey(null);}}
      finally{if(!stopped)timer=setTimeout(()=>void check(),15000);}
    }
    timer=setTimeout(()=>void check(),300);
    return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[key,reportId,organizationId,ready,retry]);
  useEffect(()=>{
    if(open)dialog.current?.showModal();
    else if(dialog.current?.open){dialog.current.close();trigger.current?.focus();}
  },[open]);
  if(browserRequestConfiguration().mode==='static'||current.status==='disabled')return null;
  const summary=current.result?.summary;
  async function openSummary(){
    try {
      const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/eps/context`),browserRequestInit());
      if(!response.ok)throw new Error();
      const context=await response.json() as EpsContext|null;
      if(activeScope.current!==key)return;
      if(context?.binding!==current.result?.context?.binding){setState({key,status:'checking'});setRetry(value=>value+1);return;}
      setOpenKey(key);
    }catch{if(activeScope.current===key){setState({key,status:'failed'});setOpenKey(null);}}
  }
  return <div className="eps-control">
    <button ref={trigger} type="button" disabled={current.status!=='available'} onClick={()=>void openSummary()}>{t('button')}</button>
    <span role="status">{t(current.status)}</span>
    {current.status==='failed'&&<button type="button" onClick={()=>{setState({key,status:'checking'});setRetry(value=>value+1);}}>{t('retry')}</button>}
    <dialog ref={dialog} className="eps-dialog" aria-labelledby="eps-title" onCancel={()=>setOpenKey(null)} onClose={()=>{setOpenKey(null);trigger.current?.focus();}}>
      {open&&summary&&<><header><h2 id="eps-title">{summary.title||t('button')}</h2><button autoFocus type="button" onClick={()=>setOpenKey(null)}>{t('close')}</button></header>
        <div className="eps-content"><dl>
          <dt>{t('patient')}</dt><dd>{summary.patient||t('unknown')}</dd>
          <dt>{t('source')}</dt><dd>{summary.source||t('unknown')}</dd>
          <dt>{t('authors')}</dt><dd>{summary.authors.join('; ')||t('unknown')}</dd>
          <dt>{t('date')}</dt><dd>{summary.date||t('unknown')}</dd>
          <dt>{t('retrieved')}</dt><dd>{current.result?.retrievedAt}</dd>
        </dl><p>{t('readOnly')}</p>
        {summary.findings.length>0&&<div role="note"><strong>{t('references')}</strong><ul>{summary.findings.map((finding,i)=><li key={i}>{finding}</li>)}</ul></div>}
        <table><thead><tr><th>{t('section')}</th><th>{t('content')}</th></tr></thead><tbody>{summary.clinicalSections.map((section,i)=><tr key={i}><th scope="row">{section.title}</th><td>{section.content||t('unknown')}</td></tr>)}</tbody></table>
        <h3>{t('sourceDetails')}</h3>
        {summary.sections.map((section,i)=><details key={i}><summary>{section.title}</summary><table><thead><tr><th>{t('element')}</th><th>{t('content')}</th></tr></thead><tbody>{section.rows.map((row,j)=><tr key={j}><th scope="row">{row.path}</th><td>{row.value}</td></tr>)}</tbody></table></details>)}
        </div></>}
    </dialog>
  </div>;
}
