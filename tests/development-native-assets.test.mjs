import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';

test('development emits reachable JavaScript and CSS compatible with released native asset filters',{timeout:90000},async()=>{
 await mkdir(resolve('.local'),{recursive:true});
 const directory=await mkdtemp(join(resolve('.local'),'native-dev-assets-'));
 let child,output='';
 try{
  await mkdir(join(directory,'app'));
  await symlink(resolve('node_modules'),join(directory,'node_modules'),'dir');
  await writeFile(join(directory,'package.json'),JSON.stringify({private:true}));
  await writeFile(join(directory,'next.config.mjs'),`import config from ${JSON.stringify(new URL('../apps/web/next.config.ts',import.meta.url).href)};export default {...config,distDir:'.next',output:undefined,turbopack:{root:${JSON.stringify(resolve('.'))}}};`);
  await writeFile(join(directory,'app/layout.jsx'),"import './style.css';export default function Layout({children}){return <html><body>{children}</body></html>}");
  await writeFile(join(directory,'app/style.css'),'button{min-height:44px}');
  await writeFile(join(directory,'app/page.jsx'),"'use client';import{_ as wrap}from'@swc/helpers/_/_interop_require_default';export default function Page(){return <button>{wrap('Native development fixture').default}</button>}");
  const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const env={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',OPEN_TRIAGE_PUBLIC_SITE_HOST:''};
  for(const key of ['DEV_TLS_CERT_FILE','DEV_TLS_KEY_FILE','DEV_TLS_CA_FILE','OPEN_TRIAGE_E2E_DIST_DIR','TURBOPACK'])delete env[key];
  child=spawn(process.execPath,[resolve('apps/web/scripts/serve-development.mjs'),'--port',String(port),'--hostname','127.0.0.1'],{cwd:directory,env,detached:true,stdio:['ignore','pipe','pipe']});
  const record=chunk=>{output=(output+chunk).slice(-6000)};child.stdout.on('data',record);child.stderr.on('data',record);child.on('error',error=>record(error.message));
  const deadline=Date.now()+30000;let listening=false;
  while(Date.now()<deadline&&child.exitCode===null){
   listening=await new Promise(resolve=>{const socket=connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));});
   if(listening)break;await delay(100);
  }
  assert(listening,output);
  const origin=`http://127.0.0.1:${port}`,response=await fetch(origin,{signal:AbortSignal.timeout(45000)});assert.equal(response.status,200,output);
  const html=await response.text();assert(html.includes('Native development fixture'),output);
  const assets=[...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>new URL(match[1],origin)).filter(url=>url.pathname.startsWith('/_next/static/')&&/\.(js|css)$/.test(url.pathname)).map(url=>url.href))];
  assert(assets.some(url=>new URL(url).pathname.endsWith('.js')));assert(assets.some(url=>new URL(url).pathname.endsWith('.css')));
  for(const asset of assets){
   // RC9's published native filter predates support for scoped package names.
   assert.match(decodeURIComponent(new URL(asset).pathname),/^\/_next\/static\/[A-Za-z0-9_./()\[\]-]+$/,'Existing APKs must load every development asset');
   const reply=await fetch(asset,{signal:AbortSignal.timeout(10000)});assert.equal(reply.status,200,asset);
   assert.match(reply.headers.get('content-type'),new URL(asset).pathname.endsWith('.js')?/javascript/:/text\/css/);await reply.body.cancel();
  }
 }finally{
  const running=()=>child?.pid&&child.exitCode===null&&child.signalCode===null;
  const stop=signal=>{try{process.kill(-child.pid,signal)}catch(error){if(error.code!=='ESRCH')throw error}};
  if(running()){stop('SIGTERM');await Promise.race([once(child,'exit'),delay(5000)]);if(running())stop('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
 }
});
