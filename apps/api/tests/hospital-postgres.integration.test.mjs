import {savepointDataSource} from "./fixtures/savepoint-data-source.mjs";
import {hospitalFixtureBaseline} from './fixtures/hospital-baseline.mjs';
import {epsJourney} from './fixtures/eps-journey.mjs';
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
import {HospitalService} from '../dist/hospital/hospital.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AccountService} from '../dist/identity/account.service.js';
import {contentDigest,makePackage} from '../dist/admin/canonical-package.js';
import {decryptAgencyCredential} from '../dist/authentication/agency-oidc-keys.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('EPS real database and browser setup preserves tested revisions, canonical files, scope and credentials',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const folder=await mkdtemp('/tmp/eps-canonical-');const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 let browser,server;
 try{
  process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
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
  const definition={schemaVersion:1,sections:[{key:'patient',fields:[{key:'identifier',source:{kind:'nemsis',elementId:'ePatient.01'}},{key:'alternative',source:{kind:'nemsis',elementId:'ePatient.05'}}]}]};
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

  const foreignId=randomUUID();await query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Other EPS group',$2,'UTC')",[foreignId,`eps-${foreignId}.example.org`]);
  const other=await accounts.provision({organizationId:foreignId,username:`other-${username}`,displayName:'Other admin',role:'administrator',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[other.userId]);
  const otherSession=await sessions.create({username:`other-${username}`,password});
  const medic=await accounts.provision({organizationId:group.id,username:`medic-${username}`,displayName:'Medic',role:'clinician',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[medic.userId]);
  const medicSession=await sessions.create({username:`medic-${username}`,password});
  await assert.rejects(service.get(medicSession.sessionToken));
  const initial=await service.get(token);assert.ok(initial.options.some(option=>option.id==='ePatient.01'));
  const alternative=initial.options.find(option=>option.id!=='ePatient.01');assert.ok(alternative);
  const body={expectedRevision:0,endpoint:initial.defaultEndpoint,authentication:'team-token',patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient:test',aliases:['https://example.org/person']},replacementSecret:'private-team-credential'};
  service.connectivity=async(endpoint,secret)=>{assert.equal(endpoint,initial.defaultEndpoint);assert.equal(secret,'private-team-credential');return true;};
  await assert.rejects(service.save(token,{...body,groupId:foreignId}));
  let view=await service.save(token,body);assert.equal(view.draft.revision,1);assert.equal(view.active,null);assert.doesNotMatch(JSON.stringify(view),/private-team|encrypted_credential|ciphertext/);
  const files=await service.files(token);assert.equal(files.length,1);
  const exported=await service.export(token,'1');assert.deepEqual(JSON.parse(await readFile(path.join(folder,files[0].file),'utf8')),exported);
  assert.equal((await service.files(otherSession.sessionToken)).length,0);await assert.rejects(service.export(otherSession.sessionToken,'1'));await assert.rejects(service.importFile(otherSession.sessionToken,{expectedRevision:0,file:files[0].file}));
  await assert.rejects(service.save(medicSession.sessionToken,body));await assert.rejects(service.save(token,body));
  view=await service.test(token,{expectedRevision:1});assert.equal(view.tests[0].publication,false);
  view=await service.activate(token,{expectedRevision:1,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});assert.equal(view.active.revision,1);
  await epsJourney({database,query,sessions,configuration:service,adminToken:token,otherToken:otherSession.sessionToken,body});
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
  const [stored]=await query('select credential_id,encrypted_credential from app_identity.hospital_eps_version where group_id=$1 and revision=1',[group.id]);
  assert.equal(await decryptAgencyCredential(manager,stored.encrypted_credential,group.id,`hospital-eps:${stored.credential_id}`),'private-team-credential');
  const privilege=await query("select has_table_privilege('open_triage_api_runtime','app_identity.hospital_eps_version','UPDATE') changed,has_table_privilege('public','app_identity.hospital_eps_version','SELECT') exposed");assert.deepEqual(privilege,[{changed:false,exposed:false}]);
  // Drive the actual panel and service against PostgreSQL. Only external HTTP is
  // simulated; all authorization, persistence, files and lifecycle checks are real.
  const {build}=await import('esbuild');const {chromium}=await import('@playwright/test');
  const web=path.resolve(new URL('../../web/',import.meta.url).pathname);
  const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {HospitalIntegrationsPanel} from './components/hospital-integrations';createRoot(document.getElementById('root')).render(<HospitalIntegrationsPanel language="en" csrfToken="browser-csrf" canWrite/>);`}});
  const css=await readFile(path.join(web,'app/styles.css'),'utf8');
  server=createServer(async(req,res)=>{
   try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8"><div class="admin-panel agency-settings" id="root"></div><script src="/panel.js"></script></body></html>`);return;}
    if(req.url==='/panel.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
    if(req.url==='/api/admin/hospital/cos'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await new CosService(database,sessions).get(token)));return;}
    if(!req.url.startsWith('/api/admin/hospital/eps')){res.writeHead(404);res.end();return;}
    assert.equal(req.headers.cookie,'eps-session=authorized');
    let input;for await(const part of req)input=(input??'')+part;const command=input?JSON.parse(input):undefined;
    if(command)assert.equal(req.headers['x-csrf-token'],'browser-csrf');
    const route=req.url.replace('/api/admin/hospital/eps','');
    const result=route==='/files'?await service.files(token):route==='/import-file'?await service.importFile(token,command):route.startsWith('/export/')?await service.export(token,route.split('/').at(-1)):route==='/test'?await service.test(token,command):route==='/activate'?await service.activate(token,command):route==='/deactivate'?await service.activate(token,command,true):req.method==='PUT'?await service.save(token,command):await service.get(token);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
   }catch(error){res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{code:'hospital.invalid'}));}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'eps-session',value:'authorized',url:origin}]);const page=await context.newPage();
  await page.goto(origin);await page.getByRole('group',{name:'EPS configuration',exact:true}).getByLabel('Patient identifier field').waitFor();assert.equal(await page.getByRole('group',{name:'EPS configuration',exact:true}).getByLabel('Patient identifier field').inputValue(),'ePatient.01');await page.getByLabel('Replacement team credential').fill('private-team-credential');await page.getByRole('group',{name:'EPS configuration',exact:true}).getByLabel('Patient identifier field').selectOption(alternative.id);await page.getByRole('button',{name:'Save EPS draft',exact:true}).click();
  await page.getByRole('status').waitFor();assert.equal((await service.get(token)).draft.revision,4);assert.equal((await service.get(token)).active.revision,1);
  await page.getByRole('button',{name:'Test read-only connection',exact:true}).click();await page.getByText('Connection verified',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Activate EPS',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Active revision: 4'));assert.equal((await service.get(token)).active.revision,4);
  const fileResponse=page.waitForResponse(response=>response.url().endsWith('/files'));await page.getByRole('button',{name:'Find saved mapping files',exact:true}).click();const fileResult=await fileResponse;assert.equal(fileResult.status(),200,await fileResult.text());await page.getByLabel('Saved mapping files',{exact:false}).selectOption(files[0].file);
  await page.getByRole('button',{name:'Import selected file as draft',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Draft revision: 5'));assert.equal((await service.get(token)).active.revision,4);
  assert.equal(await page.getByRole('button',{name:'Activate EPS',exact:true}).isDisabled(),true);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export mapping JSON',exact:true}).click();const artifact=await download;assert.ok(artifact.suggestedFilename().endsWith('.json'));
  assert.deepEqual(JSON.parse(await readFile(await artifact.path(),'utf8')),exported);
  await page.getByRole('button',{name:'COS',exact:true}).click();await page.getByText('Simulator tests run locally',{exact:false}).waitFor();
  await page.getByRole('button',{name:'EPS',exact:true}).click();await page.getByRole('button',{name:'Deactivate EPS',exact:true}).click();await page.getByRole('group',{name:'EPS configuration',exact:true}).locator('../..').getByText('Active revision: Inactive',{exact:false}).waitFor();assert.equal((await service.get(token)).active,null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile fields must fit');
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'History',exact:true}).click();assert.equal(await page.getByRole('table').isVisible(),true);
  const audits=await query("select details from app_identity.configuration_event where organization_id=$1 and action like 'hospital.%'",[group.id]);assert.ok(audits.length>8);assert.doesNotMatch(JSON.stringify(audits),/private-team|ciphertext|urn:patient|example.org/);
  // Recheck live authority after a successful configuration journey.
  await query('update app_identity.app_user set active=false where id=$1',[admin.userId]);await assert.rejects(service.save(token,{...body,expectedRevision:5}));
 }finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await client.query('rollback');await client.end();
  if(oldRoot===undefined)delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;else process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;
  if(oldKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;
  await rm(folder,{recursive:true,force:true});
 }
});
