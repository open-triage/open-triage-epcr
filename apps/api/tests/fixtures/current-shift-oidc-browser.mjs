// Actual TLS provider, API, session cookies, UI and deployment proxy. This is a
// controlled contract regression; regional and physical-device acceptance is separate.
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
import {DataSource} from 'typeorm';
import {SchedulesService} from '../../dist/schedules/schedules.service.js';
import {agencyContextMiddleware} from '../../dist/sessions/agency-context.middleware.js';
import {PlatformErrorFilter} from '../../dist/platform-error.filter.js';
import {localRouting} from '../../../web/scripts/lib/local-routing.mjs';
const control=async command=>{const r=await fetch(process.env.SHIFT_CONTROL_URL,{method:'POST',body:JSON.stringify(command)});assert.equal(r.status,200);return r.json();};
const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');app.use(agencyContextMiddleware);const errors=new PlatformErrorFilter(),handle=errors.catch.bind(errors);errors.catch=(error,...args)=>{if(!error.getStatus||error.getStatus()>=500)console.error(error.stack??error);return handle(error,...args);};app.useGlobalFilters(errors);
let proxy,browser;
try{
 await app.listen(0,'127.0.0.1');app.get(DataSource).logger.logQueryError=error=>console.error(error);const api=await app.getUrl();
 const incoming=Date.parse(process.env.SHIFT_INCOMING),schedules=app.get(SchedulesService),liveNow=schedules.now.bind(schedules);let crossing=false;
 schedules.now=manager=>crossing?Promise.resolve(Math.max(incoming,Date.now())):liveNow(manager);
 const css=await readFile(new URL('../../../web/app/styles.css',import.meta.url),'utf8');
 const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:fileURLToPath(new URL('../../../web',import.meta.url)),loader:'tsx',contents:`import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{AssignedCalls}from'./components/assigned-calls';import{createNewPatientReport}from'./app/assigned-calls';import{transitionInstallation}from'./app/installation-transition';import{beginPersonalClinicianSession,createClinicianSession,endClinicianSession}from'./app/clinician-session';
 function CreateJob({session}){const[result,setResult]=useState('');return <><button onClick={async()=>{try{const opened=await createNewPatientReport(session);setResult(opened.report.id)}catch(e){setResult(e.message)}}}>Create grace report</button><output>{result}</output></>}
 function App(){const[session,setSession]=useState(null);useEffect(()=>{fetch('/api/sessions/current').then(async r=>{if(r.ok){const s=await r.json(),old=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null');if(old?.user?.id===s.user.id&&old?.organization?.id===s.organization.id)s.csrfToken??=old.csrfToken;localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s));setSession(s)}})},[]);return session?<><AssignedCalls session={session} language="en"/><CreateJob session={session}/></>:location.hostname==='localshift.localhost'?<><button onClick={async()=>{const s=await createClinicianSession({username:'local-shift-clinician',password:'Local shift password 42!'});localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s));setSession(s)}}>Local login</button><button onClick={async()=>{const s=await createClinicianSession({username:'incoming-local-clinician',password:'Local shift password 42!'});localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(s));setSession(s)}}>Incoming local login</button></>:<button onClick={()=>beginPersonalClinicianSession('login').catch(()=>{})}>Regional login</button>};createRoot(document.getElementById('root')).render(<App/>);`}});
 const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:api,OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
 proxy=createServer((req,res)=>{if(route(req,res))return;if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);return;}res.setHeader('content-type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const origin=`http://child.localhost:${proxy.address().port}`;process.env.WEB_ORIGIN=`http://localhost:${proxy.address().port}`;process.env.NODE_ENV='development';
 const paired=await control({origin});browser=await chromium.launch();
 const newContext=async()=>{const context=await browser.newContext({ignoreHTTPSErrors:true});await context.addCookies([{name:'open_triage_installation',value:paired.credential,url:origin+'/api',httpOnly:true,secure:true,sameSite:'Strict'}]);return context;};
 const context=await newContext();let page=await context.newPage();page.setDefaultTimeout(15000);
 const token=async ctx=>(await ctx.cookies()).find(c=>c.name==='open_triage_session')?.value;
 const finish=async target=>{await target.getByRole('link',{name:'Continue fictional provider login'}).click();await target.waitForURL(url=>url.origin===origin);};
 const login=async target=>{await target.goto(origin);await target.getByRole('button',{name:'Regional login'}).click();await finish(target);await expect(target.locator('#assigned-calls-title')).toBeVisible();await expect(target.getByText('No calls are currently assigned.',{exact:true})).toBeVisible();};
 const newReport=async()=>page.evaluate(async()=>{
  const session=await(await fetch('/api/sessions/current')).json();session.csrfToken??=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')).csrfToken;
  const command={commandId:crypto.randomUUID(),reportId:crypto.randomUUID(),incidentId:crypto.randomUUID(),patientId:crypto.randomUUID(),organizationId:session.organization.id,documentingUserId:session.user.id,patientIdentityState:'unknown'};
  const response=await fetch('/api/reports',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(command)});
  return {status:response.status,body:await response.json(),command};
 });
 const reopen=id=>page.evaluate(async id=>{const s=await(await fetch('/api/sessions/current')).json();s.csrfToken??=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')).csrfToken;const response=await fetch('/api/reports/'+id+'/reopen',{method:'POST',headers:{'x-csrf-token':s.csrfToken}});return {status:response.status,body:await response.json()};},id);
 const regionalPage=page,localOrigin=`http://localshift.localhost:${proxy.address().port}`,localPaired=await control({origin:localOrigin,local:true}),localContext=await browser.newContext();
 await localContext.addCookies([{name:'open_triage_installation',value:localPaired.credential,url:localOrigin+'/api',httpOnly:true,secure:true,sameSite:'Strict'}]);
 page=await localContext.newPage();await page.goto(localOrigin);await page.getByRole('button',{name:'Local login',exact:true}).click();await expect(page.getByText('No calls are currently assigned.',{exact:true})).toBeVisible();
 const localFirst=await newReport();assert.equal(localFirst.status,201,JSON.stringify(localFirst.body));
 const localToken=await token(localContext);await control({age:localToken});await page.reload();
 await expect(page.getByRole('button',{name:'Authenticate for this shift'})).toHaveCount(0);
 assert.equal((await newReport()).status,201);assert.equal((await reopen(localFirst.body.id)).status,200);
 const validLoginJourney=async(ctx,personal)=>{
  const originalToken=await token(ctx),before=await control({inspect:originalToken});
  await control({grace:true,...(!personal?{local:true}:{})});await page.reload();
  const trigger=page.getByRole('button',{name:'Create grace report'});
  await trigger.click();await expect(page.locator('output')).toHaveText(/^[a-f0-9-]{36}$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const first=await page.locator('output').textContent();
  await trigger.click();await expect(page.locator('output')).not.toHaveText(first);
  await expect(page.locator('output')).toHaveText(/^[a-f0-9-]{36}$/);
  assert.deepEqual((await control({inspect:originalToken})).session,before.session,'ordinary work never changes proof or fixed expiry');
  // Actual logout and initial authentication still change the clinician.
  await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));await fetch('/api/sessions/current',{method:'DELETE',headers:{'x-csrf-token':s.csrfToken}});localStorage.removeItem('open-triage.clinician-session.v1');});
  if(personal)await control({subject:'incoming-shift-clinician'});
  await page.reload();
  assert((await control({inspect:originalToken})).session.revoked_at);
  if(personal){await page.getByRole('button',{name:'Regional login',exact:true}).click();await finish(page);}
  else await page.getByRole('button',{name:'Incoming local login',exact:true}).click();
  await expect(page.locator('output')).toBeEmpty();
  const incomingSession=await page.evaluate(async()=>(await fetch('/api/sessions/current')).json());
  assert.notEqual(incomingSession.user.id,before.session.user_id);
  assert.equal((await reopen(first)).status,404,'incoming clinician cannot reopen outgoing report');
 };
 await validLoginJourney(localContext,false);await localContext.close();page=regionalPage;
 await login(page);const first=await newReport();assert.equal(first.status,201,JSON.stringify(first.body));
 const originalToken=await token(context);await control({age:originalToken});
 const before=await control({inspect:originalToken});
 crossing=true;await control({mode:'outage'});await page.reload();
 await expect(page.getByRole('button',{name:'Authenticate for this shift'})).toHaveCount(0);
 assert.equal((await newReport()).status,201,'valid SSO session remains sufficient across shift and provider outage');
 assert.equal((await reopen(first.body.id)).status,200);
 assert.deepEqual((await control({inspect:originalToken})).session,before.session);
 await control({mode:'fresh'});await validLoginJourney(context,true);

 console.log(JSON.stringify({currentLogin:true,ownershipSwitch:true,shiftOidc:true,localBrowser:true,crossing:true,outage:true,fixedExpiry:true}));
}finally{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}await app.close();}
