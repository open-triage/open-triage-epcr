import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, get as httpGet } from 'node:http';
import { get } from 'node:https';
import { once } from 'node:events';
import { developmentServer } from '../apps/web/scripts/lib/development-tls.mjs';
import { localRouting } from '../apps/web/scripts/lib/local-routing.mjs';
import { waitForHttp } from '../scripts/dev-local.mjs';

test('one HTTPS edge serves the app and API with verified local trust and the original agency identity', async t => {
  const directory=await mkdtemp(join(tmpdir(),'development-tls-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const pfx=fileURLToPath(new URL('../android/app/src/test/resources/tls/server.p12',import.meta.url));
  const extract=flag=>execFileSync('openssl',['pkcs12','-in',pfx,'-passin','pass:synthetic-only',...flag],{encoding:'utf8'});
  const cert=join(directory,'cert.pem'),key=join(directory,'key.pem');
  await writeFile(cert,extract(['-clcerts','-nokeys']));
  await writeFile(key,extract(['-nocerts','-nodes']),{mode:0o600});
  const ca=await readFile(new URL('../android/app/src/test/resources/tls/ca.pem',import.meta.url));
  const upstream=createServer((req,res)=>res.end(JSON.stringify({status:'ok',host:req.headers.host,protocol:req.headers['x-forwarded-proto']}))).listen(0,'127.0.0.1');
  await once(upstream,'listening');t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const route=localRouting({OPEN_TRIAGE_API_UPSTREAM:`http://127.0.0.1:${upstream.address().port}`,OPEN_TRIAGE_PUBLIC_SITE_HOST:''});
  const server=developmentServer((req,res)=>{if(!route(req,res))res.end('application');},{DEV_TLS_CERT_FILE:cert,DEV_TLS_KEY_FILE:key});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`https://localhost:${server.address().port}`;
  const redirected=await new Promise((resolve,reject)=>httpGet(origin.replace('https:','http:')+'/enroll/?test=1',res=>{
    res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));
  }).on('error',reject));
  assert.deepEqual(redirected,{status:307,location:origin+'/enroll/?test=1'});
  const agencyRedirect=await new Promise((resolve,reject)=>httpGet(origin.replace('https:','http:')+'/',{headers:{host:'demo.localhost:3000'}},res=>{
    res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));
  }).on('error',reject));
  assert.deepEqual(agencyRedirect,{status:307,location:'https://demo.localhost:3000/'});
  const call=path=>new Promise((resolve,reject)=>get(origin+path,{ca,headers:{host:'localhost:3000','x-forwarded-proto':'forged'}},res=>{
    let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));
  }).on('error',reject));
  assert.equal(await call('/'),'application');
  assert.deepEqual(JSON.parse(await call('/api/health')),{status:'ok',host:'localhost:3000',protocol:'https'});
  await waitForHttp(origin+'/api/health',{api:true,ca,timeoutMs:1000});
  server.on('upgrade',(_request,socket)=>socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
  await new Promise((resolve,reject)=>get(origin+'/_next/webpack-hmr',{ca,headers:{Connection:'Upgrade',Upgrade:'websocket'}},()=>reject(new Error('Upgrade was not forwarded')))
    .on('upgrade',(response,socket)=>{socket.destroy();assert.equal(response.statusCode,101);resolve();}).on('error',reject));
  await assert.rejects(waitForHttp(origin,{timeoutMs:20}),/Startup timed out/);
  assert.throws(()=>developmentServer(()=>{},{DEV_TLS_CERT_FILE:cert}),/Configure both/);
});
