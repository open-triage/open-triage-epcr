"use client";
import {CosIntegrationsPanel} from './cos-integrations';
import React,{useEffect,useState} from 'react';
import {DEFAULT_HOSPITAL_PATIENT_FIELD,hospitalFieldId,type EpsOutputMapping,type EpsClinicalMapping,type HospitalField,type HospitalMappingDefinition} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from '../app/browser-api';
import {resolveMessage} from '../app/localization';
import {platformRequestError,PlatformRequestError} from '../app/platform-errors';
import {resolveCatalogElementText} from '../app/catalog-localization';
import {useUnsavedChanges} from './unsaved-changes';
type Mapping={sha256:string;definition:HospitalMappingDefinition};
type Version={revision:number;endpoint:string;credentialConfigured:boolean;mapping:Mapping};
type View={groupName:string;stateRevision:number;draft:Version|null;active:Version|null;defaultEndpoint:string;
 clinicalOptions?:{id:string;field:HospitalField;name?:string}[];
 options:{id:string;field:HospitalField;name:string;localization?:{schemaVersion:1;sv?:{label:string}}}[];
 tests:{id:string;revision:number;result:string;createdAt:string}[];
 history:{revision:number;sha256:string;status:string;createdAt:string}[];
 events:{action:string;occurredAt:string;actorId:string}[]};
