import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {ANDROID_CLIENT_REQUIRED_CAPABILITIES} from '../packages/contracts/android-client-protocol.mjs';
import {realContractsSourcePlugin,assertUnbuiltWorkspaceInputs} from './helpers/unbuilt-contracts.mjs';

const bundled=await build({bundle:true,write:false,metafile:true,format:'cjs',platform:'node',define:{'process.env.NEXT_PUBLIC_API_URL':'"same-origin"'},plugins:[realContractsSourcePlugin(),{name:'native-continuation',setup(builder){
 builder.onResolve({filter:/^\.\/protected-clinical-storage$/},args=>args.importer.endsWith('/clinician-session.ts')?{path:'settlement',namespace:'held-storage'}:undefined);
 builder.onLoad({filter:/.*/,namespace:'held-storage'},()=>({contents:'export async function lockProtectedClinicalStorage(){return globalThis.continuationFixture.lock?.();}'}));
 builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'test'}));
 builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};export const registerPlugin=()=>({resumePersonalSession:options=>globalThis.continuationFixture.resume(options)});`}));
}}],stdin:{resolveDir:process.cwd(),contents:"export{authenticateRestartedClinicianSession,resumeInterruptedNativeClinicianSession}from'./apps/web/app/clinician-session';export{configureNativeConnection}from'./apps/web/app/android-runtime';"}});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
const api=module.exports;
test('early personal continuation regressions consume real contracts sources without generated outputs',()=>{assertUnbuiltWorkspaceInputs(bundled.metafile);});
const session={csrfToken:'c'.repeat(43),user:{id:'principal',displayName:'Current server name'},organization:{id:'agency'},capabilities:['current:role'],expiresAt:'2098-01-01T00:00:00Z',startedAt:'2026-01-01T00:00:00Z',personallyAuthenticatedAt:'2026-01-01T00:00:00Z'};
function fixture(resume){const entries=new Map();const priorWindow=globalThis.window,priorFetch=globalThis.fetch;globalThis.window={localStorage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)},location:{origin:'https://localhost',href:'https://localhost/'},dispatchEvent:()=>true};globalThis.continuationFixture={resume};api.configureNativeConnection({configured:true,origin:'https://source.example',storageScope:'A'.repeat(43),connectionContext:'current-context'});return{entries,restore(){globalThis.window=priorWindow;globalThis.fetch=priorFetch;delete globalThis.continuationFixture}};}

test('complete public session loss restores fresh native authority without credentials or cached roles',async()=>{
 const f=fixture(async options=>{assert.equal(options.connectionContext,'current-context');return{session:structuredClone(session)}});
 try{globalThis.fetch=()=>{throw Error('No new primary login may be dispatched')};const result=await api.resumeInterruptedNativeClinicianSession();assert.deepEqual(result,session);assert.deepEqual(JSON.parse(f.entries.get('open-triage.clinician-session.v1')),session);}finally{f.restore();}
});
test('a legacy public candidate migrates only through a successful CSRF-guarded current POST',async()=>{
 const f=fixture(async()=>({}));
 try{globalThis.fetch=async(url,options)=>{assert.match(url,/\/api\/sessions\/current\/continuation$/);assert.equal(options.method,'POST');assert.equal(new Headers(options.headers).get('x-csrf-token'),session.csrfToken);return Response.json({...session,csrfToken:undefined})};assert.deepEqual(await api.authenticateRestartedClinicianSession({...session,capabilities:['stale:role'],expiresAt:'2099-01-01T00:00:00Z'}),session);}finally{f.restore();}
});
test('stale public identity A cannot veto sealed native identity B after fresh server validation',async()=>{
 const f=fixture(async()=>({session:structuredClone(session)}));
 try{
  const stale={...structuredClone(session),user:{id:'old-public-user',displayName:'Old cached identity'},capabilities:['old:role']};
  f.entries.set('open-triage.clinician-session.v1',JSON.stringify(stale));
  const restored=await api.authenticateRestartedClinicianSession(stale);
  assert.deepEqual(restored,session);
  assert.deepEqual(JSON.parse(f.entries.get('open-triage.clinician-session.v1')),session);
  assert.equal(f.entries.get('open-triage.installation-generation.v1'),undefined);
 }finally{f.restore();}
});
for(const change of ['generation','context'])test(`native identity adoption cannot publish after ${change} changes during old-key settlement`,async()=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve),f=fixture(async()=>({session:structuredClone(session)}));
 try{
  const stale={...structuredClone(session),user:{id:'old-public-user'}};f.entries.set('open-triage.clinician-session.v1',JSON.stringify(stale));
  globalThis.continuationFixture.lock=()=>{entered();return new Promise(resolve=>release=resolve)};
  const pending=api.authenticateRestartedClinicianSession(stale);await ready;
  if(change==='generation')f.entries.set('open-triage.installation-generation.v1','enrollment:newer');else api.configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'newer-context'});
  release();await assert.rejects(pending);assert.deepEqual(JSON.parse(f.entries.get('open-triage.clinician-session.v1')),stale);
 }finally{f.restore();}
});
test('old-key settlement failure cannot publish the new native identity',async()=>{
 const f=fixture(async()=>({session:structuredClone(session)}));try{const stale={...structuredClone(session),user:{id:'old-public-user'}};f.entries.set('open-triage.clinician-session.v1',JSON.stringify(stale));globalThis.continuationFixture.lock=async()=>{throw Error('synthetic key settlement failure')};await assert.rejects(api.authenticateRestartedClinicianSession(stale),/settlement failure/);assert.deepEqual(JSON.parse(f.entries.get('open-triage.clinician-session.v1')),stale);}finally{f.restore();}
});
test('public cache changes do not excuse a current old-view settlement failure but newer native contexts supersede it',async()=>{
 const f=fixture(async()=>({session:structuredClone(session)}));try{const stale={...structuredClone(session),user:{id:'old-public-user'}};f.entries.set('open-triage.clinician-session.v1',JSON.stringify(stale));globalThis.continuationFixture.lock=async()=>{f.entries.set('open-triage.clinician-session.v1','new-public-bytes');throw Error('synthetic key settlement failure')};let failure;try{await api.authenticateRestartedClinicianSession(stale)}catch(error){failure=error}assert(failure);assert.equal(failure.isCurrent(),true);assert.equal(failure.ownsPublicMetadata(),false);api.configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'newer-context'});assert.equal(failure.isCurrent(),false);assert.equal(f.entries.get('open-triage.clinician-session.v1'),'new-public-bytes');}finally{f.restore();}
});
for(const field of ['user','organization'])test(`legacy public ${field} mismatch remains denied without sealed native authority`,async()=>{
 const f=fixture(async()=>({}));try{globalThis.fetch=async()=>Response.json(session);const candidate=structuredClone(session);candidate[field].id='different';assert.equal(await api.authenticateRestartedClinicianSession(candidate),null);}finally{f.restore();}
});
test('an absent or rejected native continuation cannot revive missing public metadata',async()=>{const f=fixture(async()=>({}));try{assert.equal(await api.resumeInterruptedNativeClinicianSession(),null);assert.equal(f.entries.has('open-triage.clinician-session.v1'),false);}finally{f.restore();}});
test('an explicitly unavailable native context cannot fall back to public metadata or a guarded migration',async()=>{const f=fixture(async()=>({unavailable:true}));try{f.entries.set('open-triage.installation-session-candidate.v1',JSON.stringify({generation:null,session}));globalThis.fetch=()=>{throw Error('No migration may bypass a pending transition')};assert.equal(await api.resumeInterruptedNativeClinicianSession(),null);assert.equal(await api.authenticateRestartedClinicianSession(session),null);assert.equal(f.entries.has('open-triage.clinician-session.v1'),false);}finally{f.restore();}});
test('a late native continuation cannot cross a newer installation generation',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>release=resolve));try{const pending=api.resumeInterruptedNativeClinicianSession();f.entries.set('open-triage.installation-generation.v1','enrollment:newer');release({session});await assert.rejects(pending);assert.equal(f.entries.has('open-triage.clinician-session.v1'),false);}finally{f.restore();}
});
for(const stored of [false,true])test(`a held native reply cannot cross a new connection even without a new JS generation (${stored?'existing metadata':'missing metadata'})`,async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>release=resolve));
 try{
  const pending=stored?api.authenticateRestartedClinicianSession(session):api.resumeInterruptedNativeClinicianSession();
  api.configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'newer-context'});
  assert.equal(f.entries.get('open-triage.installation-generation.v1'),undefined);
  release({session});if(stored)assert.equal(await pending,null);else await assert.rejects(pending);
  assert.equal(f.entries.has('open-triage.clinician-session.v1'),false);
 }finally{f.restore();}
});
test('a held legacy migration body cannot restore authority after a native connection change',async()=>{
 let release,started;const ready=new Promise(resolve=>started=resolve),f=fixture(async()=>({}));
 try{globalThis.fetch=async()=>({ok:true,status:200,json:()=>{started();return new Promise(resolve=>release=resolve)}});const pending=api.authenticateRestartedClinicianSession(session);await ready;
  api.configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'newer-context'});release(session);assert.equal(await pending,null);assert.equal(f.entries.has('open-triage.clinician-session.v1'),false);
 }finally{f.restore();}
});
test('actual process-restart acceptance deliberately removes public metadata only after native login is durable',()=>{
 const source=readFileSync(new URL('../android/app/src/androidTest/java/org/opentriage/development/AgencyHandoffJourneyTest.java',import.meta.url),'utf8');
 assert.match(source,/Successful native login commits continuation before public metadata may disappear/);assert.match(source,/status\("source_cookie_sha256"[^\n]+\n\s+losePublicSessionMetadata\(\)/);assert.match(source,/verifySuperuser\([^\n]+losePublicSessionMetadata\(\)/);
 assert.match(source,/JSONObject oldPublic=new JSONObject/);assert.match(source,/logout\(true\);login\([^\n]+\n\s+stalePublicIdentityCannotVetoCurrentNativeLogin\(oldPublic\)/);
 assert.match(source,/Collections.singleton\("https:\/\/localhost"\)/);assert.match(source,/const reply=send.apply\(this,arguments\)/);assert.match(source,/return reply;/);assert.match(source,/finally\{if\(handler\[0\]!=null\)/);
 assert.match(source,/fresh-JS-startup-not-process-death/);assert.match(source,/unchanged\(before\);bundled\(\)/);
});
test('native new-destination compatibility requires exactly the shared current descriptor capabilities',()=>{
 const source=readFileSync(new URL('../android/app/src/main/java/org/opentriage/development/NativeApiCompatibility.java',import.meta.url),'utf8');
 const required=[...source.match(/String\[\] REQUIRED = \{([^}]+)\}/)[1].matchAll(/"([^"]+)"/g)].map(value=>value[1]);
 assert.deepEqual(required,ANDROID_CLIENT_REQUIRED_CAPABILITIES);
});
