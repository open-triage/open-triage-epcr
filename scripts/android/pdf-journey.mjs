import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {adbShellArguments} from './instrumentation.mjs';
import {startLiveInstrumentation} from './live-instrumentation.mjs';

export function assertNativePdfInstrumentation(output) {
  assert.match(output,/(?:^|\n)OK \(3 tests\)(?:\r?\n|$)/,'All native PDF rendering, lifetime and background cleanup cases must pass');
  assert.match(output,/INSTRUMENTATION_CODE: -1(?:\r?\n|$)/,'The installed instrumentation must finish successfully');
  assert.doesNotMatch(output,/FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=/,'A late crash or runner failure cannot be hidden by an earlier test count');
}

/** Real platform renderer plus abrupt death with a genuinely live private document. */
export async function runNativePdfJourney({root,adb,serial,applicationId='org.opentriage.development',verifyFontPid=async()=>{}}) {
  const instrument=(name,extra=[])=>adbShellArguments(['-s',serial,'shell','am','instrument','-w','-r','-e','class',name,...extra,`${applicationId}.test/androidx.test.runner.AndroidJUnitRunner`]);
  const live=execFileSync(adb,instrument('org.opentriage.development.NativePdfLifecycleTest'),{cwd:root,encoding:'utf8',timeout:120000});
  console.log(live);assertNativePdfInstrumentation(live);
  let preparation;
  try {
    preparation=startLiveInstrumentation(adb,instrument('org.opentriage.development.NativePdfColdProcessTest',['-e','phase','prepare']),{cwd:root,checkpoint:'opentriage_pdf_phase=ready-for-process-kill',timeoutMs:45000});
    console.log(await preparation.ready);
    const pid=execFileSync(adb,['-s',serial,'shell','pidof',applicationId],{encoding:'utf8'}).trim();assert(pid,'Native PDF preparation must retain a real live process');
    execFileSync(adb,['-s',serial,'shell','am','force-stop',applicationId]);
    assert.equal(spawnSync(adb,['-s',serial,'shell','pidof',applicationId],{encoding:'utf8'}).stdout.trim(),'','Host force-stop must really terminate the process');
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;preparation.child.kill('SIGTERM');},15000);
    const closed=await preparation.closed;clearTimeout(timer);console.log(closed.output);assert.equal(timedOut,false,'Killed instrumentation must exit promptly');
    const after=execFileSync(adb,instrument('org.opentriage.development.NativePdfColdProcessTest,org.opentriage.development.NativeStartupTest',['-e','phase','verify','-e','fixtureFontProfile','1']),{cwd:root,encoding:'utf8',timeout:120000});
    console.log(after);assert.match(after,/(?:^|\n)OK \(2 tests\)(?:\r?\n|$)/);assert.match(after,/opentriage_pdf_cold_cleanup=true/);
    await verifyFontPid(/opentriage_startup_pid=(\d+)/.exec(after)?.[1]);
    console.log('PASS native PDF: real rendering, secure private pages, expiry/context/background cleanup and cold-process stale-byte/handle rejection');
  } finally {
    if(preparation&&preparation.child.exitCode===null&&preparation.child.signalCode===null){preparation.child.kill('SIGTERM');await preparation.closed;}
  }
}
