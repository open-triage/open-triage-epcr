import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const execute=promisify(execFile);
export const WEBVIEW_FONT_FLAG_FILE='/data/local/tmp/webview-command-line';
export const WEBVIEW_FONT_FEATURES='PrefetchAndroidFonts,GMSCoreEmoji';
export const WEBVIEW_FONT_FLAGS=`_ --disable-features=${WEBVIEW_FONT_FEATURES} --webview-verbose-logging\n`;

/** Optional Chromium109 font retrieval only, on disposable userdebug/eng emulators.
 * Never configure production APKs, TLS/security flags, permissions or Google packages.
 * Source: Chromium109 ProductionSupportedFlagList.java and commandline-flags.md.
 */
export async function withWebViewFontProfile({adb,serial,root,applicationId='org.opentriage.development',executeCommand=execute},work) {
  assert(['org.opentriage.development','org.opentriage.android'].includes(applicationId),'Known synthetic APK package required');
  const run=async args=>(await executeCommand(adb,['-s',serial,...args],{encoding:'buffer',timeout:15000,maxBuffer:256*1024})).stdout;
  const text=async args=>String(await run(args)).trim();
  const exists=async args=>{try{await run(args);return true;}catch(error){if(error.code===1)return false;throw error;}};
  const stopClinicalProcess=async()=>{if(await exists(['shell','pidof',applicationId]))await run(['shell','am','force-stop',applicationId]);};
  assert.equal(await text(['shell','getprop','ro.kernel.qemu']),'1','Font profile requires an isolated emulator');
  assert(['userdebug','eng'].includes(await text(['shell','getprop','ro.build.type'])),'Font profile requires a userdebug/eng emulator');
  const webview=await text(['shell','dumpsys','webviewupdate']);
  assert.match(webview,/Current WebView package \(name, version\): \(com\.google\.android\.webview, 109\.0\.5414\.\d+\)/,'Font profile is supported only for the evidenced Chromium109 fixture');
  assert.equal(await exists(['shell','test','-L',WEBVIEW_FONT_FLAG_FILE]),false,'Do not replace a symlinked flag file');
  const present=await exists(['shell','test','-e',WEBVIEW_FONT_FLAG_FILE]);
  let original,mode;
  if(present) {
    assert(await exists(['shell','test','-f',WEBVIEW_FONT_FLAG_FILE]),'Flag path must be a regular file');
    original=Buffer.from(await run(['exec-out','cat',WEBVIEW_FONT_FLAG_FILE]));
    assert(original.length<=4096,'Existing flag file is unexpectedly large');
    mode=await text(['shell','stat','-c','%a',WEBVIEW_FONT_FLAG_FILE]);assert.match(mode,/^[0-7]{3,4}$/);
    const value=original.toString('utf8');assert(Buffer.from(value).equals(original),'Existing flags must be UTF-8');
    const tokens=value.trim()?value.trim().split(/\s+/):[];
    assert(tokens.length===0||tokens[0]==='_','Unexpected existing WebView flag prefix');
    const allowed=new Set([`--disable-features=${WEBVIEW_FONT_FEATURES}`,'--webview-verbose-logging']);
    assert(tokens.slice(1).every(token=>allowed.has(token))&&new Set(tokens).size===tokens.length,'Conflicting existing WebView flags');
  }
  const directory=await mkdtemp(join(tmpdir(),'android-webview-font-'));
  const desired=join(directory,'profile'),backup=join(directory,'original');
  await writeFile(desired,WEBVIEW_FONT_FLAGS);if(present)await writeFile(backup,original);
  let changed=false,failure,result;
  const verifyForPid=async pid=>{
    assert(/^[1-9]\d*$/.test(String(pid)),'An actual startup PID is required');
    const raw=await text(['logcat','-d',`--pid=${pid}`,'-s','chromium:I','cr_WebViewCommandLine:V','WebViewCommandLine:V','*:S']);
    const logs=raw.split('\n').filter(line=>line.includes('WebViewCommandLine')).join('\n');
    const reports=join(root,'android/app/build/reports/android-font-profile');await mkdir(reports,{recursive:true});
    await writeFile(join(reports,'effective-flags.txt'),logs+'\n');
    assertEffectiveFontFlags(logs);
    console.log(`PASS Chromium109 optional-font profile effective in startup PID ${pid}`);
  };
  try {
    // Kill only this harness's clinical APK before changing its WebView startup profile.
    await stopClinicalProcess();
    changed=true;await run(['push',desired,WEBVIEW_FONT_FLAG_FILE]);await run(['shell','chmod','644',WEBVIEW_FONT_FLAG_FILE]);
    assert(Buffer.from(await run(['exec-out','cat',WEBVIEW_FONT_FLAG_FILE])).equals(Buffer.from(WEBVIEW_FONT_FLAGS)),'Fixture flag write must be exact');
    result=await work({verifyForPid,before:{present,mode:mode??null,sha256:present?createHash('sha256').update(original).digest('hex'):null}});
  } catch(error) {failure=error;}
  finally {
    try {
      if(changed) {
        try {await stopClinicalProcess();}
        catch(error) {failure=failure?new AggregateError([failure,error],'Android fixture failed and process cleanup failed'):error;}
        if(present) {
          await run(['push',backup,WEBVIEW_FONT_FLAG_FILE]);await run(['shell','chmod',mode,WEBVIEW_FONT_FLAG_FILE]);
          assert(Buffer.from(await run(['exec-out','cat',WEBVIEW_FONT_FLAG_FILE])).equals(original),'Original flag bytes must be restored');
          assert.equal(await text(['shell','stat','-c','%a',WEBVIEW_FONT_FLAG_FILE]),mode,'Original flag mode must be restored');
        } else {await run(['shell','rm','-f',WEBVIEW_FONT_FLAG_FILE]);assert.equal(await exists(['shell','test','-e',WEBVIEW_FONT_FLAG_FILE]),false,'Original flag absence must be restored');}
      }
    } catch(error) {failure=failure?new AggregateError([failure,error],'Android fixture failed and font-profile restoration failed'):error;}
    finally {await rm(directory,{recursive:true,force:true});}
  }
  if(failure)throw failure;
  console.log('PASS scoped WebView font profile restored original flag bytes/mode/absence');
  return result;
}

/** Chromium109 logs native key/value switch rows; some builds log a CLI string. */
export function assertEffectiveFontFlags(logs) {
  assert.doesNotMatch(logs,/--(?:ignore-certificate-errors(?:-spki-list)?|disable-web-security|allow-insecure-localhost|unsafely-treat-insecure-origin-as-secure)(?:[=\s]|$)|WebViewCommandLine ['"](?:ignore-certificate-errors(?:-spki-list)?|disable-web-security|allow-insecure-localhost|unsafely-treat-insecure-origin-as-secure)['"]:/,'Effective fixture must not bypass origin or TLS security');
  assert.match(logs,/(?:--webview-verbose-logging|WebViewCommandLine ['"]webview-verbose-logging['"]:)/,'WebView must report the effective fixture command line');
  const switches=[...logs.matchAll(/--disable-features=([^\s"']+)|WebViewCommandLine ['"]disable-features['"]:\s*['"]([^'"]*)['"]/g)].map(match=>match[1]??match[2]);
  assert(switches.some(value=>{const features=value.split(',');return WEBVIEW_FONT_FEATURES.split(',').every(feature=>features.includes(feature));}),'The running WebView must confirm both optional font features are disabled');
}