type FileEntry={file:string;compatible:boolean;mapping:Mapping|null};
const empty={endpoint:'https://hackathon2026.vadimperetok.in/fhir',field:DEFAULT_HOSPITAL_PATIENT_FIELD,namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:'',clinicalMappings:[] as EpsClinicalMapping[],outputMappings:[] as EpsOutputMapping[]};
function editable(value:Version|null){return value?{endpoint:value.endpoint,field:value.mapping.definition.patientIdentifier.field,namespace:value.mapping.definition.patientIdentifier.namespace,aliases:value.mapping.definition.patientIdentifier.aliases.join('\n'),clinicalMappings:value.mapping.definition.clinicalMappings??[],outputMappings:value.mapping.definition.outputMappings??[]}:empty;}
export function HospitalIntegrationsPanel({language,csrfToken,canWrite}:{language:string;csrfToken:string;canWrite:boolean}){
 const t=(key:string)=>resolveMessage(language,`hospital.${key}`);
 const [value,setValue]=useState<View|null>(null),[draft,setDraft]=useState(empty),[secret,setSecret]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('eps'),[cosOpened,setCosOpened]=useState(false),[files,setFiles]=useState<FileEntry[]>([]),[selectedFile,setSelectedFile]=useState('');
 const [mappingFindings,setMappingFindings]=useState<{key:string;rows:{id:string;label:string;finding:string|null}[]}>({key:'',rows:[]});
 const dirty=!!secret||JSON.stringify(draft)!==JSON.stringify(editable(value?.draft??null));
 const confirmLeave=useUnsavedChanges(dirty);
 const tested=value?.tests.find(test=>test.revision===value.draft?.revision);
 async function request(path='',body?:unknown,method='POST'){
  const url=apiRequestUrl(`/api/admin/hospital/eps${path}`);if(!url)throw new Error(t('unavailable'));
  const response=await fetch(url,browserRequestInit(body?{method,headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(body)}:{}));
  if(!response.ok)throw await platformRequestError(response,language);return response.json();
 }
 function load(next:View){setValue(next);setDraft(editable(next.draft));setSecret('');}
 function failed(reason:unknown){if(reason instanceof PlatformRequestError&&[401,403].includes(reason.status)){setValue(null);setDraft(empty);setSecret('');setFiles([]);}setError(reason instanceof PlatformRequestError?reason.message:t('unavailable'));}
 // Request helpers use this mount's session and language; Admin remounts on scope changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{let alive=true;request().then(next=>{if(alive)load(next);}).catch(reason=>{if(alive)failed(reason);});return()=>{alive=false;};},[csrfToken]); // Scope changes remount the Admin shell.
 async function action(path:string,body:unknown,method='POST'){
  setBusy(true);setError('');setStatus('');try{load(await request(path,body,method));setStatus(t('saved'));}catch(reason){failed(reason);}finally{setBusy(false);setSecret('');}
 }
 async function refresh(){if(!confirmLeave())return;setBusy(true);try{load(await request());setError('');}catch(reason){failed(reason);}finally{setBusy(false);}}
 async function discover(){setBusy(true);try{setFiles(await request('/files'));setError('');}catch(reason){failed(reason);}finally{setBusy(false);}}
 async function download(){if(!value?.draft)return;setBusy(true);try{const mapping=await request(`/export/${value.draft.revision}`);const blob=URL.createObjectURL(new Blob([JSON.stringify(mapping,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=blob;link.download=`eps-mapping-${mapping.definition.id}-v${mapping.version}.json`;link.click();URL.revokeObjectURL(blob);}catch(reason){failed(reason);}finally{setBusy(false);}}
 async function importUpload(file:File|undefined){if(!file||!confirmLeave())return;if(file.size>256*1024){setError(t('invalidFile'));return;}try{const mapping:unknown=JSON.parse(await file.text());await action('',{expectedRevision:value?.draft?.revision??0,endpoint:draft.endpoint,authentication:'team-token',mapping},'PUT');}catch{setError(t('invalidFile'));}}
 const expected={expectedRevision:value?.draft?.revision??0,expectedStateRevision:value?.stateRevision??0};
 return <section className="admin-configuration agency-settings hospital-integrations" aria-label={t('title')}>
  <h3>{t('title')}</h3><div className="form-actions" role="group" aria-label={t('destination')}>
   {['eps','cos','history'].map(item=><button type="button" key={item} aria-pressed={tab===item} onClick={()=>{setTab(item);if(item==='cos')setCosOpened(true);}}>{t(item)}</button>)}
  </div>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  {error&&<button type="button" onClick={()=>void refresh()} disabled={busy}>{t('reload')}</button>}
  <div hidden={tab!=='cos'}>{cosOpened&&<CosIntegrationsPanel language={language} csrfToken={csrfToken} canWrite={canWrite}/>}</div>
  {value&&<><p>{t('group')}: {value.groupName}</p>
   <div hidden={tab!=='eps'}>
    <p>{t('active')}: {value.active?.revision??t('inactive')} — {t('draft')}: {value.draft?.revision??t('unsaved')}</p>
    <p>{t('connectivityHelp')}</p>
    {tested&&<p>{t('testRevision')}: {tested.revision} — {t(tested.result)} — {new Date(tested.createdAt).toLocaleString(language)}</p>}
    <form onSubmit={event=>{event.preventDefault();void action('',{expectedRevision:expected.expectedRevision,endpoint:draft.endpoint,authentication:'team-token',clinicalMappings:draft.clinicalMappings,outputMappings:draft.outputMappings,patientIdentifier:{field:draft.field,namespace:draft.namespace,aliases:draft.aliases.split(/\s+/).filter(Boolean)},...(secret?{replacementSecret:secret}:{})},'PUT');}}>
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
       {draft.clinicalMappings.map((m,index)=><fieldset key={m.id}><legend>{index+1}</legend>
        <label>{t('resource')}<select value={m.resourceType} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,resourceType:e.target.value as EpsClinicalMapping['resourceType'],semanticRole:undefined,expectedUnit:undefined}:v)})}><option value="AllergyIntolerance">{t('allergy')}</option><option value="Condition">{t('condition')}</option><option value="MedicationStatement">{t('medicationHistory')}</option><option value="Observation">{t('historicalObservation')}</option><option value="Procedure">{t('historicalProcedure')}</option><option value="Patient">{t('patientContext')}</option></select></label>
        {['MedicationStatement','Observation','Procedure','Patient'].includes(m.resourceType)&&<label>{t('semanticRole')}<select required value={m.semanticRole??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,semanticRole:e.target.value as EpsClinicalMapping['semanticRole']}:v)})}><option value="">{t('chooseHistoryRole')}</option>{m.resourceType==='MedicationStatement'?<option value="medication-history">{t('medicationHistoryRole')}</option>:m.resourceType==='Observation'?<option value="historical-observation">{t('historicalObservationRole')}</option>:m.resourceType==='Procedure'?<option value="historical-procedure">{t('historicalProcedureRole')}</option>:<option value="patient-identifier">{t('patientIdentifierRole')}</option>}</select></label>}
        {m.resourceType==='Observation'&&<fieldset><legend>{t('expectedUnit')}</legend><p>{t('expectedUnitHelp')}</p><label>{t('unitSystem')}<input value={m.expectedUnit?.system??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,expectedUnit:e.target.value||v.expectedUnit?.code?{system:e.target.value,code:v.expectedUnit?.code??''}:undefined}:v)})}/></label><label>{t('unitCode')}<input value={m.expectedUnit?.code??''} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,expectedUnit:e.target.value||v.expectedUnit?.system?{system:v.expectedUnit?.system??'',code:e.target.value}:undefined}:v)})}/></label></fieldset>}
        {m.resourceType==='Patient'&&<p>{t('patientContextHelp')}</p>}
        <label>{t('sourceSystem')}<input required value={m.system} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,system:e.target.value}:v)})}/></label>
        <label>{t('sourceCode')}<input required value={m.code} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,code:e.target.value}:v)})}/></label>
        <label>{t('clinicalDestination')}<select value={hospitalFieldId(m.destination)} onChange={e=>{const field=value.clinicalOptions?.find(o=>o.id===e.target.value)?.field;if(field)setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,destination:field}:v)});}}>{value.clinicalOptions?.map(o=><option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</select></label>
        <label>{t('representation')}<select value={m.representation} onChange={e=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.map((v,i)=>i===index?{...v,representation:e.target.value as 'text'|'coded'}:v)})}><option value="text">{t('sourceText')}</option><option value="coded">{t('sameCode')}</option></select></label>
        <button type="button" onClick={()=>setDraft({...draft,clinicalMappings:draft.clinicalMappings.filter((_,i)=>i!==index)})}>{t('removeMapping')}</button>
       </fieldset>)}
       <button type="button" onClick={()=>{setBusy(true);void request('/inspect-mappings',{clinicalMappings:draft.clinicalMappings}).then(rows=>setMappingFindings({key:JSON.stringify(draft.clinicalMappings),rows})).catch(failed).finally(()=>setBusy(false));}}>{t('inspectMappings')}</button>
       {(mappingFindings.key===JSON.stringify(draft.clinicalMappings)?mappingFindings.rows:[]).map(f=><p key={f.id} role="status">{f.label}: {resolveMessage(language,`epsImport.${f.finding??'compatible'}`)}</p>)}
       <button type="button" onClick={()=>setDraft({...draft,clinicalMappings:[...draft.clinicalMappings,{id:crypto.randomUUID(),resourceType:'AllergyIntolerance',system:'http://snomed.info/sct',code:'',destination:value.clinicalOptions?.[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,representation:'coded'}]})}>{t('addMapping')}</button>
      </fieldset>
      <fieldset><legend>{t('outputMappings')}</legend><p>{t('outputHelp')}</p>
       {draft.outputMappings.map((m,index)=><fieldset key={m.id}><legend>{index+1}</legend>
        <label>{t('outputSource')}<select value={hospitalFieldId(m.source)} onChange={e=>{const source=value.clinicalOptions?.find(o=>o.id===e.target.value)?.field;if(source)setDraft({...draft,outputMappings:draft.outputMappings.map((v,i)=>i===index?{...v,source}:v)});}}>{value.clinicalOptions?.map(o=><option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</select></label>
        <label>{t('outputSection')}<select value={m.section} onChange={e=>setDraft({...draft,outputMappings:draft.outputMappings.map((v,i)=>i===index?{...v,section:e.target.value as EpsOutputMapping['section']}:v)})}>{['problems','allergies','medications','procedures','devices','patientStory','patientHistory'].map(section=><option key={section} value={section}>{t(`outputSections.${section}`)}</option>)}</select></label>
        <button type="button" onClick={()=>setDraft({...draft,outputMappings:draft.outputMappings.filter((_,i)=>i!==index)})}>{t('removeMapping')}</button>
       </fieldset>)}
       <button type="button" onClick={()=>setDraft({...draft,outputMappings:[...draft.outputMappings,{id:crypto.randomUUID(),source:value.clinicalOptions?.[0]?.field??DEFAULT_HOSPITAL_PATIENT_FIELD,section:'patientStory',representation:'signed-narrative'}]})}>{t('addOutputMapping')}</button>
      </fieldset>
      <p>{t(value.draft?.credentialConfigured?'credentialConfigured':'credentialMissing')}</p>
      <label>{t('credential')}<input type="password" autoComplete="off" maxLength={4096} value={secret} onChange={event=>setSecret(event.target.value)}/></label>
      <div className="form-actions"><button type="submit" disabled={!dirty&&!!value.draft}>{t('save')}</button>
       <button type="button" disabled={dirty||!value.draft?.credentialConfigured} onClick={()=>void action('/test',{expectedRevision:expected.expectedRevision})}>{t('test')}</button>
       <button type="button" disabled={dirty||tested?.result!=='healthy'||value.active?.revision===value.draft?.revision} onClick={()=>void action('/activate',{...expected,testId:tested?.id})}>{t('activate')}</button>
       <button type="button" disabled={dirty||!value.active} onClick={()=>void action('/deactivate',expected)}>{t('deactivate')}</button></div>
     </fieldset>
    </form>
    <fieldset disabled={busy}><legend>{t('canonical')}</legend><p>{t('canonicalHelp')}</p>
     {value.draft&&<p className="hospital-digest">{t('hash')}: {value.draft.mapping.sha256}</p>}
     <div className="form-actions"><button type="button" onClick={()=>void download()} disabled={!value.draft}>{t('export')}</button><button type="button" onClick={()=>void discover()}>{t('discover')}</button></div>
     {canWrite&&<label>{t('upload')}<input type="file" accept="application/json,.json" onChange={event=>{void importUpload(event.target.files?.[0]);event.target.value='';}}/></label>}
     {!!files.length&&<><label>{t('savedFiles')}<select value={selectedFile} onChange={event=>setSelectedFile(event.target.value)}><option value="">{t('chooseFile')}</option>{files.map(file=><option key={file.file} value={file.file} disabled={!file.compatible}>{file.file}</option>)}</select></label>
      {canWrite&&<button type="button" disabled={!selectedFile} onClick={()=>{if(confirmLeave())void action('/import-file',{expectedRevision:expected.expectedRevision,file:selectedFile});}}>{t('import')}</button>}</>}
    </fieldset>
   </div>
   <div hidden={tab!=='history'} className="hospital-history"><table><thead><tr><th>{t('revision')}</th><th>{t('state')}</th><th>{t('date')}</th><th>{t('hash')}</th></tr></thead><tbody>{value.history.map(row=><tr key={row.revision}><td>{row.revision}</td><td>{t(row.status)}</td><td>{new Date(row.createdAt).toLocaleString(language)}</td><td className="hospital-digest">{row.sha256}</td></tr>)}</tbody></table>
    <ul>{value.events.map((event,index)=><li key={index}>{t(event.action.replace('hospital.','event.'))} — {new Date(event.occurredAt).toLocaleString(language)} — {event.actorId}</li>)}</ul>
   </div>
  </>}
 </section>;
}
