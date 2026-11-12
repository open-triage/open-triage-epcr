import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import releaseCatalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {approvedAndroidReleaseUrl,parseAndroidReleaseDescriptor} from '@open-triage/contracts/android-release';
import {verifyInstrumentationClasses} from './instrumentation-contents.mjs';

/** One installed startup contract for general and focused instrumentation callers. */
export function nativeStartupArguments({serial,applicationId='org.opentriage.development',classes=nativeStartupClasses,extras={}},catalog=releaseCatalog) {
  assert.equal(typeof serial,'string');assert(serial.length);
  assert(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(applicationId));
  assert(Array.isArray(classes)&&classes.length&&classes.every(name=>typeof name==='string'&&name.length));
  const release=catalog.releases?.[0];assert(release,'Startup requires the committed verified release catalog');
  const url=approvedAndroidReleaseUrl(release.tag,parseAndroidReleaseDescriptor(release.descriptor));
  assert.equal(release.downloadUrl,url,'Startup must use the exact verified catalog APK URL');
  const args=['-s',serial,'shell','am','instrument','-w','-r','-e','class',classes.join(','),'-e','fixtureFontProfile','1','-e','officialApkUrl',url];
  for(const [key,value] of Object.entries(extras)) {
    assert(!['class','fixtureFontProfile','officialApkUrl'].includes(key),'Startup extras cannot override mandatory acceptance inputs');
    assert.equal(typeof value,'string');args.push('-e',key,value);
  }
  args.push(`${applicationId}.test/androidx.test.runner.AndroidJUnitRunner`);return args;
}

export function assertNoRemoteFontInitializer(manifest) {
  assert.equal(typeof manifest,'string');
  assert.match(manifest,/<manifest\b/,'Validate the actual merged Android manifest');
  assert.doesNotMatch(manifest,/androidx\.emoji2\.text\.EmojiCompatInitializer/,'The generic APK must not auto-bind a downloadable font provider');
}
export function verifyNativeStartup(root,variant,{instrumentation=false,instrumentationDexReader}={}) {
  assert(['debug','release'].includes(variant));
  const task=variant==='debug'?'processDebugManifest':'processReleaseManifest';
  const main=readFileSync(join(root,'android/app/build/intermediates/merged_manifests',variant,task,'AndroidManifest.xml'),'utf8');
  assertNoRemoteFontInitializer(main);
  assert.doesNotMatch(main,/NativePdfSafDocumentActivity/,'The test-only document verifier must never be packaged in the clinical APK');
  if(instrumentation) {
    const testTask=variant==='debug'?'processDebugAndroidTestManifest':'processReleaseAndroidTestManifest';
    assertNoRemoteFontInitializer(readFileSync(join(root,'android/app/build/intermediates/packaged_manifests',`${variant}AndroidTest`,testTask,'AndroidManifest.xml'),'utf8'));
    verifyInstrumentationClasses(root,variant,{readDex:instrumentationDexReader});
  }
}

/** Keep the selected installed startup cases and their completion proof together. */
export const nativeStartupClasses=Object.freeze([
 'org.opentriage.development.NativeStartupTest',
 'org.opentriage.development.NativeReplyLifecycleTest',
 'org.opentriage.development.NativeTransitionResumeTest',
]);
export function assertNativeStartupInstrumentation(output){
 const message='All installed startup, reply lifecycle and transition recovery cases must pass';
 assert.doesNotMatch(output,/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed\./,message);
 assert.match(output,new RegExp(`(?:^|\\n)OK \\(${nativeStartupClasses.length} tests\\)(?:\\r?\\n|$)`),message);
}
