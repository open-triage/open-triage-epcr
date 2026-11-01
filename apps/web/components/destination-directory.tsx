"use client";
import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {DestinationEntry,DestinationPage,SaveDestinationCommand} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {platformRequestError} from '../app/platform-errors';
import {resolveMessage} from '../app/localization';
import {useUnsavedChanges,confirmDiscardChanges} from './unsaved-changes';
import {activateListRow} from './list-row-action';
const empty:SaveDestinationCommand={displayName:'',localCode:'',hsaId:null,active:true};
export function DestinationDirectory({csrfToken,language,canWrite}:{csrfToken:string;language:string;canWrite:boolean}){
 const t=useCallback((key:string)=>resolveMessage(language,key),[language]);
 const [page,setPage]=useState<DestinationPage>({items:[],nextCursor:null});const [search,setSearch]=useState('');
 const [editing,setEditing]=useState<DestinationEntry|null|undefined>();const [draft,setDraft]=useState(empty);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [dirty,setDirty]=useState(false);const generation=useRef(0);
 useUnsavedChanges(dirty);
 const request=useCallback(async (path:string,body?:SaveDestinationCommand,method="POST"):Promise<DestinationPage|DestinationEntry>=>{
  const url=apiRequestUrl(`/api/admin/destinations${path}`);if(!url)throw new Error(t('hospital.destinationUnavailable'));
  const response=await fetch(url,browserRequestInit(body?{method,headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok)throw await platformRequestError(response);return response.json();
 },[csrfToken,t]);
 const load=useCallback(async (cursor?:string)=>{const current=++generation.current;setBusy(true);try{const next=await request(`?search=${encodeURIComponent(search)}${cursor?`&cursor=${cursor}`:''}`) as DestinationPage;if(current===generation.current){setPage(next);setError('');}}catch(reason){if(current===generation.current)setError(reason instanceof Error?reason.message:t('hospital.destinationUnavailable'));}finally{if(current===generation.current)setBusy(false);}},[request,search,t]);
 const cancelPending=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;cancelPending();};},[load,cancelPending]);
 function edit(entry:DestinationEntry|null){if(!confirmDiscardChanges(dirty))return;setEditing(entry);setDraft(entry?{displayName:entry.displayName,localCode:entry.localCode,hsaId:entry.hsaId,active:entry.active,expectedRevision:entry.revision}:empty);setDirty(false);}
 return <section className="admin-directory cos-destination-directory"><div className="section-heading"><h3>{t('hospital.destinations')}</h3>{canWrite&&<button type="button" onClick={()=>edit(null)}>{t('hospital.destinationCreate')}</button>}</div>
  {error&&<p role="alert" className="admin-error">{error}</p>}
  {editing!==undefined?<form className="admin-user-create" onSubmit={async event=>{event.preventDefault();setBusy(true);try{await request(editing?`/${editing.id}`:'',draft,editing?'PUT':'POST');setEditing(undefined);setDirty(false);await load();}catch(reason){setError(reason instanceof Error?reason.message:t('hospital.destinationUnavailable'));}finally{setBusy(false);}}} onChangeCapture={()=>setDirty(true)}>
   <fieldset disabled={busy||!canWrite}><label>{t('hospital.destinationName')}<input required minLength={2} maxLength={100} value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})}/></label>
   <label>{t('hospital.destinationCode')}<input required minLength={2} maxLength={50} value={draft.localCode} onChange={event=>setDraft({...draft,localCode:event.target.value})}/></label>
   <label>{t('admin.hsaId')}<input maxLength={128} value={draft.hsaId??''} onChange={event=>setDraft({...draft,hsaId:event.target.value||null})}/></label>
   <label><input type="checkbox" checked={draft.active} onChange={event=>setDraft({...draft,active:event.target.checked})}/>{t('admin.active')}</label>
   <div className="admin-role-editor-actions"><button type="submit">{t('admin.save')}</button><button type="button" onClick={()=>{if(confirmDiscardChanges(dirty)){setEditing(undefined);setDirty(false);}}}>{t('admin.cancel')}</button></div></fieldset>
  </form>:<><form className="admin-directory-filters" role="search" onSubmit={event=>{event.preventDefault();void load();}}><label>{t('admin.search')}<input type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></label><button disabled={busy}>{t('admin.search')}</button></form>
   <div className="admin-table-scroll" style={{maxHeight:'24rem'}}><table className="admin-table"><thead><tr><th>{t('hospital.destinationName')}</th><th>{t('hospital.destinationCode')}</th><th>{t('admin.hsaId')}</th><th>{t('admin.status')}</th><th>{t('admin.actions')}</th></tr></thead><tbody>{page.items.map(entry=><tr key={entry.id} className="admin-directory-row" onClick={canWrite?activateListRow:undefined}><td>{entry.displayName}</td><td>{entry.localCode}</td><td>{entry.hsaId??'—'}</td><td>{t(entry.active?'admin.active':'admin.deactivated')}</td><td>{canWrite&&<button type="button" onClick={()=>edit(entry)}>{t('admin.edit')}</button>}</td></tr>)}</tbody></table></div>
   <div className="admin-role-editor-actions"><button type="button" disabled={busy} onClick={()=>void load()}>{t('hospital.destinationFirst')}</button><button type="button" disabled={busy||!page.nextCursor} onClick={()=>void load(page.nextCursor??undefined)}>{t('hospital.destinationNext')}</button></div></>}
 </section>;
}
