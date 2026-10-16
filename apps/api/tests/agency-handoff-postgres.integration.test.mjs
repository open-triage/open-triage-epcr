import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AgencyDirectoryService} from '../dist/sessions/agency-directory.service.js';
import {AgencyHandoffService} from '../dist/sessions/agency-handoff.service.js';
import {agencyRequest} from '../dist/sessions/agency-context.js';
import {createPasswordVerifier} from '../dist/identity/password.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const digest=s=>createHash('sha256').update(s).digest('hex');
integration('only agency-less installation superusers transfer sessions through a one-use browser-bound handoff without new proof or time',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query('begin');
 const previousOrigin=process.env.WEB_ORIGIN;process.env.WEB_ORIGIN='http://localhost:3000';
 try{
  const query=async(sql,args)=>(await client.query(sql,args)).rows,manager={query};
  let serial=0;const database={manager,query,transaction:async work=>{const savepoint=`handoff_${++serial}`;await client.query(`savepoint ${savepoint}`);try{const result=await work(manager);await client.query(`release savepoint ${savepoint}`);return result;}catch(e){await client.query(`rollback to savepoint ${savepoint}`);throw e;}}};
  const source=randomUUID(),target=randomUUID(),user=randomUUID(),ordinary=randomUUID(),boundAdmin=randomUUID(),targetPerson=randomUUID(),name='h'+randomUUID().slice(0,8),password='Handoff test password 42!';
  const sourceOrigin=`http://${name}s.localhost:3000`,targetOrigin=`http://${name}t.localhost:3000`;
  await query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Handoff source',$2,'UTC'),($3,'Handoff target',$4,'UTC')",[source,new URL(sourceOrigin).hostname,target,new URL(targetOrigin).hostname]);
  await query("insert into app_identity.app_user(id,organization_id,display_name,account_scope) values($1,null,'Global administrator','installation'),($2,$3,'Ordinary person','agency'),($4,$3,'Agency-bound administrator','agency')",[user,ordinary,source,boundAdmin]);
  await query("insert into app_identity.installation_superadmin(user_id,established_by_operator_id) values($1,'test')",[user]);
  await query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='administrator'",[source,boundAdmin,user]);
  await query("insert into app_identity.app_user(id,organization_id,display_name,account_scope) values($1,$2,'Destination person','agency')",[targetPerson,target]);
  for(const id of [user,ordinary,boundAdmin,targetPerson])await query('insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,$2,$3,false)',[id,name+id.slice(0,8),await createPasswordVerifier(password)]);
  await client.query('set local role open_triage_api_runtime');
  const directory=new AgencyDirectoryService(database),sessions=new ClinicianSessionService(database,directory),handoffs=new AgencyHandoffService(database,sessions,directory);
  const at=(origin,work)=>agencyRequest.run({origin},work);
  const login=id=>at(sourceOrigin,()=>sessions.create({username:name+id.slice(0,8),password}));
  const sourceSession=await login(user);
  const original=await at(sourceOrigin,()=>sessions.getAuthenticated(sourceSession.sessionToken));
  for(const id of [ordinary,boundAdmin]){
   const session=await login(id);await assert.rejects(at(sourceOrigin,()=>handoffs.start(session.sessionToken,{organizationId:target,verifierHash:'a'.repeat(64)})),e=>e.getStatus?.()===401||e.getResponse?.().code==='auth.agencyHandoffRestricted');
  }
  const verifier=randomBytes(32).toString('base64url');
  const begin=()=>at(sourceOrigin,()=>handoffs.start(sourceSession.sessionToken,{organizationId:target,verifierHash:digest(verifier)}));
  const start=await begin();assert.equal(new URL(start.targetUrl).origin,targetOrigin);
  await assert.rejects(at(sourceOrigin,()=>handoffs.challenge({transactionId:start.transactionId})));
  const challenge=await at(targetOrigin,()=>handoffs.challenge({transactionId:start.transactionId}));
  const challengeHash=new URLSearchParams(new URL(challenge.sourceUrl).hash.slice(1)).get('challengeHash');
  await assert.rejects(at(sourceOrigin,()=>handoffs.issue(sourceSession.sessionToken,{transactionId:start.transactionId,verifier:randomBytes(32).toString('base64url'),challengeHash})));
  const issued=await at(sourceOrigin,()=>handoffs.issue(sourceSession.sessionToken,{transactionId:start.transactionId,verifier,challengeHash}));
  const code=new URLSearchParams(new URL(issued.targetUrl).hash.slice(1)).get('code');
  await assert.rejects(at(sourceOrigin,()=>sessions.getAuthenticated(sourceSession.sessionToken)));
  await assert.rejects(at(targetOrigin,()=>handoffs.consume({transactionId:start.transactionId,code},randomBytes(32).toString('base64url'))));
  await assert.rejects(at(sourceOrigin,()=>handoffs.consume({transactionId:start.transactionId,code},challenge.correlation)));
  const created=await at(targetOrigin,()=>handoffs.consume({transactionId:start.transactionId,code},challenge.correlation));
  assert.equal(created.session.user.id,user);assert.equal(created.session.organization.id,target);assert.equal(created.session.installationSuperadmin,true);assert.equal(created.session.homeOrganizationId,undefined);
  assert.equal(created.session.startedAt,sourceSession.session.startedAt);assert.equal(created.session.expiresAt,sourceSession.session.expiresAt);assert.equal(created.session.authenticationSource,'local');assert.equal(created.session.personallyAuthenticatedAt,original.personallyAuthenticatedAt);
  const [binding]=await query('select browser_origin,installation_registration_id from app_identity.app_session where token_sha256=$1',[digest(created.sessionToken)]);assert.deepEqual(binding,{browser_origin:targetOrigin,installation_registration_id:null});
  await assert.rejects(at(targetOrigin,()=>handoffs.consume({transactionId:start.transactionId,code},challenge.correlation)));
  // A fresh source switch expires, and an otherwise valid issue cannot survive a credential reset.
  const fresh=await login(user),verifier2=randomBytes(32).toString('base64url');
  const reset=await at(sourceOrigin,()=>handoffs.start(fresh.sessionToken,{organizationId:target,verifierHash:digest(verifier2)}));
  const resetChallenge=await at(targetOrigin,()=>handoffs.challenge({transactionId:reset.transactionId}));
  const resetHash=new URLSearchParams(new URL(resetChallenge.sourceUrl).hash.slice(1)).get('challengeHash');
  const resetIssue=await at(sourceOrigin,()=>handoffs.issue(fresh.sessionToken,{transactionId:reset.transactionId,verifier:verifier2,challengeHash:resetHash}));
  const resetCode=new URLSearchParams(new URL(resetIssue.targetUrl).hash.slice(1)).get('code');
  await client.query('reset role');await query('update app_identity.local_credential set credential_version=credential_version+1 where user_id=$1',[user]);await client.query('set local role open_triage_api_runtime');
  await assert.rejects(at(targetOrigin,()=>handoffs.consume({transactionId:reset.transactionId,code:resetCode},resetChallenge.correlation)));

  const expiringSession=await login(user),expiring=await at(sourceOrigin,()=>handoffs.start(expiringSession.sessionToken,{organizationId:target,verifierHash:digest(verifier)}));
  await client.query('reset role');await query("update app_identity.agency_session_handoff set expires_at=created_at+interval '1 microsecond' where id=$1",[expiring.transactionId]);await client.query('set local role open_triage_api_runtime');
  await assert.rejects(at(targetOrigin,()=>handoffs.challenge({transactionId:expiring.transactionId})));
  const another=await at(targetOrigin,()=>sessions.create({username:name+targetPerson.slice(0,8),password})),pending=await at(sourceOrigin,()=>handoffs.start(expiringSession.sessionToken,{organizationId:target,verifierHash:digest(verifier)}));
  await assert.rejects(at(targetOrigin,()=>handoffs.challenge({transactionId:pending.transactionId},another.sessionToken)),e=>e.getResponse?.().code==='auth.agencyHandoffOtherUser');

  // Real cross-host browser cookies, source intent, target challenge and CSRF guard.
  const {NestFactory}=await import('@nestjs/core'),{Module}=await import('@nestjs/common'),{APP_GUARD}=await import('@nestjs/core');
  const {AgencyHandoffController}=await import('../dist/sessions/agency-handoff.controller.js');
  const {CsrfGuard}=await import('../dist/sessions/csrf.guard.js');
  const {agencyContextMiddleware}=await import('../dist/sessions/agency-context.middleware.js');
  const {PlatformErrorFilter}=await import('../dist/platform-error.filter.js');
  const {createServer}=await import('node:http'),{once}=await import('node:events');
  const {build}=await import('esbuild'),{chromium,expect}=await import('@playwright/test');
  const {fileURLToPath}=await import('node:url');
  const {localRouting}=await import('../../web/scripts/lib/local-routing.mjs');
  class FixtureModule{};Module({controllers:[AgencyHandoffController],providers:[{provide:AgencyHandoffService,useValue:handoffs},{provide:APP_GUARD,useValue:new CsrfGuard(sessions)}]})(FixtureModule);
  const app=await NestFactory.create(FixtureModule,{logger:false});app.setGlobalPrefix('api');app.use(agencyContextMiddleware);app.useGlobalFilters(new PlatformErrorFilter());
  let proxy,browser;
  try{
   await app.listen(0,'127.0.0.1');
   let script='';const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:await app.getUrl(),OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
   proxy=createServer((req,res)=>{if(route(req,res))return;res.setHeader('content-type','text/html');res.end(`<html lang="en"><body><button id="switch">Switch agency</button><p id="result">Loading</p><script>${script}</script></body></html>`);});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
   const port=proxy.address().port;process.env.WEB_ORIGIN=`http://localhost:${port}`;
   const browserSource=`http://${new URL(sourceOrigin).hostname}:${port}`,browserTarget=`http://${new URL(targetOrigin).hostname}:${port}`;
   const browserSession=await at(browserSource,()=>sessions.create({username:name+user.slice(0,8),password}));
   script=(await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:fileURLToPath(new URL('../../web',import.meta.url)),loader:'ts',contents:`import {startAgencyHandoff,resumeAgencyHandoff} from './app/agency-handoff';async function boot(){const result=await resumeAgencyHandoff();if(result&&'redirecting'in result)return;document.getElementById('result').textContent=result?'Handoff complete':'Ready';document.getElementById('switch').onclick=()=>startAgencyHandoff(${JSON.stringify(target)},${JSON.stringify(browserSession.session.csrfToken)}).catch(e=>document.getElementById('result').textContent=e.message);}boot().catch(e=>document.getElementById('result').textContent=e.message);`}})).outputFiles[0].text;
   browser=await chromium.launch();const context=await browser.newContext();
   await context.addCookies([{name:'open_triage_session',value:browserSession.sessionToken,domain:new URL(browserSource).hostname,path:'/api',httpOnly:true,secure:true,sameSite:'Strict'}]);
   const page=await context.newPage();await page.goto(browserSource);await expect(page.locator('#result')).toHaveText('Ready');
   await page.evaluate(session=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(session)),browserSession.session);
   await page.locator('#switch').click();await expect(page.locator('#result')).toHaveText('Handoff complete',{timeout:15000});
   assert.equal(new URL(page.url()).origin,browserTarget);assert.equal(new URL(page.url()).hash,'');
   const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')));
   assert.equal(stored.user.id,user);assert.equal(stored.organization.id,target);assert.equal(stored.expiresAt,browserSession.session.expiresAt);
   const sourceCookies=await context.cookies(browserSource+'/api');assert(!sourceCookies.some(c=>c.name==='open_triage_session'));
   const cookies=await context.cookies(browserTarget+'/api');const cookie=cookies.find(c=>c.name==='open_triage_session');assert(cookie);assert(cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');assert(!cookies.some(c=>c.name==='open_triage_agency_handoff'));
  }finally{await browser?.close();if(proxy)await new Promise(r=>proxy.close(r));await app.close();}
 }finally{if(previousOrigin===undefined)delete process.env.WEB_ORIGIN;else process.env.WEB_ORIGIN=previousOrigin;await client.query('rollback');await client.end();}
});
