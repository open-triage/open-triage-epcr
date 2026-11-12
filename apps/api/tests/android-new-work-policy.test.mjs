import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {AndroidUpgradePolicyService,prepareAndroidNewWork} from '../dist/admin/android-upgrade-policy.service.js';
import {agencyRequest} from '../dist/sessions/agency-context.js';
import {legacyAndroidAgent,agencyContextMiddleware} from '../dist/sessions/agency-context.middleware.js';
const ua='Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone64_x86_64 Build/TE1A.220922.010)';
function fixture({native=false,retired=false,days=90,unsupported=false,missingBaseline=false}={}) {
 const releases=structuredClone(catalog),queries=[];
 if(missingBaseline)releases.releases=releases.releases.filter(e=>e.descriptor.versionCode!==1);
 if(unsupported)releases.releases.find(e=>e.descriptor.versionCode===1).descriptor.compatibility.requiredCapabilities=['not-supported'];
 const replacement={status:'available',tag:releases.releases[0].tag,descriptor:releases.releases[0].descriptor,downloadUrl:releases.releases[0].downloadUrl};
 const manager={query:async(sql)=>{queries.push(sql);return sql.includes('as native')?[{native}]:[{grace_days:days,revision:1,updated_at:'2026-01-01T00:00:00.000Z'}];}};
 const service=new AndroidUpgradePolicyService({manager},{},{verifiedSelection:async()=>replacement,currentVerifiedSelection:()=>replacement},{},releases,{schemaVersion:1,retirements:retired?[{versionCode:1,supersededAt:'2000-01-01T00:00:00.000Z',replacementTag:replacement.tag}]:[]});
 return {service,manager,queries};
}
async function evaluate(options,context) {
 const f=fixture(options);return agencyRequest.run({origin:'https://test.example',...context},async()=>{
  const lock=await prepareAndroidNewWork(f.service,'current-valid-login');const assertNew=await lock(f.manager);return {assertNew,...f};
 });
}
test('Android legacy HTTP signal is bounded and excludes ordinary Android Chrome/WebView browsers',()=>{
 assert(legacyAndroidAgent(ua));
 for(const value of [undefined,'Dalvik/2.1.0','x'+ua,ua+'\r\nInjected: x','Dalvik/2.1.0 (Linux; U; Android '+ 'a'.repeat(600)+')','Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/109.0.0.0 Mobile Safari/537.36'])assert(!legacyAndroidAgent(value));
});
test('deployed middleware preserves exact native version and narrowly classified legacy signal',()=>{
 let value;agencyContextMiddleware({protocol:'https',headers:{host:'test.example','user-agent':ua,'x-opentriage-android-version':'2'}},{status(){throw Error('unexpected invalid origin');}},()=>{value=agencyRequest.getStore();});
 assert.equal(value.androidVersion,'2');assert.equal(value.legacyAndroid,true);
});
test('ordinary browser new work remains unaffected by APK retirement',async()=>{
 const {assertNew,queries}=await evaluate({retired:true},{});assert.equal(await assertNew(),undefined);assert(!queries.some(sql=>sql.includes('for share')));
});
test('declared current Android remains compatible while legacy retirement expires',async()=>{
 const {assertNew,queries}=await evaluate({retired:true},{androidVersion:'2'});assert.equal((await assertNew()).status,'compatible');assert(queries.some(sql=>sql.endsWith('for share')));
});
test('oldest approved legacy APK can start before retirement and cannot start after retirement',async()=>{
 const supported=await evaluate({}, {legacyAndroid:true});assert.equal((await supported.assertNew()).versionCode,1);assert.equal((await supported.assertNew()).metadata,'legacy-baseline');
 const retired=await evaluate({retired:true}, {legacyAndroid:true});await assert.rejects(retired.assertNew,error=>error.getStatus()===426&&error.getResponse().versionCode===1&&error.getResponse().metadata==='legacy-baseline');
});
for(const context of [{},{legacyAndroid:true}])test(`known native provenance cannot evade retirement by omitting metadata: ${JSON.stringify(context)}`,async()=>{
 const {assertNew}=await evaluate({native:true},context);await assert.rejects(assertNew,error=>error.getStatus()===426&&error.getResponse().reason==='invalid-client');
});
for(const value of ['', '0','01','1.0','999','2147483648','1\r\n'])test(`invalid or unknown declared Android version cannot fall back to legacy baseline: ${JSON.stringify(value)}`,async()=>{
 const {assertNew}=await evaluate({native:false},{androidVersion:value,legacyAndroid:true});await assert.rejects(assertNew,error=>error.getStatus()===426);
});
test('legacy fallback never chooses latest when immutable baseline is absent or unsupported',async()=>{
 for(const options of [{missingBaseline:true},{unsupported:true}]){
  const {assertNew}=await evaluate(options,{legacyAndroid:true});await assert.rejects(assertNew,error=>error.getStatus()===426);
 }
});
test('retirement is sampled at actual new-work assertion, and does not itself fail existing-work/replay transaction setup',async()=>{
 const {assertNew}=await evaluate({retired:true},{androidVersion:'1'});
 // Holding the shared lock is deliberately not a retirement rejection. Existing report/replay paths skip assertion.
 await assert.rejects(assertNew,error=>error.getStatus()===426);
});
test('declared Android fails closed when an isolated host omits the policy provider',async()=>{
 await agencyRequest.run({origin:'https://test.example',androidVersion:'2'},()=>assert.rejects(prepareAndroidNewWork(undefined,'session'),error=>error.getStatus()===503));
});

test('a newly committed native enrollment cannot evade metadata enforcement between preflight and report insertion',async()=>{
 const f=fixture();
 await agencyRequest.run({origin:'https://test.example'},async()=>{
  const lock=await prepareAndroidNewWork(f.service,'live-personal-session');
  const assertNew=await lock({query:async()=>[{native:true}]});
  await assert.rejects(assertNew,error=>error.getStatus()===426&&error.getResponse().reason==='invalid-client');
 });
});
