import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {assertNoRemoteFontInitializer,verifyNativeStartup,nativeStartupClasses,assertNativeStartupInstrumentation,nativeStartupArguments} from '../scripts/android/native-startup.mjs';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};

test('every startup selection receives exact verified catalog arguments and cannot replace mandatory inputs',()=>{
  for(const classes of [nativeStartupClasses,['org.opentriage.development.NativeStartupTest']]) {
    const args=nativeStartupArguments({serial:'emulator-fixture',classes,extras:{phase:'verify'}});
    assert.equal(args[args.indexOf('officialApkUrl')+1],catalog.releases[0].downloadUrl);
    assert.equal(args[args.indexOf('fixtureFontProfile')+1],'1');assert.equal(args[args.indexOf('class')+1],classes.join(','));
    assert.equal(args[args.indexOf('phase')+1],'verify');assert.equal(args.filter(value=>value==='officialApkUrl').length,1);
  }
  const changed=structuredClone(catalog);changed.releases[0].downloadUrl='https://invalid.example/unverified.apk';
  assert.throws(()=>nativeStartupArguments({serial:'emulator-fixture'},changed),/exact verified/);
  for(const key of ['class','fixtureFontProfile','officialApkUrl'])assert.throws(()=>nativeStartupArguments({serial:'emulator-fixture',extras:{[key]:'override'}}),/cannot override/);
});

test('all existing startup instrumentation callers share the mandatory argument factory',()=>{
  const root=resolve(import.meta.dirname,'../scripts');let callers=0;
  for(const file of readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.mjs')&&name!=='android/native-startup.mjs')) {
    const source=readFileSync(join(root,file),'utf8');
    if(!/NativeStartupTest|nativeStartupClasses|nativeStartupArguments\(/.test(source))continue;
    callers++;assert.match(source,/nativeStartupArguments\(/,`${file} must use the shared installed startup contract`);
    assert.doesNotMatch(source,/["']officialApkUrl["']/,`${file} cannot maintain a second manual startup argument list`);
  }
  assert(callers>0,'At least the general startup caller must be validated');
});

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
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('all three installed startup classes must pass, with no partial or failed completion',()=>{assert.equal(nativeStartupClasses.length,3);assert.doesNotThrow(()=>assertNativeStartupInstrumentation('Time: 3.3\n\nOK (3 tests)\n'));for(const output of ['OK (1 test)\n','OK (2 tests)\n','OK (0 tests)\n','FAILURES!!!\nTests run: 3, Failures: 1\n','FAILURES!!!\nOK (3 tests)\n'])assert.throws(()=>assertNativeStartupInstrumentation(output),/must pass/);});
