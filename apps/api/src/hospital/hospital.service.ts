import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { DEFAULT_HOSPITAL_PATIENT_FIELD, type HospitalMappingDefinition } from '@open-triage/contracts';
import { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { clinicalFormConfiguration } from '../forms/clinical-form-configuration.js';
import { generateAgencyKey, encryptAgencyCredential, decryptAgencyCredential } from '../authentication/agency-oidc-keys.js';
import type { CredentialEnvelope } from '../authentication/oidc-credentials.js';
import { providerFetch } from '../authentication/oidc-network.js';
import { discoverPackages, writePackage, type CanonicalPackage } from '../admin/canonical-package.js';
import { EPS_ENDPOINT, compileMapping, contentDigest, identifier, identifierOptions, invalid, keys, makePackage, mappingPackage } from './hospital-mapping.js';

type Version={revision:string;endpoint:string;canonical_mapping:CanonicalPackage;catalog_release_id:string;form_version_id:string;credential_id:string;encrypted_credential:CredentialEnvelope|null;created_at:Date;created_by:string};
type State={draft_revision:string;active_revision:string|null;state_revision:string};
const stale=()=>new ConflictException({code:'hospital.stale'});
function revision(value:unknown,min=0):number {if(!Number.isSafeInteger(value)||Number(value)<min)return invalid();return Number(value);}
@Injectable()
export class HospitalService {
  constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
  private async scope(token:string,write=false,manager:EntityManager=this.database.manager) {
    if(write&&manager.queryRunner?.isTransactionActive)await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
    const actor=await this.sessions.requireCapability(token,write?'settings:write':'settings:read',manager);
    const [group]=await manager.query<Array<{id:string;name:string}>>('select id,name from app_identity.organization where id=app_identity.organization_group($1)',[actor.organization.id]);
    if(!group)throw stale();
    return {actor,groupId:group.id,groupName:group.name};
  }
  private async locked(token:string,manager:EntityManager,expected:number) {
    const scope=await this.scope(token,true,manager);
    await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[scope.groupId]);
    const [clock]=await manager.query<Array<{now:Date}>>('select clock_timestamp() now');
    await this.sessions.requireCapability(token,'settings:write',manager,clock!.now);
    const [state]=await manager.query<State[]>('select * from app_identity.hospital_eps_state where group_id=$1',[scope.groupId]);
    if(Number(state?.draft_revision??0)!==expected)throw stale();
    return {...scope,state};
  }
  private async currentForm(manager:EntityManager,groupId:string) {
    const [row]=await manager.query<Array<{form_version_id:string;catalog_release_id:string}>>(`select d.form_version_id,v.catalog_release_id from forms.agency_stationary_default d join forms.form_version v on v.id=d.form_version_id where d.organization_id=$1 and v.status='published'`,[groupId]);
    if(!row)throw new ServiceUnavailableException({code:'hospital.formRequired'});
    const form=await clinicalFormConfiguration(manager,row.form_version_id,row.catalog_release_id);
    return {...row,form,catalogHash:contentDigest({catalogFields:form.catalogFields,customFields:form.customFields??{}})};
  }
  private async version(manager:EntityManager,groupId:string,rev:number) {
    const [row]=await manager.query<Version[]>('select * from app_identity.hospital_eps_version where group_id=$1 and revision=$2',[groupId,rev]);
    if(!row)throw stale();return row;
  }
  private view(row:Version|undefined) {
    if(!row)return null;
    return {revision:Number(row.revision),endpoint:row.endpoint,authentication:'team-token',mapping:row.canonical_mapping,
      credentialConfigured:!!row.encrypted_credential,createdAt:row.created_at.toISOString()};
  }
  async get(token:string) {
    const {groupId,groupName}=await this.scope(token);
    const [state]=await this.database.query<State[]>('select * from app_identity.hospital_eps_state where group_id=$1',[groupId]);
    const rows=await this.database.query<Version[]>('select * from app_identity.hospital_eps_version where group_id=$1 order by revision desc limit 20',[groupId]);
    const active=state?.active_revision?await this.version(this.database.manager,groupId,Number(state.active_revision)):undefined;
    const tests=await this.database.query<Array<{id:string;revision:string;result:string;created_at:Date}>>('select id,revision,result,created_at from app_identity.hospital_eps_test where group_id=$1 order by created_at desc,id desc limit 20',[groupId]);
    const events=await this.database.query<Array<{action:string;occurred_at:Date;actor_id:string;details:unknown}>>(`select action,occurred_at,actor_id,details from app_identity.configuration_event where organization_id=$1 and action like 'hospital.%' order by occurred_at desc,id desc limit 30`,[groupId]);
    let options:ReturnType<typeof identifierOptions>=[];
    try {options=identifierOptions((await this.currentForm(this.database.manager,groupId)).form);}catch(error){if(!(error instanceof ServiceUnavailableException))throw error;}
    return {groupId,groupName,stateRevision:Number(state?.state_revision??0),cos:'unconfigured',draft:this.view(rows[0]),active:this.view(active),options,
      defaultPatientField:DEFAULT_HOSPITAL_PATIENT_FIELD,defaultEndpoint:EPS_ENDPOINT,
      tests:tests.map(t=>({id:t.id,revision:Number(t.revision),result:t.result,createdAt:t.created_at.toISOString(),kind:'read-only-connectivity',publication:false})),
      history:rows.map(row=>({revision:Number(row.revision),mappingId:mappingPackage(row.canonical_mapping).definition.id,sha256:row.canonical_mapping.sha256,createdAt:row.created_at.toISOString(),actorId:row.created_by,status:Number(row.revision)===Number(state?.active_revision)?'active':Number(row.revision)===Number(state?.draft_revision)?'draft':'superseded'})),
      events:events.map(event=>({action:event.action,occurredAt:event.occurred_at.toISOString(),actorId:event.actor_id,details:event.details}))};
  }
  async save(token:string,input:unknown) {
    const body=keys(input,['expectedRevision','endpoint','authentication','patientIdentifier','replacementSecret','mapping']);
    const expected=revision(body.expectedRevision);
    if(body.endpoint!==EPS_ENDPOINT||body.authentication!=='team-token')return invalid();
    if(body.replacementSecret!==undefined&&(typeof body.replacementSecret!=='string'||body.replacementSecret.length<1||body.replacementSecret.length>4096||/[\u0000-\u001f\u007f]/.test(body.replacementSecret)))return invalid();
    await this.database.transaction(async manager=>{
      const {actor,groupId,state}=await this.locked(token,manager,expected);
      const dependencies=await this.currentForm(manager,groupId);
      const prior=state?await this.version(manager,groupId,expected):undefined;
      const incoming=body.mapping===undefined?null:mappingPackage(body.mapping);
      if(incoming&&incoming.catalog.sha256!==dependencies.catalogHash)throw new ConflictException({code:'hospital.dependencies'});
      const patientIdentifier=incoming?.definition.patientIdentifier??identifier(body.patientIdentifier);
      const priorDefinition=prior?mappingPackage(prior.canonical_mapping).definition:null;
      // Imported identity/revision/hash remains intact in its canonical file. Local
      // configuration revision is independent and still requires a fresh test.
      const mappingId=incoming?.definition.id??priorDefinition?.id??randomUUID();
      const [maximum]=await manager.query<Array<{revision:number}>>(`select coalesce(max((canonical_mapping->'definition'->>'revision')::integer),0)::integer revision from app_identity.hospital_eps_version where group_id=$1 and canonical_mapping->'definition'->>'id'=$2`,[groupId,mappingId]);
      if(incoming){const existing=await manager.query<Array<{sha256:string}>>(`select canonical_mapping->>'sha256' sha256 from app_identity.hospital_eps_version where group_id=$1 and canonical_mapping->'definition'->>'id'=$2 and canonical_mapping->'definition'->>'revision'=$3`,[groupId,mappingId,String(incoming.definition.revision)]);if(existing.some(row=>row.sha256!==incoming.sha256))throw stale();}
      const mappingRevision=Number(maximum?.revision??0)+1;
      const mapping=incoming??makePackage({kind:'hospital-mapping',name:`EPS-${mappingId}`,version:String(mappingRevision),catalog:{sha256:dependencies.catalogHash},definition:{
        schemaVersion:1,id:mappingId,revision:mappingRevision,
        authoredAt:new Date().toISOString(),author:actor.user.id,
        profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier
      } satisfies HospitalMappingDefinition});
      compileMapping(mapping,dependencies.form);
      const credentialId=prior?.credential_id??randomUUID();
      let credential=prior?.encrypted_credential??null;
      try {
        if(body.replacementSecret){await generateAgencyKey(manager,groupId,actor.user.id);credential=await encryptAgencyCredential(manager,body.replacementSecret as string,groupId,`hospital-eps:${credentialId}`);}
      }catch {throw new ServiceUnavailableException({code:'hospital.encryptionUnavailable'});}
      // Persist before publishing the database pointer. Failed storage never claims
      // a successful save. An orphan file after rollback remains a valid draft import.
      try {await writePackage(mapping,groupId);}catch {throw new ServiceUnavailableException({code:'hospital.fileUnavailable'});}
      await manager.query(`insert into app_identity.hospital_eps_version(group_id,revision,credential_id,endpoint,canonical_mapping,catalog_release_id,form_version_id,encrypted_credential,created_by) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9)`,
        [groupId,expected+1,credentialId,body.endpoint,JSON.stringify(mapping),dependencies.catalog_release_id,dependencies.form_version_id,credential?JSON.stringify(credential):null,actor.user.id]);
      await manager.query(`insert into app_identity.hospital_eps_state(group_id,draft_revision) values($1,$2) on conflict(group_id) do update set draft_revision=$2,state_revision=hospital_eps_state.state_revision+1`,[groupId,expected+1]);
      await this.audit(manager,groupId,actor.user.id,await this.version(manager,groupId,expected+1),'draft_save');
    });
    return this.get(token);
  }
  /** Replaced by deterministic transport in tests; production sends only GET. */
  async connectivity(endpoint:string,secret:string):Promise<boolean> {
    const response=await providerFetch(`${endpoint}/Organization/$me`,{headers:{'X-Team-Token':secret}},undefined,undefined,'application/fhir+json');
    const body=await response.json() as {resourceType?:string;id?:string};
    return body.resourceType==='Organization'&&typeof body.id==='string'&&!!body.id;
  }
  async test(token:string,input:unknown) {
    const body=keys(input,['expectedRevision']);const expected=revision(body.expectedRevision,1);
    const {groupId}=await this.scope(token,true);
    const row=await this.version(this.database.manager,groupId,expected);
    if(!row.encrypted_credential)throw new ConflictException({code:'hospital.credentialRequired'});
    let healthy=false;
    try {const secret=await decryptAgencyCredential(this.database.manager,row.encrypted_credential,groupId,`hospital-eps:${row.credential_id}`);healthy=await this.connectivity(row.endpoint,secret);}catch{/* Never expose provider bodies, credentials or raw network errors. */}
    await this.database.transaction(async manager=>{
      const current=await this.locked(token,manager,expected);if(current.groupId!==groupId)throw stale();
      const form=await clinicalFormConfiguration(manager,row.form_version_id,row.catalog_release_id);
      compileMapping(row.canonical_mapping,form);
      await manager.query(`insert into app_identity.hospital_eps_test(id,group_id,revision,result,created_by) values($1,$2,$3,$4,$5)`,[randomUUID(),groupId,expected,healthy?'healthy':'failed',current.actor.user.id]);
      await this.audit(manager,groupId,current.actor.user.id,row,'test',healthy?'succeeded':'failed');
    });return this.get(token);
  }
  async activate(token:string,input:unknown,deactivate=false) {
    const body=keys(input,['expectedRevision','expectedStateRevision','testId']);const expected=revision(body.expectedRevision,1),expectedState=revision(body.expectedStateRevision,1);
    if(!deactivate&&(typeof body.testId!=='string'||!/^[-0-9a-f]{36}$/.test(body.testId)))return invalid();
    await this.database.transaction(async manager=>{
      const {groupId,actor,state}=await this.locked(token,manager,expected);
      if(Number(state?.state_revision)!==expectedState)throw stale();
      const row=await this.version(manager,groupId,expected);
      if(!deactivate){
        const [tested]=await manager.query<Array<{id:string;result:string}>>('select id,result from app_identity.hospital_eps_test where group_id=$1 and revision=$2 order by created_at desc,id desc limit 1',[groupId,expected]);
        if(!tested||tested.id!==body.testId||tested.result!=='healthy')throw new ConflictException({code:'hospital.testRequired'});
        compileMapping(row.canonical_mapping,await clinicalFormConfiguration(manager,row.form_version_id,row.catalog_release_id));
        try{await writePackage(row.canonical_mapping,groupId);}catch{throw new ServiceUnavailableException({code:'hospital.fileUnavailable'});}
      }
      await manager.query('update app_identity.hospital_eps_state set active_revision=$2,state_revision=state_revision+1 where group_id=$1',[groupId,deactivate?null:expected]);
      await this.audit(manager,groupId,actor.user.id,row,deactivate?'deactivate':'activate');
    });return this.get(token);
  }
  async files(token:string){
    const {groupId}=await this.scope(token);
    const files=await discoverPackages('hospital-mapping',groupId);
    if(!files.length)return [];
    let dependencies:Awaited<ReturnType<HospitalService['currentForm']>>|undefined;
    try{dependencies=await this.currentForm(this.database.manager,groupId);}catch(error){if(!(error instanceof ServiceUnavailableException))throw error;}
    return files.map(file=>{
      try {
        const mapping=mappingPackage(file.package);
        if(!dependencies||mapping.catalog.sha256!==dependencies.catalogHash)throw stale();
        compileMapping(mapping,dependencies.form);
        return {file:file.file,mapping,compatible:true};
      }catch{return {file:file.file,mapping:null,compatible:false};}
    });
  }
  async importFile(token:string,input:unknown){
    const body=keys(input,['expectedRevision','file']);const {groupId}=await this.scope(token,true);
    if(typeof body.file!=='string')return invalid();
    const file=(await discoverPackages('hospital-mapping',groupId)).find(file=>file.file===body.file);
    if(!file?.package)return invalid();
    return this.save(token,{expectedRevision:body.expectedRevision,endpoint:EPS_ENDPOINT,authentication:'team-token',mapping:file.package});
  }
  async export(token:string,rev:string){const {groupId}=await this.scope(token);return (await this.version(this.database.manager,groupId,revision(Number(rev),1))).canonical_mapping;}
  private async audit(manager:EntityManager,groupId:string,actorId:string,row:Version,operation:string,result='succeeded') {
    await manager.query(`insert into app_identity.configuration_event(organization_id,actor_id,action,result,form_version_id,catalog_release_id,change_note,content_sha256,details) values($1,$2,$3,$4,$5,$6,$3,$7,$8::jsonb)`,
      [groupId,actorId,`hospital.${operation}`,result,row.form_version_id,row.catalog_release_id,row.canonical_mapping.sha256,JSON.stringify({integration:'eps',revision:Number(row.revision),mappingId:mappingPackage(row.canonical_mapping).definition.id,publication:false})]);
  }
}
