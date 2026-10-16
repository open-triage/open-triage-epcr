// Controlled TLS plus actual API, application components and deployment proxy.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../../dist/app.module.js';
import {agencyContextMiddleware} from '../../dist/sessions/agency-context.middleware.js';
import {PlatformErrorFilter} from '../../dist/platform-error.filter.js';
import {localRouting} from '../../../web/scripts/lib/local-routing.mjs';
import {DataSource} from 'typeorm';
import {ProtectedReportKeyService} from '../../dist/reports/protected-report-key.service.js';
import {ClinicianSessionService} from '../../dist/sessions/clinician-session.service.js';
import {OidcPersonalService} from '../../dist/authentication/oidc-personal.service.js';
import {AgencyDirectoryService} from '../../dist/sessions/agency-directory.service.js';
import {ExternalIdentityService} from '../../dist/authentication/external-identity.service.js';
import {productionJobAccess} from '../../dist/calls/production-job-access.js';
import {SchedulesService} from '../../dist/schedules/schedules.service.js';
import {agencyRequest} from '../../dist/sessions/agency-context.js';
const control=async command=>{const response=await fetch(process.env.OIDC_CONTROL_URL,{method:'POST',body:JSON.stringify(command)});assert.equal(response.status,200);return response.json();};
const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');app.use(agencyContextMiddleware);app.useGlobalFilters(new PlatformErrorFilter());
const observations=[];app.use((req,_res,next)=>{if(req.url.startsWith('/api/sessions/oidc/callback'))observations.push({cookie:req.headers.cookie});next();});
let proxy,browser,db;
try{
 await app.listen(0,'127.0.0.1');const api=await app.getUrl();
 const css=await readFile(new URL('../../../web/app/styles.css',import.meta.url),'utf8');
 const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:fileURLToPath(new URL('../../../web',import.meta.url)),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ClinicianSessionGate} from './components/clinician-session-gate';import {lockProtectedClinicalStorage,protectedStorageActive,prepareProtectedReport,updateProtectedReport,recoverProtectedReport,flushProtectedReport} from './app/protected-clinical-storage';import {cachedOpenReports,cacheOpenedReport,queueDraftChange,restoreRecoveredReport} from './app/offline-reports';import {reauthenticateClinicianSession,beginPersonalClinicianSession} from './app/clinician-session';window.fixture={beginPersonalClinicianSession,reauthenticateClinicianSession,lockProtectedClinicalStorage,cachedOpenReports,queueDraftChange,protectedStorageActive,prepareProtectedReport,updateProtectedReport,recoverProtectedReport,cacheOpenedReport,flushProtectedReport,restoreRecoveredReport};createRoot(document.getElementById('root')).render(<ClinicianSessionGate><p>Shared clinical application</p></ClinicianSessionGate>);`}});
 const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:api,OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
 proxy=createServer((req,res)=>{if(route(req,res))return;if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);return;}res.setHeader('content-type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);});
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const origin=`http://child.localhost:${proxy.address().port}`;process.env.WEB_ORIGIN=`http://localhost:${proxy.address().port}`;process.env.NODE_ENV='development';
 db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{application_name:'personal-session-race'}});await db.initialize();
 const sessions=new ClinicianSessionService(db),personal=new OidcPersonalService(db,sessions,new AgencyDirectoryService(db),new ExternalIdentityService(db,sessions));
 browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();await context.addInitScript(()=>{Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});});page.setDefaultTimeout(15000);
 const token=async()=> (await context.cookies()).find(cookie=>cookie.name==='open_triage_session')?.value;
 const current=()=>page.evaluate(async()=>{const response=await fetch('/api/sessions/current');return {status:response.status,body:await response.json()};});
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null'));
 const start=async subject=>{await control({token:{sub:subject},claimsMode:'fresh'});await page.goto(origin);await page.getByRole('button',{name:'Sign in with your organization',exact:true}).click();};
 const finish=async()=>{await page.getByRole('link',{name:'Continue fictional provider login'}).click();await page.waitForURL(url=>url.origin===origin);};
 const authenticate=async subject=>{await start(subject);await finish();await expect(page.locator('.session-identity')).toBeVisible();await expect(page.getByRole('button',{name:'Switch user',exact:true})).toHaveCount(0);};
 const logout=async()=>{await page.getByRole('button',{name:'Log out',exact:true}).first().click();await expect(page.getByRole('button',{name:'Sign in with your organization',exact:true})).toBeEnabled();assert.equal(await token(),undefined);};
 await page.goto(origin);
 const noIntent=await page.evaluate(async()=> (await fetch('/api/sessions/oidc/login',{method:'POST',headers:{'content-type':'application/json'},body:'{"purpose":"login"}'})).status);assert.equal(noIntent,401);
 await assert.rejects(agencyRequest.run({origin},()=>personal.begin({purpose:['login']})),error=>error.getStatus?.()===400);
 await control({proofAvailable:false});
 await assert.rejects(agencyRequest.run({origin},()=>personal.begin({purpose:'login'})),error=>error.getStatus?.()===503);await control({proofAvailable:true});
 for(let attempt=0;attempt<2;attempt++){
  await start('fictional-denied');await finish();await expect(page.getByText(/Your external identity request was denied/)).toBeVisible();
  assert.equal((await current()).status,401);assert.equal(await token(),undefined);assert.equal(await stored(),null);
 }
 const [deniedRequest]=await db.query("select linked_user_id,denied_at,review_revision from app_identity.regional_identity_request where subject='fictional-denied'");
 assert.equal(deniedRequest.linked_user_id,null);assert(deniedRequest.denied_at);assert.equal(Number(deniedRequest.review_revision),2);
 await control({token:{sub:'fictional-alpha'},claimsMode:'fresh'});
 const guarded=await agencyRequest.run({origin},()=>personal.begin({purpose:'login'}));const confirmGuarded=new URL(guarded.authorizationUrl);confirmGuarded.searchParams.set('confirm','1');const returned=await fetch(confirmGuarded,{redirect:'manual'});const guardedCallback=new URL(returned.headers.get('location'));
 const ambiguous=new URL(guardedCallback);ambiguous.searchParams.append('state','another');await assert.rejects(agencyRequest.run({origin},()=>personal.callback(ambiguous,guarded.correlation)),error=>error.getStatus?.()===401);
 await assert.rejects(agencyRequest.run({origin},()=>personal.callback(guardedCallback,'wrong-correlation')),error=>error.getStatus?.()===401);
 const guardedResult=await agencyRequest.run({origin},()=>personal.callback(guardedCallback,guarded.correlation));assert(guardedResult.created);
 await assert.rejects(agencyRequest.run({origin},()=>personal.callback(guardedCallback,guarded.correlation)),error=>error.getStatus?.()===401);
 await authenticate('fictional-alpha');let alphaToken=await token(),alphaSession=await stored();assert.equal(alphaSession.user.id,process.env.OIDC_ALPHA);assert.equal(alphaSession.authenticationSource,'oidc');assert.equal((await current()).status,200);
 const missingCsrf=await page.evaluate(async()=> (await fetch('/api/sessions/oidc/login',{method:'POST',headers:{'content-type':'application/json','x-personal-authentication':'1'},body:'{"purpose":"switch"}'})).status);assert.equal(missingCsrf,401);assert.equal((await current()).status,200);
 await assert.rejects(agencyRequest.run({origin},()=>sessions.reauthenticate(alphaToken,alphaSession.csrfToken,'anything')),error=>error.getStatus?.()===403);
 const cookie=(await context.cookies()).find(cookie=>cookie.name==='open_triage_session');assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert(observations.every(callback=>!/open_triage_session=/.test(callback.cookie||'')));assert.match(observations[0].cookie,/open_triage_oidc_personal=/);
 await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByRole('button',{name:'Agency Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Agency Settings',exact:true})).toBeVisible();await expect(page.getByLabel('Your current password is required to save')).toHaveCount(0);
 await page.getByLabel('Maximum session duration (hours)').fill('8');await page.getByRole('button',{name:'Save group policy',exact:true}).click();
 await expect(page.getByRole('link',{name:'Continue fictional provider login'})).toBeVisible();await finish();await expect(page.locator('.session-identity')).toBeVisible();
 const reauthenticated=await stored();assert.equal(await token(),alphaToken);assert.equal(reauthenticated.expiresAt,alphaSession.expiresAt);assert.equal(reauthenticated.personalAuthenticationPurpose,'reauthenticate');
 await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByRole('button',{name:'Agency Settings',exact:true}).click();await page.getByLabel('Maximum session duration (hours)').fill('8');await page.getByRole('button',{name:'Save group policy',exact:true}).click();await expect(page.getByText('Saved',{exact:true})).toBeVisible();assert.equal((await current()).body.expiresAt,alphaSession.expiresAt);
 const alternate=await agencyRequest.run({origin,organizationId:process.env.OIDC_CHILD},async()=>{const begin=await personal.begin({purpose:'login'});const response=await fetch(begin.authorizationUrl,{redirect:'manual'});const confirm=new URL(begin.authorizationUrl);confirm.searchParams.set('confirm','1');const code=await fetch(confirm,{redirect:'manual'});return personal.callback(new URL(code.headers.get('location')),begin.correlation);});
 assert(alternate.created);await assert.rejects(sessions.requireRecentReauthentication(alternate.created.sessionToken));
 // Freshness is neither activity nor provider revision. Issuance stays version 1;
 // a same-user proof after credential rotation records latest evidence as version 2.
 await control({revision:2,expireRecent:alphaToken});
 const proofResult=await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));const r=await fetch('/api/sessions/reauthenticate',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:'{"currentPassword":""}'});return r.json();});
 assert(proofResult.authorizationUrl);await page.goto(proofResult.authorizationUrl);await finish();await expect(page.locator('.session-identity')).toBeVisible();
 const [provenance]=await db.query('select oidc_revision,personal_revision from app_identity.app_session where token_sha256=encode(sha256($1::bytea),\'hex\')',[Buffer.from(alphaToken)]);assert.equal(Number(provenance.oidc_revision),1);assert.equal(Number(provenance.personal_revision),2);
 const reportId='91200000-0000-4000-8000-000000000001';
 await page.evaluate(async({reportId,alpha,child})=>{
  const session=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));
  if(!await fixture.prepareProtectedReport(session.csrfToken,reportId))throw Error('Protected fixture unavailable');
  fixture.cacheOpenedReport(localStorage,session,{assignmentId:'fixture-assignment',report:{id:reportId,documentingUserId:alpha,organizationId:child,formVersionId:'fixture-form',catalogReleaseId:'fixture-catalog',revision:1,document:{}}},'PRIVATE OUTGOING CALL LABEL');
  fixture.queueDraftChange(localStorage,reportId,{commandId:crypto.randomUUID(),expectedRevision:1,groups:[],occurrences:[],note:'PRIVATE OUTGOING UNSYNCHRONIZED WORK'});
 },{reportId,alpha:process.env.OIDC_ALPHA,child:process.env.OIDC_CHILD});
 let deadline=(await control({recoveryDeadline:reportId})).deadline;
 assert.equal(await page.evaluate(id=>fixture.protectedStorageActive(id),reportId),true);
 assert.match(JSON.stringify(await page.evaluate(alpha=>fixture.cachedOpenReports(localStorage,alpha),process.env.OIDC_ALPHA)),/PRIVATE OUTGOING CALL LABEL/);
 const otherTab=await context.newPage();await otherTab.goto(origin);await expect(otherTab.locator('.session-identity')).toBeVisible();
 await otherTab.evaluate(({alpha,child})=>{const session=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));fixture.cacheOpenedReport(localStorage,session,{assignmentId:'fixture-other-tab',report:{id:'outgoing-tab-report',documentingUserId:alpha,organizationId:child,formVersionId:'fixture-form',catalogReleaseId:'fixture-catalog',revision:1}},'PRIVATE OTHER TAB LABEL');},{alpha:process.env.OIDC_ALPHA,child:process.env.OIDC_CHILD});
 // Validated wrong-subject sensitive proof replaces the session. The outgoing
 // token cannot read common authority; its freshness cannot unlock the new user.
 await control({token:{sub:'fictional-beta'},expireRecent:alphaToken});
 await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));try{await fixture.reauthenticateClinicianSession('',s.csrfToken);}catch{}});await expect(page.getByRole('link',{name:'Continue fictional provider login'})).toBeVisible();assert.equal(await otherTab.evaluate(alpha=>fixture.cachedOpenReports(localStorage,alpha).length,process.env.OIDC_ALPHA),0);await finish();await expect(page.locator('.session-identity')).toBeVisible();assert.equal((await stored()).user.id,process.env.OIDC_BETA);assert.notEqual(await token(),alphaToken);await assert.rejects(sessions.getAuthenticated(alphaToken));await assert.rejects(sessions.requireRecentReauthentication(await token()));
 assert.equal(await page.evaluate(id=>fixture.protectedStorageActive(id),reportId),false);
 assert.equal(await page.evaluate(alpha=>fixture.cachedOpenReports(localStorage,alpha).length,process.env.OIDC_ALPHA),0);
 const retained=await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result,query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{resolve(query.result.map(row=>({deadline:row.recoveryDeadline,revision:row.ciphertextRevision,keys:Object.keys(row)})));db.close();};};}));
 deadline=(await control({recoveryDeadline:reportId})).deadline;
 assert.equal(retained.length,1);assert.equal(retained[0].deadline,deadline);assert(retained[0].revision>0);assert(!retained[0].keys.some(key=>/reportId|owner|callNumber/.test(key)));
 const oldRequest=await fetch(`${api}/api/reports/${reportId}/recovery-grants`,{method:'POST',headers:{origin,host:new URL(origin).host,authorization:`Bearer ${alphaToken}`,'content-type':'application/json','x-csrf-token':alphaSession.csrfToken},body:JSON.stringify({schemaVersion:1,envelopeVersion:1})});assert.equal(oldRequest.status,401);

 // A different clinician, even with approved recent proof, gets no handle/key/label.
 const requestGrant=()=>page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));const response=await fetch(`/api/reports/${id}/recovery-grants`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({schemaVersion:1,envelopeVersion:1})});return {status:response.status,body:await response.json()};},reportId);
 const prove=async()=>{await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));try{await fixture.reauthenticateClinicianSession('',s.csrfToken);}catch{}});await finish();await expect(page.locator('.session-identity')).toBeVisible();};
 await prove();const wrong=await requestGrant();assert.equal(wrong.status,404);assert.doesNotMatch(JSON.stringify(wrong.body),/recoveryHandle|reportKey|PRIVATE OUTGOING/);
 await otherTab.close();await logout();await authenticate('fictional-alpha');alphaToken=await token();
 assert.equal((await requestGrant()).status,428,'ordinary login cannot satisfy the purpose-bound recovery gate');
 await prove();assert.equal((await control({recoveryDeadline:reportId})).deadline,deadline);
 // Restart in the same Chromium profile retains ciphertext but no runtime keys.
 await page.reload();await expect(page.locator('.session-identity')).toBeVisible();assert.equal(await page.evaluate(id=>fixture.protectedStorageActive(id),reportId),false);
 let restorationReceipts=0;const observeRestoration=request=>{if(request.url().endsWith('/protected-ciphertext-receipt'))restorationReceipts++;};page.on('request',observeRestoration);
 const restored=await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));const recovered=await fixture.recoverProtectedReport(s.csrfToken,id);if(!fixture.restoreRecoveredReport(localStorage,s.user.id,id,recovered))throw Error("Restoration failed");await fixture.flushProtectedReport(id);return recovered;},reportId);
 page.off('request',observeRestoration);assert.equal(restorationReceipts,0,'restoring an unchanged draft must not write or renew its ciphertext deadline');
 assert.match(JSON.stringify(restored),/PRIVATE OUTGOING UNSYNCHRONIZED WORK/);assert.equal((await control({recoveryDeadline:reportId})).deadline,deadline);
 const competing=await context.newPage();await competing.goto(origin);await expect(competing.locator('.session-identity')).toBeVisible();assert.equal(await competing.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));return fixture.recoverProtectedReport(s.csrfToken,id);},reportId),null);await competing.close();

 // A synchronized browser snapshot is intentionally discarded on lock. Reopen
 // initialization must preserve the server key deadline even without local bytes.
 const emptyReport='91200000-0000-4000-8000-000000000004';
 const initializeSnapshot=async id=>page.evaluate(async({id,alpha,child})=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));fixture.cacheOpenedReport(localStorage,s,{assignmentId:'fixture-synchronized',report:{id,documentingUserId:alpha,organizationId:child,formVersionId:'fixture-form',catalogReleaseId:'fixture-catalog',revision:1,document:{}}},'Fictional synchronized report');await fixture.flushProtectedReport(id);},{id,alpha:process.env.OIDC_ALPHA,child:process.env.OIDC_CHILD});
 await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));await fixture.prepareProtectedReport(s.csrfToken,id);},emptyReport);await initializeSnapshot(emptyReport);
 const emptyDeadline=(await control({recoveryDeadline:emptyReport})).deadline;await page.evaluate(()=>fixture.lockProtectedClinicalStorage());await page.reload();await expect(page.locator('.session-identity')).toBeVisible();
 const initializationReceipts=[];const observeInitialization=request=>{if(request.url().endsWith(`/reports/${emptyReport}/protected-ciphertext-receipt`))initializationReceipts.push(request.postDataJSON());};page.on('request',observeInitialization);
 assert.equal(await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));return fixture.recoverProtectedReport(s.csrfToken,id);},emptyReport),null);assert.equal(await page.evaluate(id=>fixture.protectedStorageActive(id),emptyReport),true);
 await initializeSnapshot(emptyReport);assert.equal((await control({recoveryDeadline:emptyReport})).deadline,emptyDeadline);assert.equal(initializationReceipts.length,1);assert.equal(initializationReceipts[0].preserveRecoveryDeadline,true);
 await page.evaluate(async id=>{fixture.queueDraftChange(localStorage,id,{commandId:crypto.randomUUID(),expectedRevision:1,groups:[],occurrences:[],note:'NEW REAL USER EDIT'});await fixture.flushProtectedReport(id);},emptyReport);assert.equal(initializationReceipts.length,2);assert.equal(initializationReceipts[1].preserveRecoveryDeadline,undefined);assert(Date.parse((await control({recoveryDeadline:emptyReport})).deadline)>Date.parse(emptyDeadline));page.off('request',observeInitialization);

 // New pending work as the very first recovered snapshot remains a genuine
 // write, rather than being mistaken for passive browser initialization.
 const firstPendingReport='91200000-0000-4000-8000-000000000005';
 await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));await fixture.prepareProtectedReport(s.csrfToken,id);},firstPendingReport);
 const firstPendingDeadline=(await control({recoveryDeadline:firstPendingReport})).deadline;await page.evaluate(()=>fixture.lockProtectedClinicalStorage());await page.reload();await expect(page.locator('.session-identity')).toBeVisible();
 const firstPendingReceipts=[];const observeFirstPending=request=>{if(request.url().endsWith(`/reports/${firstPendingReport}/protected-ciphertext-receipt`))firstPendingReceipts.push(request.postDataJSON());};page.on('request',observeFirstPending);
 await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));await fixture.recoverProtectedReport(s.csrfToken,id);fixture.updateProtectedReport(id,{queuedChanges:[{command:{note:'NEW FIRST REAL EDIT'},attempted:false}]});await fixture.flushProtectedReport(id);},firstPendingReport);
 assert.equal(firstPendingReceipts.length,1);assert.equal(firstPendingReceipts[0].preserveRecoveryDeadline,undefined);assert(Date.parse((await control({recoveryDeadline:firstPendingReport})).deadline)>Date.parse(firstPendingDeadline));page.off('request',observeFirstPending);
 await page.evaluate(()=>fixture.lockProtectedClinicalStorage());
 const recovery=new ProtectedReportKeyService(db,sessions),scope={origin,organizationId:process.env.OIDC_CHILD};
 const currentAlpha=await stored();const grant=await agencyRequest.run(scope,()=>recovery.createRecoveryGrant(alphaToken,reportId,{schemaVersion:1,envelopeVersion:1},currentAlpha.csrfToken));
 await control({ageRecoveryProof:alphaToken});await assert.rejects(agencyRequest.run(scope,()=>recovery.consumeRecoveryGrant(alphaToken,reportId,{schemaVersion:1,envelopeVersion:1,grant:grant.grant},currentAlpha.csrfToken)),error=>error.getStatus?.()===428);
 await prove();
 const expired=await requestGrant();assert.equal(expired.status,201);await control({expireRecovery:reportId});
 await assert.rejects(agencyRequest.run(scope,()=>recovery.consumeRecoveryGrant(alphaToken,reportId,{schemaVersion:1,envelopeVersion:1,grant:expired.body.grant},currentAlpha.csrfToken)),error=>error.getStatus?.()===404);
 assert.equal((await requestGrant()).status,404);
 // Local proof uses exactly the same runtime grant and consume functions for a
 // root-owned clinician's child-agency report; a second session cannot borrow it.
 await control({groupMode:'local'});
 const local=await agencyRequest.run(scope,()=>sessions.create({username:'reviewer',password:process.env.OIDC_LOCAL_PASSWORD}));
 const localReport='91200000-0000-4000-8000-000000000003',localKey=randomBytes(32).toString('base64');
 const envelope=await agencyRequest.run(scope,()=>recovery.register(local.sessionToken,localReport,{schemaVersion:1,recoveryHandle:randomUUID(),reportKeyBase64:localKey},local.session.csrfToken));
 await assert.rejects(agencyRequest.run(scope,()=>recovery.createRecoveryGrant(local.sessionToken,localReport,{schemaVersion:1,envelopeVersion:1},local.session.csrfToken)),error=>error.getStatus?.()===428);

 for(const expression of ["personally_authenticated_at=null,reauthenticated_at=null,personal_authentication_purpose=null", "personally_authenticated_at=clock_timestamp()+interval '1 minute',reauthenticated_at=null,personal_authentication_purpose='reauthenticate'", "personally_authenticated_at=clock_timestamp(),reauthenticated_at=null,personal_authentication_purpose='login'"]){
  await db.query(`update app_identity.app_session set ${expression} where token_sha256=encode(sha256($1::bytea),'hex')`,[Buffer.from(local.sessionToken)]);
  const denied=await db.query("select * from offline_recovery.create_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),'hex'),$5,1)",[localReport,process.env.OIDC_CHILD,process.env.OIDC_LOCAL_USER,Buffer.from(local.sessionToken),randomBytes(32).toString('hex')]);
  assert.equal(denied[0].result,'reauthentication_required');assert.equal(denied[0].recovery_handle,null);
 }
 await agencyRequest.run(scope,()=>sessions.reauthenticate(local.sessionToken,local.session.csrfToken,process.env.OIDC_LOCAL_PASSWORD));
 const localGrant=await agencyRequest.run(scope,()=>recovery.createRecoveryGrant(local.sessionToken,localReport,{schemaVersion:1,envelopeVersion:1},local.session.csrfToken));

 for(const expression of ["personally_authenticated_at=null,reauthenticated_at=null,personal_authentication_purpose=null", "personally_authenticated_at=clock_timestamp()+interval '1 minute',reauthenticated_at=null,personal_authentication_purpose='reauthenticate'", "personally_authenticated_at=clock_timestamp(),reauthenticated_at=null,personal_authentication_purpose='login'"]){
  await db.query(`update app_identity.app_session set ${expression} where token_sha256=encode(sha256($1::bytea),'hex')`,[Buffer.from(local.sessionToken)]);
  const denied=await db.query("select * from offline_recovery.consume_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),'hex'),encode(sha256($5::bytea),'hex'),1)",[localReport,process.env.OIDC_CHILD,process.env.OIDC_LOCAL_USER,Buffer.from(local.sessionToken),Buffer.from(localGrant.grant)]);
  assert.equal(denied[0].result,'denied');assert.equal(denied[0].wrapped_data_key,null);assert.equal(denied[0].recovery_handle,null);
 }
 await agencyRequest.run(scope,()=>sessions.reauthenticate(local.sessionToken,local.session.csrfToken,process.env.OIDC_LOCAL_PASSWORD));
 const localReturned=await agencyRequest.run(scope,()=>sessions.create({username:'reviewer',password:process.env.OIDC_LOCAL_PASSWORD}));await agencyRequest.run(scope,()=>sessions.reauthenticate(localReturned.sessionToken,localReturned.session.csrfToken,process.env.OIDC_LOCAL_PASSWORD));
 await assert.rejects(agencyRequest.run(scope,()=>recovery.consumeRecoveryGrant(localReturned.sessionToken,localReport,{schemaVersion:1,envelopeVersion:1,grant:localGrant.grant},localReturned.session.csrfToken)),error=>error.getStatus?.()===404);
 const localRecovered=await agencyRequest.run(scope,()=>recovery.consumeRecoveryGrant(local.sessionToken,localReport,{schemaVersion:1,envelopeVersion:1,grant:localGrant.grant},local.session.csrfToken));assert.equal(localRecovered.reportKeyBase64,localKey);
 await assert.rejects(agencyRequest.run(scope,()=>recovery.consumeRecoveryGrant(local.sessionToken,localReport,{schemaVersion:1,envelopeVersion:1,grant:localGrant.grant},local.session.csrfToken)),error=>error.getStatus?.()===404);
 await assert.rejects(db.query('select * from offline_recovery.recover_report_key($1,$2,$3,$4)',[localReport,process.env.OIDC_CHILD,process.env.OIDC_LOCAL_USER,envelope.recoveryHandle]),error=>error.code==='42501');
 const foreign=await db.query('select * from offline_recovery.create_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),\'hex\'),$5,1)',[localReport,process.env.OIDC_OTHER,process.env.OIDC_LOCAL_USER,Buffer.from(local.sessionToken),'b'.repeat(64)]);assert.equal(foreign[0].result,'denied');assert.equal(foreign[0].recovery_handle,null);
 assert.equal((await control({recoveryDeadline:localReport})).deadline,envelope.recoveryDeadline);
 await control({groupMode:'oidc'});
 await logout();

 // All approved-method/freshness negatives travel through real code exchange.
 for(const mode of ['cached','silent','method','future','outage']){await control({token:{sub:'fictional-alpha'},claimsMode:mode});await page.goto(origin);await page.getByRole('button',{name:'Sign in with your organization'}).click();await finish();await expect(page.getByText(/Personal authentication failed/)).toBeVisible();assert.equal((await current()).status,401);assert.equal(await token(),undefined);}
 await control({token:{sub:'fictional-alpha'},claimsMode:'fresh'});await page.goto(origin);await page.getByRole('button',{name:'Sign in with your organization'}).click();
 await expect(page.getByRole('link',{name:'Continue fictional provider login'})).toBeVisible();const state=new URL(page.url()).searchParams.get('state');const [sameSecond]=await db.query("select created_at from app_identity.oidc_personal_transaction where state_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(state)]);
 await control({token:{sub:'fictional-alpha',auth_time:Math.floor(new Date(sameSecond.created_at).getTime()/1000)}});await finish();assert.equal((await current()).status,401);
 await control({token:{sub:'fictional-alpha'},claimsMode:'fresh',beforeRevision:true,revision:1});await page.goto(origin);await page.getByRole('button',{name:'Sign in with your organization'}).click();await finish();await expect(page.getByText(/Personal authentication failed/)).toBeVisible();assert.equal(await token(),undefined);await control({beforeRevision:false,revision:1});
 // Exercise the retained protocol-level handover API directly; the UI only
 // offers logout. A confirmed handover settles encrypted writers before the start request
 // revokes authority, and a missing contract cannot retain the outgoing cookie.
 await authenticate('fictional-alpha');alphaToken=await token();
 await control({proofAvailable:false});
 await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));await fixture.beginPersonalClinicianSession('switch',s.csrfToken).catch(()=>{});});
 await expect(page.getByRole('button',{name:'Sign in with your organization',exact:true})).toBeEnabled();
 assert.equal(await token(),undefined);assert.equal((await current()).status,401);await assert.rejects(sessions.getAuthenticated(alphaToken));
 await control({proofAvailable:true});
 await authenticate('fictional-alpha');alphaToken=await token();
 const switchReport='91200000-0000-4000-8000-000000000002';
 await context.route(`**/api/reports/${switchReport}/protected-key-envelope`,route=>route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:deadline,wrappingKeyVersion:1}}));
 await context.route(`**/api/reports/${switchReport}/protected-ciphertext-receipt`,route=>route.fulfill({json:{schemaVersion:1,recoveryDeadline:deadline}}));
 let holdCheckpoint=false,checkpointSettled=false,checkpointStarted,releaseCheckpoint;
 const checkpointReady=new Promise(resolve=>{checkpointStarted=resolve;});
 const checkpointRelease=new Promise(resolve=>{releaseCheckpoint=resolve;});
 await context.route(`**/api/reports/${switchReport}/protected-ciphertext-checkpoint`,async route=>{if(holdCheckpoint){checkpointStarted();await checkpointRelease;}await route.fulfill({json:route.request().postDataJSON()});if(holdCheckpoint)checkpointSettled=true;});
 await page.evaluate(async id=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));if(!await fixture.prepareProtectedReport(s.csrfToken,id))throw Error('Protected switch fixture unavailable');},switchReport);
 holdCheckpoint=true;
 await page.evaluate(id=>fixture.updateProtectedReport(id,{note:'PENDING SWITCH WORK'}),switchReport);
 // Begin while the network checkpoint is actually in flight; direct protocol
 // invocation has no browser click delay to establish that precondition.
 await checkpointReady;
 let beginObserved=false;
 await context.route('**/api/sessions/oidc/login',async route=>{beginObserved=true;assert.equal(checkpointSettled,true,'begin must follow the settled checkpoint');assert.equal((await sessions.getAuthenticated(alphaToken)).user.id,process.env.OIDC_ALPHA);await route.continue();});
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));void fixture.beginPersonalClinicianSession('switch',s.csrfToken).catch(()=>{});});
 await checkpointReady;assert.equal(beginObserved,false,'switch must not revoke authority while the protected checkpoint is pending');
 assert.equal((await sessions.getAuthenticated(alphaToken)).user.id,process.env.OIDC_ALPHA);
 releaseCheckpoint();
 await expect(page.getByRole('link',{name:'Continue fictional provider login'})).toBeVisible();
 assert.equal(beginObserved,true);
 await context.unroute('**/api/sessions/oidc/login');
 assert.equal(await token(),undefined);await assert.rejects(sessions.getAuthenticated(alphaToken));

 // Cancellation cannot restore the outgoing app cookie.
 const pendingUrl=new URL(page.url());const canceled=new URL(pendingUrl.searchParams.get('redirect_uri'));canceled.searchParams.set('state',pendingUrl.searchParams.get('state'));canceled.searchParams.set('error','access_denied');await page.goto(canceled.href);await expect(page.getByText(/Personal authentication failed/)).toBeVisible();assert.equal((await current()).status,401);
 await authenticate('fictional-alpha');alphaToken=await token();await control({token:{sub:'unknown-case-sensitive'}});await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));void fixture.beginPersonalClinicianSession('switch',s.csrfToken).catch(()=>{});});await finish();await expect(page.getByText(/awaiting access review/)).toBeVisible();assert.equal((await current()).status,401);await assert.rejects(sessions.getAuthenticated(alphaToken));
 await authenticate('fictional-alpha');alphaToken=await token();await control({token:{sub:'fictional-empty'}});await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));void fixture.beginPersonalClinicianSession('switch',s.csrfToken).catch(()=>{});});await finish();await expect(page.getByRole('heading',{name:'No workspace assigned'})).toBeVisible();await assert.rejects(sessions.getAuthenticated(alphaToken));assert.equal((await current()).body.workspaceAvailable,false);await logout();
 await authenticate('fictional-alpha');alphaToken=await token();await control({disabled:true});assert.equal((await current()).status,401);await control({disabled:false});
 await assert.rejects(sessions.getAuthenticated(alternate.created.sessionToken));
 // Old activity must not take a session lock before personal authority. With
 // the original incidental UPDATE, call-open waited on user while disablement
 // waited on that locked session, producing a deadlock instead of containment.
 await control({disabled:false,token:{sub:'fictional-alpha'},claimsMode:'fresh'});
 const raceToken=randomBytes(32).toString('base64url');
 // Use the still-valid issuance row as a trusted fixture; revoked rows remain
 // useful provenance but the copy is deliberately a live aged runtime session.
 const freshRace=await agencyRequest.run({origin,organizationId:process.env.OIDC_CHILD},async()=>{const start=await personal.begin({purpose:'login'});const confirm=new URL(start.authorizationUrl);confirm.searchParams.set('confirm','1');const response=await fetch(confirm,{redirect:'manual'});return personal.callback(new URL(response.headers.get('location')),start.correlation);});assert(freshRace.created);
 await control({ageSession:{token:freshRace.created.sessionToken,newToken:raceToken}});
 const paired=await control({pairForRace:{token:raceToken,origin}});
 const contextForRace={origin,organizationId:process.env.OIDC_CHILD,installationCredential:paired.credential};
 const tiny=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{max:1,connectionTimeoutMillis:1000}});await tiny.initialize();
 try{
  const tinySessions=new ClinicianSessionService(tiny),tinyPersonal=new OidcPersonalService(tiny,tinySessions,new AgencyDirectoryService(tiny),new ExternalIdentityService(tiny,tinySessions));
  const reads=await Promise.all(Array.from({length:3},()=>agencyRequest.run(contextForRace,()=>tiny.transaction(manager=>tinySessions.getAuthenticated(raceToken,new Date(),false,manager)))));assert(reads.every(session=>session.user.id===process.env.OIDC_ALPHA));
  const starts=await Promise.all(Array.from({length:3},()=>agencyRequest.run(contextForRace,()=>tinyPersonal.begin({purpose:'reauthenticate'},raceToken,'race-csrf'))));
  const completions=await Promise.all(starts.map(async start=>{const authorize=new URL(start.authorizationUrl);authorize.searchParams.set('confirm','1');const response=await fetch(authorize,{redirect:'manual'});return agencyRequest.run(contextForRace,()=>tinyPersonal.callback(new URL(response.headers.get('location')),start.correlation));}));assert(completions.every(result=>result.created?.sessionToken===raceToken),'registered-device callbacks must use their held connection, even when the pool has one connection');
 }finally{await tiny.destroy();}

 const began=await agencyRequest.run(contextForRace,()=>personal.begin({purpose:'reauthenticate'},raceToken,'race-csrf'));
 const authorization=new URL(began.authorizationUrl);authorization.searchParams.set('confirm','1');const authorized=await fetch(authorization,{redirect:'manual'});const callback=new URL(authorized.headers.get('location'));
 await db.query("update app_identity.app_session set last_activity_at=created_at+interval '1 minute' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(raceToken)]);
 const blocker=db.createQueryRunner();await blocker.connect();await blocker.startTransaction();
 await blocker.query('select id from app_identity.app_user where id=$1 for update',[process.env.OIDC_ALPHA]);
 const opening=agencyRequest.run(contextForRace,()=>db.transaction(async manager=>{await manager.query("set local statement_timeout='5s'");const initial=await sessions.get(raceToken,new Date(),false,manager);const access=await productionJobAccess(manager,raceToken,initial,new SchedulesService(db,sessions));await sessions.get(raceToken,new Date(),false,manager);return access;})).then(value=>({value}),error=>({error}));
 const reauth=agencyRequest.run(contextForRace,()=>personal.callback(callback,began.correlation));
 let waiting=false;for(let attempt=0;attempt<100;attempt++){const row=await control({waiting:true});if(row.waiting>=2){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
 if(!waiting){await blocker.rollbackTransaction();await blocker.release();}
 assert(waiting,'call open and proof completion must both wait behind personal authority');
 await blocker.query('update app_identity.app_user set active=false where id=$1',[process.env.OIDC_ALPHA]);
 await blocker.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='account_disabled' where user_id=$1 and revoked_at is null",[process.env.OIDC_ALPHA]);
 await blocker.commitTransaction();await blocker.release();
 assert.equal((await opening).error?.getStatus?.(),401);assert.equal((await reauth).created,undefined);await assert.rejects(sessions.getAuthenticated(raceToken));await control({disabled:false});
 // Revocation/expiry does not gain authority from current provider cookies.
 await control({expireSession:alphaToken});assert.equal((await current()).status,401);await page.goto(origin);await expect(page.getByRole('button',{name:'Sign in with your organization'})).toBeVisible();
 await control({token:{sub:'fictional-alpha'},claimsMode:'cached'});await page.getByRole('button',{name:'Sign in with your organization'}).click();await finish();assert.equal((await current()).status,401);
 console.log(JSON.stringify({sharedSessions:true,sensitiveActionCompleted:true,outgoingAuthorityDenied:true,strictCookie:true,proofNegatives:true,revisionBinding:true,applicationLogout:true}));
}finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}await app.close();if(db?.isInitialized)await db.destroy();}
