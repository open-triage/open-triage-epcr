"use client";
import {activateListRow} from './list-row-action';
import {CosIntegrationsPanel} from './cos-integrations';
import React,{useEffect,useState} from 'react';
import {flushSync} from 'react-dom';
import {EPS_PATIENT_OUTPUT_FIELDS,type HospitalIntegrationLifecycleState,DEFAULT_HOSPITAL_PATIENT_FIELD,hospitalFieldId,type EpsOutputMapping,type EpsClinicalMapping,type HospitalField,type HospitalMappingDefinition} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
import {platformRequestError,PlatformRequestError} from '../app/platform-errors';
import {resolveCatalogElementText} from '../app/catalog-localization';
import {useUnsavedChanges} from './unsaved-changes';
type Mapping={sha256:string;definition:HospitalMappingDefinition};
type Version={revision:number;endpoint:string;credentialConfigured:boolean;mapping:Mapping};
type View=HospitalIntegrationLifecycleState & {groupName:string;stateRevision:number;draft:Version|null;active:Version|null;defaultEndpoint:string;
 clinicalOptions?:{id:string;field:HospitalField;name?:string}[];
 options:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];
 tests:{id:string;revision:number;result:string;createdAt:string}[];
 history:{revision:number;sha256:string;status:string;createdAt:string}[];
 events:{action:string;occurredAt:string;actorId:string}[]};
