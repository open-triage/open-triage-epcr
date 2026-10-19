import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {HospitalHistoryService} from '../../dist/hospital/hospital-history.service.js';
import {AuditService} from '../../dist/admin/audit.service.js';
/** Runs against the caller's owned, normally signed COS fixture, including failures and success. */
export async function hospitalHistoryJourney({db,sample,reviewer,run,expiring}){
 const organization=sample.organization_id;
 let session={user:{id:sample.documenting_user_id},organization:{id:organization},capabilities:['settings:read']};
 const sessions={get:async()=>session,requireCapability:async(_token,capability)=>{if(!session.capabilities.includes(capability))throw new Error('denied');return session;}};
 const service=new HospitalHistoryService(db,sessions),audit=new AuditService(db,sessions);
 const status=await service.list('fixture',{dataset:'synthetic'});assert.ok(status.entries.length);
 const clinical=status.entries.filter(e=>e.reportId);assert.ok(clinical.some(e=>e.state==='confirmed'));assert.ok(clinical.some(e=>e.events.some(v=>v.state==='failed'||v.state==='uncertain')));
 assert.ok(status.entries.every(e=>!e.review),'settings status grants no Review link');
 for(const entry of clinical.filter(e=>e.kind==='cos')){
  assert.equal(entry.attemptCount,(await db.query('select count(*)::int n from clinical.cos_attempt where delivery_id=$1',[entry.id]))[0].n);
  assert.equal(entry.mapping.sha256,(await db.query('select mapping_sha256 from clinical.cos_delivery where id=$1',[entry.id]))[0].mapping_sha256);
 }
 const payload=JSON.stringify(status);assert.doesNotMatch(payload,/200207252388|Fictional hospital|fictional-staff|encrypted_credential|replacementSecret|resourceType|canonical_mapping|contactKey/);
 assert.ok(status.entries.some(e=>e.mapping.revision===1),'old mapping remains available after later configuration edits');
 const report=clinical.find(e=>e.events.some(v=>v.state==='failed'))?.reportId??clinical[0].reportId;
 await assert.rejects(service.link('fixture',report,'synthetic'));
 session={...session,user:{id:reviewer.userId},capabilities:['audit:read','audit:identifying']};
 assert.ok((await service.list('fixture',{dataset:'synthetic',reportId:report})).entries.length);
 await assert.rejects(service.link('fixture',report,'synthetic'));
 session={...session,capabilities:['review:all','review:identifying']};await assert.rejects(service.list('fixture',{dataset:'synthetic'}));
 assert.ok((await service.link('fixture',report,'synthetic')).itemId,'Review-only authority can open authorized recovery, independently of status/audit');
 session={...session,capabilities:['settings:read','review:all']};assert.ok((await service.list('fixture',{dataset:'synthetic',reportId:report})).entries.every(e=>!e.review),'other report without identifying Review grant has no link');
 session={...session,capabilities:['settings:read','review:all','review:identifying']};
 const scoped=await service.list('fixture',{dataset:'synthetic',reportId:report});assert.ok(scoped.entries.some(e=>e.review));
 assert.equal((await service.list('fixture',{dataset:'real',reportId:report})).entries.length,0);
 await assert.rejects(service.link('fixture',report,'real'));
 session={...session,organization:{id:'00000000-0000-4000-8000-000000000099'}};assert.equal((await service.list('fixture',{dataset:'synthetic',reportId:report})).entries.length,0);await assert.rejects(service.link('fixture',report,'synthetic'));
 session={user:{id:sample.documenting_user_id},organization:{id:organization},capabilities:['settings:read','audit:read','audit:identifying','review:all','review:identifying']};
 const auditPage=await audit.list('fixture',{category:'clinical',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString(),uuid:report});
 assert.ok(auditPage.entries.some(e=>e.source==='clinical_audit.hospital_operational_event'&&e.integration?.mappingSha256));
 // The actual runtime role sees only a scoped audit ledger, with no mutable access.
 const connection=db.createQueryRunner();await connection.connect();await connection.startTransaction();try{
  await connection.query('set local role open_triage_api_runtime');
  assert.equal((await connection.query('select count(*)::int n from clinical_audit.hospital_operational_event'))[0].n,0);
  await connection.query("select set_config('open_triage.audit_organization_id',$1,true)",[organization]);
  assert.ok((await connection.query('select count(*)::int n from clinical_audit.hospital_operational_event'))[0].n>0);
  const scopedDb={query:connection.query.bind(connection),manager:{query:connection.query.bind(connection)},transaction:async(first,second)=>(typeof first==='function'?first:second)({query:connection.query.bind(connection)})};
  assert.ok((await new HospitalHistoryService(scopedDb,sessions).list('fixture',{dataset:'synthetic',reportId:report})).entries.length);
  await connection.query('savepoint denied');await assert.rejects(connection.query('update clinical_audit.hospital_operational_event set state=state'));await connection.query('rollback to savepoint denied');await assert.rejects(connection.query('truncate clinical_audit.hospital_operational_event'));
 }finally{await connection.rollbackTransaction();await connection.release();}
 // Ordinary retention removes artifacts/source while metadata remains, with no live Review link.
 assert.ok((await db.query('select delivery_id from clinical.cos_payload where report_id=$1',[expiring])).length,'failed transport retains a prepared clinical artifact before ordinary expiry');
 const [retainedVersion]=await db.query('select d.snapshot_id,d.amendment_sequence,p.payload_sha256 from clinical.cos_delivery d join clinical.cos_payload p on p.delivery_id=d.id where d.report_id=$1 order by d.created_at desc limit 1',[expiring]);
 const retained=await db.query('select id from clinical_audit.hospital_operational_event where report_id=$1',[expiring]);assert.ok(retained.length);
 const [expiry]=await db.query('select expires_at from clinical.report where id=$1',[expiring]);
 const marker={};await assert.rejects(db.transaction(async manager=>{
  await manager.query("select retention.purge_expired_synthetic_records($1::timestamptz+interval '1 minute')",[expiry.expires_at]);
  assert.equal((await manager.query('select id from clinical.report where id=$1',[expiring])).length,0);
  for(const table of ['cos_payload','cos_delivery','eps_submission','eps_import','signed_snapshot'])assert.equal((await manager.query(`select 1 from clinical.${table} where report_id=$1`,[expiring])).length,0);
  assert.equal((await manager.query('select id from clinical_audit.hospital_operational_event where report_id=$1',[expiring])).length,retained.length);
  assert.equal(await service.reviewLink(manager,session,expiring,'synthetic'),undefined);
  await manager.query('set local role open_triage_api_runtime');
  const auditDatabase={manager,transaction:async(first,second)=>(typeof first==='function'?first:second)(manager)};
  const expiredAudit=await new AuditService(auditDatabase,sessions).list('fixture',{category:'clinical',uuid:expiring,from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString()});
  const expiredEvents=expiredAudit.entries.filter(e=>e.source==='clinical_audit.hospital_operational_event');assert.equal(expiredEvents.length,retained.length);
  assert.ok(expiredEvents.every(e=>e.integration.snapshotId===retainedVersion.snapshot_id&&e.integration.amendmentSequence===retainedVersion.amendment_sequence&&!e.recovery));
  assert.ok(expiredEvents.some(e=>e.integration.payloadSha256===retainedVersion.payload_sha256));assert.ok(expiredEvents.some(e=>e.integration.payloadSha256===null),'unprepared queued evidence has an explicitly nullable hash');
  assert.doesNotMatch(JSON.stringify(expiredAudit),/resourceType|QuestionnaireResponse|Fictional documented assessment|200207252388|canonical_bytes|encrypted_credential/);

  throw marker;
 }),error=>error===marker);
 // Re-run the exact migration over existing journals inside a rollback transaction:
 // historical evidence is copied honestly, without source payloads or invented results.
 const migration=await readFile(new URL('../../../../supabase/migrations/20261019164802_hospital_protected_operational_history.sql',import.meta.url),'utf8');
 await assert.rejects(db.transaction(async manager=>{
  await manager.query('drop trigger cos_operational_audit on clinical.cos_delivery_event;drop trigger eps_attempt_operational_audit on clinical.eps_submission_attempt;drop trigger eps_result_operational_audit on clinical.eps_submission_result;drop function clinical_audit.record_hospital_operational_event();drop table clinical_audit.hospital_operational_event');
  await manager.query(migration);
  const [totals]=await manager.query('select (select count(*)::int from clinical.cos_delivery_event where report_id=$1) source,(select count(*)::int from clinical_audit.hospital_operational_event where report_id=$1) retained',[report]);assert.equal(totals.retained,totals.source);
  const proof=await manager.query("select proof_outcome,proof_fenced,command_id from clinical_audit.hospital_operational_event where organization_id=$1 and action='cos.reconcile'",[organization]);assert.ok(proof.some(e=>e.proof_outcome==='not-stored'&&e.proof_fenced===true&&e.command_id));
  throw marker;
 }),error=>error===marker);
 // Actual browser/UI reads the real service output. No simulated network publication.
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HospitalHistoryPanel}from'./components/hospital-history';function App(){const[scope,setScope]=React.useState('fixture');return <><button onClick={()=>setScope('changed')}>Change scope fixture</button><HospitalHistoryPanel language="en" scopeKey={scope}/></>}createRoot(document.getElementById('root')).render(<App/>);`}});
 const css=await readFile(path.join(web,'app/styles.css'),'utf8');let denied=false,linkStarted=false,releaseLink;const linkBarrier=new Promise(resolve=>releaseLink=resolve);
 const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html');return res.end(`<html><style>${css}</style><div class="admin-panel" id="root"></div><script src="/app.js"></script></html>`);}if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');return res.end(bundle.outputFiles[0].text);}if(denied){res.writeHead(403,{'content-type':'application/json'});return res.end('{}');}if(req.url.startsWith('/api/admin/hospital/history/review/')){linkStarted=true;const link=await service.link('fixture',report,'synthetic');await linkBarrier;res.setHeader('content-type','application/json');return res.end(JSON.stringify(link));}const query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);const result=await service.list('fixture',query);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}catch(error){res.writeHead(error.getStatus?.()??500,{'content-type':'application/json'});res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>console.error('History browser error',error));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Dataset',{exact:true}).selectOption('synthetic');await page.getByLabel('Report reference',{exact:true}).fill(report);await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByRole('button',{name:'Inspect',exact:true}).first().click();await page.getByRole('heading',{name:'Operational evidence'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/resend|retry delivery|submit|save/i}).count(),0);await page.getByText('Simulator evidence only; live COS storage has not been verified.',{exact:true}).waitFor();
  assert.ok(await page.getByRole('link',{name:'Open delivery recovery in Review',exact:false}).count());
  await mkdir('/tmp/hospital-022-preview',{recursive:true});await page.screenshot({path:`/tmp/hospital-022-preview/history-desktop-${run}.png`,fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/tmp/hospital-022-preview/history-mobile-${run}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('link',{name:'Open delivery recovery in Review',exact:true}).click();for(let i=0;i<100&&!linkStarted;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(linkStarted,true);denied=true;await page.getByRole('button',{name:'Change scope fixture',exact:true}).click();releaseLink();await page.waitForTimeout(100);assert.equal(new URL(page.url()).pathname,'/','late reauthorization cannot navigate after scope remount');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Operational evidence'}).count(),0);
 }finally{releaseLink();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
