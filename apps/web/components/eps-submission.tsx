"use client";
import {EpsSummaryPreview,type EpsPreviewBundle} from './eps-summary-preview';
import {useEffect,useRef,useState} from 'react';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
type Submission={id:string;snapshotId:string;amendmentSequence:number;configurationRevision:number;mappingId:string;mappingRevision:number;mappingSha256:string;lineageParentId:string|null;state:string;validation:{findings:{code:string;severity:string;section?:string}[];profile:{state:string;issues:{severity:string;code:string;expression:string[]}[]}};bundle:EpsPreviewBundle;result:{headers:Record<string,string>;issues:{severity:string;code:string;expression:string[]}[]}|null};
/** Ephemeral authorized review; no payload persistence in browser storage. */
type EpsSubmissionProps={reportId:string;snapshotId:string;amendmentSequence:number;dataset:'real'|'synthetic';language:string;csrfToken:string};
class EpsRequestError extends Error {constructor(readonly status:number,message:string){super(message);}}
export function EpsSubmissionPanel(props:EpsSubmissionProps){
 // Remount synchronously on scope changes; no previously authorized payload or command crosses this boundary.
 const binding=JSON.stringify([props.reportId,props.snapshotId,props.amendmentSequence,props.dataset,props.csrfToken]);
 return <ActivatedEpsSubmission key={binding} {...props}/>;
}
function ActivatedEpsSubmission(props:EpsSubmissionProps){
 const [active,setActive]=useState(false);
 useEffect(()=>{
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  async function check(){
   try{
    const url=apiRequestUrl(`/api/reports/${props.reportId}/eps/submissions/availability?dataset=${props.dataset}`);
    if(!url||!navigator.onLine){if(!stopped)setActive(false);return;}
    const response=await fetch(url,browserRequestInit({signal:controller.signal}));
    const value=response.ok?await response.json():null;
    if(!stopped)setActive(value?.active===true);
   }catch{if(!stopped)setActive(false);}
   finally{if(!stopped)timer=setTimeout(()=>void check(),15000);}
  }
  void check();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[props.reportId,props.dataset]);
 return active?<EpsSubmissionDialog {...props}/>:null;
}
function EpsSubmissionDialog({reportId,snapshotId,amendmentSequence,dataset,language,csrfToken}:EpsSubmissionProps){
 const t=(key:string)=>resolveMessage(language,`epsSubmission.${key}`);
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Submission[]>([]),[selected,setSelected]=useState<Submission|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),generation=useRef(0),pending=useRef(0),command=useRef<{id:string;submissionId:string}|null>(null);
 useEffect(()=>()=>{
 // This counter belongs to asynchronous request scope, not a DOM node.
 generation.current++;
 },[]);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 async function request(action:string,body?:unknown){const url=apiRequestUrl(`/api/reports/${reportId}/eps/submissions${action}`);if(!url)throw new Error();const response=await fetch(url,browserRequestInit(body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));if(!response.ok){const failure=await response.json().catch(()=>({})) as {code?:string};throw new EpsRequestError(response.status,typeof failure.code==='string'&&failure.code.startsWith('epsSubmission.')?failure.code:'epsSubmission.failed');}return response.json();}
 function clearPrivateState(){generation.current++;pending.current=0;command.current=null;setRows([]);setSelected(null);setConfirm(false);setBusy(false);}
 async function run(action:()=>Promise<void>){const current=generation.current;pending.current++;setBusy(true);setError('');try{await action();}catch(reason){
  if(current===generation.current){
   if(reason instanceof EpsRequestError&&[401,403,404,410].includes(reason.status)){clearPrivateState();setError(t('accessDenied'));}
   else setError(resolveMessage(language,reason instanceof Error&&reason.message.startsWith('epsSubmission.')?reason.message:'epsSubmission.failed'));
  }
 }finally{if(current===generation.current){pending.current--;setBusy(pending.current>0);}}}

 async function load(){const current=generation.current;const result=await request(`?dataset=${dataset}`) as Submission[];if(current!==generation.current)return;setRows(result);setSelected(current=>current?result.find(row=>row.id===current.id)??current:result.find(row=>row.snapshotId===snapshotId&&row.amendmentSequence===amendmentSequence)??null);}
 const close=()=>{clearPrivateState();dialog.current?.close();setOpen(false);setError('');trigger.current?.focus();};
 async function preview(remap=false){const current=generation.current;const row=await request('/preview',{dataset,snapshotId,amendmentSequence,...(remap&&selected&&selected.snapshotId===snapshotId&&selected.amendmentSequence===amendmentSequence?{lineageParentId:selected.id}:{})}) as Submission;if(current!==generation.current)return;setSelected(row);setConfirm(false);command.current=null;await load();}
 async function submit(){if(!selected)return;const current=generation.current;if(command.current?.submissionId!==selected.id)command.current={id:crypto.randomUUID(),submissionId:selected.id};const row=await request('/submit',{dataset,submissionId:selected.id,commandId:command.current.id,confirmPublicFictional:true}) as Submission;if(current!==generation.current)return;setSelected(row);setConfirm(false);await load();}
 const ready=selected?.state==='prepared'&&['pending','passed'].includes(selected.validation.profile.state)&&!selected.validation.findings.some(row=>row.severity==='error');
 return <><button ref={trigger} type="button" onClick={()=>{setOpen(true);void run(load);}}>{t('open')}</button>
 {open&&<dialog ref={dialog} className="eps-submission-dialog" aria-label={t('open')} onCancel={close}><header><h2>{t('open')}</h2><button type="button" onClick={close}>{t('close')}</button></header>
 <p>{t('publicationHelp')}</p><p>{resolveMessage(language,'epsSubmission.version',{sequence:selected?.amendmentSequence??amendmentSequence})}</p>
 {error&&<p role="alert">{error}</p>}
 <div className="form-actions"><button type="button" disabled={busy} onClick={()=>void run(()=>preview())}>{t('preview')}</button><button type="button" disabled={busy} onClick={()=>void run(()=>preview(true))}>{t('remap')}</button><button type="button" onClick={()=>void run(load)}>{t('refresh')}</button></div>
 {!!rows.length&&<label>{t('history')}<select value={selected?.id??''} disabled={busy} onChange={event=>{setSelected(rows.find(row=>row.id===event.target.value)??null);setConfirm(false);command.current=null;}}><option value="">{t('choose')}</option>{rows.map(row=><option key={row.id} value={row.id}>{resolveMessage(language,'epsSubmission.historyVersion',{sequence:row.amendmentSequence,revision:row.configurationRevision})} — {t(row.state)}</option>)}</select></label>}
 {busy&&<p role="status">{t('busy')}</p>}
 {selected&&<><p>{t('patientIdentifier')}: {selected.bundle.entry.find(entry=>entry.resource.resourceType==='Patient')?.resource.identifier?.map(identifier=>`${identifier.system??''} | ${identifier.value??''}`).join('; ')}</p><p role="status">{t(selected.state)} · {t(`profile.${selected.validation.profile.state}`)}</p><details><summary>{resolveMessage(language,'epsSubmission.mappingVersion',{revision:selected.mappingRevision})}</summary><p>{selected.mappingId}</p><p className="hospital-digest">{selected.mappingSha256}</p></details>
 {selected.validation.findings.some(finding=>finding.code==='missingData')&&<p>{t('finding.missingData')} {selected.validation.findings.filter(finding=>finding.code==='missingData').map(finding=>resolveMessage(language,`hospital.outputSections.${finding.section}`)).join(', ')}</p>}
 <ul>{selected.validation.findings.filter(finding=>finding.code!=='missingData').map((finding,index)=><li key={index}>{t(`finding.${finding.code}`)}</li>)}{selected.validation.profile.issues.map((finding,index)=><li key={`p${index}`}>{t(`severity.${finding.severity}`)}: {finding.code} {finding.expression.join(', ')}</li>)}</ul>
 <EpsSummaryPreview bundle={selected.bundle} language={language}/>
 {selected.result&&<><p>{t('resultHeaders')}: {Object.entries(selected.result.headers).filter(([key])=>key!=='content-location').map(([key,value])=>`${key}: ${value}`).join(' · ')}</p>{selected.result.headers['content-location']&&<a target="_blank" rel="noreferrer" href={selected.result.headers['content-location']}>{t('rendering')}</a>}<ul>{selected.result.issues.map((finding,index)=><li key={index}>{t(`severity.${finding.severity}`)}: {finding.code} {finding.expression.join(', ')}</li>)}</ul></>}
 {ready&&<label><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)}/>{t('confirm')}</label>}
 <button type="button" className="button-primary" disabled={busy||!ready||!confirm} onClick={()=>void run(submit)}>{t('submit')}</button></>}
 </dialog>}</>;
}
