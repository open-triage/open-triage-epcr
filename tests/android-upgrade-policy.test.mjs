import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import lifecycle from '@open-triage/contracts/config/android-release-lifecycle.json' with {type:'json'};
import {isAndroidReleaseCompatible} from '@open-triage/contracts/android-release';
import {evaluateAndroidUpgrade,parseAndroidReleaseLifecycle,parseAndroidUpgradeGraceDays} from '@open-triage/contracts/android-upgrade-policy';
import {ANDROID_API_PROTOCOL_VERSION,ANDROID_API_CAPABILITIES} from '@open-triage/contracts/android-client-protocol';
const retired={versionCode:1,supersededAt:'2026-01-01T00:00:00.000Z',replacementTag:catalog.releases[0].tag};
const replacement={status:'available',...catalog.releases[0]};
const input={versionCode:1,releases:catalog.releases,retirements:[retired],graceDays:90,serverTime:'2026-03-31T23:59:59.999Z',serverProtocol:ANDROID_API_PROTOCOL_VERSION,serverCapabilities:ANDROID_API_CAPABILITIES,replacement};
test('server-clock grace uses fixed retirement metadata at exact expiry and changes retroactively without reinstall or deployment clocks',()=>{
 const before=evaluateAndroidUpgrade(input);assert.equal(before.status,'approaching-upgrade');assert.equal(before.deadline,'2026-04-01T00:00:00.000Z');
 const at=evaluateAndroidUpgrade({...input,serverTime:before.deadline});assert.equal(at.status,'upgrade-required');
 const extended=evaluateAndroidUpgrade({...input,graceDays:100,serverTime:before.deadline});assert.equal(extended.status,'approaching-upgrade');assert.equal(extended.deadline,'2026-04-11T00:00:00.000Z');
 assert.equal(evaluateAndroidUpgrade({...input,graceDays:0,serverTime:retired.supersededAt}).status,'upgrade-required');
 assert.equal(evaluateAndroidUpgrade({...input,versionCode:2}).status,'compatible');
});
test('grace cannot restore unsupported protocol or capabilities and unknown versions fail closed',()=>{
 for(const change of [entry=>entry.descriptor.compatibility.api={minimum:99,maximum:99},entry=>entry.descriptor.compatibility.requiredCapabilities=['unimplemented-v1'],entry=>entry.descriptor.compatibility.protectedReportSchema=99]){
  const releases=structuredClone(input.releases);change(releases.find(entry=>entry.descriptor.versionCode===1));
  const value=evaluateAndroidUpgrade({...input,releases,graceDays:365});assert.equal(value.status,'upgrade-required');assert.equal(value.reason,'unsupported');assert.equal(value.deadline,null);
 }
 assert.equal(evaluateAndroidUpgrade({...input,versionCode:9876}).reason,'unknown-release');
 assert.equal(evaluateAndroidUpgrade({...input,versionCode:9876}).replacement,null,'A lower version cannot be a usable Android upgrade');
 assert.equal(evaluateAndroidUpgrade({...input,versionCode:2}).replacement,null,'The installed version is not its own upgrade');
});
test('retirement requires exact approved compatible replacement; no selected, unavailable or wrong replacement starts a deadline',()=>{
 for(const update of [{status:'unavailable',reason:'not-selected'},{status:'unavailable',reason:'unavailable'},{...replacement,tag:'unselected-release'}, {...replacement,descriptor:{...replacement.descriptor,compatibility:{...replacement.descriptor.compatibility,requiredCapabilities:['missing-v1']}}}]){
  const value=evaluateAndroidUpgrade({...input,replacement:update});assert.equal(value.status,'compatible');assert.equal(value.reason,'replacement-unavailable');assert.equal(value.deadline,null);
 }
 assert.equal(evaluateAndroidUpgrade({...input,retirements:[]}).reason,'supported');
});
test('lifecycle validation rejects ambiguous, unknown, non-increasing and invalid-time retirements; live catalog contains no invented retirement',()=>{
 assert.deepEqual(parseAndroidReleaseLifecycle(lifecycle,catalog.releases),[]);
 assert.deepEqual(parseAndroidReleaseLifecycle({schemaVersion:1,retirements:[retired]},catalog.releases),[retired]);
 for(const value of [{schemaVersion:2,retirements:[]},{schemaVersion:1,retirements:[retired,retired]},{schemaVersion:1,retirements:[{...retired,versionCode:99}]},{schemaVersion:1,retirements:[{...retired,replacementTag:'unknown'}]},{schemaVersion:1,retirements:[{...retired,versionCode:2}]},{schemaVersion:1,retirements:[{...retired,supersededAt:'2026-02-30T00:00:00.000Z'}]}]) assert.throws(()=>parseAndroidReleaseLifecycle(value,catalog.releases));
 for(const value of [-1,366,1.5,'90',null,NaN])assert.throws(()=>parseAndroidUpgradeGraceDays(value));
 for(const value of [0,90,365])assert.equal(parseAndroidUpgradeGraceDays(value),value);
});


test('future APK policy consumers require the implemented policy capability and cannot assume an enrollment-only server supports it',()=>{
 const descriptor=structuredClone(catalog.releases[0].descriptor);descriptor.compatibility.requiredCapabilities=['native-enrollment-attempt-v1','android-upgrade-policy-v1'];
 assert.equal(isAndroidReleaseCompatible(descriptor,1,['native-enrollment-attempt-v1']),false);
 assert.equal(isAndroidReleaseCompatible(descriptor,1,ANDROID_API_CAPABILITIES),true);
});
