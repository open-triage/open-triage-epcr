import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
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
import {ClinicianSessionService} from '../../dist/sessions/clinician-session.service.js';
import {OidcPersonalService} from '../../dist/authentication/oidc-personal.service.js';
import {AgencyDirectoryService} from '../../dist/sessions/agency-directory.service.js';
import {ExternalIdentityService} from '../../dist/authentication/external-identity.service.js';
import {OidcDraftService} from '../../dist/authentication/oidc-draft.service.js';
import {productionJobAccess} from '../../dist/calls/production-job-access.js';
import {SchedulesService} from '../../dist/schedules/schedules.service.js';
import {agencyRequest} from '../../dist/sessions/agency-context.js';
const control=async cmd=>{const r=await fetch(process.env.ACTIVATION_CONTROL_URL,{method:'POST',body:JSON.stringify(cmd)});assert.equal(r.status,200,await r.clone().text());return r.json();};
const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');app.use(agencyContextMiddleware);app.useGlobalFilters(new PlatformErrorFilter());
let proxy,browser,db;
try{
 await app.listen(0,'127.0.0.1');
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:fileURLToPath(new URL('../../../web',import.meta.url)),loader:'tsx',contents:`import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {OidcDraftPanel} from './components/oidc-draft';import {ClinicianSessionGate} from './components/clinician-session-gate';import {PersonalAuthenticationContext} from './components/personal-authentication';function App(){const[session,setSession]=useState(null);useEffect(()=>{fetch('/api/sessions/current').then(r=>r.ok?r.json():null).then(s=>{const old=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null');if(s){s.csrfToken??=old?.csrfToken;localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s));setSession(s)}})},[]);return session?<PersonalAuthenticationContext.Provider value={session.nextAuthenticationSource??session.authenticationSource??'local'}><OidcDraftPanel language="en" csrfToken={session.csrfToken} canWrite={true}/></PersonalAuthenticationContext.Provider>:null}createRoot(document.getElementById('root')).render(localStorage.getItem('activation-temporary')==='1'?<ClinicianSessionGate><p>Temporary clinical application</p></ClinicianSessionGate>:<App/>);`}});
 const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:await app.getUrl(),OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
 const css=await readFile(new URL('../../../web/app/styles.css',import.meta.url),'utf8');
 proxy=createServer((req,res)=>{if(route(req,res))return;res.setHeader('content-type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body><div id="root" class="agency-settings"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const origin=`http://child.localhost:${proxy.address().port}`,otherOrigin=`http://other.localhost:${proxy.address().port}`;process.env.WEB_ORIGIN=`http://localhost:${proxy.address().port}`;process.env.NODE_ENV='development';
 browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>process.stderr.write("PAGEERROR "+e.message+"\n"));
 const password=process.env.ACTIVATION_PASSWORD;
 const request=async(path,body,csrf)=>page.evaluate(async({path,body,csrf})=>{const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(csrf?{'x-csrf-token':csrf}:{}),'x-personal-authentication':'1'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};},{path,body,csrf});
 const token=async()=>(await context.cookies()).find(c=>c.name==='open_triage_session'&&c.domain===new URL(page.url()).hostname)?.value;
 await page.goto(origin);
 const temporary=await request('sessions',{username:'temporary',password});assert.equal(temporary.status,201);assert.equal(temporary.body.passwordChangeRequired,true);const temporaryToken=await token();
 const reportId='91200000-0000-4000-8000-000000000001';
 const medic=await request('sessions',{username:'medic',password});assert.equal(medic.status,201);const medicToken=await token();
 await request('sessions/reauthenticate',{currentPassword:password},medic.body.csrfToken);assert.equal((await control({proof:medicToken})).proof,true);
 const registered=await request(`reports/${reportId}/protected-key-envelope`,{schemaVersion:1,recoveryHandle:randomUUID(),reportKeyBase64:randomBytes(32).toString('base64')},medic.body.csrfToken);assert.equal(registered.status,201);
 const beforeGrant=await request(`reports/${reportId}/recovery-grants`,{schemaVersion:1,envelopeVersion:1},medic.body.csrfToken);assert.equal(beforeGrant.status,201);
 const reviewer=await request('sessions',{username:'reviewer',password});assert.equal(reviewer.status,201);const reviewerToken=await token(),reviewerCsrf=reviewer.body.csrfToken;
 await page.evaluate(s=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s)),reviewer.body);await page.reload();
 // A leftover failed personal flow must not steal the next diagnostic callback.
 await context.addCookies([{name:'open_triage_oidc_personal',value:'aborted-old-personal-flow',domain:'child.localhost',path:'/api/sessions/oidc/callback',httpOnly:true,secure:true,sameSite:'Lax'}]);
 await control({subject:'activation-reviewer'});
 await page.getByRole('button',{name:'Test provider login',exact:true}).click({noWaitAfter:true});await expect(page.getByRole('link',{name:'Continue fictional provider login'})).toBeVisible();
 assert(!(await context.cookies()).some(c=>c.name==='open_triage_oidc_personal'));
 await page.getByRole('link',{name:'Continue fictional provider login'}).click();await page.waitForURL(u=>u.origin===origin);
 await expect(page.getByRole('button',{name:'Activate tested SSO',exact:true})).toBeVisible();assert.equal(await token(),reviewerToken);
 let tested=(await request('admin/authentication/oidc')).body.test;
 const activation={expectedRevision:1,testId:tested.testId};
 // Inspection after a successful test cannot accidentally approve different metadata.
 await control({changeDiscovery:true});let failed=await request('admin/authentication/oidc/activate',activation,reviewerCsrf);assert.equal(failed.status,409);assert.equal((await control({inspect:true})).state.active_revision,null);await control({restoreDiscovery:true});
 // Deterministically interleave edit and activation while holding the policy row.
 db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{application_name:'activation-race'}});await db.initialize();const sessions=new ClinicianSessionService(db),drafts=new OidcDraftService(db,sessions);
 await control({holdPolicy:true});let pending=agencyRequest.run({origin},()=>drafts.activate(reviewerToken,activation));pending.catch(()=>{});
 for(let i=0;i<100;i++){if((await control({waiting:true})).waiting)break;await new Promise(r=>setTimeout(r,20));if(i===99)throw Error('Activation did not wait for held policy row');}
 await control({releasePolicy:true,editDraft:true});await assert.rejects(pending);assert.equal((await control({inspect:true})).state.active_revision,null);await control({resetDraft:true});
 // Authority withdrawal owns the assignment row before the activation actor locks it.
 await control({holdAuthority:true});pending=agencyRequest.run({origin},()=>drafts.activate(reviewerToken,activation));pending.catch(()=>{});
 for(let i=0;i<100;i++){if((await control({waiting:true})).waiting)break;await new Promise(r=>setTimeout(r,20));if(i===99)throw Error('Activation did not wait for held assignment row');}
 await control({withdrawAuthority:true});await assert.rejects(pending);assert.equal((await control({inspect:true})).state.active_revision,null);await control({restoreAuthority:true});
 await control({proofAvailable:false});await assert.rejects(agencyRequest.run({origin},()=>drafts.activate(reviewerToken,activation)),e=>e.getResponse?.().code==='admin.oidcActivationProofRequired');await control({proofAvailable:true});
 await control({ageProof:reviewerToken});// Activation uses the live administrator session even after its proof ages.
 await page.reload();await page.getByRole('button',{name:'Activate tested SSO',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'SSO activated.'})).toBeVisible();
 const state=await control({inspect:true});assert.equal(state.policy.mode,'oidc');assert.equal(state.state.active_revision,'1');assert(state.audit.some(e=>e.result==='succeeded'));assert(state.audit.some(e=>e.result==='failed'));
 assert.equal((await request('reports/91200000-0000-4000-8000-000000000003')).status,200,'Current local report remains readable after activation');
 const preserved=await request('sessions/current');assert.equal(preserved.status,200);assert.equal(preserved.body.expiresAt,reviewer.body.expiresAt);assert.equal(preserved.body.authenticationSource,'local');assert.equal(preserved.body.nextAuthenticationSource,'oidc');
 await assert.rejects(agencyRequest.run({origin},()=>sessions.getAuthenticated(temporaryToken)),e=>e.getStatus?.()===401);
 const temporaryLive=await agencyRequest.run({origin},()=>sessions.getAuthenticated(temporaryToken,new Date(),true));assert.equal(temporaryLive.nextAuthenticationSource,'oidc');assert.equal(temporaryLive.passwordChangeRequired,true);assert.equal(temporaryLive.expiresAt,temporary.body.expiresAt);
 // A limited temporary session must complete personal SSO before clinical/Admin
 // access, including on an unpaired or blank-schedule installation.
 const temporaryContext=await browser.newContext({ignoreHTTPSErrors:true}),temporaryPage=await temporaryContext.newPage();
 await temporaryContext.addCookies([{name:'open_triage_session',value:temporaryToken,domain:'child.localhost',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
 await temporaryContext.addInitScript(s=>{if(location.hostname!=='child.localhost')return;localStorage.setItem('activation-temporary','1');localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s));Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});},temporary.body);
 await temporaryPage.goto(origin);await expect(temporaryPage.getByRole('heading',{name:'Complete organization authentication',exact:true})).toBeVisible();await expect(temporaryPage.locator('input[name="newPassword"]')).toHaveCount(0);
 const beforeTemporary=await temporaryPage.evaluate(async()=>({clinical:(await fetch('/api/calls/assigned')).status,admin:(await fetch('/api/admin/authentication')).status}));assert.deepEqual(beforeTemporary,{clinical:401,admin:401});
 await control({subject:'activation-temporary'});await temporaryPage.getByRole('button',{name:'Sign in with your organization',exact:true}).click({noWaitAfter:true});await temporaryPage.getByRole('link',{name:'Continue fictional provider login'}).click();await temporaryPage.waitForURL(url=>url.origin===origin);await expect(temporaryPage.locator('.session-identity')).toBeVisible();
 const afterTemporary=await temporaryPage.evaluate(async()=>{const r=await fetch('/api/sessions/current');return{status:r.status,session:await r.json(),clinical:(await fetch('/api/calls/assigned')).status};});assert.equal(afterTemporary.status,200);assert.equal(afterTemporary.session.authenticationSource,'oidc');assert.equal(afterTemporary.session.user.id,temporary.body.user.id);assert.equal(afterTemporary.session.passwordChangeRequired,false);assert.equal(afterTemporary.session.expiresAt,temporary.body.expiresAt);assert.equal(afterTemporary.clinical,200);
 const temporaryReplacement=(await temporaryContext.cookies()).find(cookie=>cookie.name==='open_triage_session').value;assert.notEqual(temporaryReplacement,temporaryToken);await assert.rejects(agencyRequest.run({origin},()=>sessions.getAuthenticated(temporaryToken)),e=>e.getStatus?.()===401);await temporaryContext.close();

 assert.equal((await control({proof:medicToken})).proof,false,'Direct database recovery proof must reject recent local proof');
 const runtimeGrant=await db.query("select * from offline_recovery.create_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),'hex'),$5,1)",[reportId,medic.body.organization.id,medic.body.user.id,Buffer.from(medicToken),randomBytes(32).toString('hex')]);assert.equal(runtimeGrant[0].result,'reauthentication_required');assert.equal(runtimeGrant[0].recovery_handle,null);
 const runtimeConsume=await db.query("select * from offline_recovery.consume_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),'hex'),encode(sha256($5::bytea),'hex'),1)",[reportId,medic.body.organization.id,medic.body.user.id,Buffer.from(medicToken),Buffer.from(beforeGrant.body.grant)]);assert.equal(runtimeConsume[0].result,'denied');assert.equal(runtimeConsume[0].wrapped_data_key,null);
 await assert.rejects(agencyRequest.run({origin},()=>sessions.requireRecentReauthentication(reviewerToken)),e=>e.getStatus?.()===403);
 await assert.rejects(agencyRequest.run({origin},()=>sessions.reauthenticate(reviewerToken,reviewerCsrf,password)),e=>e.getStatus?.()===403);
 for(const username of ['reviewer','medic','synthetic'])assert.equal((await request('sessions',{username,password})).status,403);
 // Existing cookie survives denied new passwords and unavailable provider proof.
 assert.equal(await token(),reviewerToken);assert.equal((await request('sessions/current')).status,200);await control({health:'failed'});
 assert.equal((await request('sessions/authentication-options')).body.organization,true);assert.equal((await request('sessions/reauthenticate',{currentPassword:''},reviewerCsrf)).status,503);assert.equal(await token(),reviewerToken);await control({health:'healthy'});
 // Current local proof cannot skip required SSO, even though it was recent.
 await control({subject:'activation-reviewer'});const begin=await request('sessions/reauthenticate',{currentPassword:''},reviewerCsrf);assert.equal(begin.status,200);assert(begin.body.authorizationUrl);await page.goto(begin.body.authorizationUrl);await page.getByRole('link',{name:'Continue fictional provider login'}).click();await page.waitForURL(u=>u.origin===origin);
 const replacement=await request('sessions/current'),replacementToken=await token();assert.equal(replacement.status,200);assert.notEqual(replacementToken,reviewerToken);assert.equal(replacement.body.expiresAt,reviewer.body.expiresAt);assert.equal(replacement.body.authenticationSource,'oidc');assert.equal(replacement.body.personalAuthenticationPurpose,'reauthenticate');assert.equal((await control({proof:replacementToken})).proof,true);
 await assert.rejects(agencyRequest.run({origin},()=>sessions.getAuthenticated(reviewerToken)),e=>e.getStatus?.()===401);
 // A failed next provider activation preserves the established active policy.
 const activeView=await agencyRequest.run({origin},()=>drafts.get(replacementToken));
 const next=await agencyRequest.run({origin},()=>drafts.save(replacementToken,{expectedRevision:1,name:activeView.draft.name,issuer:activeView.draft.issuer,discoveryUrl:activeView.draft.discoveryUrl,clientId:activeView.draft.clientId,scopes:activeView.draft.scopes,mappings:activeView.draft.mappings,clientAuthentication:'client_secret_post'}));
 assert.equal(next.draft.revision,2);await assert.rejects(agencyRequest.run({origin},()=>drafts.activate(replacementToken,{expectedRevision:2,testId:activation.testId})),e=>e.getStatus?.()===409);assert.equal((await control({inspect:true})).state.active_revision,'1');assert.equal((await request('sessions/current')).status,200);
 // Different signed subject during a local session's required SSO proof is a
 // switch. Incoming reviewer cannot obtain the outgoing clinician's grant.
 const personal=new OidcPersonalService(db,sessions,new AgencyDirectoryService(db),new ExternalIdentityService(db,sessions));
 await control({subject:'activation-reviewer'});const wrong=await agencyRequest.run({origin},()=>personal.begin({purpose:'reauthenticate'},medicToken,medic.body.csrfToken));const confirmed=new URL(wrong.authorizationUrl);confirmed.searchParams.set('confirm','1');const exchanged=await fetch(confirmed,{redirect:'manual'});const switched=await agencyRequest.run({origin},()=>personal.callback(new URL(exchanged.headers.get('location')),wrong.correlation));assert.equal(switched.created.session.user.id,reviewer.body.user.id);assert.equal(switched.created.session.personalAuthenticationPurpose,'switch');await assert.rejects(agencyRequest.run({origin},()=>sessions.getAuthenticated(medicToken)),e=>e.getStatus?.()===401);
 const wrongGrant=await db.query("select * from offline_recovery.create_report_recovery_grant($1,$2,$3,encode(sha256($4::bytea),'hex'),$5,1)",[reportId,medic.body.organization.id,reviewer.body.user.id,Buffer.from(switched.created.sessionToken),randomBytes(32).toString('hex')]);assert.notEqual(wrongGrant[0].result,'succeeded');assert.equal(wrongGrant[0].recovery_handle,null);
 // Independent recovery is local even at an SSO agency. It cannot become a external identity.
 const owner=await request('sessions',{username:'owner',password});assert.equal(owner.status,201);assert.equal(owner.body.nextAuthenticationSource,'local');assert.equal((await request('sessions/reauthenticate',{currentPassword:password},owner.body.csrfToken)).status,200);
 const superadmin=await request('sessions',{username:'superadmin',password});assert.equal(superadmin.status,201);assert.equal(superadmin.body.nextAuthenticationSource,'local');assert.equal((await request('sessions/reauthenticate',{currentPassword:password},superadmin.body.csrfToken)).status,200);
 await page.goto(`http://demo.localhost:${proxy.address().port}`);const demo=await request('sessions',{username:'demo',password});assert.equal(demo.status,201);assert.equal(demo.body.nextAuthenticationSource,'local');const demoToken=await token();assert.equal((await db.transaction(m=>agencyRequest.run({origin:`http://demo.localhost:${proxy.address().port}`},()=>productionJobAccess(m,demoToken,demo.body,new SchedulesService(db,sessions))))).state,'synthetic-only');
 await control({extendDemo:true});assert.equal((await request('sessions',{username:'demo',password})).status,403);assert.equal((await request('sessions/current')).body.nextAuthenticationSource,'oidc');await assert.rejects(agencyRequest.run({origin:`http://demo.localhost:${proxy.address().port}`},()=>sessions.reauthenticate(demoToken,demo.body.csrfToken,password)),e=>e.getStatus?.()===403);
 await page.goto(otherOrigin);assert.equal((await request('sessions/authentication-options')).body.regional,false);assert.equal((await request('sessions',{username:'other',password})).status,201);
 await page.goto(origin);await control({expire:medicToken});await assert.rejects(agencyRequest.run({origin},()=>sessions.getAuthenticated(medicToken)),e=>e.getStatus?.()===401);
 console.log(JSON.stringify({activation:true,exactDraft:true,currentSessions:true,fixedExpiry:true,ordinaryDenied:true,syntheticDenied:true,ownerRecovery:true,independentGroup:true,races:true,staleCookie:true}));
}finally{await browser?.close();if(db?.isInitialized)await db.destroy();if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}await app.close();}
