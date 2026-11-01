'use client';
import {useEffect,useState,useRef, type ReactNode} from 'react';
import type {EpsImportPlan,EpsImportRow} from '@open-triage/contracts';
import {browserRequestInit,browserRouteUrl} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
export function EpsImports({reportId,binding,language,ready,children,onImported,csrfToken}:{reportId:string;binding:string;language:string;ready:boolean;csrfToken:string;onImported?:()=>void;children?:(rows:EpsImportRow[],action:(row:EpsImportRow)=>ReactNode)=>ReactNode}) {
 const t=(key:string)=>resolveMessage(language,`epsImport.${key}`);
 const [rows,setRows]=useState<EpsImportRow[]>([]),[plan,setPlan]=useState<EpsImportPlan|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[inconsistent,setInconsistent]=useState(false),[done,setDone]=useState(false);
 const [online,setOnline]=useState(true);
 const previewPanel=useRef<HTMLFieldSetElement>(null);
 const importTrigger=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{if(!plan)importTrigger.current?.focus();},[plan]);
 useEffect(()=>{if(plan)previewPanel.current?.focus();},[plan]);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 useEffect(()=>{if(!online||!ready)return;let alive=true;const controller=new AbortController();fetch(browserRouteUrl(`/api/reports/${reportId}/eps/imports?binding=${encodeURIComponent(binding)}`),browserRequestInit({signal:controller.signal})).then(async response=>{if(!response.ok)throw new Error();return response.json();}).then(result=>{if(alive){setRows(result.rows);setInconsistent(result.inconsistent);}}).catch(()=>{if(alive)setError(t('failed'));});return()=>{alive=false;controller.abort();};
 // Translation changes remount the workspace; keep requests scoped to the report/binding.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[reportId,binding,online,ready]);
 async function request(path:string,body:unknown){const response=await fetch(browserRouteUrl(`/api/reports/${reportId}/eps/imports/${path}`),browserRequestInit({method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}));if(!response.ok)throw new Error();return response.json();}
 async function preview(entryId:string){setBusy(true);setError('');setDone(false);try{setPlan(await request('plan',{binding,entryId}));}catch{setError(t('failed'));}finally{setBusy(false);}}
 async function apply(decision:string){if(!plan)return;setBusy(true);setError('');try{await request('apply',{planId:plan.id,commandId:crypto.randomUUID(),decision});setPlan(null);setDone(true);onImported?.();}catch{setError(t('failed'));}finally{setBusy(false);}}
 const action=(row:EpsImportRow)=>row.finding?<span>{t(row.finding)}</span>:row.mappingId&&row.destination?<button type="button" disabled={busy||!ready||!online} onClick={event=>{importTrigger.current=event.currentTarget;void preview(row.entryId);}}>{t('import')}</button>:null;
 return <section aria-label={t('title')}>
  <h3>{t('title')}</h3>{inconsistent&&<p role="alert">{t('inconsistent')}</p>}{error&&<p role="alert">{error}</p>}{done&&<p role="status">{t('done')}</p>}{!online&&<p>{t('offline')}</p>}
  <div hidden={!!plan}>{children?children(rows,action):<table><thead><tr><th>{t('item')}</th><th>{t('destination')}</th><th>{t('action')}</th></tr></thead><tbody>{rows.map(row=><tr key={row.entryId}><td>{row.label}</td><td>{row.destination??t('unmapped')}</td><td>{row.finding?<span>{t(row.finding)}</span>:<button type="button" disabled={busy||!ready||!online} onClick={()=>void preview(row.entryId)}>{t('preview')} — {row.destination}</button>}</td></tr>)}</tbody></table>}</div>
  {plan&&<fieldset className="eps-import-preview" ref={previewPanel} tabIndex={-1} disabled={busy||!ready||!online}><legend>{t('preview')} — {plan.destination}</legend>{plan.projection&&<p>{t(plan.projection)}</p>}{plan.proposedValue!==undefined&&<label>{t('proposedValue')}<input readOnly value={plan.proposedValue}/></label>}<label>{t('incoming')}<textarea readOnly rows={6} value={plan.incoming}/></label>{plan.existing.length>0&&<label>{t('existing')}<textarea readOnly rows={4} value={plan.existing.join('\n')}/></label>}
   {plan.alreadyImported?<p>{t('duplicate')}</p>:<div className="form-actions">{plan.conflict?<>{plan.canAppend&&<button type="button" onClick={()=>void apply('append')}>{t('append')}</button>}<button type="button" onClick={()=>void apply('keep')}>{t('keep')}</button><button type="button" onClick={()=>void apply('replace')}>{t('replace')}</button></>:<button type="button" onClick={()=>void apply('import')}>{t('import')}</button>}</div>}
   <button type="button" onClick={()=>setPlan(null)}>{t('cancel')}</button>
  </fieldset>}
 </section>;
}

export function EpsImportWarning({reportId,documentKey,language}:{reportId:string;documentKey:string;language:string}) {
 const [warning,setWarning]=useState(false);
 useEffect(()=>{let alive=true;fetch(browserRouteUrl(`/api/reports/${reportId}/eps/imports/history`),browserRequestInit()).then(async r=>{if(!r.ok){if(alive&&[401,403,404,410].includes(r.status)){setWarning(false);}throw new Error();}return r.json();}).then(r=>{if(alive){setWarning(r.inconsistent);}}).catch(()=>{});return()=>{alive=false;};},[reportId,documentKey]);
 return warning?<p role="alert">{resolveMessage(language,'epsImport.inconsistent')}</p>:null;
}
