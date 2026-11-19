import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import legacy from './fixtures/android-published-legacy-releases.json' with {type:'json'};
import {latestApprovedAndroidRelease,syntheticApprovedAndroidRelease,androidPolicyTestCatalog} from './helpers/android-release-fixtures.mjs';
import { androidApkArtifactName, approvedAndroidReleaseUrl, parseAndroidReleaseDescriptor } from '@open-triage/contracts/android-release';

test('new APK names contain the version once while metadata verifies bytes and historical artifacts remain valid',()=>{
 assert.equal(androidApkArtifactName('0.1.0-rc.6'),'opentriage-0.1.0-rc.6.apk');
 for(const name of ['', '../0.1.0', '0.1.0/extra', '0.1.0?download=1'])assert.throws(()=>androidApkArtifactName(name));
 const previous=catalog.releases[0].descriptor;
 assert.deepEqual(parseAndroidReleaseDescriptor(previous),previous);
 const short={...previous,artifact:androidApkArtifactName(previous.versionName)};
 assert.deepEqual(parseAndroidReleaseDescriptor(short),short);
 for(const artifact of ['../'+short.artifact,'opentriage-9.9.9.apk','opentriage-'+previous.versionName+'-wrong.apk','opentriage-'+previous.versionName+'-'+previous.versionCode+'-'+'0'.repeat(64)+'.apk'])assert.throws(()=>parseAndroidReleaseDescriptor({...short,artifact}));
 assert.throws(()=>parseAndroidReleaseDescriptor({...short,apkSha256:'invalid'}));
});

test('every approved catalog entry preserves the owned signing identity and immutable versioned artifact URL',async()=>{
 const identity=JSON.parse(await readFile(new URL('../docs/releases/android/signing-identity.json',import.meta.url),'utf8'));
 assert.equal(catalog.schemaVersion,1);
 assert.deepEqual(catalog.signingIdentity,{applicationId:identity.applicationId,certificateSha256:identity.certificateSha256});
 const codes=new Set(),tags=new Set();
 for(const entry of catalog.releases){
  const descriptor=parseAndroidReleaseDescriptor(entry.descriptor);
  assert.equal(descriptor.applicationId,identity.applicationId);assert.equal(descriptor.certificateSha256,identity.certificateSha256);
  assert.equal(entry.downloadUrl,approvedAndroidReleaseUrl(entry.tag,descriptor));
  assert(!codes.has(descriptor.versionCode)&&!tags.has(entry.tag),'Catalog identities must be unambiguous');codes.add(descriptor.versionCode);tags.add(entry.tag);
 }
});

test('superseded candidates remain offline test evidence and cannot be selected as approved downloads',()=>{
 assert.deepEqual(catalog.signingIdentity,legacy.signingIdentity);
 assert(catalog.releases.some(entry=>entry.tag==='android-v9-0.1.0-rc.9'));
 assert.deepEqual(legacy.releases.map(entry=>entry.descriptor.versionCode),[8,6,5,4,2,1]);
 for(const entry of legacy.releases){
  assert.deepEqual(parseAndroidReleaseDescriptor(entry.descriptor),entry.descriptor);
  assert.equal(entry.downloadUrl,approvedAndroidReleaseUrl(entry.tag,entry.descriptor));
  assert(!catalog.releases.some(current=>current.tag===entry.tag||current.descriptor.versionCode===entry.descriptor.versionCode));
 }
});

test('historical policy fixtures preserve client coverage without changing production approvals',()=>{
 const original=structuredClone(catalog),isolated=androidPolicyTestCatalog();
 assert.deepEqual(isolated.releases[0],catalog.releases[0]);
 assert.deepEqual(new Set(isolated.releases.map(entry=>entry.descriptor.versionCode)),new Set([...catalog.releases,...legacy.releases].map(entry=>entry.descriptor.versionCode)));
 isolated.releases[0].descriptor.apkSha256='0'.repeat(64);
 isolated.releases.at(-1).descriptor.apkSha256='0'.repeat(64);
 assert.deepEqual(catalog,original);assert.notEqual(legacy.releases.at(-1).descriptor.apkSha256,'0'.repeat(64));
});

test('shared release fixtures use the current committed version and preserve its capability contract',()=>{
 const selected=latestApprovedAndroidRelease();
 assert.equal(selected.descriptor.versionCode,Math.max(...catalog.releases.map(entry=>entry.descriptor.versionCode)));
 for(const entry of catalog.releases){
  const fixture=syntheticApprovedAndroidRelease(Buffer.from('synthetic catalog transport bytes'),entry);
  assert.equal(fixture.tag,entry.tag);assert.equal(fixture.descriptor.versionCode,entry.descriptor.versionCode);
  assert.equal(fixture.descriptor.versionName,entry.descriptor.versionName);
  assert.deepEqual(fixture.descriptor.compatibility,entry.descriptor.compatibility);
  assert.equal(fixture.downloadUrl,approvedAndroidReleaseUrl(entry.tag,parseAndroidReleaseDescriptor(fixture.descriptor)));
 }
});

test('early Android release gates run from source runtime modules without any compiled contract output',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'opentriage-release-cold-'));
 try{
  const root=new URL('../',import.meta.url), contracts=join(directory,'node_modules/@open-triage/contracts');
  await mkdir(contracts,{recursive:true});await mkdir(join(directory,'scripts/android'),{recursive:true});await mkdir(join(directory,'tests'));
  for(const name of await readdir(new URL('packages/contracts/',root)))if(/\.(?:mjs|cjs|json)$/.test(name))await cp(new URL(`packages/contracts/${name}`,root),join(contracts,name));
  await cp(new URL('scripts/android/release-contract.mjs',root),join(directory,'scripts/android/release-contract.mjs'));
  await cp(new URL('tests/android-release.test.mjs',root),join(directory,'tests/android-release.test.mjs'));
  // A nested runner must not inherit the parent's private test-worker channel.
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/android-release.test.mjs'],{cwd:directory,env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`Cold release validation imported an unavailable build output: ${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout,/# tests [1-9][0-9]*/);assert.match(result.stdout,/# fail 0/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
