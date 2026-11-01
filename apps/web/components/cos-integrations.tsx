"use client";
import { LocalDateTime } from "./local-date-time";
import React,{useEffect,useState} from 'react';
import {COS_ELEMENT_MAPPINGS,type CosReadiness,type CosVitalMapping,type HospitalIntegrationLifecycleState,DEFAULT_HOSPITAL_PATIENT_FIELD,hospitalFieldId,type HospitalField,type CosMappingDefinition,type CosConnectionSettings} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
import {platformRequestError,PlatformRequestError} from '../app/platform-errors';
import {resolveCatalogElementText} from '../app/catalog-localization';
import {FieldHelp} from './field-help';
import {DestinationDirectory} from './destination-directory';
import {useUnsavedChanges} from './unsaved-changes';
type Mapping={sha256:string;definition:CosMappingDefinition};
type Version={settings:CosConnectionSettings;revision:number;endpoint:string;credentialConfigured:boolean;mapping:Mapping};
type View=HospitalIntegrationLifecycleState & {readiness?:CosReadiness;clinicalOptions:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];groupName:string;stateRevision:number;draft:Version|null;active:Version|null;defaultEndpoint:string;
 options:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];
 tests:{id:string;revision:number;result:string;createdAt:string;evidence?:{findings:string[]}}[];
 history:{revision:number;sha256:string;status:string;createdAt:string}[];
 events:{action:string;occurredAt:string;actorId:string}[]};
const empty={endpoint:'https://cos.example.invalid',field:DEFAULT_HOSPITAL_PATIENT_FIELD,namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:'',
 settings:{mode:'simulator',authentication:'api-key',template:'',encounterNamespace:'urn:opentriage:encounter',organizationHsaId:'',defaultAmbulanceCareUnit:''} as CosConnectionSettings,
 vitalMappings:[] as CosVitalMapping[],medicationMappings:[] as NonNullable<CosMappingDefinition['medicationMappings']>,retryScheduleText:'1, 5, 15, 30, 60',pdfLinkId:'',clinicalMappings:[] as CosMappingDefinition['clinicalMappings']};
