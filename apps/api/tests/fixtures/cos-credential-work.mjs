import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {ReviewService} from '../../dist/review/review.service.js';
import {CosService} from '../../dist/hospital/cos.service.js';
import {processCosWork} from '../../dist/hospital/cos-worker.js';
import {CosRejected} from '../../dist/hospital/cos-simulator.js';
import {cosRetryStatus} from '../../dist/hospital/cos-automatic-retry.js';
import {retryCosReview} from '../../dist/hospital/cos-retry.js';
import {makePackage} from '../../dist/admin/canonical-package.js';
export async function credentialWorkFixture({db,draft,sign,simulator,group,actorId,recoveryReview,recoverySessions,retryInput}){
 const root=process.env.OPENTRIAGE_DEFINITIONS_ROOT,keys=process.env.OIDC_CREDENTIAL_KEYS_JSON,folder=await mkdtemp('/tmp/cos-rotation-work-');
 process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;process.env.OIDC_CREDENTIAL_KEYS_JSON??=JSON.stringify({'1':randomBytes(32).toString('base64')});
 try{
  const sessions={lockPersonalAuthenticationContext:async()=>{},requireCapability:async()=>({organization:{id:group},user:{id:actorId}})};
  const service=new CosService(db,sessions);let view=await service.get('fixture');const base=view.draft;
  view=await service.save('fixture',{expectedRevision:base.revision,endpoint:base.endpoint,authentication:base.authentication,settings:base.settings,patientIdentifier:{...base.mapping.definition.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.01'}},clinicalMappings:base.mapping.definition.clinicalMappings,pdfLinkId:base.mapping.definition.pdfLinkId,replacementSecret:'fictional-work-original'});
  const activate=async()=>{view=await service.test('fixture',{expectedRevision:view.draft.revision});view=await service.activate('fixture',{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,testId:view.tests[0].id});};
  await activate();const preparationRevision=view.active.revision;
  const report=await draft();await sign(report);await processCosWork(db,100,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
  const [delivery]=await db.query('select * from clinical.cos_delivery where report_id=$1',[report]);
  const [payload]=await db.query('select * from clinical.cos_payload where delivery_id=$1',[delivery.id]);
  const policy=await cosRetryStatus(db,delivery.id);
  const queued=await draft();await sign(queued);
  // Two independently tested rotations prove the transitive chain, retaining all bytes and budget.
  for(let n=0;n<2;n++){view=await service.rotateCredential('fixture',{expectedRevision:view.draft.revision,replacementSecret:`fictional-work-rotation-${n}`});await activate();}
  const activationRevision=view.active.revision;
  assert.equal((await cosRetryStatus(db,delivery.id)).paused,false);
  assert.deepEqual((await cosRetryStatus(db,delivery.id)).scheduleMinutes,policy.scheduleMinutes);
  view=await service.activate('fixture',{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision},true);
  const pausedReport=await draft();await sign(pausedReport);assert.equal((await db.query('select 1 from clinical.cos_delivery where report_id=$1',[pausedReport])).length,0);
  const before=await db.query('select id,state from clinical.cos_delivery where report_id=any($1::uuid[]) order by id',[[report,queued]]);
  await processCosWork(db,100,simulator);assert.deepEqual(await db.query('select id,state from clinical.cos_delivery where report_id=any($1::uuid[]) order by id',[[report,queued]]),before);
  const {format,schemaVersion,sha256,...portable}=view.draft.mapping;
  const imported=makePackage({...portable,version:'1',definition:{...portable.definition,id:randomUUID(),revision:1,patientIdentifier:{...portable.definition.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}}});
  view=await service.save('fixture',{expectedRevision:view.draft.revision,endpoint:base.endpoint,authentication:base.authentication,settings:base.settings,mapping:imported});
  assert.equal(view.active,null);assert.equal(view.pausedRevision,activationRevision);
  view=await service.resume('fixture',{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,expectedPausedRevision:activationRevision});
  assert.equal(view.active.revision,activationRevision);assert.deepEqual(view.draft.mapping,imported);
  const [item]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[report]);
  await recoveryReview.claim('fixture',item.id,{commandId:randomUUID(),expectedVersion:Number(item.version),dataset:'synthetic'});
  await retryCosReview(db,recoverySessions,'fixture',item.id,await retryInput(item.id));await processCosWork(db,100,simulator);
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[delivery.id]))[0].state,'confirmed');
  assert.deepEqual((await db.query('select * from clinical.cos_payload where delivery_id=$1',[delivery.id]))[0],payload);
  assert.equal((await cosRetryStatus(db,delivery.id)).reserved,policy.reserved);
  assert.equal((await db.query('select configuration_revision from clinical.cos_attempt where delivery_id=$1 order by created_at desc limit 1',[delivery.id]))[0].configuration_revision,String(preparationRevision));
  const [intent]=await db.query("select evidence from clinical.cos_delivery_event where delivery_id=$1 and finding='inFlight' order by created_at desc,id desc limit 1",[delivery.id]);assert.equal(intent.evidence.activationRevision,activationRevision);assert.equal(intent.evidence.preparationRevision,preparationRevision);
  const held=await draft();await sign(held);await activate();await processCosWork(db,100,simulator);
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[held]))[0].state,'waiting','mapping change holds even unattempted jobs until explicit revalidation');
  assert.equal((await db.query('select 1 from clinical.cos_delivery where report_id=$1',[pausedReport])).length,0,'resume never backfills a signature made while paused');
  await repairHeldWork({db,reportId:held,group,actorId});
 }finally{if(root===undefined)delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;else process.env.OPENTRIAGE_DEFINITIONS_ROOT=root;if(keys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;await rm(folder,{recursive:true,force:true});}
}