const empty={endpoint:'https://hackathon2026.vadimperetok.in/fhir',field:DEFAULT_HOSPITAL_PATIENT_FIELD,namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:'',clinicalMappings:[] as EpsClinicalMapping[],outputMappings:[] as EpsOutputMapping[]};
function editable(value:Version|null){return value?{endpoint:value.endpoint,field:value.mapping.definition.patientIdentifier.field,namespace:value.mapping.definition.patientIdentifier.namespace,aliases:value.mapping.definition.patientIdentifier.aliases.join('\n'),clinicalMappings:value.mapping.definition.clinicalMappings??[],outputMappings:value.mapping.definition.outputMappings??[]}:empty;}
export function HospitalIntegrationsPanel({language,csrfToken,canWrite,initialTab="eps"}:{initialTab?:"eps"|"cos";language:string;csrfToken:string;canWrite:boolean}){
 const t=(key:string)=>resolveMessage(language,`hospital.${key}`);
 const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState<string>(initialTab),[cosOpened,setCosOpened]=useState(initialTab==='cos');
 const [editingMapping,setEditingMapping]=useState<string|null>(null);
 const resourceLabels:Record<EpsClinicalMapping['resourceType'],string>={AllergyIntolerance:'allergy',Condition:'condition',MedicationStatement:'medicationHistory',Observation:'historicalObservation',Procedure:'historicalProcedure',Patient:'patientContext'};
 const [mappingFindings,setMappingFindings]=useState<{key:string;rows:{id:string;label:string;finding:string|null}[]}>({key:'',rows:[]});
 const currentFindings=mappingFindings.key===JSON.stringify(draft.clinicalMappings)?mappingFindings.rows:[];
 const findingsById=new Map(currentFindings.map(f=>[f.id,f]));
 const hasFindings=currentFindings.length>0;
 const mappingColumns=hasFindings?4:3;
 const dirty=!!secret||JSON.stringify(draft)!==JSON.stringify(editable(value?.draft??null));
 const confirmLeave=useUnsavedChanges(dirty);
 const tested=value?.tests.find(test=>test.revision===value.draft?.revision);
 async function request(path='',body?:unknown,method='POST'){
  const url=apiRequestUrl(`/api/admin/hospital/eps${path}`);if(!url)throw new Error(t('unavailable'));
  const response=await fetch(url,browserRequestInit(body?{method,headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok)throw await platformRequestError(response,language);return response.json();
 }
 function load(next:View){setEditingMapping(null);setValue(next);setDraft(editable(next.draft));setSecret('');}
 function failed(reason:unknown){if(reason instanceof PlatformRequestError&&[401,403].includes(reason.status)){setValue(null);setDraft(empty);setSecret('');}setError(reason instanceof PlatformRequestError?reason.message:t('unavailable'));}
 // Request helpers use this mount's session and language; Admin remounts on scope changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{let alive=true;request().then(next=>{if(alive)load(next);}).catch(reason=>{if(alive)failed(reason);});return()=>{alive=false;};},[csrfToken]); // Scope changes remount the Admin shell.
 async function action(path:string,body:unknown,method='POST'){
  setBusy(true);setError('');setStatus('');try{
   const next:View=await request(path,body,method);load(next);setStatus(t('saved'));
   if(path===''&&method==='PUT'){
    setMappingFindings({key:'',rows:[]});
    const clinicalMappings=next.draft?.mapping.definition.clinicalMappings??[];
    if(clinicalMappings.length){const rows=await request('/inspect-mappings',{clinicalMappings});setMappingFindings({key:JSON.stringify(clinicalMappings),rows});}
   }
  }catch(reason){failed(reason);}finally{setBusy(false);setSecret('');}
 }
 async function refresh(){if(!confirmLeave())return;setBusy(true);try{load(await request());setError('');}catch(reason){failed(reason);}finally{setBusy(false);}}
 const expected={expectedRevision:value?.draft?.revision??0,expectedStateRevision:value?.stateRevision??0};
 return <section className="admin-configuration agency-settings hospital-integrations eps-integrations" aria-label={t('title')}>
  <h3>{t('title')}</h3><div className="form-actions" role="group" aria-label={t('destination')}>
   {['eps','cos'].map(item=><button type="button" key={item} aria-pressed={tab===item} onClick={()=>{setTab(item);if(item==='cos')setCosOpened(true);}}>{t(item)}</button>)}
  </div>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  {error&&<button type="button" onClick={()=>void refresh()} disabled={busy}>{t('reload')}</button>}
  <div hidden={tab!=='cos'}>{cosOpened&&<CosIntegrationsPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>}</div>
  {value&&<><p>{t('group')}: {value.groupName}</p>
   <div className="eps-integration-workspace" hidden={tab!=='eps'}>
    <div className="hospital-integration-status" aria-label={t('health')}>
     <p><strong>{t('active')}: {value.active?.revision??t('inactive')}</strong>{value.active&&<> · {t(`health.${value.activeHealth}`)}</>}</p>
     <p><strong>{t('draft')}: {value.draft?.revision??t('unsaved')}</strong>{value.draft&&<> · {tested?t(tested.result):t(`health.${value.draftHealth}`)}</>}{tested&&<> · <time dateTime={tested.createdAt}>{new Date(tested.createdAt).toLocaleString(language)}</time></>}</p>
     {value.pausedRevision&&<p><strong>{t('paused')}: {value.pausedRevision}</strong> · {t(`health.${value.pausedHealth}`)}</p>}
     {value.credentialReplacement&&<p>{t('replacementPendingCompact')}</p>}
    </div>
    <form noValidate onSubmit={event=>{event.preventDefault();
     const invalid=event.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:invalid, select:invalid, textarea:invalid');
     if(invalid){const mappingId=invalid.closest<HTMLElement>('[data-mapping-id]')?.dataset.mappingId;if(mappingId)flushSync(()=>setEditingMapping(mappingId));invalid.reportValidity();return;}
     void action('',{expectedRevision:expected.expectedRevision,endpoint:draft.endpoint,authentication:'team-token',clinicalMappings:draft.clinicalMappings,outputMappings:draft.outputMappings,patientIdentifier:{field:draft.field,namespace:draft.namespace,aliases:draft.aliases.split(/\s+/).filter(Boolean)},...(secret?{replacementSecret:secret}:{})},'PUT');}}>
     <fieldset disabled={busy||!canWrite}><legend>{t('configuration')}</legend>
      <label>{t('endpoint')}<input type="url" required value={draft.endpoint} onChange={event=>setDraft({...draft,endpoint:event.target.value})}/></label>
      <label>{t('authentication')}<select value="team-token" onChange={()=>{}}><option value="team-token">{t('teamToken')}</option></select></label>
      <label>{t('patientField')}<select value={hospitalFieldId(draft.field)} onChange={event=>{const option=value.options.find(option=>option.id===event.target.value);if(option)setDraft({...draft,field:option.field});}}>
       {!value.options.some(option=>option.id===hospitalFieldId(draft.field))&&<option value={hospitalFieldId(draft.field)}>{hospitalFieldId(draft.field)} — {t('fieldUnavailable')}</option>}
       {value.options.map(option=><option key={`${option.field.kind}:${option.id}`} value={option.id}>{option.id} — {resolveCatalogElementText(option,option.id,language,'label')}</option>)}
      </select></label>
      <label>{t('namespace')}<input required value={draft.namespace} onChange={event=>setDraft({...draft,namespace:event.target.value})}/></label>
      <label>{t('aliases')}<textarea rows={2} value={draft.aliases} onChange={event=>setDraft({...draft,aliases:event.target.value})}/></label>
      <fieldset><legend>{t('clinicalMappings')}</legend><p>{t('clinicalHelp')}</p>
       <div className="admin-table-scroll hospital-mappings-scroll" role="region" aria-label={t('clinicalMappings')} tabIndex={0}>
       <table className="hospital-mappings-table" aria-label={t('clinicalMappings')}>
        <thead><tr>{['sourceCode','clinicalDestination',...(hasFindings?['mappingCheck']:[]),'mappingActions'].map(key=><th scope="col" key={key}>{t(key)}</th>)}</tr></thead>
        {(Object.keys(resourceLabels) as EpsClinicalMapping['resourceType'][]).filter(resource=>draft.clinicalMappings.some(m=>m.resourceType===resource)).map(resource=><tbody key={resource}>
         <tr className="hospital-mapping-group"><th scope="rowgroup" colSpan={mappingColumns}>{t(resourceLabels[resource])}</th></tr>
         {draft.clinicalMappings.map((m,index)=>m.resourceType!==resource?null:<React.Fragment key={m.id}>
          <tr className={`hospital-mapping-summary${editingMapping===m.id?' selected':''}`} onClick={activateListRow}>
           <td><strong>{m.code||t('unsaved')}</strong><small>{m.system}</small></td>
           <td>{hospitalFieldId(m.destination)}{value.clinicalOptions?.find(o=>o.id===hospitalFieldId(m.destination))?.name&&<small>{value.clinicalOptions.find(o=>o.id===hospitalFieldId(m.destination))?.name}</small>}<small>{m.crosswalk?`${m.crosswalk.display} (${m.crosswalk.code})`:t(m.representation==='text'?'sourceText':'sameCode')}</small></td>
           {hasFindings&&<td className="hospital-mapping-finding">{findingsById.has(m.id)&&<span className={findingsById.get(m.id)?.finding?'admin-error':undefined}>{resolveMessage(language,`epsImport.${findingsById.get(m.id)?.finding??'compatible'}`)}</span>}</td>}
           <td><button type="button" data-list-row-action aria-expanded={editingMapping===m.id} aria-controls={`mapping-editor-${m.id}`} onClick={()=>setEditingMapping(editingMapping===m.id?null:m.id)}>{t(editingMapping===m.id?'closeMapping':'editMapping')}</button></td>
          </tr>
          <tr hidden={editingMapping!==m.id}><td colSpan={mappingColumns}>
           <div id={`mapping-editor-${m.id}`} className="hospital-mapping-editor" data-mapping-id={m.id}><div>
        <label>{t('resource')}<select value={m.resourceType} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,resourceType:e.target.value as EpsClinicalMapping['resourceType'],semanticRole:undefined,expectedUnit:undefined,crosswalk:undefined}:v)})}><option value="AllergyIntolerance">{t('allergy')}</option><option value="Condition">{t('condition')}</option><option value="MedicationStatement">{t('medicationHistory')}</option><option value="Observation">{t('historicalObservation')}</option><option value="Procedure">{t('historicalProcedure')}</option><option value="Patient">{t('patientContext')}</option></select></label>
        {['MedicationStatement','Observation','Procedure','Patient'].includes(m.resourceType)&&<label>{t('semanticRole')}<select required value={m.semanticRole??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,semanticRole:e.target.value as EpsClinicalMapping['semanticRole']}:v)})}><option value="">{t('chooseHistoryRole')}</option>{m.resourceType==='MedicationStatement'?<option value="medication-history">{t('medicationHistoryRole')}</option>:m.resourceType==='Observation'?<option value="historical-observation">{t('historicalObservationRole')}</option>:m.resourceType==='Procedure'?<option value="historical-procedure">{t('historicalProcedureRole')}</option>:<option value="patient-identifier">{t('patientIdentifierRole')}</option>}</select></label>}
        {m.resourceType==='Observation'&&<fieldset><legend>{t('expectedUnit')}</legend><p>{t('expectedUnitHelp')}</p><label>{t('unitSystem')}<input value={m.expectedUnit?.system??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,expectedUnit:e.target.value||v.expectedUnit?.code?{system:e.target.value,code:v.expectedUnit?.code??''}:undefined}:v)})}/></label><label>{t('unitCode')}<input value={m.expectedUnit?.code??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,expectedUnit:e.target.value||v.expectedUnit?.system?{system:v.expectedUnit?.system??'',code:e.target.value}:undefined}:v)})}/></label></fieldset>}
        {m.resourceType==='Patient'&&<p>{t('patientContextHelp')}</p>}
        </div><div><label>{t('sourceSystem')}<input required value={m.system} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,system:e.target.value}:v)})}/></label>
        <label>{t('sourceCode')}<input required value={m.code} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,code:e.target.value}:v)})}/></label>
        </div><div><label>{t('clinicalDestination')}<select value={hospitalFieldId(m.destination)} onChange={e=>{const field=value.clinicalOptions?.find(o=>o.id===e.target.value)?.field;if(field)setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,destination:field}:v)});}}>{value.clinicalOptions?.map(o=><option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</select></label>
        </div><div><label>{t('representation')}<select value={m.representation} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,representation:e.target.value as 'text'|'coded',crosswalk:e.target.value==='coded'?v.crosswalk:undefined}:v)})}><option value="text">{t('sourceText')}</option><option value="coded">{t('sameCode')}</option></select></label>
        </div><div>{m.representation==='coded'&&['AllergyIntolerance','MedicationStatement','Condition'].includes(m.resourceType)&&<div className="hospital-crosswalk-fields">
         <label><input type="checkbox" checked={!!m.crosswalk} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,crosswalk:e.target.checked?{system:'',code:'',display:'',relationship:'equivalent',reference:''}:undefined}:v)})}/>{t('useCrosswalk')}</label>
         {m.crosswalk&&<>{(['system','code','display','reference'] as const).map(key=><label key={key}>{t(`crosswalk.${key}`)}<input required value={m.crosswalk![key]} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,crosswalk:{...v.crosswalk!,[key]:e.target.value}}:v)})}/></label>)}
          <label>{t('crosswalk.relationship')}<select value={m.crosswalk.relationship} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,crosswalk:{...v.crosswalk!,relationship:e.target.value as 'equivalent'|'broader'}}:v)})}><option value="equivalent">{t('crosswalk.equivalent')}</option><option value="broader">{t('crosswalk.broader')}</option></select></label>
          </>}
        </div>}</div>
           </div>
           <button className="button-danger" type="button" onClick={()=>{setDraft({...draft,clinicalMappings:draft.clinicalMappings.filter((_,i)=>i!==index)});setEditingMapping(null);}}>{t('removeMapping')}</button>
          </td></tr>
         </React.Fragment>)}
        </tbody>)}
       </table></div>
       <span className="hospital-mapping-check-summary" role="status">{hasFindings&&t('mappingCheckSummary').replace('{compatible}',String(currentFindings.filter(f=>!f.finding).length)).replace('{issues}',String(currentFindings.filter(f=>f.finding).length))}</span>
       <button type="button" onClick={()=>{const id=crypto.randomUUID();setEditingMapping(id);setDraft({...draft,clinicalMappings:[...draft.clinicalMappings,{id,resourceType:'AllergyIntolerance',system:'http://snomed.info/sct',code:'',destination:value.clinicalOptions?.[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,representation:'coded'}]});}}>{t('addMapping')}</button>
      </fieldset>
      <fieldset><legend>{t('outputMappings')}</legend><p>{t('outputHelp')}</p>
       <div className="admin-table-scroll hospital-mappings-scroll" role="region" aria-label={t('outputMappings')} tabIndex={0}>
       <table className="hospital-mappings-table hospital-output-table" aria-label={t('outputMappings')}>
        <thead><tr>{['outputSource','outputSection','mappingActions'].map(key=><th scope="col" key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{draft.outputMappings.map((m,index)=><tr key={m.id}><td>
        <select aria-label={t('outputSource')} value={hospitalFieldId(m.source)} onChange={e=>{const source=value.clinicalOptions?.find(o=>o.id===e.target.value)?.field;if(source)setDraft({...draft,outputMappings:draft.outputMappings.map((v,i)=>i===index?{...v,source}:v)});}}>{value.clinicalOptions?.map(o=><option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</select>
        </td><td><select aria-label={t('outputSection')} value={m.section} onChange={e=>setDraft({...draft,outputMappings:draft.outputMappings.map((v,i)=>i===index?{...v,section:e.target.value as EpsOutputMapping['section'],representation:Object.hasOwn(EPS_PATIENT_OUTPUT_FIELDS,e.target.value)?'structured-patient':'signed-narrative',...(Object.hasOwn(EPS_PATIENT_OUTPUT_FIELDS,e.target.value)?{source:{kind:'nemsis' as const,elementId:EPS_PATIENT_OUTPUT_FIELDS[e.target.value as keyof typeof EPS_PATIENT_OUTPUT_FIELDS]}}:{})}:v)})}>{['problems','allergies','medications','procedures','devices','patientStory','patientHistory',...Object.keys(EPS_PATIENT_OUTPUT_FIELDS)].map(section=><option key={section} value={section}>{t(`outputSections.${section}`)}</option>)}</select>
        </td><td><button className="button-danger" type="button" onClick={()=>setDraft({...draft,outputMappings:draft.outputMappings.filter((_,i)=>i!==index)})}>{t('removeMapping')}</button>
       </td></tr>)}</tbody></table></div>
       <button type="button" onClick={()=>setDraft({...draft,outputMappings:[...draft.outputMappings,{id:crypto.randomUUID(),source:value.clinicalOptions?.[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,section:'patientStory',representation:'signed-narrative'}]})}>{t('addOutputMapping')}</button>
      </fieldset>
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
