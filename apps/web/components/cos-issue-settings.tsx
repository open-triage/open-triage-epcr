"use client";
import {useEffect,useRef} from 'react';
import {UnitsPanel} from './units-panel';
import {UsersPanel} from './admin-directory';
import {HospitalIntegrationsPanel} from './hospital-integrations';
import {AdminLanguageContext} from '../app/admin-localization';
import {resolveMessage,type AgencyLanguage} from '../app/localization';
export function CosIssueSettings({kind,language,csrfToken,userId,onClose,integration='cos'}:{integration?:'eps'|'cos';kind:'units'|'users'|'configuration';language:AgencyLanguage;csrfToken:string;userId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} className="cos-issue-settings" onCancel={onClose} aria-labelledby="cos-settings-heading">
  <div className="section-heading"><h2 id="cos-settings-heading">{resolveMessage(language,integration==='eps'?'epsSubmission.correctSettings':`cosSigning.action.${kind}`)}</h2><button type="button" onClick={onClose}>{resolveMessage(language,'cosSigning.closeSettings')}</button></div>
  <AdminLanguageContext.Provider value={language}>
   {kind==='units'?<UnitsPanel language={language} csrfToken={csrfToken} canManage/>:kind==='users'?<UsersPanel csrfToken={csrfToken} currentUserId={userId} canManage/>:<HospitalIntegrationsPanel initialTab={integration} language={language} csrfToken={csrfToken} canWrite/>}
  </AdminLanguageContext.Provider>
 </dialog>;
}