async function repairHeldWork({db,reportId,group,actorId}){
 const actor={organization:{id:group},user:{id:actorId},capabilities:['settings:write','review:all','review:admin','review:identifying'],csrfToken:'rotation-repair-csrf'};
 const sessions={lockPersonalAuthenticationContext:async()=>{},get:async()=>actor,requireCapability:async()=>actor,assertCsrf:async(_token,csrf)=>assert.equal(csrf,actor.csrfToken)};
 const review=new ReviewService(db,sessions);
 const [item]=await db.query("select id from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping' and active_match",[reportId]);assert.ok(item,'held queued work has an actionable administrator mapping concern');
 const [original]=await db.query('select * from clinical.cos_delivery where report_id=$1',[reportId]);
 const snapshot=await db.query('select * from clinical.signed_snapshot where report_id=$1',[reportId]);
 assert.equal((await db.query('select 1 from clinical.cos_payload where report_id=$1',[reportId])).length,0);
 const detail=await review.item('fixture',item.id,'synthetic');assert.ok(detail.transmission.missing.includes('configurationChanged'));
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ReviewMappingRepair} from './components/review-mapping-repair';function App(){const[item,setItem]=useState(${JSON.stringify(detail)});return <ReviewMappingRepair item={item} session={${JSON.stringify(actor)}} dataset="synthetic" language="en" online onSaved={setItem}/>;}createRoot(document.getElementById('root')).render(<App/>);`}});
 const css=await readFile(path.join(web,'app/styles.css'),'utf8');let browser;
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');return res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8"><div class="admin-panel" id="root"></div><script src="/app.js"></script></body></html>`);}
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  let raw='';for await(const part of req)raw+=part;
  const value=req.method==='POST'?await review.repairCosMapping('fixture',item.id,JSON.parse(raw),req.headers['x-csrf-token']):await review.mappingRepairContext('fixture',item.id,'synthetic');res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
 }catch(error){res.writeHead(error.getStatus?.()??500,{'content-type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{}));}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Check active mappings',exact:true}).click();
  const apply=page.getByRole('button',{name:'Revalidate and resume eligible delivery',exact:true});await apply.waitFor();assert.equal(await apply.isDisabled(),true,'changed patient binding requires explicit acknowledgement');
  for(const checkbox of await page.getByRole('checkbox').all())await checkbox.check();
  await mkdir('/tmp/hospital-023-preview',{recursive:true});await page.screenshot({path:`/tmp/hospital-023-preview/held-review-${reportId}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const response=page.waitForResponse(response=>response.request().method()==='POST');await apply.click();assert.equal((await response).status(),200);
  await processCosWork(db,100);
  const deliveries=await db.query('select * from clinical.cos_delivery where report_id=$1 order by created_at,id',[reportId]);assert.equal(deliveries.length,2);assert.equal(deliveries[0].state,'superseded');assert.equal(deliveries[1].state,'confirmed');assert.equal(deliveries[1].lineage_parent_id,original.id);assert.equal(deliveries[0].mapping_sha256,original.mapping_sha256);
  assert.equal((await db.query('select 1 from clinical.amendment where report_id=$1',[reportId])).length,0);assert.deepEqual(await db.query('select * from clinical.signed_snapshot where report_id=$1',[reportId]),snapshot);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
