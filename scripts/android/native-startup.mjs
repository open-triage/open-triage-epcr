import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function assertNoRemoteFontInitializer(manifest) {
  assert.equal(typeof manifest,'string');
  assert.match(manifest,/<manifest\b/,'Validate the actual merged Android manifest');
  assert.doesNotMatch(manifest,/androidx\.emoji2\.text\.EmojiCompatInitializer/,'The generic APK must not auto-bind a downloadable font provider');
}
export function verifyNativeStartup(root,variant) {
  assert(['debug','release'].includes(variant));
  const task=variant==='debug'?'processDebugManifest':'processReleaseManifest';
  assertNoRemoteFontInitializer(readFileSync(join(root,'android/app/build/intermediates/merged_manifests',variant,task,'AndroidManifest.xml'),'utf8'));
}
