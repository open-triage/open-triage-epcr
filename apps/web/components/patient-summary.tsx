"use client";
import { EpsImports, EpsImportWarning } from './eps-imports';
import type { ClinicalFormConfiguration } from '@open-triage/contracts';
import { useEffect, useRef } from 'react';
import { browserRequestConfiguration } from '../app/browser-api';
import { resolveMessage, type AgencyLanguage } from '../app/localization';
import { usePatientSummary } from './use-patient-summary';

export function PatientSummaryButton({reportId, organizationId, userId, documentKey, ready, language, form}: {
  reportId:string; organizationId:string; userId:string; documentKey:string; ready:boolean; language:AgencyLanguage; form?:ClinicalFormConfiguration;
}) {
  const t=(key:string)=>resolveMessage(language,`eps.${key}`);
  const {current, online, accessBlocked, open, openSummary, close, dismissed, refresh}=usePatientSummary({reportId,organizationId,userId,documentKey},ready,form);
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(open)dialog.current?.showModal();
    else if(dialog.current?.open){dialog.current.close();trigger.current?.focus();}
  },[open]);
  if(browserRequestConfiguration().mode==='static')return null;
  const summary=current.result?.summary;
  return <div className="eps-control">
    {!accessBlocked&&<EpsImportWarning key={JSON.stringify([reportId,organizationId,userId])} reportId={reportId} documentKey={documentKey} language={language}/>}
    <button hidden={current.status==='disabled'} ref={trigger} type="button" disabled={current.status!=='available'} onClick={()=>void openSummary()}>{t('button')}</button>
    <span hidden={current.status==='disabled'} role="status">{t(current.status)}</span>
    {current.cached&&<span role="status">{t(online?'cached':'offlineCached')}</span>}
    {current.status==='failed'&&<button type="button" disabled={!online} onClick={refresh}>{t('retry')}</button>}
    <dialog ref={dialog} className="eps-dialog" aria-labelledby="eps-title" onCancel={close} onClose={()=>{dismissed();trigger.current?.focus();}}>
      {open&&summary&&<><header><h2 id="eps-title">{summary.title||t('button')}</h2><button autoFocus type="button" onClick={close}>{t('close')}</button></header>
        <div className="eps-content"><dl>
          <dt>{t('patient')}</dt><dd>{summary.patient||t('unknown')}</dd>
          <dt>{t('source')}</dt><dd>{summary.source||t('unknown')}</dd>
          <dt>{t('authors')}</dt><dd>{summary.authors.join('; ')||t('unknown')}</dd>
          <dt>{t('date')}</dt><dd>{summary.date||t('unknown')}</dd>
          <dt>{t('retrieved')}</dt><dd>{current.result?.retrievedAt}</dd>
        </dl>{current.cached&&<p role="status">{t(online?'cached':'offlineCached')}</p>}<p>{t('readOnly')}</p><p>{t(current.cached?'cachePolicy':'onlineOnly')}</p>
        <button type="button" disabled={!online} onClick={refresh}>{t('refresh')}</button>
        {!accessBlocked&&current.result?.context&&<EpsImports key={JSON.stringify([reportId,organizationId,userId,documentKey,ready,language,current.result.context.binding])} reportId={reportId} binding={current.result.context.binding} language={language} ready={ready}/>}
        {summary.findings.length>0&&<div role="note"><strong>{t('references')}</strong><ul>{summary.findings.map((finding,i)=><li key={i}>{finding}</li>)}</ul></div>}
        <table><thead><tr><th>{t('section')}</th><th>{t('content')}</th></tr></thead><tbody>{summary.clinicalSections.map((section,i)=><tr key={i}><th scope="row">{section.title}</th><td>{section.content||t('unknown')}</td></tr>)}</tbody></table>
        <h3>{t('sourceDetails')}</h3>
        {summary.sections.map((section,i)=><details key={i}><summary>{section.title}</summary><table><thead><tr><th>{t('element')}</th><th>{t('content')}</th></tr></thead><tbody>{section.rows.map((row,j)=><tr key={j}><th scope="row">{row.path}</th><td>{row.value}</td></tr>)}</tbody></table></details>)}
        </div></>}
    </dialog>
  </div>;
}
