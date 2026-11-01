"use client";

import {useEffect,useRef,useState} from "react";
import type {ReviewItemDetail,CosRebuildContext} from "@open-triage/contracts";
import {apiRequestUrl,browserRequestInit} from "../app/browser-api";
import {resolveMessage,type AgencyLanguage} from "../app/localization";

export function CosRecoveryActions({itemId,reportId,userId,csrfToken,dataset,language,online,onSaved,refreshKey}: {
  itemId:string;reportId:string;userId:string;csrfToken:string;dataset:"real"|"synthetic";
  language:AgencyLanguage;online:boolean;onSaved:()=>void;refreshKey:string;
}) {
  const [item,setItem]=useState<ReviewItemDetail|null>(null);
  const [rebuild,setRebuild]=useState<CosRebuildContext|null>(null);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const t=(key:string)=>resolveMessage(language,key);
  const saved=useRef(onSaved);
  useEffect(()=>{saved.current=onSaved;},[onSaved]);
  useEffect(()=>{
    if(!online)return;
    const controller=new AbortController();
    const url=apiRequestUrl(`/api/review/items/${itemId}?dataset=${dataset}`);
    if(!url)return;
    void fetch(url,browserRequestInit({signal:controller.signal})).then(async response=>{
      if(!response.ok)throw new Error();
      const next=await response.json() as ReviewItemDetail;
      if(controller.signal.aborted)return;
      setItem(next);
      if(next.reportId===reportId&&next.kind==='cos-delivery-failed'&&next.assigneeId===userId&&!next.transmissionRestricted){
        const contextUrl=apiRequestUrl(`/api/review/items/${itemId}/rebuild-cos?dataset=${dataset}`);
        if(!contextUrl)return;
        const contextResponse=await fetch(contextUrl,browserRequestInit({signal:controller.signal}));
        if(!contextResponse.ok)throw new Error();
        const context=await contextResponse.json() as CosRebuildContext;
        if(!controller.signal.aborted)setRebuild(context);
      }else setRebuild(null);
    }).catch(()=>{if(!controller.signal.aborted){setItem(null);setRebuild(null);setError('review.workflowUnavailable');}});
    return ()=>controller.abort();
  },[itemId,reportId,userId,dataset,online,revision,refreshKey]);
  const allowed=item?.reportId===reportId&&item.kind==='cos-delivery-failed'&&item.assigneeId===userId&&!item.transmissionRestricted;
  const progressing=item?.transmission?.deliveryState==='pending'&&!item.transmission.reconciliationTarget||item?.transmission?.finding==='inFlight';
  useEffect(()=>{
    if(!allowed||!online||busy||!progressing)return;
    // Worker completion happens after the recovery response. Keep both the
    // report evidence and available actions current without issuing another POST.
    const timer=setInterval(()=>{setRevision(value=>value+1);saved.current();},3000);
    return ()=>clearInterval(timer);
  },[allowed,online,busy,progressing]);
  async function run(action:'reconcile-cos'|'retry-cos'|'rebuild-cos') {
    if(!allowed||busy||!online||!item?.transmission)return;
    const evidence=item.transmission;
    if(action==='rebuild-cos'?!rebuild?.available:action==='reconcile-cos'?!evidence.reconciliationTarget:!evidence.retryable)return;
    setBusy(true);setError(null);setNotice(null);
    try {
      const url=apiRequestUrl(`/api/review/items/${itemId}/${action}`);
      if(!url)throw new Error();
      const response=await fetch(url,browserRequestInit({method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},
        body:JSON.stringify({commandId:crypto.randomUUID(),expectedVersion:item.version,dataset,stateRevision:evidence.stateRevision,
          ...(action==='rebuild-cos'?{deliveryId:rebuild!.deliveryId,amendmentSequence:rebuild!.amendmentSequence,configurationRevision:rebuild!.configurationRevision,stateRevision:rebuild!.stateRevision,expectedVersion:rebuild!.expectedVersion}:action==='reconcile-cos'?evidence.reconciliationTarget:{deliveryId:evidence.deliveryId,amendmentSequence:evidence.amendmentSequence,configurationRevision:Number(evidence.configurationRevision)})})}));
      if(!response.ok){
        const failure=await response.json().catch(()=>null) as {code?:string}|null;
        const known=['hospital.cos.rebuildIdentityChanged','hospital.cos.rebuildIdentifiers'];
        setError(failure?.code&&known.includes(failure.code)?failure.code:response.status===409?'review.workflowConflict':'review.workflowUnavailable');return;
      }
      setItem(await response.json() as ReviewItemDetail);
      setNotice(action==='rebuild-cos'?(rebuild?.blockedByUncertain?'review.rebuild.held':'review.rebuild.queued'):action==='reconcile-cos'?'review.reconciliation.saved':'review.recovery.queued');
      if(action==='rebuild-cos')setRebuild(null);
      onSaved();
    }catch{setError('review.workflowUnavailable');}
    finally{setBusy(false);setRevision(value=>value+1);}
  }
  return <div>
    {allowed&&item.transmission?.reconciliationTarget&&<button type="button" disabled={busy||!online} onClick={()=>void run('reconcile-cos')}>{t('review.reconciliation.action')}</button>}
    {allowed&&item.transmission?.retryable&&<button type="button" disabled={busy||!online} onClick={()=>void run('retry-cos')}>{t('review.recovery.retry')}</button>}
    {allowed&&rebuild?.available&&<button type="button" disabled={busy||!online} title={t(rebuild.blockedByUncertain?'review.rebuild.heldHelp':'review.rebuild.help')} onClick={()=>void run('rebuild-cos')}>{t('review.rebuild.action')}</button>}
    {notice&&<p role="status">{t(notice)}</p>}
    {error&&<p role="alert">{t(error)} <button type="button" disabled={busy||!online} onClick={()=>{setError(null);setRevision(value=>value+1);}}>{t('list.retry')}</button></p>}
  </div>;
}
