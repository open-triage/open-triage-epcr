import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {parseAndroidReleaseDescriptor,approvedAndroidReleaseUrl} from '@open-triage/contracts/android-release';

/** Exact local APK bytes exercise the production verifier through its existing DI boundary.
 * No synthetic retirement, local fetcher or catalog enters the production entry point. */
export async function upgradePolicyFixture(input) {
 const a=parseAndroidReleaseDescriptor(input.releaseA),b=parseAndroidReleaseDescriptor(input.releaseB);
 const approved=structuredClone(catalog);
 assert.equal(a.applicationId,approved.signingIdentity.applicationId);
 assert.equal(a.certificateSha256,approved.signingIdentity.certificateSha256);
 assert.equal(b.applicationId,a.applicationId);assert.equal(b.certificateSha256,a.certificateSha256);
 assert(b.versionCode>a.versionCode);
 assert(b.compatibility.requiredCapabilities?.includes('android-upgrade-gate-v1'),'Current upgrade consumer must require server enforcement');
 const original=approved.releases.find(entry=>entry.descriptor.versionCode===a.versionCode);
 assert.deepEqual(original?.descriptor,a,'Oldest production APK descriptor must remain immutable');
 const tag=`android-candidate-${b.versionCode}-${b.versionName}`,url=approvedAndroidReleaseUrl(tag,b);
 const existing=approved.releases.find(entry=>entry.descriptor.versionCode===b.versionCode);
 if(existing)assert.deepEqual(existing.descriptor,b,'Do not replace a published version descriptor');
 else approved.releases.push({tag,descriptor:b,downloadUrl:url});
 const bytes=await readFile(input.apkBPath);
 assert.equal(bytes.length,b.apkBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),b.apkSha256);
 const lifecycle={schemaVersion:1,retirements:[]};
 return {approved,lifecycle,tag,retire:()=>{
   if(!lifecycle.retirements.length)lifecycle.retirements.push({versionCode:a.versionCode,supersededAt:'2000-01-01T00:00:00.000Z',replacementTag:tag});
 },fetcher:async target=>{assert.equal(String(target),url,'Fixture verifies only exact approved replacement bytes');return new Response(bytes,{headers:{'content-length':String(bytes.length)}});}};
}
