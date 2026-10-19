"use client";
import { EpsSectionTables } from './eps-section-tables';
import { EpsImports, EpsImportWarning } from './eps-imports';
import type { ClinicalFormConfiguration } from '@open-triage/contracts';
import { useEffect, useRef } from 'react';
import { browserRequestConfiguration } from '../app/browser-api';
import { resolveMessage, type AgencyLanguage } from '../app/localization';
import { usePatientSummary } from './use-patient-summary';

export function PatientSummaryButton({reportId, organizationId, userId, documentKey, ready, language, form, onImported, csrfToken}: {
  reportId:string; organizationId:string; userId:string; documentKey:string; ready:boolean; language:AgencyLanguage; form?:ClinicalFormConfiguration; onImported?:()=>void; csrfToken:string;
}) {
  const t=(key:string)=>resolveMessage(language,`eps.${key}`);
  const {current, activated, online, accessBlocked, open, openSummary, close, dismissed, refresh}=usePatientSummary({reportId,organizationId,userId,documentKey},ready,form);
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(open)dialog.current?.showModal();
    else if(dialog.current?.open){dialog.current.close();trigger.current?.focus();}
  },[open]);
  if(browserRequestConfiguration().mode==='static'||!activated)return null;
  const summary=current.result?.summary;
  return <div className="eps-control">
    {!accessBlocked&&<EpsImportWarning key={JSON.stringify([reportId,organizationId,userId])} reportId={reportId} documentKey={documentKey} language={language}/>}
    <button hidden={current.status==='disabled'} ref={trigger} type="button" disabled={current.status!=='available'} onClick={()=>void openSummary()}>{t('button')}</button>
    {current.status==='failed'&&<button type="button" disabled={!online} onClick={refresh}>{t('retry')}</button>}
    <dialog ref={dialog} className="eps-dialog" aria-labelledby="eps-title" onCancel={close} onClose={()=>{dismissed();trigger.current?.focus();}}>
      {open&&summary&&<><header><h2 id="eps-title">{summary.title||t('button')}</h2><button autoFocus type="button" onClick={close}>{t('close')}</button></header>
        <div className="eps-content"><dl>
          <dt>{t('patient')}</dt><dd>{summary.patient||t('unknown')}</dd>
          <dt>{t('source')}</dt><dd>{summary.source||t('unknown')}</dd>
          <dt>{t('authors')}</dt><dd>{summary.authors.join('; ')||t('unknown')}</dd>
          <dt>{t('date')}</dt><dd>{summary.date||t('unknown')}</dd>
          <dt>{t('retrieved')}</dt><dd>{current.result?.retrievedAt}</dd>
        </dl>{current.cached&&<p role="status">{t(online?'cached':'offlineCached')}</p>}
        <button type="button" disabled={!online} onClick={refresh}>{t('refresh')}</button>
        {!accessBlocked&&current.result?.context&&<EpsImports csrfToken={csrfToken} key={JSON.stringify([reportId,organizationId,userId,documentKey,ready,language,current.result.context.binding])} reportId={reportId} binding={current.result.context.binding} language={language} ready={ready} onImported={onImported}>{(rows,action)=><EpsSectionTables summary={summary} language={language} rows={rows} action={action}/>}</EpsImports>}
        {summary.findings.length>0&&<div role="note"><strong>{t('references')}</strong><ul>{summary.findings.map((finding,i)=><li key={i}>{finding}</li>)}</ul></div>}
        {(accessBlocked||!current.result?.context)&&<EpsSectionTables summary={summary} language={language}/>}
        </div></>}
    </dialog>
  </div>;
}
