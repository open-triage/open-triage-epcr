import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertEffectiveFontFlags,withWebViewFontProfile,WEBVIEW_FONT_FLAG_FILE,WEBVIEW_FONT_FLAGS} from '../scripts/android/webview-font-profile.mjs';

function fakeAdb(options={}) {
  const state={bytes:options.original===undefined?undefined:Buffer.from(options.original),mode:options.mode??'640',calls:[],stops:0};
  const executeCommand=async(_command,argv,limits)=>{
    assert.equal(limits.timeout,15000);assert.equal(limits.maxBuffer,262144);
    const args=argv.slice(2);state.calls.push(args);
    const absent=()=>{throw Object.assign(new Error('absent'),{code:1});};
    let value='';
    if(args[0]==='push') {
      state.bytes=await readFile(args[1]);
      if(options.failRestore&&args[1].endsWith('/original'))throw Error('restore push failed');
      if(options.failWrite&&args[1].endsWith('/profile'))throw Error('partial write failed');
    } else if(args[0]==='exec-out')value=state.bytes??absent();
    else if(args[0]==='logcat')value=options.noEffectiveFlags?'WebViewCommandLine: no matching switches':`WebViewCommandLine: ${WEBVIEW_FONT_FLAGS.trim()}${options.unsafeEffectiveFlags?' --ignore-certificate-errors':''}`;
    else if(args[1]==='getprop')value=args[2]==='ro.kernel.qemu'?(options.qemu??'1'):(options.build??'userdebug');
    else if(args[1]==='dumpsys')value=`Current WebView package (name, version): (com.google.android.webview, ${options.version??'109.0.5414.123'})`;
    else if(args[1]==='test') {
      if(args[2]==='-L'){if(!options.symlink)absent();}
      else if(state.bytes===undefined)absent();
      else if(args[2]==='-f'&&options.directory)absent();
    } else if(args[1]==='pidof'){if(options.noProcess)absent();else value='1234';}
    else if(args[1]==='stat')value=state.mode;
    else if(args[1]==='chmod'){if(options.failModeRestore&&args[2]==='640')throw Error('restore chmod failed');state.mode=args[2];}
    else if(args[1]==='rm'){if(options.failRemove)throw Error('restore removal failed');state.bytes=undefined;}
    else if(args[1]==='am'){state.stops++;if(options.failFinalStop&&state.stops===2)throw Error('force-stop unavailable');}
    else throw Error('Unexpected command: '+args.join(' '));
    return {stdout:Buffer.isBuffer(value)?value:Buffer.from(value)};
  };
  return {state,executeCommand};
}
async function scoped(options,work) {
  const root=await mkdtemp(join(tmpdir(),'font-profile-test-')),fake=fakeAdb(options);
  try{return await work(fake,callback=>withWebViewFontProfile({adb:'fake',serial:'synthetic',root,executeCommand:fake.executeCommand},callback),root);}
  finally{await rm(root,{recursive:true,force:true});}
}
for(const original of [undefined,'_\r\n','  \n',WEBVIEW_FONT_FLAGS])test(`font fixture scopes only supported optional switches and restores ${original===undefined?'absence':'exact original bytes and mode'}`,()=>scoped({original},async({state},run,root)=>{
 const result=await run(async profile=>{
  assert.equal(state.bytes.toString(),WEBVIEW_FONT_FLAGS);assert.equal(state.mode,'644');
  await profile.verifyForPid(1234);return 'passed';
 });
 assert.equal(result,'passed');assert.equal(state.bytes?.toString(),original);if(original!==undefined)assert.equal(state.mode,'640');
 assert.match(await readFile(join(root,'android/app/build/reports/android-font-profile/effective-flags.txt'),'utf8'),/PrefetchAndroidFonts,GMSCoreEmoji/);
 assert(state.calls.every(args=>!args.includes('pm')&&!args.includes('settings')&&!args.includes('root')));
 assert(state.calls.filter(args=>args[0]==='push').every(args=>args[2]===WEBVIEW_FONT_FLAG_FILE));
}));
for(const options of [{qemu:'0'},{build:'user'},{version:'149.0.0.0'},{symlink:true},{directory:true,original:'_'},{original:'_ --ignore-certificate-errors'},{original:'_ --disable-features=SafeBrowsing'},{original:'_ --enable-features=PrefetchAndroidFonts'},{original:'_ --disable-features=PrefetchAndroidFonts,GMSCoreEmoji --webview-verbose-logging --webview-verbose-logging'}])test(`font fixture rejects unsafe/conflicting platform before mutation: ${JSON.stringify(options)}`,()=>scoped(options,async({state},run)=>{
 await assert.rejects(run(async()=>assert.fail('Unsafe platform entered journey')));
 assert(!state.calls.some(args=>['push','chmod','rm','am'].includes(args[0]==='shell'?args[1]:args[0])));
}));
test('journey and partially applied flag failures restore original state and retain the original error',()=>scoped({original:'_\r\n'},async({state},run)=>{
 const original=new Error('clinical assertion failed');await assert.rejects(run(async()=>{throw original;}),error=>error===original);assert.equal(state.bytes.toString(),'_\r\n');assert.equal(state.mode,'640');
}));
test('partial profile write failure still restores original absence',()=>scoped({failWrite:true},async({state},run)=>{
 await assert.rejects(run(async()=>assert.fail('Partial write entered journey')),/partial write failed/);assert.equal(state.bytes,undefined);
}));
test('missing effective startup flags is a failure and still restores original absence',()=>scoped({noEffectiveFlags:true},async({state},run)=>{
 await assert.rejects(run(profile=>profile.verifyForPid(1234)),/effective fixture command line/);assert.equal(state.bytes,undefined);
}));
test('restoration failure can never turn a passed journey into acceptance',()=>scoped({failRemove:true},async(_fake,run)=>{
 await assert.rejects(run(async()=>true),/restore removal failed/);
}));
test('restoration failure retains both the clinical failure and restoration error',()=>scoped({original:'_',failRestore:true},async(_fake,run)=>{
 const original=new Error('clinical failed');await assert.rejects(run(async()=>{throw original;}),error=>error instanceof AggregateError&&error.errors[0]===original&&/restore/.test(error.errors[1].message));
}));
test('a final force-stop failure does not skip restoring exact flag state',()=>scoped({original:'_',failFinalStop:true},async({state},run)=>{
 await assert.rejects(run(async()=>true),/force-stop unavailable/);assert.equal(state.bytes.toString(),'_');assert.equal(state.mode,'640');
}));
test('both actual runners scope and verify the same profile before clinical acceptance',async()=>{
 for(const file of ['android-emulator-test.mjs','android-release-upgrade.mjs']) {
  const source=await readFile(new URL('../scripts/'+file,import.meta.url),'utf8');
  assert.match(source,/await withWebViewFontProfile\(/);assert.match(source,/await fontProfile.verifyForPid\(/);
  if(file==='android-emulator-test.mjs')assert(source.indexOf('await fontProfile.verifyForPid(')<source.indexOf('await runReportRecoveryJourney('));
  else {assert.match(source,/afterOfflineStartup/);assert(!source.includes('NativeStartupTest'),'Do not require a new app initializer contract in immutable previous APK A');}
 }
});

test('original file-mode restoration failure fails acceptance even when bytes were restored',()=>scoped({original:'_',failModeRestore:true},async({state},run)=>{
 await assert.rejects(run(async()=>true),/restore chmod failed/);assert.equal(state.bytes.toString(),'_');
}));

test('fresh emulator without an installed/running clinical APK can scope and restore the fixture safely',()=>scoped({noProcess:true},async({state},run)=>{
 await run(async()=>true);assert.equal(state.stops,0);assert.equal(state.bytes,undefined);
}));

test('an unexpected effective TLS/origin bypass is rejected and original flags restored',()=>scoped({unsafeEffectiveFlags:true},async({state},run)=>{
 await assert.rejects(run(profile=>profile.verifyForPid(1234)),/must not bypass origin or TLS/);assert.equal(state.bytes,undefined);
}));

test('effective proof accepts actual Chromium109 native switch rows and rejects missing/conflicting values',()=>{
 const native="11-11 23:43:15.644 10332 10378 I chromium: [INFO:aw_contents_statics.cc(139)] WebViewCommandLine 'disable-features': 'PrefetchAndroidFonts,GMSCoreEmoji,Vulkan'\n11-11 23:43:15.644 10332 10378 I chromium: [INFO:aw_contents_statics.cc(139)] WebViewCommandLine 'webview-verbose-logging': ''";
 assertEffectiveFontFlags(native);
 assert.throws(()=>assertEffectiveFontFlags(native.replace('PrefetchAndroidFonts,','')),/both optional/);
 assert.throws(()=>assertEffectiveFontFlags(native.replace('disable-features','enable-features')),/both optional/);
 assert.throws(()=>assertEffectiveFontFlags(native+"\nWebViewCommandLine 'ignore-certificate-errors-spki-list': 'hash'"),/must not bypass origin or TLS/);
});
