import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {CosService} from '../../dist/hospital/cos.service.js';
import {ReviewService} from '../../dist/review/review.service.js';
import {makePackage} from '../../dist/admin/canonical-package.js';
import {processCosWork} from '../../dist/hospital/cos-worker.js';
/** Uses the caller's isolated agency and normally signed report; never modifies a shared demo. */
export async function mappingRepairJourney({db,sample,settings,draft,sign,reviewer,run,noDefault,noEncounter,attachPhoto}){
 const folder=await mkdtemp('/tmp/cos-repair-'),oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 let actor={capabilities:['settings:read','settings:write','review:all','review:identifying'],organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}};
 const sessions={lockPersonalAuthenticationContext:async()=>{},assertCsrf:async(_token,csrf)=>{assert.equal(csrf,'repair-csrf');},get:async()=>actor,requireCapability:async(_token,capability)=>{if(!actor.capabilities.includes(capability))throw Object.assign(new Error('denied'),{getStatus:()=>403});return actor;}};
 let mediaReads=0,sourceReads=0;
 const metadataDatabase=new Proxy(db,{get(target,key){if(key==='transaction')return callback=>target.transaction(manager=>callback(new Proxy(manager,{get(inner,field){if(field==='query')return (sql,parameters)=>{if(sql.includes('clinical.signed_snapshot'))sourceReads++;if(sql.includes('from clinical.report_photo_blob b')){mediaReads++;throw new Error('Simulated photo storage outage');}return inner.query(sql,parameters);};const member=Reflect.get(inner,field);return typeof member==='function'?member.bind(inner):member;}})));const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;}});
 const config=new CosService(db,sessions),review=new ReviewService(metadataDatabase,sessions);
 let browser,server;
 try{
  process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;process.env.OIDC_CREDENTIAL_KEYS_JSON??=JSON.stringify({'1':randomBytes(32).toString('base64')});
  let current=await config.get('fixture');
  const body={expectedRevision:current.draft.revision,endpoint:'https://cos.example.invalid',authentication:'api-key',settings:{...settings,staff:[{userId:reviewer.userId,hsaId:'fictional-other-staff'}]},patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]},clinicalMappings:[{id:'repair-text',source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:'404684003',answerType:'string'}],replacementSecret:'fictional-repair-credential'};
  async function activate(view){view=await config.test('fixture',{expectedRevision:view.draft.revision});assert.equal(view.tests[0].result,'healthy');return config.activate('fixture',{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});}
  current=await activate(await config.save('fixture',body));
  const report=await draft({'eDisposition.02':'Repair ED'});await attachPhoto(report);await sign(report);await processCosWork(db);
  const [snapshot]=await db.query('select * from clinical.signed_snapshot where report_id=$1',[report]);
  const [item]=await db.query("select * from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[report]);
  const beforeAccess=(await db.query('select count(*)::int n from clinical_audit.patient_access_event where report_id=$1',[report]))[0].n;
  const first=await review.mappingRepairContext('fixture',item.id,'synthetic');assert.deepEqual(first.missing,['staff','careUnit','pdfMapping']);assert.deepEqual(first.conflicts,[]);
  const [access]=await db.query("select * from clinical_audit.patient_access_event where report_id=$1 and action='review.report' order by occurred_at desc limit 1",[report]);
  assert.equal(access.organization_id,sample.organization_id);assert.equal(access.access_organization_id,actor.organization.id);assert.equal(access.actor_id,actor.user.id);assert.equal(access.resource_id,null);assert.equal(access.care_process,'review');assert.equal(access.integration_provenance,null);assert.doesNotMatch(JSON.stringify(access),/200207252388|200207262387/);
  assert.equal((await db.query('select count(*)::int n from clinical_audit.patient_access_event where report_id=$1',[report]))[0].n,beforeAccess+1);
  const beforeDeniedReads=sourceReads,beforeDeniedAccess=beforeAccess+1;
  const originalActor=actor;
  actor={...actor,capabilities:['review:all','review:identifying']};await assert.rejects(review.mappingRepairContext('fixture',item.id,'synthetic'));
  actor={...originalActor,capabilities:['settings:write']};await assert.rejects(review.mappingRepairContext('fixture',item.id,'synthetic'));
  actor={...originalActor,user:{id:reviewer.userId},capabilities:['settings:write','review:all']};await assert.rejects(review.mappingRepairContext('fixture',item.id,'synthetic'));
  actor=originalActor;
  await assert.rejects(review.mappingRepairContext('fixture',item.id,'real'));
  assert.equal(sourceReads,beforeDeniedReads,'denied requests do not load identifying signed source');assert.equal((await db.query('select count(*)::int n from clinical_audit.patient_access_event where report_id=$1',[report]))[0].n,beforeDeniedAccess,'denied requests do not record a successful identifying read');
  // Partial repair uses normal tested activation; another clinician's identity is never edited.
  const staffSettings={...body.settings,staff:[...body.settings.staff,{userId:sample.documenting_user_id,hsaId:'fictional-repaired-staff'}]};
  current=await activate(await config.save('fixture',{...body,replacementSecret:undefined,expectedRevision:current.draft.revision,settings:staffSettings}));
  let context=await review.mappingRepairContext('fixture',item.id,'synthetic');assert.deepEqual(context.missing,['careUnit','pdfMapping']);
  const command={commandId:randomUUID(),dataset:'synthetic',context,acceptRecipientChange:false,acceptPatientMappingChange:false};
  await assert.rejects(review.repairCosMapping('fixture',item.id,command,'wrong-csrf'));
  const barrier=db.createQueryRunner();await barrier.connect();try{await barrier.query('select pg_advisory_lock(731013,hashtext($1))',[report]);await assert.rejects(review.repairCosMapping('fixture',item.id,command,'repair-csrf'));}finally{await barrier.query('select pg_advisory_unlock(731013,hashtext($1))',[report]);await barrier.release();}
  const partial=await review.repairCosMapping('fixture',item.id,command,'repair-csrf');assert.equal(partial.activeMatch,true);assert.deepEqual(partial.transmission.missing,['careUnit','pdfMapping']);assert.deepEqual(partial.transmission.repair.satisfied,['staff']);
  await review.repairCosMapping('fixture',item.id,command,'repair-csrf');
  const count=await db.query('select id from clinical.cos_delivery where report_id=$1',[report]);assert.equal(count.length,2);
  current=await config.activate('fixture',{expectedRevision:current.draft.revision,expectedStateRevision:current.stateRevision,testId:current.tests[0].id});
  context=await review.mappingRepairContext('fixture',item.id,'synthetic');
  await review.repairCosMapping('fixture',item.id,{...command,commandId:randomUUID(),context},'repair-csrf');
  assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[report])).length,2,'revalidating the same activation is idempotent');
  assert.equal((await db.query('select id from clinical.cos_attempt where report_id=$1',[report])).length,0);
  // Browser operates the actual normal COS panel and the scoped API repair service.
  const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
  const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CosIntegrationsPanel} from './components/cos-integrations';import {ReviewMappingRepair} from './components/review-mapping-repair';const session=${JSON.stringify({...actor,csrfToken:'repair-csrf'})};function App(){const[item,setItem]=useState(null);React.useEffect(()=>{fetch('/item').then(r=>r.json()).then(setItem)},[]);return <><CosIntegrationsPanel language="en" csrfToken="repair-csrf" canWrite/><section id="repair">{item&&<ReviewMappingRepair item={item} session={session} dataset="synthetic" language="en" online onSaved={setItem}/>}</section></>}createRoot(document.getElementById('root')).render(<App/>);`}});
  const css=await readFile(path.join(web,'app/styles.css'),'utf8');
  server=createServer(async(req,res)=>{try{
   if(req.url==='/'){res.setHeader('content-type','text/html');return res.end(`<html><head><style>${css}</style></head><body style="--green:#315ba8"><div class="admin-panel agency-settings" id="root"></div><script src="/app.js"></script></body></html>`);}
   if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
   let raw='';for await(const part of req)raw+=part;const input=raw?JSON.parse(raw):undefined;
   if(input)assert.equal(req.headers['x-csrf-token'],'repair-csrf');
   let value;
   if(req.url==='/item')value=await review.item('fixture',item.id,'synthetic');
   else if(req.url.startsWith('/api/review/'))value=req.method==='POST'?await review.repairCosMapping('fixture',item.id,input,'repair-csrf'):await review.mappingRepairContext('fixture',item.id,'synthetic');
   else {const route=req.url.replace('/api/admin/hospital/cos','');value=route==='/files'?await config.files('fixture'):route==='/import-file'?await config.importFile('fixture',input):route.startsWith('/export/')?await config.export('fixture',route.split('/').at(-1)):route==='/test'?await config.test('fixture',input):route==='/activate'?await config.activate('fixture',input):req.method==='PUT'?await config.save('fixture',input):await config.get('fixture');}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
  }catch(error){res.writeHead(error.getStatus?.()??500,{'content-type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Add care-unit mapping',exact:true}).click();
  const unit=page.locator('.hospital-mapping-row').filter({has:page.getByLabel('Local care-unit identifier',{exact:true})}).last();
  await unit.getByLabel('Hospital identifier',{exact:true}).fill('Fictional hospital');await unit.getByLabel('Local care-unit identifier',{exact:true}).fill('Repair ED');await unit.getByLabel('HSA identifier',{exact:true}).fill('fictional-repair-ed');
  await page.getByLabel('Target template link ID').fill('418799008');await page.getByLabel('PDF SNOMED link identifier',{exact:true}).fill('371530004');
  const beforeSave=await config.get('fixture');await page.getByRole('button',{name:'Save COS draft',exact:true}).click();await page.waitForFunction(revision=>document.body.textContent.includes(`Draft revision: ${revision}`),beforeSave.draft.revision+1);
  const beforeImport=await config.get('fixture'),exported=await config.export('fixture',String(beforeImport.draft.revision));
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export mapping JSON',exact:true}).click();assert.deepEqual(JSON.parse(await readFile(await (await download).path(),'utf8')),exported);
  await page.getByLabel('Import mapping JSON file',{exact:false}).setInputFiles({name:'mapping-repair.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.waitForFunction(revision=>document.body.textContent.includes(`Draft revision: ${revision}`),beforeImport.draft.revision+1);
  await page.getByRole('button',{name:'Test simulator configuration',exact:true}).click();await page.getByText('Simulator configuration passed',{exact:false}).waitFor();await page.getByRole('button',{name:'Activate COS simulator',exact:true}).click();
  await page.waitForFunction(revision=>document.body.textContent.includes(`Active revision: ${revision}`),beforeImport.draft.revision+1);
  const repair=page.locator('#repair');await repair.getByRole('button',{name:'Check active mappings'}).click();await repair.getByText('All identifiers are satisfied.',{exact:false}).waitFor();
  // Adding a previously unmapped destination needs no acknowledgement: it fills a blocker.
  const recipient=repair.getByRole('checkbox');if(await recipient.count())await recipient.check();
  if(process.env.COS_SCREENSHOT_DIR){await page.screenshot({path:path.join(process.env.COS_SCREENSHOT_DIR,`cos-repair-mobile-${run}.png`),fullPage:true});await repair.screenshot({path:path.join(process.env.COS_SCREENSHOT_DIR,`cos-repair-detail-mobile-${run}.png`)});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1440,height:900});if(process.env.COS_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COS_SCREENSHOT_DIR,`cos-repair-desktop-${run}.png`),fullPage:true});
  await repair.getByRole('button',{name:'Revalidate and resume eligible delivery'}).click();await repair.getByRole('button',{name:'Revalidate and resume eligible delivery'}).waitFor({state:'detached'});
  const completed=await review.item('fixture',item.id,'synthetic');assert.equal(completed.activeMatch,false);assert.deepEqual(completed.transmission.repair.satisfied,['careUnit','pdfMapping']);assert.equal(completed.transmission.mappingSha256,exported.sha256);assert.notEqual(completed.transmission.repair.previousMappingSha256,exported.sha256);
  assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[report])).length,3);
  assert.equal((await db.query('select id from clinical.amendment where report_id=$1',[report])).length,0);
  assert.deepEqual((await db.query('select * from clinical.signed_snapshot where report_id=$1',[report]))[0],snapshot);
  assert.doesNotMatch(JSON.stringify(await db.query('select evidence from clinical.review_transmission_history where report_id=$1',[report])),/200207252388|200207262387/);
  assert.equal(mediaReads,0,'mapping repair requires immutable metadata, never photo storage or PDF generation');
  const defaultItem=(await db.query("select id from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[noDefault]))[0];
  const defaultContext=await review.mappingRepairContext('fixture',defaultItem.id,'synthetic');assert.deepEqual(defaultContext.missing,[]);
  await review.repairCosMapping('fixture',defaultItem.id,{...command,commandId:randomUUID(),context:defaultContext},'repair-csrf');
  assert.equal((await review.item('fixture',defaultItem.id,'synthetic')).activeMatch,false,'default ambulance unit is resolved through the same activated mapping workflow');
  const encounterItem=(await db.query("select id from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[noEncounter]))[0];
  const encounterContext=await review.mappingRepairContext('fixture',encounterItem.id,'synthetic');assert.deepEqual(encounterContext.missing,[]);
  await review.repairCosMapping('fixture',encounterItem.id,{...command,commandId:randomUUID(),context:encounterContext},'repair-csrf');
  assert.ok((await review.item('fixture',encounterItem.id,'synthetic')).transmission.repair.satisfied.includes('encounter'));
  await processCosWork(db);const [prepared]=await db.query('select * from clinical.cos_payload where report_id=$1',[report]);assert.ok(prepared);
  assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where report_id=$1',[report]))[0].n,1);
  const established=await config.get('fixture');
  const {format,schemaVersion,sha256,...portable}=exported;
  await assert.rejects(config.save('fixture',{...body,replacementSecret:undefined,expectedRevision:established.draft.revision,settings:established.draft.settings,mapping:makePackage({...portable,version:'999',definition:{...portable.definition,revision:999,patientIdentifier:{...portable.definition.patientIdentifier,field:{kind:'nemsis',elementId:'eBogus.99'}}}})}));
  assert.deepEqual((await config.get('fixture')).active,established.active);assert.deepEqual((await db.query('select * from clinical.cos_payload where report_id=$1',[report]))[0],prepared);
  const conflictReport=await draft({'eDisposition.02':'Conflict ED'});await sign(conflictReport);await processCosWork(db);
  const [conflictItem]=await db.query("select id from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[conflictReport]);
  const changedSettings={...established.draft.settings,careUnits:[...established.draft.settings.careUnits,{hospital:'Fictional hospital',localCareUnit:'Conflict ED',hsaId:'conflict-ed'}]};
  await activate(await config.save('fixture',{...body,replacementSecret:undefined,expectedRevision:established.draft.revision,endpoint:'https://other-cos.example.invalid',pdfLinkId:'371530004',settings:changedSettings,patientIdentifier:{...body.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}}));
  const conflictContext=await review.mappingRepairContext('fixture',conflictItem.id,'synthetic');assert.deepEqual(conflictContext.conflicts,['patientIdentifier','recipient']);assert.equal(conflictContext.previousPatient.value,'200207252388');assert.equal(conflictContext.patient.value,'200207262387');
  const conflictCommand={...command,commandId:randomUUID(),context:conflictContext};
  await assert.rejects(review.repairCosMapping('fixture',conflictItem.id,conflictCommand,'repair-csrf'));
  await assert.rejects(review.repairCosMapping('fixture',conflictItem.id,{...conflictCommand,acceptPatientMappingChange:true},'repair-csrf'));
  await review.repairCosMapping('fixture',conflictItem.id,{...conflictCommand,acceptPatientMappingChange:true,acceptRecipientChange:true},'repair-csrf');
  assert.equal((await db.query('select id from clinical.amendment where report_id=$1',[conflictReport])).length,0);
  const conflictEvidence=(await review.item('fixture',conflictItem.id,'synthetic')).transmission;
  assert.equal(conflictEvidence.repair.patientMappingChangeAccepted,true);assert.equal(conflictEvidence.repair.recipientChangeAccepted,true);assert.doesNotMatch(JSON.stringify(conflictEvidence),/200207252388|200207262387/);
  const unsafe=await review.mappingRepairContext('fixture',item.id,'synthetic');assert.equal(unsafe.safe,false);
  await assert.rejects(review.repairCosMapping('fixture',item.id,{...command,commandId:randomUUID(),context:unsafe,acceptRecipientChange:true,acceptPatientMappingChange:true},'repair-csrf'));
  assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where report_id=$1',[report]))[0].n,1);
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(oldRoot===undefined)delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;else process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;if(oldKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;await rm(folder,{recursive:true,force:true});}
}