function editable(value:Version|null){return value?{vitalMappings:value.mapping.definition.vitalMappings??[],medicationMappings:value.mapping.definition.medicationMappings??[],endpoint:value.endpoint,field:value.mapping.definition.patientIdentifier.field,namespace:value.mapping.definition.patientIdentifier.namespace,aliases:value.mapping.definition.patientIdentifier.aliases.join('\n'),settings:value.settings,retryScheduleText:(value.settings.retryScheduleMinutes??[1,5,15,30,60]).join(', '),pdfLinkId:value.mapping.definition.pdfLinkId??'',clinicalMappings:value.mapping.definition.clinicalMappings}:empty;}
export function CosIntegrationsPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}){
 const t=(key:string)=>resolveMessage(language,`hospital.cos.${key}`);
 const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(''),[clientSecret,setClientSecret]=useState(''),[subscriptionKey,setSubscriptionKey]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const replacementSecret=draft.settings.authentication==='oauth-client-credentials'?(clientSecret&&subscriptionKey?JSON.stringify({clientSecret,subscriptionKey}):''):secret;
 const dirty=!!secret||!!clientSecret||!!subscriptionKey||JSON.stringify(draft)!==JSON.stringify(editable(value?.draft??null));
 const confirmLeave=useUnsavedChanges(dirty);
 const tested=value?.tests.find(test=>test.revision===value.draft?.revision);
 async function request(path='',body?:unknown,method='POST'){
  const url=apiRequestUrl(`/api/admin/hospital/cos${path}`);if(!url)throw new Error(t('unavailable'));
  const response=await fetch(url,browserRequestInit(body?{method,headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok)throw await platformRequestError(response,language);return response.json();
 }
 function load(next:View){setValue(next);setDraft(editable(next.draft));setSecret('');setClientSecret('');setSubscriptionKey('');}
 function failed(reason:unknown){if(reason instanceof PlatformRequestError&&[401,403].includes(reason.status)){setValue(null);setDraft(empty);setSecret('');setClientSecret('');setSubscriptionKey('');}setError(reason instanceof PlatformRequestError?reason.message:t('unavailable'));}
 // Request helpers use this mount's session and language; Admin remounts on scope changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{let alive=true;request().then(next=>{if(alive)load(next);}).catch(reason=>{if(alive)failed(reason);});return()=>{alive=false;};},[csrfToken]); // Scope changes remount the Admin shell.
 async function action(path:string,body:unknown,method='POST'){
  setBusy(true);setError('');setStatus('');try{load(await request(path,body,method));setStatus(t('saved'));}catch(reason){failed(reason);}finally{setBusy(false);setSecret('');setClientSecret('');setSubscriptionKey('');}
 }
 async function refresh(){if(!confirmLeave())return;setBusy(true);try{load(await request());setError('');}catch(reason){failed(reason);}finally{setBusy(false);}}
 const retryDelays=draft.retryScheduleText.trim()?draft.retryScheduleText.split(',').map(Number):[];
 const retryScheduleValid=retryDelays.length<=5&&retryDelays.every(delay=>Number.isInteger(delay)&&delay>=1&&delay<=1440);
 const expected={expectedRevision:value?.draft?.revision??0,expectedStateRevision:value?.stateRevision??0};
 return <section className="admin-configuration agency-settings hospital-integrations cos-integrations" aria-label={t('title')}>
  <h3>{t('title')}</h3>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  {error&&<button type="button" onClick={()=>void refresh()} disabled={busy}>{t('reload')}</button>}
  {value&&<><p>{t('group')}: {value.groupName}</p>
   <div className="cos-integration-workspace">
    {value.readiness&&<p role="status">{resolveMessage(language,'hospital.cos.readiness',{users:value.readiness.usersMissingHsa,conflicts:value.readiness.usersConflictingHsa,units:value.readiness.unitsMissingRakel,destinations:value.readiness.destinationsMissingHsa})}</p>}
    <p>{t('active')}: {value.active?.revision??t('inactive')} — {t('draft')}: {value.draft?.revision??t('unsaved')}</p>
    <p>{t('connectivityScope')}</p>{value.pausedRevision&&<p>{t('paused')}: {value.pausedRevision} — {t(`health.${value.pausedHealth}`)}</p>}<p>{t('health')}: {t('active')} {t(`health.${value.activeHealth}`)} — {t('draft')} {t(`health.${value.draftHealth}`)}</p><p>{t(value.credentialReplacement?'replacementPending':'replacementNone')}</p>
    {tested?.evidence?.findings.map(finding=><p key={finding} role="status">{t(`finding.${finding}`)}</p>)}
    {tested&&<p>{t('testRevision')}: {tested.revision} — {t(draft.settings.mode==='live'?`liveResult.${tested.result}`:tested.result)} — <LocalDateTime value={tested.createdAt} language={language} /></p>}
    <form onSubmit={event=>{event.preventDefault();void action('',{expectedRevision:expected.expectedRevision,endpoint:draft.endpoint,authentication:draft.settings.authentication,settings:{...draft.settings,retryScheduleMinutes:draft.retryScheduleText.trim()?draft.retryScheduleText.split(',').map(Number):[]},vitalMappings:draft.vitalMappings,medicationMappings:draft.medicationMappings,clinicalMappings:draft.clinicalMappings,pdfLinkId:draft.pdfLinkId,patientIdentifier:{field:draft.field,namespace:draft.namespace,aliases:draft.aliases.split(/\s+/).filter(Boolean)},...(replacementSecret?{replacementSecret}:{})},'PUT');}}>
     <fieldset disabled={busy||!canWrite}><legend>{t('configuration')}</legend>
      <label>{t('endpoint')}<input type="url" required value={draft.endpoint} onChange={event=>setDraft({...draft,endpoint:event.target.value})}/></label>
      <label>{t('authentication')}<select value={draft.settings.authentication} onChange={event=>setDraft({...draft,settings:{...draft.settings,authentication:event.target.value as CosConnectionSettings['authentication']}})}>{['api-key','bearer-token','oauth-client-credentials'].map(mode=><option key={mode} value={mode}>{t(mode)}</option>)}</select></label>
      <label>{t('patientField')}<select value={hospitalFieldId(draft.field)} onChange={event=>{const option=value.options.find(option=>option.id===event.target.value);if(option)setDraft({...draft,field:option.field});}}>
       {!value.options.some(option=>option.id===hospitalFieldId(draft.field))&&<option value={hospitalFieldId(draft.field)}>{hospitalFieldId(draft.field)} — {t('fieldUnavailable')}</option>}
       {value.options.map(option=><option key={`${option.field.kind}:${option.id}`} value={option.id}>{option.id} — {resolveCatalogElementText(option,option.id,language,'label')}</option>)}
      </select></label>
      <label>{t('namespace')}<input required value={draft.namespace} onChange={event=>setDraft({...draft,namespace:event.target.value})}/></label>
      <label>{t('aliases')}<textarea rows={2} value={draft.aliases} onChange={event=>setDraft({...draft,aliases:event.target.value})}/></label>
      <label>{t('mode')}<select value={draft.settings.mode} onChange={event=>setDraft({...draft,settings:{...draft.settings,mode:event.target.value as CosConnectionSettings['mode']}})}><option value="simulator">{t('simulator')}</option><option value="live">{t('live')}</option></select></label>
      {(['template','encounterNamespace','organizationHsaId','defaultAmbulanceCareUnit'] as const).map(key=><label key={key}>{t(key)}<input value={draft.settings[key]} onChange={event=>setDraft({...draft,settings:{...draft.settings,[key]:event.target.value}})}/></label>)}
      {draft.settings.mode==='live'&&<fieldset className="admin-role-selection"><legend>{t('liveConnection')}</legend>
       <label><input type="checkbox" checked={draft.settings.live?.readBackVerification!==false} onChange={event=>setDraft({...draft,settings:{...draft.settings,live:{baseUrl:draft.endpoint,tokenUrl:'',clientId:'',acceptedProfiles:[],pdfKeyword:'',versionMarkerLinkId:'',...draft.settings.live,readBackVerification:event.target.checked}}})}/><FieldHelp label={t('readBackVerification')} text={t('readBackVerificationHelp')}/></label>
       <label><FieldHelp label={t('initialVerificationDelaySeconds')} text={t('initialVerificationDelayHelp')}/><input type="number" min={0} max={240} step={1} required disabled={draft.settings.live?.readBackVerification===false} value={Number.isNaN(draft.settings.live?.initialVerificationDelaySeconds)?'':draft.settings.live?.initialVerificationDelaySeconds??20} onChange={event=>setDraft({...draft,settings:{...draft.settings,live:{baseUrl:draft.endpoint,tokenUrl:'',clientId:'',acceptedProfiles:[],pdfKeyword:'',versionMarkerLinkId:'',...draft.settings.live,initialVerificationDelaySeconds:event.target.valueAsNumber}}})}/></label>
       {(['baseUrl','tokenUrl','clientId','scope','pdfKeyword','acceptanceRevision','versionMarkerLinkId'] as const).map(key=><label key={key}>{t(key)}<input required={key!=='scope'&&key!=='acceptanceRevision'} value={draft.settings.live?.[key]??''} onChange={event=>setDraft({...draft,settings:{...draft.settings,live:{baseUrl:draft.endpoint,tokenUrl:'',clientId:'',acceptedProfiles:[],pdfKeyword:'',versionMarkerLinkId:'',...draft.settings.live,[key]:event.target.value}}})}/></label>)}
       <fieldset className="admin-role-selection"><legend>{t('acceptedProfiles')}</legend>{Object.entries(COS_ELEMENT_MAPPINGS.vitals).map(([key,spec])=><label key={key}><input type="checkbox" checked={draft.settings.live?.acceptedProfiles.includes(spec.profile)??false} onChange={event=>setDraft({...draft,settings:{...draft.settings,live:{baseUrl:draft.endpoint,tokenUrl:'',clientId:'',pdfKeyword:'',versionMarkerLinkId:'',...draft.settings.live,acceptedProfiles:event.target.checked?[...(draft.settings.live?.acceptedProfiles??[]),spec.profile]:(draft.settings.live?.acceptedProfiles??[]).filter(profile=>profile!==spec.profile)}}})}/>{t(`vital.${key}`)}</label>)}</fieldset>
      </fieldset>}
      <label><FieldHelp label={t('retrySchedule')} text={t('retryHelp')}/><input value={draft.retryScheduleText} pattern="[0-9, ]*" onChange={event=>setDraft({...draft,retryScheduleText:event.target.value})}/></label>{retryScheduleValid&&<p>{resolveMessage(language,'hospital.cos.retryEffect',{retries:retryDelays.length,minutes:retryDelays.reduce((sum,value)=>sum+value,0)})}</p>}
      <fieldset><legend><FieldHelp label={t('clinicalMappings')} text={t('mappingHelp')}/></legend><label><FieldHelp label={t('pdfLinkId')} text={t('pdfLinkHelp')}/><input value={draft.pdfLinkId} onChange={event=>setDraft({...draft,pdfLinkId:event.target.value})}/></label><div className="hospital-mappings-scroll" role="region" aria-label={t('clinicalMappings')} tabIndex={0}><table className="hospital-mappings-table cos-mappings-table" aria-label={t('clinicalMappings')}><thead><tr><th scope="col">{t('source')}</th><th scope="col">{t('linkId')}</th><th scope="col">{t('actions')}</th></tr></thead><tbody>{draft.clinicalMappings.map((row,index)=><tr key={row.id}>
       <td><label><span className="sr-only">{t('source')}</span><select value={hospitalFieldId(row.source)} onChange={event=>{const option=value.clinicalOptions.find(option=>option.id===event.target.value);if(option)setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((item,i)=>i===index?{...item,source:option.field}:item)});}}>{value.clinicalOptions.map(option=><option key={`${option.field.kind}:${option.id}`} value={option.id}>{option.id} — {resolveCatalogElementText(option,option.id,language,'label')}</option>)}</select></label></td>
       <td><label><span className="sr-only">{t('linkId')}</span><input required value={row.linkId} onChange={event=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((item,i)=>i===index?{...item,linkId:event.target.value}:item)})}/></label></td>
       <td><button className="button-danger" type="button" onClick={()=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.filter((_,i)=>i!==index)})}>{t('remove')}</button></td>
      </tr>)}</tbody></table></div><button type="button" onClick={()=>setDraft({...draft,clinicalMappings:[...draft.clinicalMappings,{id:crypto.randomUUID(),source:value.clinicalOptions[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,linkId:'',answerType:'string'}]})}>{t('addMapping')}</button></fieldset>
      <fieldset className="admin-role-selection"><legend>{t('vitalMappings')}</legend><div className="hospital-mappings-scroll" role="region" aria-label={t('vitalMappings')} tabIndex={0}><table className="hospital-mappings-table cos-mappings-table" aria-label={t('vitalMappings')}><thead><tr><th scope="col">{t('vital')}</th><th scope="col">{t('source')}</th><th scope="col">{t('companionSource')}</th><th scope="col">{t('linkId')}</th><th scope="col">{t('actions')}</th></tr></thead><tbody>{draft.vitalMappings.map((row,index)=><tr key={row.id}>
       <td><label><span className="sr-only">{t('vital')}</span><select value={row.vital} onChange={event=>{const vital=event.target.value as CosVitalMapping['vital'],spec=COS_ELEMENT_MAPPINGS.vitals[vital];setDraft({...draft,vitalMappings:draft.vitalMappings.map((item,i)=>i===index?{id:item.id,vital,source:{kind:'nemsis',elementId:spec.source},unit:spec.unit as CosVitalMapping['unit'],linkId:spec.snomed,...('companionSource' in spec?{companionSource:{kind:'nemsis' as const,elementId:spec.companionSource}}:{})}:item)});}}>{Object.keys(COS_ELEMENT_MAPPINGS.vitals).map(vital=><option key={vital} value={vital}>{t(`vital.${vital}`)}</option>)}</select></label></td>
       <td><label><span className="sr-only">{t('source')}</span><input required value={hospitalFieldId(row.source)} onChange={event=>setDraft({...draft,vitalMappings:draft.vitalMappings.map((item,i)=>i===index?{...item,source:{kind:'nemsis',elementId:event.target.value}}:item)})}/></label></td>
       <td>{row.companionSource&&<label><span className="sr-only">{t('companionSource')}</span><input required value={hospitalFieldId(row.companionSource)} onChange={event=>setDraft({...draft,vitalMappings:draft.vitalMappings.map((item,i)=>i===index?{...item,companionSource:{kind:'nemsis',elementId:event.target.value}}:item)})}/></label>}</td>
       <td><label><span className="sr-only">{t('linkId')}</span><input required value={row.linkId} onChange={event=>setDraft({...draft,vitalMappings:draft.vitalMappings.map((item,i)=>i===index?{...item,linkId:event.target.value}:item)})}/></label></td>
       <td><button className="button-danger" type="button" onClick={()=>setDraft({...draft,vitalMappings:draft.vitalMappings.filter((_,i)=>i!==index)})}>{t('remove')}</button></td>
      </tr>)}</tbody></table></div><button type="button" onClick={()=>setDraft({...draft,vitalMappings:[...draft.vitalMappings,{id:crypto.randomUUID(),vital:'heartRate',source:{kind:'nemsis',elementId:COS_ELEMENT_MAPPINGS.vitals.heartRate.source},unit:'/min',linkId:COS_ELEMENT_MAPPINGS.vitals.heartRate.snomed}]})}>{t('addVitalMapping')}</button>
       <label><input type="checkbox" checked={draft.medicationMappings.length>0} onChange={event=>setDraft({...draft,medicationMappings:event.target.checked?[{id:'administered-medications',groupId:COS_ELEMENT_MAPPINGS.assessment.medicationGroup}]:[]})}/>{t('medicationMappings')}</label>
      </fieldset>
      <p>{t(value.draft?.credentialConfigured?'credentialConfigured':'credentialMissing')}</p>
      {draft.settings.authentication==='oauth-client-credentials'?<><label>{t('clientSecret')}<input type="password" autoComplete="off" maxLength={4096} value={clientSecret} onChange={event=>setClientSecret(event.target.value)}/></label><label>{t('subscriptionKey')}<input type="password" autoComplete="off" maxLength={4096} value={subscriptionKey} onChange={event=>setSubscriptionKey(event.target.value)}/></label></>:<label>{t('credential')}<input type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>}
      <div className="form-actions"><button type="button" disabled={!replacementSecret||JSON.stringify(draft)!==JSON.stringify(editable(value.draft))} onClick={()=>void action('/rotate-credential',{expectedRevision:expected.expectedRevision,replacementSecret})}>{t('rotateCredential')}</button><button type="submit" disabled={(!dirty&&!!value.draft)||(!retryScheduleValid)||((!!clientSecret||!!subscriptionKey)&&!replacementSecret)}>{t('save')}</button>
       <button type="button" disabled={dirty||!value.draft?.credentialConfigured} onClick={()=>void action('/test',{expectedRevision:expected.expectedRevision})}>{t(draft.settings.mode==='live'?'testLive':'test')}</button>
       <button type="button" disabled={dirty||tested?.result!=='healthy'||value.active?.revision===value.draft?.revision} onClick={()=>void action('/activate',{...expected,testId:tested?.id})}>{t(draft.settings.mode==='live'?'activateLive':'activate')}</button>
       <button type="button" disabled={dirty||!value.active} onClick={()=>void action('/deactivate',expected)}>{t('deactivate')}</button><button type="button" disabled={dirty||!!value.active||!value.pausedRevision} onClick={()=>void action('/resume',{...expected,expectedPausedRevision:value.pausedRevision})}>{t('resume')}</button></div>
     </fieldset>
    </form>
    <DestinationDirectory language={language} csrfToken={csrfToken} canWrite={canWrite}/>
   </div>
  </>}
 </section>;
}
