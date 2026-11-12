import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import { isAndroidReleaseCompatible, parseAndroidReleaseDescriptor } from '@open-triage/contracts';
import { verifyAndroidArtifact } from '@open-triage/contracts/android-artifact';
import { AndroidReleaseService } from '../dist/admin/android-release.service.js';
import { AndroidReleaseController } from '../dist/admin/android-release.controller.js';

const payload=Buffer.from('synthetic APK verification bytes'), digest=createHash('sha256').update(payload).digest('hex');
const fixture=()=>{const value=structuredClone(catalog);const d=value.releases[0].descriptor;d.apkBytes=payload.length;d.apkSha256=digest;d.artifact=`opentriage-${d.versionName}-${d.versionCode}-${digest}.apk`;value.releases[0].downloadUrl=`https://github.com/open-triage/open-triage-epcr/releases/download/${value.releases[0].tag}/${d.artifact}`;return value;};
const selected=catalog.releases[0].tag;
async function selection(work){const previous=process.env.ANDROID_APPROVED_RELEASE;try{process.env.ANDROID_APPROVED_RELEASE=selected;await work();}finally{if(previous===undefined)delete process.env.ANDROID_APPROVED_RELEASE;else process.env.ANDROID_APPROVED_RELEASE=previous;}}

test('approved release requires current read capability before verification or cached metadata; all agencies share exact bytes',()=>selection(async()=>{
 let reads=0,denied=false;const capabilities=[];
 const service=new AndroidReleaseService({requireCapability:async(token,cap)=>{capabilities.push([token,cap]);if(denied)throw new UnauthorizedException();}},async()=>{reads++;return new Response(payload,{headers:{'content-length':String(payload.length)}});},fixture());
 const [a,b]=await Promise.all([service.read('read-only-agency-a'),service.read('read-only-agency-b')]);
 assert.deepEqual(a,b);assert.equal(a.status,'available');assert.equal(a.descriptor.apkSha256,digest);assert.equal(reads,1);
 assert(capabilities.every(([,cap])=>cap==='settings:read'));
 denied=true;await assert.rejects(service.read('revoked'),error=>error.getStatus()===401);assert.equal(reads,1);
}));

test('missing selection, malformed approval, wrong identity, unsupported protocol/capability and absent artifact never advertise latest',()=>selection(async()=>{
 const sessions={requireCapability:async()=>{}};let fetches=0;
 const fetcher=async()=>{fetches++;return new Response(payload);};
 delete process.env.ANDROID_APPROVED_RELEASE;
 assert.deepEqual(await new AndroidReleaseService(sessions,fetcher,fixture()).read('admin'),{status:'unavailable',reason:'not-selected'});
 process.env.ANDROID_APPROVED_RELEASE='unreviewed-latest';
 assert.equal((await new AndroidReleaseService(sessions,fetcher,fixture()).read('admin')).reason,'unverified');
 process.env.ANDROID_APPROVED_RELEASE=selected;
 for(const change of [c=>c.releases[0].descriptor.certificateSha256='f'.repeat(64),c=>c.releases[0].downloadUrl='https://attacker.invalid/file.apk',c=>c.releases[0].descriptor.apkBytes=129*1024*1024]){
  const c=fixture();change(c);assert.equal((await new AndroidReleaseService(sessions,fetcher,c).read('admin')).reason,'unverified');
 }
 for(const change of [c=>c.releases[0].descriptor.compatibility.api={minimum:2,maximum:2},c=>c.releases[0].descriptor.compatibility.requiredCapabilities=['synthetic-unimplemented-feature-v1']]){
  const c=fixture();change(c);assert.equal((await new AndroidReleaseService(sessions,fetcher,c).read('admin')).reason,'incompatible');
 }
 assert.equal(fetches,0);
 assert.equal((await new AndroidReleaseService(sessions,async()=>new Response(null,{status:404}),fixture()).read('admin')).reason,'unavailable');
 assert.equal((await new AndroidReleaseService(sessions,async()=>new Response(Buffer.from('wrong')),fixture()).read('admin')).reason,'unavailable');
}));

