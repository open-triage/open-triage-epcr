import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {assertNoRemoteFontInitializer,verifyNativeStartup,nativeStartupClasses,assertNativeStartupInstrumentation} from '../scripts/android/native-startup.mjs';

test('generic startup permits local lifecycle initialization and rejects automatic remote emoji fonts',()=>{
  const local='<manifest><application><provider android:name="androidx.startup.InitializationProvider"><meta-data android:name="androidx.lifecycle.ProcessLifecycleInitializer" /></provider></application></manifest>';
  assert.doesNotThrow(()=>assertNoRemoteFontInitializer(local));
  assert.throws(()=>assertNoRemoteFontInitializer(local.replace('androidx.lifecycle.ProcessLifecycleInitializer','androidx.emoji2.text.EmojiCompatInitializer')),/downloadable font provider/);
  assert.throws(()=>assertNoRemoteFontInitializer(''),/actual merged/);
});

for(const variant of ['debug','release']) test(`${variant} checks the separate instrumentation manifest before device execution`,()=>{
  const root=mkdtempSync(join(tmpdir(),'android-startup-'));
  const capital=variant==='debug'?'Debug':'Release';
  const main=join(root,`android/app/build/intermediates/merged_manifests/${variant}/process${capital}Manifest/AndroidManifest.xml`);
  const instrumentation=join(root,`android/app/build/intermediates/packaged_manifests/${variant}AndroidTest/process${capital}AndroidTestManifest/AndroidManifest.xml`);
  const local='<manifest><application /></manifest>';
  try {
    for(const path of [main,instrumentation]) { mkdirSync(dirname(path),{recursive:true});writeFileSync(path,local); }
    assert.doesNotThrow(()=>verifyNativeStartup(root,variant,{instrumentation:true}));
    writeFileSync(instrumentation,'<manifest><application><provider android:name="androidx.startup.InitializationProvider"><meta-data android:name="androidx.emoji2.text.EmojiCompatInitializer" /></provider></application></manifest>');
    assert.throws(()=>verifyNativeStartup(root,variant,{instrumentation:true}),/downloadable font provider/);
    assert.doesNotThrow(()=>verifyNativeStartup(root,variant));
    const verifier='<manifest><application><activity android:name="org.opentriage.development.NativePdfSafDocumentActivity" /></application></manifest>';
    writeFileSync(instrumentation,verifier);assert.doesNotThrow(()=>verifyNativeStartup(root,variant,{instrumentation:true}));
    writeFileSync(main,verifier);assert.throws(()=>verifyNativeStartup(root,variant,{instrumentation:true}),/test-only document verifier/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('all three installed startup classes must pass, with no partial or failed completion',()=>{assert.equal(nativeStartupClasses.length,3);assert.doesNotThrow(()=>assertNativeStartupInstrumentation('Time: 3.3\n\nOK (3 tests)\n'));for(const output of ['OK (1 test)\n','OK (2 tests)\n','OK (0 tests)\n','FAILURES!!!\nTests run: 3, Failures: 1\n','FAILURES!!!\nOK (3 tests)\n'])assert.throws(()=>assertNativeStartupInstrumentation(output),/must pass/);});
