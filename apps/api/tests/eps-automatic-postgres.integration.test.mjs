import {epsSubmissionJourney} from './fixtures/eps-submission-journey.mjs';
import {savepointDataSource} from "./fixtures/savepoint-data-source.mjs";
import {hospitalFixtureBaseline} from './fixtures/hospital-baseline.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import pg from 'pg';
import {ValidationAuthoringService} from '../dist/admin/validation-authoring.service.js';
import {FormPublicationService} from '../dist/forms/form-publication.service.js';
import {canonicalDefinitionSha256} from '../dist/forms/form-publication.validation.js';
import {HospitalService} from '../dist/hospital/hospital.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AccountService} from '../dist/identity/account.service.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('automatic EPS signing exports and manual recovery preserve durable attempts and authorization',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const folder=await mkdtemp('/tmp/eps-canonical-');const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 try{
  process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;process.env.OIDC_CREDENTIAL_KEYS_JSON??=JSON.stringify({'1':randomBytes(32).toString('base64')});
  await client.query('begin');
  const database=savepointDataSource(client),{query,manager}=database;
  const baseline=await hospitalFixtureBaseline(query);
  const [group]=await query('select app_identity.organization_group($1) id',[baseline.organization_id]);
  const accounts=new AccountService(database),sessions=new ClinicianSessionService(database),service=new HospitalService(database,sessions);
  const username=`eps-${randomUUID()}`,password='Hospital test password 42!';
  const admin=await accounts.provision({organizationId:group.id,username,displayName:'EPS administrator',role:'administrator',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[admin.userId]);
  const session=await sessions.create({username,password});const token=session.sessionToken;
  const formId=randomUUID(),versionId=randomUUID();
  const definition={schemaVersion:1,sections:[{key:'patient',fields:[{key:'identifier',source:{kind:'nemsis',elementId:'ePatient.01'}},{key:'alternative',source:{kind:'nemsis',elementId:'ePatient.05'}},{key:'history',source:{kind:'nemsis',elementId:'eNarrative.01'}}]}]};
  const digest=canonicalDefinitionSha256(definition);
  await query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'EPS fixture')",[formId,group.id,`eps-${formId}`]);
  await query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[versionId,formId,baseline.catalog_release_id,JSON.stringify(definition),digest,admin.userId]);
  await new FormPublicationService(database).publish(versionId,{publishedBy:admin.userId,definitionSha256:digest,changeNote:'EPS integration fixture'},group.id);
  const validations=new ValidationAuthoringService(database,sessions);
  const validationDraft=await validations.create(token,{catalogReleaseId:baseline.catalog_release_id,displayName:'EPS fixture policy'},{importedRules:[{id:randomUUID(),name:'Fictional identifier',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'ePatient.01',message:'Fictional identifier required',source:'require present("ePatient.01")'}]});
  const validation=await validations.publish(token,validationDraft.id,{expectedRevision:validationDraft.revision,displayName:validationDraft.displayName,changeNote:'EPS configuration fixture'});
  await validations.activate(token,validation.id,{formVersionId:versionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'EPS configuration fixture'});
  // Repeat normal activation with a populated bundle to catch suite-order dependencies.
  await validations.activate(token,validation.id,{formVersionId:versionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'EPS populated configuration fixture'});
  assert.equal((await query('select form_version_id from app_identity.active_configuration_bundle where organization_id=$1',[group.id]))[0].form_version_id,versionId);


  await query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group.id]);
  const initial=await service.get(token);
  const body={expectedRevision:initial.draft?.revision??0,endpoint:initial.defaultEndpoint,authentication:'team-token',patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient:test',aliases:[]},replacementSecret:'private-team-credential',clinicalMappings:[],outputMappings:[]};
  service.connectivity=async()=>true;
  let view=await service.save(token,body);
  view=await service.test(token,{expectedRevision:view.draft.revision});
  await service.activate(token,{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});
  await epsSubmissionJourney({database,query,sessions,configuration:service,adminToken:token,otherToken:'invalid-session',body});
 }finally{
  await client.query('rollback');await client.end();
  process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;
  await rm(folder,{recursive:true,force:true});
 }
});
