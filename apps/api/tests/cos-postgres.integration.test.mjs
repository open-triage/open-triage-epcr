import {savepointDataSource} from "./fixtures/savepoint-data-source.mjs";
import {hospitalFixtureBaseline} from './fixtures/hospital-baseline.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import pg from 'pg';
import {ValidationAuthoringService} from '../dist/admin/validation-authoring.service.js';
import {FormPublicationService} from '../dist/forms/form-publication.service.js';
import {canonicalDefinitionSha256} from '../dist/forms/form-publication.validation.js';
import {CosService} from '../dist/hospital/cos.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AccountService} from '../dist/identity/account.service.js';
import {contentDigest,makePackage} from '../dist/admin/canonical-package.js';
import {decryptAgencyCredential} from '../dist/authentication/agency-oidc-keys.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('COS real database and browser setup preserves tested revisions, canonical files, scope and credentials',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const folder=await mkdtemp('/tmp/cos-canonical-');const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 let browser,server;
 try{
  process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
  await client.query('begin');
  const database=savepointDataSource(client),{query,manager}=database;
  const baseline=await hospitalFixtureBaseline(query);
  const [group]=await query('select app_identity.organization_group($1) id',[baseline.organization_id]);
  const accounts=new AccountService(database),sessions=new ClinicianSessionService(database),service=new CosService(database,sessions);
  const username=`cos-${randomUUID()}`,password='Hospital test password 42!';
  const admin=await accounts.provision({organizationId:group.id,username,displayName:'COS administrator',role:'administrator',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[admin.userId]);
  const session=await sessions.create({username,password});const token=session.sessionToken;
  const formId=randomUUID(),versionId=randomUUID();
  const definition={schemaVersion:1,sections:[{key:'patient',fields:[{key:'identifier',source:{kind:'nemsis',elementId:'ePatient.01'}},{key:'alternative',source:{kind:'nemsis',elementId:'ePatient.05'}}]}]};
  const digest=canonicalDefinitionSha256(definition);
  await query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'COS fixture')",[formId,group.id,`cos-${formId}`]);
  await query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[versionId,formId,baseline.catalog_release_id,JSON.stringify(definition),digest,admin.userId]);
  await new FormPublicationService(database).publish(versionId,{publishedBy:admin.userId,definitionSha256:digest,changeNote:'COS integration fixture'},group.id);
  const validations=new ValidationAuthoringService(database,sessions);
  const validationDraft=await validations.create(token,{catalogReleaseId:baseline.catalog_release_id,displayName:'COS fixture policy'},{importedRules:[{id:randomUUID(),name:'Fictional identifier',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'ePatient.01',message:'Fictional identifier required',source:'require present("ePatient.01")'}]});
  const validation=await validations.publish(token,validationDraft.id,{expectedRevision:validationDraft.revision,displayName:validationDraft.displayName,changeNote:'COS configuration fixture'});
  await validations.activate(token,validation.id,{formVersionId:versionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'COS configuration fixture'});
  // Repeat normal activation with a populated bundle to catch suite-order dependencies.
  await validations.activate(token,validation.id,{formVersionId:versionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'COS populated configuration fixture'});
  assert.equal((await query('select form_version_id from app_identity.active_configuration_bundle where organization_id=$1',[group.id]))[0].form_version_id,versionId);

  const childId=randomUUID();await query("insert into app_identity.organization(id,name,deployment_timezone,parent_organization_id) values($1,'COS child','UTC',$2)",[childId,group.id]);
  const foreignId=randomUUID();await query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Other COS group',$2,'UTC')",[foreignId,`cos-${foreignId}.example.org`]);
  const other=await accounts.provision({organizationId:foreignId,username:`other-${username}`,displayName:'Other admin',role:'administrator',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[other.userId]);
  const otherSession=await sessions.create({username:`other-${username}`,password});
  const medic=await accounts.provision({organizationId:group.id,username:`medic-${username}`,displayName:'Medic',role:'clinician',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[medic.userId]);
  const medicSession=await sessions.create({username:`medic-${username}`,password});
  await assert.rejects(service.get(medicSession.sessionToken));
  const initial=await service.get(token);assert.ok(initial.options.some(option=>option.id==='ePatient.01'));
  const alternative=initial.options.find(option=>option.id!=='ePatient.01');assert.ok(alternative);
  const body={expectedRevision:0,endpoint:initial.defaultEndpoint,authentication:'api-key',settings:{mode:'simulator',authentication:'api-key',template:'urn:template:fictional',encounterNamespace:'urn:encounter:fictional',organizationHsaId:'fictional-org',defaultAmbulanceCareUnit:'fictional-ambulance',staff:[{userId:admin.userId,hsaId:'fictional-staff'}],careUnits:[{hospital:'fictional-hospital',localCareUnit:'fictional-unit',hsaId:'fictional-care-unit'}]},clinicalMappings:[{id:'clinical-text',source:{kind:'nemsis',elementId:'ePatient.05'},linkId:'404684003',answerType:'string'}],patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:['https://example.org/person']},replacementSecret:'private-team-credential'};

  await assert.rejects(service.save(token,{...body,groupId:foreignId}));
  let view=await service.save(token,body);assert.equal(view.draft.revision,1);assert.equal(view.active,null);assert.doesNotMatch(JSON.stringify(view),/private-team|encrypted_credential|ciphertext/);
  await sessions.switchAgency(token,childId);const inherited=await service.get(token);assert.equal(inherited.groupId,group.id);assert.deepEqual(inherited.draft,view.draft);assert.equal(inherited.draft.settings.defaultAmbulanceCareUnit,view.draft.settings.defaultAmbulanceCareUnit);await sessions.switchAgency(token,group.id);
  const files=await service.files(token);assert.equal(files.length,1);
  const exported=await service.export(token,'1');assert.deepEqual(JSON.parse(await readFile(path.join(folder,files[0].file),'utf8')),exported);
  assert.equal((await service.files(otherSession.sessionToken)).length,0);await assert.rejects(service.export(otherSession.sessionToken,'1'));await assert.rejects(service.importFile(otherSession.sessionToken,{expectedRevision:0,file:files[0].file}));
  await assert.rejects(service.save(medicSession.sessionToken,body));await assert.rejects(service.save(token,body));
  view=await service.test(token,{expectedRevision:1});assert.equal(view.tests[0].publication,false);
  const originalTest=view.tests[0].id,configuredKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
  process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
  try{view=await service.test(token,{expectedRevision:1});}finally{process.env.OIDC_CREDENTIAL_KEYS_JSON=configuredKeys;}
  assert.equal(view.tests[0].result,'failed','completion timestamps must order evidence even within one transaction');
  await assert.rejects(service.activate(token,{expectedRevision:1,expectedStateRevision:view.stateRevision,testId:originalTest}));
  view=await service.test(token,{expectedRevision:1});assert.equal(view.tests[0].result,'healthy');
  view=await service.activate(token,{expectedRevision:1,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});assert.equal(view.active.revision,1);
  const activeHash=view.active.mapping.sha256;
  view=await service.save(token,{...body,expectedRevision:1,replacementSecret:undefined,patientIdentifier:{...body.patientIdentifier,field:alternative.field}});
  assert.equal(view.active.mapping.sha256,activeHash);assert.equal(view.draft.mapping.definition.patientIdentifier.field.kind,alternative.field.kind);
  await assert.rejects(service.activate(token,{expectedRevision:2,expectedStateRevision:view.stateRevision,testId:view.tests[0].id}));
  const {format,schemaVersion,sha256,...portable}=exported;
  await assert.rejects(service.save(token,{...body,expectedRevision:2,mapping:makePackage({...portable,catalog:{sha256:'0'.repeat(64)}})}));
  await assert.rejects(service.save(token,{...body,expectedRevision:2,mapping:makePackage({...portable,definition:{...portable.definition,secret:'forbidden'}})}));
  // A failed file write does not move either database pointer.
  const blocker=path.join(folder,'not-a-directory');await writeFile(blocker,'x');process.env.OPENTRIAGE_DEFINITIONS_ROOT=blocker;
  await assert.rejects(service.save(token,{...body,expectedRevision:2}));process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
  assert.equal((await service.get(token)).draft.revision,2);
  view=await service.importFile(token,{expectedRevision:2,file:files[0].file});assert.equal(view.draft.revision,3);assert.deepEqual(view.draft.mapping,exported);assert.equal(view.active.revision,1);
  assert.equal(view.tests[0].evidence.simulated,true);assert.equal(view.tests[0].evidence.externalTransmission,false);
  // Other integration activation state is independent.
  assert.equal((await query('select * from app_identity.hospital_eps_state where group_id=$1',[group.id])).length,0);
  // A live mode revision cannot be activated with simulator evidence.
  view=await service.save(token,{...body,expectedRevision:3,settings:{...body.settings,mode:'live'}});
  view=await service.test(token,{expectedRevision:4});assert.equal(view.tests[0].result,'failed');assert.ok(view.tests[0].evidence.findings.includes('sandboxVerification'));
  await assert.rejects(service.activate(token,{expectedRevision:4,expectedStateRevision:view.stateRevision,testId:view.tests[0].id}));assert.equal(view.active.revision,1);
  view=await service.save(token,{...body,expectedRevision:4,patientIdentifier:{...body.patientIdentifier,namespace:'urn:unrecognized:patient'}});
  view=await service.test(token,{expectedRevision:5});assert.ok(view.tests[0].evidence.findings.includes('patientNamespace'));
  await assert.rejects(service.save(token,{...body,expectedRevision:5,settings:{...body.settings,staff:[{userId:other.userId,hsaId:'foreign'}]}}));
  const [stored]=await query('select credential_id,encrypted_credential from app_identity.hospital_cos_version where group_id=$1 and revision=1',[group.id]);
  assert.equal(await decryptAgencyCredential(manager,stored.encrypted_credential,group.id,`hospital-cos:${stored.credential_id}`),'private-team-credential');
  const privilege=await query("select has_table_privilege('open_triage_api_runtime','app_identity.hospital_cos_version','UPDATE') changed,has_table_privilege('public','app_identity.hospital_cos_version','SELECT') exposed");assert.deepEqual(privilege,[{changed:false,exposed:false}]);
  const {build}=await import('esbuild');const {chromium}=await import('@playwright/test');
  const web=path.resolve(new URL('../../web/',import.meta.url).pathname);
  const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CosIntegrationsPanel} from './components/cos-integrations';createRoot(document.getElementById('root')).render(<CosIntegrationsPanel language="en" csrfToken="browser-csrf" canWrite/>);`}});
  const css=await readFile(path.join(web,'app/styles.css'),'utf8');
  server=createServer(async(req,res)=>{
   try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8"><div class="admin-panel agency-settings" id="root"></div><script src="/panel.js"></script></body></html>`);return;}
    if(req.url==='/panel.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
    assert.equal(req.headers.cookie,'cos-session=authorized');
    let input;for await(const part of req)input=(input??'')+part;const command=input?JSON.parse(input):undefined;
    if(command)assert.equal(req.headers['x-csrf-token'],'browser-csrf');
    const route=req.url.replace('/api/admin/hospital/cos','');
    const result=route==='/files'?await service.files(token):route==='/import-file'?await service.importFile(token,command):route.startsWith('/export/')?await service.export(token,route.split('/').at(-1)):route==='/test'?await service.test(token,command):route==='/activate'?await service.activate(token,command):route==='/deactivate'?await service.activate(token,command,true):req.method==='PUT'?await service.save(token,command):await service.get(token);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
   }catch(error){res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{code:'hospital.invalid'}));}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'cos-session',value:'authorized',url:origin}]);const page=await context.newPage();
  await page.goto(origin);await page.getByLabel('Patient identifier field').waitFor();
  await page.getByLabel('Identifier namespace',{exact:true}).fill(body.patientIdentifier.namespace);
  await page.getByLabel('Patient identifier field').selectOption(alternative.id);
  await page.getByLabel('Default ambulance care-unit HSA identifier',{exact:true}).fill('fictional-inherited-ambulance');
  await page.getByLabel('Target template link ID').fill('418799008');
  await page.getByLabel('PDF SNOMED link identifier',{exact:true}).fill('371530004');
  await page.getByLabel('Retry delays (minutes, comma separated)').fill('2, 10');
  await page.getByRole('button',{name:'Save COS draft',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Draft revision: 6'));
  assert.equal((await service.get(token)).active.revision,1);
  assert.equal((await service.get(token)).draft.settings.defaultAmbulanceCareUnit,'fictional-inherited-ambulance');
  await sessions.switchAgency(token,childId);assert.equal((await service.get(token)).draft.settings.defaultAmbulanceCareUnit,'fictional-inherited-ambulance');await sessions.switchAgency(token,group.id);
  await page.getByRole('button',{name:'Test simulator configuration',exact:true}).click();await page.getByText('Simulator configuration passed',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Activate COS simulator',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Active revision: 6'));
  assert.equal((await service.get(token)).draft.mapping.definition.clinicalMappings[0].linkId,'418799008');
  assert.equal((await service.get(token)).draft.mapping.definition.pdfLinkId,'371530004');
  assert.deepEqual((await service.get(token)).draft.settings.retryScheduleMinutes,[2,10]);
  assert.deepEqual((await service.get(token)).active.settings.retryScheduleMinutes,[2,10]);
  assert.equal((await service.get(token)).history.find(row=>row.revision===1).revision,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile fields fit');
  if(process.env.COS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COS_SCREENSHOT_DIR,'cos-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  if(process.env.COS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COS_SCREENSHOT_DIR,'cos-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Find saved mapping files',exact:true}).click();await page.getByLabel('Saved mapping files',{exact:false}).selectOption(files[0].file);
  await page.getByRole('button',{name:'Import selected file as draft',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Draft revision: 7'));assert.equal((await service.get(token)).active.revision,6);
  assert.equal(await page.getByRole('button',{name:'Activate COS simulator',exact:true}).isDisabled(),true);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export mapping JSON',exact:true}).click();const artifact=await download;
  assert.deepEqual(JSON.parse(await readFile(await artifact.path(),'utf8')),exported);
  const audits=await query("select details from app_identity.configuration_event where organization_id=$1 and details->>'integration'='cos'",[group.id]);assert.doesNotMatch(JSON.stringify(audits),/private-team|ciphertext|fictional-staff/);
  // Normal Admin save/test/activate uses the same scheme registry as delivery and Review.
  for(const namespace of ['urn:oid:1.2.752.129.2.1.3.2','urn:oid:1.2.752.129.2.1.3.3']){
   const current=await service.get(token);
   view=await service.save(token,{...body,expectedRevision:current.draft.revision,patientIdentifier:{...body.patientIdentifier,namespace}});
   const revision=view.draft.revision;
   view=await service.test(token,{expectedRevision:revision});assert.equal(view.tests[0].result,'healthy',namespace);
   view=await service.activate(token,{expectedRevision:revision,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});
   assert.equal(view.active.mapping.definition.patientIdentifier.namespace,namespace);
  }
  await query('update app_identity.app_user set active=false where id=$1',[admin.userId]);await assert.rejects(service.save(token,{...body,expectedRevision:5}));
 }finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await client.query('rollback');await client.end();
  if(oldRoot===undefined)delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;else process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;
  if(oldKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;
  await rm(folder,{recursive:true,force:true});
 }
});
