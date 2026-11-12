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

/** Each startup class owns one acceptance case; require the complete installed suite. */
export const nativeStartupClasses = Object.freeze([
  'org.opentriage.development.NativeStartupTest',
  'org.opentriage.development.NativeReplyLifecycleTest',
]);
export function assertNativeStartupInstrumentation(output) {
  assert.match(output, /(?:^|\n)OK \(2 tests\)(?:\r?\n|$)/,
    'Actual installed startup and WebView reply lifecycle cases must both pass');
}
