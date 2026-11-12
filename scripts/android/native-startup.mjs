import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function assertNoRemoteFontInitializer(manifest) {
  assert.equal(typeof manifest,'string');
  assert.match(manifest,/<manifest\b/,'Validate the actual merged Android manifest');
  assert.doesNotMatch(manifest,/androidx\.emoji2\.text\.EmojiCompatInitializer/,'The generic APK must not auto-bind a downloadable font provider');
}
export function verifyNativeStartup(root,variant,{instrumentation=false}={}) {
  assert(['debug','release'].includes(variant));
  const task=variant==='debug'?'processDebugManifest':'processReleaseManifest';
  assertNoRemoteFontInitializer(readFileSync(join(root,'android/app/build/intermediates/merged_manifests',variant,task,'AndroidManifest.xml'),'utf8'));
  if(instrumentation) {
    const testTask=variant==='debug'?'processDebugAndroidTestManifest':'processReleaseAndroidTestManifest';
    assertNoRemoteFontInitializer(readFileSync(join(root,'android/app/build/intermediates/packaged_manifests',`${variant}AndroidTest`,testTask,'AndroidManifest.xml'),'utf8'));
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
