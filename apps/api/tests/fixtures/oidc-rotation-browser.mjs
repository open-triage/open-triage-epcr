import 'reflect-metadata';
import assert from 'node:assert/strict';
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
import {OidcDraftService} from '../../dist/authentication/oidc-draft.service.js';
import {ExternalIdentityService} from '../../dist/authentication/external-identity.service.js';
import {agencyRequest} from '../../dist/sessions/agency-context.js';
import {decryptCredential} from '../../dist/authentication/oidc-credentials.js';
const control=async cmd=>{const response=await fetch(process.env.ROTATION_CONTROL_URL,{method:'POST',body:JSON.stringify(cmd)});assert.equal(response.status,200,await response.clone().text());return response.json();};
const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');app.use(agencyContextMiddleware);app.useGlobalFilters(new PlatformErrorFilter());
let proxy,browser,db;
try{
 await app.listen(0,'127.0.0.1');
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:fileURLToPath(new URL('../../../web',import.meta.url)),loader:'tsx',contents:`import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {OidcDraftPanel} from './components/oidc-draft';function App(){const[s,setSession]=useState(null);useEffect(()=>{fetch('/api/sessions/current').then(r=>r.json()).then(setSession)},[]);return s?<OidcDraftPanel language="en" csrfToken={${JSON.stringify(process.env.ROTATION_OWNER_CSRF)}} canWrite={true}/>:null}createRoot(document.getElementById('root')).render(<App/>);`}});
 const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:await app.getUrl(),OPEN_TRIAGE_PUBLIC_SITE_HOST:''}),css=await readFile(new URL('../../../web/app/styles.css',import.meta.url),'utf8');
 proxy=createServer((req,res)=>{if(route(req,res))return;res.setHeader('content-type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body><div id="root" class="agency-settings"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const origin=`http://rotation.localhost:${proxy.address().port}`;process.env.WEB_ORIGIN=`http://localhost:${proxy.address().port}`;process.env.NODE_ENV='development';
 db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{application_name:'rotation-race'}});await db.initialize();
 const sessions=new ClinicianSessionService(db),drafts=new OidcDraftService(db,sessions),personal=new OidcPersonalService(db,sessions,new AgencyDirectoryService(db),new ExternalIdentityService(db,sessions));
 const ownerToken=process.env.ROTATION_OWNER_TOKEN,password=process.env.ROTATION_PASSWORD,csrf=process.env.ROTATION_OWNER_CSRF;
 const inAgency=fn=>agencyRequest.run({origin},fn);
 const fresh=()=>inAgency(()=>sessions.reauthenticate(ownerToken,csrf,password));
 const view=()=>inAgency(()=>drafts.get(ownerToken));
 const command=(v,changes={})=>({expectedRevision:v.draft.revision,name:v.draft.name,issuer:v.draft.issuer,discoveryUrl:v.draft.discoveryUrl,clientId:v.draft.clientId,scopes:v.draft.scopes,mappings:v.draft.mappings,clientAuthentication:'client_secret_post',...changes});
 const save=async changes=>inAgency(async()=>drafts.save(ownerToken,command(await view(),changes)));
 const version=async revision=>(await db.query('select provider_id,encrypted_credential from app_identity.oidc_provider_version where group_id=$1 and revision=$2',[(await view()).groupId,revision]))[0];
 browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();page.setDefaultTimeout(15000);
 await context.addCookies([{name:'open_triage_session',value:ownerToken,domain:'rotation.localhost',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);await page.goto(origin);
 const authenticate=()=>page.getByLabel('Your password for OIDC changes').fill(password);
 const inspect=async()=>{await authenticate();await page.getByRole('button',{name:'Check discovery',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Discovery healthy'})).toBeVisible();};
 const diagnostic=async revision=>{await authenticate();await page.getByRole('button',{name:'Test provider login',exact:true}).click({noWaitAfter:true});await page.getByRole('link',{name:'Continue fictional provider login'}).click();await page.waitForURL(u=>u.origin===origin);await expect(page.getByText(new RegExp(`Revision ${revision}:`))).toBeVisible();return (await view()).test;};
 await inspect();await fresh();
 const proof=async(purpose,previous)=>inAgency(async()=>{const begin=await personal.begin({purpose},previous?.sessionToken,previous?.session.csrfToken);const url=new URL(begin.authorizationUrl);url.searchParams.set('confirm','1');const exchanged=await fetch(url,{redirect:'manual'});return personal.callback(new URL(exchanged.headers.get('location')),begin.correlation);});
 const issued=(await proof('login')).created;assert(issued);const recent=(await proof('reauthenticate',issued)).created;assert(recent);assert.equal(recent.sessionToken,issued.sessionToken);
 const baseline=await version(1),initialExpiry=issued.session.expiresAt,group=(await view()).groupId,contract=process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;
 await inAgency(()=>sessions.requireRecentReauthentication(issued.sessionToken));
 // Edit away and restore exact active integration, with no deployment-file or
 // contract changes and without moving an envelope across its provider AAD.
 const away=await save({issuer:'https://wrong-issuer.example/adfs',replacementSecret:'discarded-other-integration-secret'});assert(away.identityImpact.integrationChanged);assert.equal(away.identityImpact.linkedIdentities,1);assert.notEqual((await version(2)).provider_id,baseline.provider_id);
 const restored=await save({issuer:(await view()).active.issuer});assert.equal(restored.draft.revision,3);assert.equal((await version(3)).provider_id,baseline.provider_id);assert.deepEqual((await version(3)).encrypted_credential,baseline.encrypted_credential);assert.equal(restored.test,null);assert.equal(restored.identityImpact.integrationChanged,false);
 await assert.rejects(inAgency(()=>drafts.activate(ownerToken,{expectedRevision:3,testId:'a'.repeat(64)})),e=>e.getResponse?.().code==='admin.oidcActivationTestRequired');
 // Repair a persisted restoration made before this slice in another namespace.
 await control({legacyDraft:4});await page.reload();await expect(page.getByText(/Existing external identity links stay/)).toBeVisible();await expect(page.getByRole('button',{name:'Save OIDC draft',exact:true})).toBeDisabled();await inspect();assert.equal((await diagnostic(4)).result,'succeeded');await page.getByRole('checkbox',{name:/I understand that the replacement/}).check();await authenticate();await page.getByRole('button',{name:'Prepare replacement draft',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Draft saved');const repaired=await view();assert.equal(repaired.draft.revision,5);assert.equal(repaired.test,null);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByText('No completed test login for this draft.')).toBeVisible();assert.equal((await version(5)).provider_id,baseline.provider_id);assert.deepEqual((await version(5)).encrypted_credential,baseline.encrypted_credential);assert.notEqual((await version(4)).provider_id,baseline.provider_id);
 await control({resetAuthenticationWindow:true});
 await save({clientId:'rejected-new-registration',replacementSecret:'discarded-new-registration-secret'});
 const rotated='rotated-controlled-client-secret';const replacing=await save({clientId:(await view()).active.clientId,replacementSecret:rotated});assert.equal(replacing.draft.revision,7);assert.equal((await version(7)).provider_id,baseline.provider_id);assert.equal(decryptCredential((await version(7)).encrypted_credential,group,baseline.provider_id),rotated);assert.equal(process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON,contract);
 await control({secret:rotated});await page.reload();await inspect();assert.equal((await diagnostic(7)).result,'succeeded');
 await authenticate();await page.getByRole('button',{name:'Activate tested SSO',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'SSO activated.'})).toBeVisible();assert.equal((await view()).active.revision,7);
 await inAgency(()=>sessions.requireRecentReauthentication(issued.sessionToken));assert.equal((await inAgency(()=>sessions.get(issued.sessionToken))).expiresAt,initialExpiry);
 // Re-inspecting the same active revision cannot disable its working snapshot
 // or silently replace tested endpoints. Both failed and changed-but-healthy
 // inspection continue to allow real personal login through activated metadata.
 const workingMetadata=(await view()).active.discovery;
 await control({metadata:{issuer:'https://wrong-inspection.example'}});await authenticate();await page.getByRole('button',{name:'Check discovery',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Discovery failed. Active configuration retained.'})).toBeVisible();assert.equal((await view()).draft.discoveryHealth,'failed');assert.equal((await view()).active.discoveryHealth,'healthy');assert((await proof('reauthenticate',issued)).created);
 await control({metadata:{authorization_endpoint:workingMetadata.authorization_endpoint.replace('/authorize','/unavailable')}});await inspect();assert.notEqual((await view()).draft.discovery.authorization_endpoint,workingMetadata.authorization_endpoint);assert.deepEqual((await view()).active.discovery,workingMetadata);assert((await proof('reauthenticate',issued)).created);
 await control({metadata:{}});await inspect();
 await control({rollKeys:true});const afterRollover=(await proof('reauthenticate',issued)).created;assert(afterRollover);assert.equal(afterRollover.session.expiresAt,initialExpiry);assert.equal((await db.query("select oidc_revision from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(issued.sessionToken)]))[0].oidc_revision,'1','Issuance provenance remains immutable');
 // A rejected replacement secret gets its own revision and cannot displace the
 // active credential, even after healthy discovery and a failed real exchange.
 await save({replacementSecret:'invalid-replacement-secret'});await page.reload();await inspect();const failed=await diagnostic(8);assert.equal(failed.result,'failed');assert.equal(failed.failureCode,'provider_validation');assert.equal((await view()).active.revision,7);
 await assert.rejects(inAgency(()=>drafts.activate(ownerToken,{expectedRevision:8,testId:failed.testId})),e=>e.getResponse?.().code==='admin.oidcActivationTestRequired');
 // Wrong issuer discovery and signature-validated wrong issuer never replace
 // the working integration; diagnostics expose only bounded failure categories.
 await save({replacementSecret:rotated});await page.reload();await control({metadata:{issuer:'https://wrong-issuer.example'}});await authenticate();await page.getByRole('button',{name:'Check discovery',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Discovery failed. Active configuration retained.'})).toBeVisible();assert.equal((await view()).active.revision,7);
 await control({metadata:{},token:{iss:'https://wrong-issuer.example'}});await inspect();assert.equal((await diagnostic(9)).failureCode,'provider_validation');await control({token:{}});
 // Simultaneous saves must serialize on the shared group policy and preserve
 // exactly one immutable winning revision instead of overwriting either draft.
 await fresh();const input=command(await view());const competing=await Promise.allSettled(['One concurrent writer','Other concurrent writer'].map(name=>inAgency(()=>drafts.save(ownerToken,{...input,name}))));assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.find(r=>r.status==='rejected').reason.getResponse().code,'admin.oidcStale');assert.equal((await view()).draft.revision,10);
 // Observe the actual database blocker, then let database time expire the proof
 // while the writer waits for the policy lock. No timing-only race assumption.
 await fresh();await control({prepareExpiry:true});await control({holdPolicy:true});const stale=save({name:'Must not save after proof expiry'});stale.catch(()=>{});
 for(let i=0;i<200;i++){if((await control({waiting:true})).waiting)break;if(i===199)throw Error('Writer did not block');await new Promise(r=>setTimeout(r,10));}
 for(let i=0;i<200;i++){if((await control({proofExpired:true})).expired)break;if(i===199)throw Error('Fixture proof did not expire');await new Promise(r=>setTimeout(r,10));}
 await control({release:true});await assert.rejects(stale,e=>e.getResponse?.().code==='login.reauthenticationRequired');assert.equal((await view()).draft.revision,10);await fresh();
 // Bound history independently of the latest-page predecessor and expose field
 // names, actor and effective status, never encrypted or clear credential values.
 for(let i=0;i<22;i++)await save({name:`Historical configuration ${i}`});const history=await view();assert.equal(history.history.length,20);assert.equal(history.history[0].status,'draft');assert.equal(history.history[0].actorId,(await inAgency(()=>sessions.get(ownerToken))).user.id);assert.deepEqual(history.history[19].changedFields,['name']);assert.equal(history.history[19].credentialReplaced,false);
 await page.reload();await expect(page.getByRole('region',{name:'Version history',exact:true}).getByRole('row')).toHaveCount(21);for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('region',{name:'Version history',exact:true}).focus();assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'region');await page.screenshot({path:`/tmp/auth012-runtime-history-${width}.png`,fullPage:true});}
 // New integration remains separate: consent is tied to the exact immutable
 // draft and active revision, and an ordinary administrator cannot approve a
 // new installation trust contract by acknowledging identity consequences.
 const replacement=await save({clientId:'replacement-registration',replacementSecret:rotated});await page.reload();await expect(page.getByText(/Existing external identity links stay/)).toBeVisible();await inspect();const tested=await diagnostic(replacement.draft.revision);assert.equal(tested.result,'succeeded');assert.equal(tested.identityOutcome,'pending');
 const activation={expectedRevision:replacement.draft.revision,testId:tested.testId};
 await assert.rejects(inAgency(()=>drafts.activate(ownerToken,activation)),e=>e.getResponse?.().code==='admin.oidcIdentityAcknowledgmentRequired');
 await assert.rejects(inAgency(()=>drafts.activate(ownerToken,{...activation,identityChangeAcknowledgment:{activeRevision:1,draftRevision:replacement.draft.revision}})),e=>e.getResponse?.().code==='admin.oidcIdentityAcknowledgmentRequired');
 const acknowledged={...activation,identityChangeAcknowledgment:{activeRevision:7,draftRevision:replacement.draft.revision}};
 await assert.rejects(inAgency(()=>drafts.activate(ownerToken,acknowledged)),e=>e.getResponse?.().code==='admin.oidcActivationProofRequired');assert.equal((await view()).active.revision,7);
 const replacementProvider=(await version(replacement.draft.revision)).provider_id,policies=JSON.parse(contract);
 process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=JSON.stringify([...policies,{...policies[0],id:'separately-reviewed-controlled-replacement',providerId:replacementProvider,clientId:'replacement-registration'}]);
 await inAgency(()=>drafts.activate(ownerToken,acknowledged));assert.equal((await view()).active.revision,replacement.draft.revision);
 // The old session still has ordinary authority and fixed issuance/expiry, but
 // old-namespace sensitive/recovery proof cannot satisfy the new integration.
 assert.equal((await inAgency(()=>sessions.get(issued.sessionToken))).expiresAt,initialExpiry);await assert.rejects(inAgency(()=>sessions.requireRecentReauthentication(issued.sessionToken)),e=>e.getResponse?.().code==='login.reauthenticationRequired');
 const [proofState]=await db.query("select app_identity.session_proof_matches_policy(s) matches,oidc_revision,personal_revision from app_identity.app_session s where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(issued.sessionToken)]);assert.equal(proofState.matches,false);assert.equal((await control({proof:issued.sessionToken})).recovery,false);assert.equal(proofState.oidc_revision,'1');assert.equal(proofState.personal_revision,'7');
 const pending=await proof('login');assert.equal(pending.created,undefined);assert.equal(pending.clearSession,true);assert.match(pending.destination,/authentication=pending/);
 // Ambiguous upgrade evidence blocks new regional proof, preserves existing
 // sessions, and offers independent recovery without artificial field edits.
 await control({clearSnapshot:true,resetAuthenticationWindow:true});await assert.rejects(inAgency(()=>personal.begin({purpose:'login'})),error=>error.getResponse?.().code==='login.personalProofUnavailable');assert.equal((await inAgency(()=>sessions.get(issued.sessionToken))).expiresAt,initialExpiry);
 await page.reload();await expect(page.getByRole('alert')).toContainText('no approved discovery snapshot');await expect(page.getByRole('button',{name:'Save OIDC draft',exact:true})).toBeDisabled();await authenticate();await page.getByRole('button',{name:'Prepare replacement draft',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Draft saved');
 const prepared=await view();assert.equal(prepared.draft.revision,replacement.draft.revision+1);assert.equal(prepared.test,null);assert.equal(prepared.activeSnapshotReady,false);assert.equal(prepared.active.revision,replacement.draft.revision);
 await inspect();await diagnostic(prepared.draft.revision);await authenticate();await page.getByRole('button',{name:'Activate tested SSO',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'SSO activated.'})).toBeVisible();assert.equal((await view()).activeSnapshotReady,true);assert.equal((await inAgency(()=>sessions.get(issued.sessionToken))).expiresAt,initialExpiry);
 const evidence=await control({inspect:true});assert.equal(evidence.identities.find(i=>i.provider_id===baseline.provider_id).linked_user_id,issued.session.user.id);assert.equal(evidence.identities.find(i=>i.provider_id===replacementProvider).linked_user_id,null);
 const publicHistory=JSON.stringify({view:await view(),audit:evidence.audit});assert.doesNotMatch(publicHistory,/fresh-provider-secret|rotated-controlled-client-secret|invalid-replacement-secret|discarded-other|discarded-new|legacy-incorrect|fictional-access-token|fictional-provider-user|ciphertext|encrypted_credential|code_verifier/);
 console.log(JSON.stringify({rotation:true,restoration:true,legacyRestoration:true,failedReplacement:true,concurrentEdits:true,wrongIssuer:true,automaticSigningKeys:true,secretFreeHistory:true,namespaceProof:true}));
}finally{await browser?.close();if(db?.isInitialized)await db.destroy();if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}await app.close();}
