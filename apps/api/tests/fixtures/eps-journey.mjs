import {epsBrowser} from './eps-browser.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {EpsService} from '../../dist/hospital/eps.service.js';
import {DraftReportService} from '../../dist/reports/draft-report.service.js';
import {SYNTHETIC_DEMO_FIXTURE} from '@open-triage/contracts';
export async function epsJourney({database,query,sessions,configuration,adminToken,otherToken,body}){
 const originalRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps-journey-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
 await query('savepoint eps_journey');
 try{
  process.env.PATIENT_KEY_INSTALLATION_ID??='91000000-0000-4000-8000-000000000001';process.env.PATIENT_KEY_VERSION??='1';process.env.PATIENT_KEY_SECRET_BASE64??=Buffer.alloc(32,0x31).toString('base64');
  const login=await sessions.create({username:'demo',password:'opentriagedemo'}),token=login.sessionToken,actor=login.session;
  assert.equal(actor.user.id,SYNTHETIC_DEMO_FIXTURE.userId);assert.equal(actor.organization.id,SYNTHETIC_DEMO_FIXTURE.organizationId,'EPS fixture must use the seeded demo agency');
  const drafts=new DraftReportService(database,sessions),service=new EpsService(database,sessions);
  const report=await drafts.create(token,{commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:actor.organization.id,documentingUserId:actor.user.id,patientIdentityState:'unknown'});
  const [rootGroup]=await query("select id from clinical.group_instance where report_id=$1 and group_id='PatientCareReportGroup'",[report.id]);
  const patientGroup={id:randomUUID(),groupId:'ePatientSection',parentGroupInstanceId:rootGroup.id,ordinal:0};
  const occurrence={id:randomUUID(),groupInstanceId:patientGroup.id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'200207252388'}};
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:report.revision,authorId:actor.user.id,groups:[patientGroup],occurrences:[occurrence]},actor.csrfToken);
  const fixtures=await Promise.all(['andrea','arne'].map(n=>readFile(new URL(`./hospital/${n}.json`,import.meta.url),'utf8').then(JSON.parse)));
  for(const b of fixtures){
   b.entry.find(e=>e.resource.resourceType==='Patient').resource.identifier[0].system=body.patientIdentifier.namespace;
   const section=b.entry[0].resource.section[0];section.entry=[...(section.entry??[]),{reference:'https://example.invalid/eps-resource'}];
   section.text={status:'generated',div:(section.text?.div??'')+'<div>Fixture narrative<img src="https://example.invalid/image" alt="Image description" onerror="window.epsUnsafe=true"><script>window.epsUnsafe=true</script></div>'};
  }
  let broken=false,malformed=false,gate=null;
  service.adapter.read=async path=>{
   if(gate)await gate;
   if(broken)throw new Error('PRIVATE PROVIDER BODY');
   if(path==='/$samples')return {resourceType:'Parameters',parameter:['andrea','arne'].map(id=>({name:'entry',part:[{name:'id',valueString:id}]}))};
   if(path==='/$exchange')return {resourceType:'Parameters',parameter:[]};
   return malformed?{}:fixtures[path==='/Bundle/andrea'?0:1];
  };
  await query('set local role open_triage_api_runtime');
  let context=await service.context(token,report.id);assert.ok(context,'EPS must be activated for the demo report agency');
  assert.deepEqual(await new EpsService(database,sessions).context(token,report.id),context,'replicas issue the same stale detector');
  let result=await service.lookup(token,report.id,context.binding);assert.equal(result.status,'available');assert.match(JSON.stringify(result.summary),/Andrea/);assert.equal(result.context.mappingSha256,context.mappingSha256);
  await query('reset role');
  await assert.rejects(service.context(otherToken,report.id));await assert.rejects(service.context(adminToken,report.id));
  await assert.rejects(service.lookup(token,report.id,'wrong'),error=>error.getStatus()===409);
  const change=async value=>{const current=(await drafts.get(token,report.id));return drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,occurrences:[{...occurrence,value:{kind:'text',value}}]},actor.csrfToken);};
  await change('194302096997');const arne=await service.context(token,report.id);assert.notEqual(arne.binding,context.binding);context=arne;
  result=await service.lookup(token,report.id,context.binding);assert.match(JSON.stringify(result.summary),/Arne/);
  broken=true;await assert.rejects(service.lookup(token,report.id,context.binding),error=>error.getStatus()===503&&!JSON.stringify(error).includes('PRIVATE'));broken=false;
  malformed=true;await assert.rejects(service.lookup(token,report.id,context.binding),error=>error.getStatus()===503);malformed=false;
  await epsBrowser({service,token,reportId:report.id,organizationId:actor.organization.id,userId:actor.user.id,change,setBroken:value=>{broken=value;}});
  await change('194302096997');context=await service.context(token,report.id);
  let release;gate=new Promise(resolve=>release=resolve);const pending=service.lookup(token,report.id,context.binding);
  // Let snapshot finish, then change identity while the external lookup is held.
  await new Promise(resolve=>setTimeout(resolve,30));await change('200207252388');release();gate=null;await assert.rejects(pending,error=>error.getStatus()===409);
  await change('not-found');context=await service.context(token,report.id);assert.equal((await service.lookup(token,report.id,context.binding)).status,'no-match');
  await change('');context=await service.context(token,report.id);assert.equal((await service.lookup(token,report.id,context.binding)).status,'missing');
  // A new selected field cannot reuse availability for ePatient.01.
  let config=await configuration.save(adminToken,{...body,expectedRevision:1,replacementSecret:undefined,patientIdentifier:{...body.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}});
  config=await configuration.test(adminToken,{expectedRevision:2});await configuration.activate(adminToken,{expectedRevision:2,expectedStateRevision:config.stateRevision,testId:config.tests.find(test=>test.revision===2).id});
  const changed=await service.context(token,report.id);assert.equal(changed.patientIdentifier.field.elementId,'ePatient.05');assert.notEqual(changed.binding,context.binding);assert.equal((await service.lookup(token,report.id,changed.binding)).status,'missing');
  const nameGroup={id:randomUUID(),groupId:'ePatient.PatientNameGroup',parentGroupInstanceId:patientGroup.id,ordinal:0};
  const currentReport=await drafts.get(token,report.id);
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:currentReport.revision,authorId:actor.user.id,groups:[nameGroup],occurrences:[{id:randomUUID(),groupInstanceId:nameGroup.id,elementId:'ePatient.05',ordinal:0,value:{kind:'text',value:'194302096997'}}]},actor.csrfToken);
  const alternateContext=await service.context(token,report.id);const alternateResult=await service.lookup(token,report.id,alternateContext.binding);assert.equal(alternateResult.status,'available');assert.match(JSON.stringify(alternateResult.summary),/Arne/);assert.equal(alternateResult.context.configurationRevision,2);
  const events=await query("select integration_provenance from clinical_audit.patient_access_event where report_id=$1 and action='eps.read'",[report.id]);assert.ok(events.length>=3);assert.equal(events[0].integration_provenance.mappingSha256,result.context.mappingSha256);assert.doesNotMatch(JSON.stringify(events),/20020725|19430209|Andrea|Arne/);
  await query('update app_identity.app_user set active=false where id=$1',[actor.user.id]);await assert.rejects(service.context(token,report.id));
 }finally{await query('rollback to savepoint eps_journey');await query('release savepoint eps_journey');process.env.OPENTRIAGE_DEFINITIONS_ROOT=originalRoot;await rm(folder,{recursive:true,force:true});}
}
