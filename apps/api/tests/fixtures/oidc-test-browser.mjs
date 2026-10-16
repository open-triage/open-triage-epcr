// Run in a child with a scoped trusted CA; no production TLS or origin exception.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {DataSource} from 'typeorm';
import {localRouting} from '../../../web/scripts/lib/local-routing.mjs';
import {OidcTestService} from '../../dist/authentication/oidc-test.service.js';
import {OidcTestController} from '../../dist/authentication/oidc-test.controller.js';
import {ClinicianSessionService} from '../../dist/sessions/clinician-session.service.js';
import {AgencyDirectoryService} from '../../dist/sessions/agency-directory.service.js';
import {agencyRequest,browserOrigin} from '../../dist/sessions/agency-context.js';
import {CsrfGuard} from '../../dist/sessions/csrf.guard.js';
const db=new DataSource({type:'postgres',url:process.env.OIDC_TEST_DATABASE_URL,extra:{options:'-c role=open_triage_api_runtime'}});await db.initialize();
const sessions=new ClinicianSessionService(db),service=new OidcTestService(db,sessions,new AgencyDirectoryService(db)),controller=new OidcTestController(service),csrf=new CsrfGuard(sessions);
let browser,proxy;
const observations=[];
const api=createServer((request,response)=>agencyRequest.run({origin:browserOrigin({protocol:'http',headers:request.headers}),organizationId:request.headers['x-organization-id']},async()=>{
 const url=new URL(request.url,'http://localhost');
 const adapter={cookie(name,value,options){response.setHeader('set-cookie',`${name}=${value}; Path=${options.path}; HttpOnly; Secure; SameSite=${options.sameSite}; Max-Age=300`);},clearCookie(name,options){response.setHeader('set-cookie',`${name}=; Path=${options.path}; HttpOnly; Secure; SameSite=${options.sameSite}; Max-Age=0`);},redirect(code,destination){response.writeHead(code,{location:destination});response.end();}};
 try{
  if(url.pathname==='/api/admin/authentication/oidc/test'){
   observations.push({kind:'begin',cookie:request.headers.cookie});
   await csrf.canActivate({switchToHttp:()=>({getRequest:()=>({headers:request.headers,method:request.method,originalUrl:request.url})})});
   const result=await controller.begin({expectedRevision:4},request,undefined,adapter);response.setHeader('content-type','application/json');response.end(JSON.stringify(result));
  }else if(url.pathname==='/api/sessions/oidc/callback'){
   observations.push({kind:'callback',cookie:request.headers.cookie});await controller.callback({headers:request.headers,originalUrl:request.url,protocol:'http'},adapter);
  }else response.writeHead(404).end();
 }catch(error){response.writeHead(error.getStatus?.()??400).end('Rejected');}
}));
try{
 api.listen(0,'127.0.0.1');await once(api,'listening');
 const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:`http://127.0.0.1:${api.address().port}`,OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
 proxy=createServer((request,response)=>{if(route(request,response))return;response.setHeader('content-type','text/html');response.end(`<button id="start">Start test</button><script>document.querySelector('button').onclick=async()=>{const response=await fetch('/api/admin/authentication/oidc/test',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':${JSON.stringify(process.env.OIDC_TEST_CSRF)}}});if(response.ok)location.assign((await response.json()).authorizationUrl);else document.body.textContent='Rejected';};</script>`);});
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const origin=`http://child.localhost:${proxy.address().port}`;process.env.WEB_ORIGIN=`http://localhost:${proxy.address().port}`;process.env.NODE_ENV='development';
 browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();page.setDefaultTimeout(5000);
 await context.addCookies([{name:'open_triage_session',value:process.env.OIDC_TEST_SESSION_TOKEN,url:origin+'/api',httpOnly:true,secure:true,sameSite:'Strict'}]);
 await page.route('**/api/sessions/oidc/callback?*',route=>route.continue({headers:{...route.request().headers(),'x-organization-id':randomUUID()}}));
 await page.goto(origin);assert.equal(await page.evaluate(async()=> (await fetch('/api/admin/authentication/oidc/test',{method:'POST',headers:{'x-csrf-token':'wrong'}})).status),401);await page.click('#start');await page.getByRole('link',{name:'Continue fictional provider login'}).click();await page.waitForURL(url=>url.origin===origin&&url.pathname==='/'&&observations.some(item=>item.kind==='callback'));
 const cookies=await context.cookies();assert(!cookies.some(item=>item.name==='open_triage_oidc_test'));
 const callback=observations.find(item=>item.kind==='callback');assert.match(callback.cookie,/open_triage_oidc_test=/);
 // Strict application cookie is deliberately unavailable during IdP navigation.
 assert.doesNotMatch(callback.cookie,/open_triage_session=/);
 const [result]=await db.query("select result from app_identity.oidc_test_transaction order by completed_at desc nulls last limit 1");assert.equal(result.result,'succeeded');
 console.log(JSON.stringify({browserRedirect:true,callbackCookie:true,strictSessionCookie:true}));
}finally{await browser?.close();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}await db.destroy();}
