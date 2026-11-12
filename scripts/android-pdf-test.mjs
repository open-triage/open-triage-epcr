import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {withWebViewFontProfile} from './android/webview-font-profile.mjs';
import {runNativePdfJourney} from './android/pdf-journey.mjs';

const root=resolve(import.meta.dirname,'..');
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;assert(sdk,'Android SDK required');
const adb=join(sdk,'platform-tools/adb'),serial=process.env.ANDROID_SERIAL??'emulator-5554';
if(!process.argv.includes('--skip-build'))execFileSync('npm',['run','android:build'],{cwd:root,stdio:'inherit'});
assert.equal(execFileSync(adb,['-s',serial,'shell','getprop','sys.boot_completed'],{encoding:'utf8'}).trim(),'1');
assert.equal(execFileSync(adb,['-s',serial,'shell','getprop','ro.kernel.qemu'],{encoding:'utf8'}).trim(),'1','Synthetic PDF checks require the isolated emulator');
await withWebViewFontProfile({adb,serial,root},async profile=>{
  for(const apk of ['android/app/build/outputs/apk/debug/app-debug.apk','android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])execFileSync(adb,['-s',serial,'install','-r',join(root,apk)],{stdio:'inherit'});
  await runNativePdfJourney({root,adb,serial,verifyFontPid:pid=>profile.verifyForPid(pid)});
});
