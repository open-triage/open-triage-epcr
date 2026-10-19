"use client";
import React,{useEffect,useState} from 'react';
import {type HospitalIntegrationLifecycleState,DEFAULT_HOSPITAL_PATIENT_FIELD,hospitalFieldId,type HospitalField,type CosMappingDefinition,type CosConnectionSettings} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
import {platformRequestError,PlatformRequestError} from '../app/platform-errors';
import {resolveCatalogElementText} from '../app/catalog-localization';
import {useUnsavedChanges} from './unsaved-changes';
type Mapping={sha256:string;definition:CosMappingDefinition};
type Version={settings:CosConnectionSettings;revision:number;endpoint:string;credentialConfigured:boolean;mapping:Mapping};
type View=HospitalIntegrationLifecycleState & {staffOptions:{id:string;name:string}[];clinicalOptions:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];groupName:string;stateRevision:number;draft:Version|null;active:Version|null;defaultEndpoint:string;
 options:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];
 tests:{id:string;revision:number;result:string;createdAt:string;evidence?:{findings:string[]}}[];
 history:{revision:number;sha256:string;status:string;createdAt:string}[];
 events:{action:string;occurredAt:string;actorId:string}[]};
const empty={endpoint:'https://cos.example.invalid',field:DEFAULT_HOSPITAL_PATIENT_FIELD,namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:'',
 settings:{mode:'simulator',authentication:'api-key',template:'',encounterNamespace:'urn:opentriage:encounter',organizationHsaId:'',defaultAmbulanceCareUnit:'',staff:[],careUnits:[]} as CosConnectionSettings,
 retryScheduleText:'1, 5, 15, 30, 60',pdfLinkId:'',clinicalMappings:[] as CosMappingDefinition['clinicalMappings']};