test('artifact transport follows only approved public CDN redirects, sends no session, and bounds/challenges every byte',async()=>{
 const url=fixture().releases[0].downloadUrl;let calls=0;
 await verifyAndroidArtifact(url,payload.length,digest,async(target,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.cookie,undefined);
  if(calls===1)return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/approved/signed.apk?public=1'}});
  assert.match(target,/^https:\/\/release-assets\.githubusercontent\.com\//);return new Response(payload);
 });assert.equal(calls,2);
 for(const location of ['http://release-assets.githubusercontent.com/file','https://attacker.invalid/file','https://release-assets.githubusercontent.com:8443/file','https://user:pass@release-assets.githubusercontent.com/file']){
  let attempts=0;await assert.rejects(verifyAndroidArtifact(url,payload.length,digest,async()=>{attempts++;return new Response(null,{status:302,headers:{location}});}));assert.equal(attempts,1);
 }
 for(const response of [()=>new Response(payload.subarray(1)),()=>new Response(Buffer.concat([payload,Buffer.from('extra')])),()=>new Response(payload,{headers:{'content-length':'999999999'}})])await assert.rejects(verifyAndroidArtifact(url,payload.length,digest,async()=>response()));
 await assert.rejects(verifyAndroidArtifact(url,payload.length,'0'.repeat(64),async()=>new Response(payload)));
});

test('legacy descriptors remain compatible while missing required native capabilities fail closed',()=>{
 const descriptor=parseAndroidReleaseDescriptor(catalog.releases[0].descriptor);
 assert(isAndroidReleaseCompatible(descriptor,1));
 const extended={...descriptor,compatibility:{...descriptor.compatibility,requiredCapabilities:['native-enrollment-attempt-v1','native-oidc-return-v1']}};
 assert.equal(isAndroidReleaseCompatible(extended,1,[]),false);assert.equal(isAndroidReleaseCompatible(extended,1,['native-enrollment-attempt-v1']),false);
 assert.equal(isAndroidReleaseCompatible({...extended,upgradeGraceDays:365},1,[]),false);
 for(const field of ['pairingArtifact','protectedReportSchema','recoveryEnvelope'])assert.equal(isAndroidReleaseCompatible({...descriptor,compatibility:{...descriptor.compatibility,[field]:2}},1,[]),false);
 assert(isAndroidReleaseCompatible(extended,1,['native-enrollment-attempt-v1','native-oidc-return-v1']));
 assert.equal(isAndroidReleaseCompatible(extended,2,['native-enrollment-attempt-v1','native-oidc-return-v1']),false);
 for(const requiredCapabilities of [['invalid capability'],['x','x'],Array(33).fill('x'),null])assert.throws(()=>parseAndroidReleaseDescriptor({...descriptor,compatibility:{...descriptor.compatibility,requiredCapabilities}}));
});

test('actual HTTP Admin endpoint uses cookie/session authorization, private no-store metadata and no write or reauthentication path',()=>selection(async()=>{
 const sessions={requireCapability:async(token,cap)=>{assert.equal(cap,'settings:read');if(!['reader-a','reader-b'].includes(token))throw new UnauthorizedException();}};
 const service=new AndroidReleaseService(sessions,async()=>new Response(payload),fixture());
 class FixtureModule{};Module({controllers:[AndroidReleaseController],providers:[{provide:AndroidReleaseService,useValue:service}]})(FixtureModule);
 const app=await NestFactory.create(FixtureModule,{logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');
 try{
  const url=`http://127.0.0.1:${app.getHttpServer().address().port}/api/admin/android/release`;
  for(const cookie of [undefined,'open_triage_session=revoked','open_triage_session=clinician'])assert.equal((await fetch(url,{headers:cookie?{cookie}:{}})).status,401);
  const response=await fetch(url,{headers:{cookie:'open_triage_session=reader-a'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');const a=await response.json();
  const b=await(await fetch(url,{headers:{authorization:'Bearer reader-b'}})).json();assert.deepEqual(a,b);assert.equal(a.descriptor.apkSha256,digest);
  assert.equal((await fetch(url,{method:'PUT',headers:{cookie:'open_triage_session=reader-a'}})).status,404);
 }finally{await app.close();}
}));

test('implemented OIDC and enrollment capabilities permit verified future descriptors',()=>selection(async()=>{
 const catalog=fixture();catalog.releases[0].descriptor.compatibility.requiredCapabilities=['native-enrollment-attempt-v1','native-oidc-return-v1'];
 const service=new AndroidReleaseService({requireCapability:async()=>{}},async()=>new Response(payload),catalog);
 assert.equal((await service.read('authorized-reader')).status,'available');
}));