function editable(value:Version|null){return value?{endpoint:value.endpoint,field:value.mapping.definition.patientIdentifier.field,namespace:value.mapping.definition.patientIdentifier.namespace,aliases:value.mapping.definition.patientIdentifier.aliases.join('\n'),settings:value.settings,retryScheduleText:(value.settings.retryScheduleMinutes??[1,5,15,30,60]).join(', '),pdfLinkId:value.mapping.definition.pdfLinkId??'',clinicalMappings:value.mapping.definition.clinicalMappings}:empty;}
export function CosIntegrationsPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}){
 const t=(key:string)=>resolveMessage(language,`hospital.cos.${key}`);
 const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const dirty=!!secret||JSON.stringify(draft)!==JSON.stringify(editable(value?.draft??null));
 const confirmLeave=useUnsavedChanges(dirty);
 const tested=value?.tests.find(test=>test.revision===value.draft?.revision);
 async function request(path='',body?:unknown,method='POST'){
  const url=apiRequestUrl(`/api/admin/hospital/cos${path}`);if(!url)throw new Error(t('unavailable'));
  const response=await fetch(url,browserRequestInit(body?{method,headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok)throw await platformRequestError(response,language);return response.json();
 }
 function load(next:View){setValue(next);setDraft(editable(next.draft));setSecret('');}
 function failed(reason:unknown){if(reason instanceof PlatformRequestError&&[401,403].includes(reason.status)){setValue(null);setDraft(empty);setSecret('');}setError(reason instanceof PlatformRequestError?reason.message:t('unavailable'));}
 // Request helpers use this mount's session and language; Admin remounts on scope changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{let alive=true;request().then(next=>{if(alive)load(next);}).catch(reason=>{if(alive)failed(reason);});return()=>{alive=false;};},[csrfToken]); // Scope changes remount the Admin shell.
 async function action(path:string,body:unknown,method='POST'){
  setBusy(true);setError('');setStatus('');try{load(await request(path,body,method));setStatus(t('saved'));}catch(reason){failed(reason);}finally{setBusy(false);setSecret('');}
 }
 async function refresh(){if(!confirmLeave())return;setBusy(true);try{load(await request());setError('');}catch(reason){failed(reason);}finally{setBusy(false);}}
 const retryDelays=draft.retryScheduleText.trim()?draft.retryScheduleText.split(',').map(Number):[];
 const retryScheduleValid=retryDelays.length<=5&&retryDelays.every(delay=>Number.isInteger(delay)&&delay>=1&&delay<=1440);
 const expected={expectedRevision:value?.draft?.revision??0,expectedStateRevision:value?.stateRevision??0};
 return <section className="admin-configuration agency-settings hospital-integrations cos-integrations" aria-label={t('title')}>
  <h3>{t('title')}</h3><p>{t('simulatorHelp')}</p>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  {error&&<button type="button" onClick={()=>void refresh()} disabled={busy}>{t('reload')}</button>}
  {value&&<><p>{t('group')}: {value.groupName}</p>
   <div className="cos-integration-workspace">
    <p>{t('active')}: {value.active?.revision??t('inactive')} — {t('draft')}: {value.draft?.revision??t('unsaved')}</p>
    <p>{t('connectivityHelp')}</p>{value.pausedRevision&&<p>{t('paused')}: {value.pausedRevision} — {t(`health.${value.pausedHealth}`)}</p>}<p>{t('health')}: {t('active')} {t(`health.${value.activeHealth}`)} — {t('draft')} {t(`health.${value.draftHealth}`)}</p><p>{t(value.credentialReplacement?'replacementPending':'replacementNone')}</p><p>{t('keyManagementHelp')}</p><p>{t('pauseHelp')}</p>
    {tested?.evidence?.findings.map(finding=><p key={finding} role="status">{t(`finding.${finding}`)}</p>)}
    {tested&&<p>{t('testRevision')}: {tested.revision} — {t(tested.result)} — {new Date(tested.createdAt).toLocaleString(language)}</p>}
    <form onSubmit={event=>{event.preventDefault();void action('',{expectedRevision:expected.expectedRevision,endpoint:draft.endpoint,authentication:draft.settings.authentication,settings:{...draft.settings,retryScheduleMinutes:draft.retryScheduleText.trim()?draft.retryScheduleText.split(',').map(Number):[]},clinicalMappings:draft.clinicalMappings,...(draft.pdfLinkId?{pdfLinkId:draft.pdfLinkId}:{}),patientIdentifier:{field:draft.field,namespace:draft.namespace,aliases:draft.aliases.split(/\s+/).filter(Boolean)},...(secret?{replacementSecret:secret}:{})},'PUT');}}>
     <fieldset disabled={busy||!canWrite}><legend>{t('configuration')}</legend>
      <label>{t('endpoint')}<input type="url" required value={draft.endpoint} onChange={event=>setDraft({...draft,endpoint:event.target.value})}/></label>
      <label>{t('authentication')}<select value={draft.settings.authentication} onChange={event=>setDraft({...draft,settings:{...draft.settings,authentication:event.target.value as CosConnectionSettings['authentication']}})}>{['api-key','bearer-token'].map(mode=><option key={mode} value={mode}>{t(mode)}</option>)}</select></label>
      <label>{t('patientField')}<select value={hospitalFieldId(draft.field)} onChange={event=>{const option=value.options.find(option=>option.id===event.target.value);if(option)setDraft({...draft,field:option.field});}}>
       {!value.options.some(option=>option.id===hospitalFieldId(draft.field))&&<option value={hospitalFieldId(draft.field)}>{hospitalFieldId(draft.field)} — {t('fieldUnavailable')}</option>}
       {value.options.map(option=><option key={`${option.field.kind}:${option.id}`} value={option.id}>{option.id} — {resolveCatalogElementText(option,option.id,language,'label')}</option>)}
      </select></label>
      <label>{t('namespace')}<input required value={draft.namespace} onChange={event=>setDraft({...draft,namespace:event.target.value})}/></label>
      <label>{t('aliases')}<textarea rows={2} value={draft.aliases} onChange={event=>setDraft({...draft,aliases:event.target.value})}/></label>
      <label>{t('mode')}<select value={draft.settings.mode} onChange={event=>setDraft({...draft,settings:{...draft.settings,mode:event.target.value as CosConnectionSettings['mode']}})}><option value="simulator">{t('simulator')}</option><option value="live">{t('live')}</option></select></label>
      {(['template','encounterNamespace','organizationHsaId','defaultAmbulanceCareUnit'] as const).map(key=><label key={key}>{t(key)}<input value={draft.settings[key]} onChange={event=>setDraft({...draft,settings:{...draft.settings,[key]:event.target.value}})}/></label>)}
      <label>{t('retrySchedule')}<input value={draft.retryScheduleText} pattern="[0-9, ]*" onChange={event=>setDraft({...draft,retryScheduleText:event.target.value})}/></label><p>{t('retryHelp')}</p>{retryScheduleValid&&<p>{resolveMessage(language,'hospital.cos.retryEffect',{retries:retryDelays.length,minutes:retryDelays.reduce((sum,value)=>sum+value,0)})}</p>}
      <fieldset><legend>{t('staff')}</legend>{draft.settings.staff.map((row,index)=><div className="hospital-mapping-row" key={index}>
       <label>{t('userId')}<select required value={row.userId} onChange={event=>setDraft({...draft,settings:{...draft.settings,staff:draft.settings.staff.map((item,i)=>i===index?{...item,userId:event.target.value}:item)}})}><option value="">{t('chooseStaff')}</option>{value.staffOptions.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
       <label>{t('hsaId')}<input required value={row.hsaId} onChange={event=>setDraft({...draft,settings:{...draft.settings,staff:draft.settings.staff.map((item,i)=>i===index?{...item,hsaId:event.target.value}:item)}})}/></label>
       <button type="button" onClick={()=>setDraft({...draft,settings:{...draft.settings,staff:draft.settings.staff.filter((_,i)=>i!==index)}})}>{t('remove')}</button>
      </div>)}<button type="button" onClick={()=>setDraft({...draft,settings:{...draft.settings,staff:[...draft.settings.staff,{userId:'',hsaId:''}]}})}>{t('addStaff')}</button></fieldset>
      <fieldset><legend>{t('careUnits')}</legend>{draft.settings.careUnits.map((row,index)=><div className="hospital-mapping-row" key={index}>
       {(['hospital','localCareUnit','hsaId'] as const).map(key=><label key={key}>{t(key)}<input required value={row[key]} onChange={event=>setDraft({...draft,settings:{...draft.settings,careUnits:draft.settings.careUnits.map((item,i)=>i===index?{...item,[key]:event.target.value}:item)}})}/></label>)}
       <button type="button" onClick={()=>setDraft({...draft,settings:{...draft.settings,careUnits:draft.settings.careUnits.filter((_,i)=>i!==index)}})}>{t('remove')}</button>
      </div>)}<button type="button" onClick={()=>setDraft({...draft,settings:{...draft.settings,careUnits:[...draft.settings.careUnits,{hospital:'',localCareUnit:'',hsaId:''}]}})}>{t('addCareUnit')}</button></fieldset>
      <fieldset><legend>{t('clinicalMappings')}</legend><label>{t('pdfLinkId')}<input value={draft.pdfLinkId} onChange={event=>setDraft({...draft,pdfLinkId:event.target.value})}/></label><p>{t('pdfLinkHelp')}</p><p>{t('mappingHelp')}</p>{draft.clinicalMappings.map((row,index)=><div className="hospital-mapping-row" key={row.id}>
       <label>{t('source')}<select value={hospitalFieldId(row.source)} onChange={event=>{const option=value.clinicalOptions.find(option=>option.id===event.target.value);if(option)setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((item,i)=>i===index?{...item,source:option.field}:item)});}}>{value.clinicalOptions.map(option=><option key={`${option.field.kind}:${option.id}`} value={option.id}>{option.id} — {resolveCatalogElementText(option,option.id,language,'label')}</option>)}</select></label>
       <label>{t('linkId')}<input required value={row.linkId} onChange={event=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((item,i)=>i===index?{...item,linkId:event.target.value}:item)})}/></label>
       <label>{t('answerType')}<select value={row.answerType} onChange={event=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((item,i)=>i===index?{...item,answerType:event.target.value as 'string'}:item)})}>{['string'].map(type=><option key={type} value={type}>{t(type)}</option>)}</select></label>
       <button type="button" onClick={()=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.filter((_,i)=>i!==index)})}>{t('remove')}</button>
      </div>)}<button type="button" onClick={()=>setDraft({...draft,clinicalMappings:[...draft.clinicalMappings,{id:crypto.randomUUID(),source:value.clinicalOptions[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,linkId:'',answerType:'string'}]})}>{t('addMapping')}</button></fieldset>
      <p>{t(value.draft?.credentialConfigured?'credentialConfigured':'credentialMissing')}</p>
      <label>{t('credential')}<input type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
      <div className="form-actions"><button type="button" disabled={!secret||JSON.stringify(draft)!==JSON.stringify(editable(value.draft))} onClick={()=>void action('/rotate-credential',{expectedRevision:expected.expectedRevision,replacementSecret:secret})}>{t('rotateCredential')}</button><button type="submit" disabled={!dirty&&!!value.draft}>{t('save')}</button>
       <button type="button" disabled={dirty||!value.draft?.credentialConfigured} onClick={()=>void action('/test',{expectedRevision:expected.expectedRevision})}>{t('test')}</button>
       <button type="button" disabled={dirty||tested?.result!=='healthy'||value.active?.revision===value.draft?.revision} onClick={()=>void action('/activate',{...expected,testId:tested?.id})}>{t('activate')}</button>
       <button type="button" disabled={dirty||!value.active} onClick={()=>void action('/deactivate',expected)}>{t('deactivate')}</button><button type="button" disabled={dirty||!!value.active||!value.pausedRevision} onClick={()=>void action('/resume',{...expected,expectedPausedRevision:value.pausedRevision})}>{t('resume')}</button></div>
     </fieldset>
    </form>
   </div>
  </>}
 </section>;
}
