import {adbShellArguments} from './android/instrumentation.mjs';
import {upgradePreparationProfile,upgradePreparationReceipt,upgradeProbeCallNumber} from './android/upgrade-policy-fixture.mjs';
import {assertUpgradeHarnessSource,assertFreshUpgradeTarget} from './android/upgrade-harness-source.mjs';
import { withWebViewFontProfile } from './android/webview-font-profile.mjs';
import { stopFixtureChildren } from './android/fixture-processes.mjs';
import { preserveAndroidFailure } from './android/diagnostics.mjs';
import { captureAndroidDisplay, restoreAndroidDisplay } from './android/display-state.mjs';
import { isAndroidReleaseCompatible } from '@open-triage/contracts/android-release';
import { verifyApkSignature } from './android/apk-signature.mjs';
import { execFileSync, spawnSync, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepareFixtures } from './android/fixtures.mjs';
import { fixtureApi as api } from './android/fixture-client.mjs';
import { runReportRecoveryJourney } from './android/report-journey.mjs';
import { validateUpgrade, verifyApkMetadata, requiredUpgradeAssertions, requiredUpgradeGateAssertions } from './android/release-contract.mjs';
const root = resolve(import.meta.dirname, '..');
const [aDirectory, bDirectory] = process.argv.slice(2).map(value => resolve(value));
assert(aDirectory && bDirectory, 'Supply release A and B artifact directories');
const a = JSON.parse(await readFile(join(aDirectory, 'release.json'))), b = JSON.parse(await readFile(join(bDirectory, 'release.json')));
validateUpgrade(a, b);
const testSourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Upgrade acceptance requires clean committed test source');
const changedPaths=execFileSync('git',['diff','--name-only',`${b.sourceCommit}..${testSourceCommit}`],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
assertUpgradeHarnessSource({artifactSource:b.sourceCommit,testSource:testSourceCommit,changedPaths});
const preparationProfile=upgradePreparationProfile(a),upgradeReceipt=upgradePreparationReceipt(a,b);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT, adb = join(sdk, 'platform-tools/adb');
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554';
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.status ?? result.signal})`);
}
assert.equal(execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).trim(), '1');
assert.equal(execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'], { encoding: 'utf8' }).trim(), '1', 'Destructive synthetic setup is restricted to a disposable emulator');
for (const [directory, descriptor] of [[aDirectory, a], [bDirectory, b]]) {
  const file = join(directory, descriptor.artifact);
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), descriptor.apkSha256, 'Immutable APK digest');
  verifyApkMetadata(execFileSync(join(sdk, 'build-tools/36.0.0/aapt'), ['dump', 'badging', file], { encoding: 'utf8' }),
    verifyApkSignature(sdk, file), descriptor);
}
// Refuse before creating fixtures or changing the emulator's font profile.
assertFreshUpgradeTarget(spawnSync(adb,['-s',serial,'shell','pm','path',a.applicationId],{encoding:'utf8'}));
const directory = await mkdtemp(join(tmpdir(), 'open-triage-upgrade-')), container = `open-triage-upgrade-${randomUUID()}`;
const children = []; let ownsController = false, restoreDisplay;
await withWebViewFontProfile({adb,serial,root,applicationId:a.applicationId},async fontProfile=>{
try {
  restoreDisplay = captureAndroidDisplay({ adb, serial });
  const fixtures = await prepareFixtures(root, directory, run, process.env.DOCKER_COMMAND ?? 'docker', container);
  for (const fixture of fixtures) {
    fixture.upgradeAcceptance={releaseA:a,releaseB:b,apkBPath:join(bDirectory,b.artifact)};
    const file = join(directory, `fixture-${fixture.index}.json`); await writeFile(file, JSON.stringify(fixture));
    const child = fork(fileURLToPath(new URL('./android/fixture-api.mjs', import.meta.url)), [file], { cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }); children.push(child);
    await new Promise((ready, reject) => { const timer = setTimeout(() => reject(new Error('Synthetic API startup timeout')), 45000); child.once('message', () => { clearTimeout(timer); ready(); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic API exited ${code}`)); }); });
  }
  const health = await api(fixtures[0], await readFile(fixtures[0].caPath), 'health');
  assert.equal(health.status, 200);
  const serverAndroidApiProtocol = health.body.androidApiProtocol;
  const serverAndroidApiCapabilities = health.body.androidApiCapabilities ?? [];
  for (const descriptor of [a, b]) assert(isAndroidReleaseCompatible(descriptor, serverAndroidApiProtocol, serverAndroidApiCapabilities), 'A/B client must support the real server protocol and capabilities');
  // Fresh-target guard already proved there is no existing production installation.
  // A-to-B never clears or uninstalls data.
  run(adb, ['-s', serial, 'install', '-r', join(aDirectory, a.artifact)]);
  run(adb, ['-s', serial, 'install', '-r', join(root, 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk')]);
  run(adb, ['-s', serial, 'install', '-t', '-r', join(root, 'android/management-test-controller/build/outputs/apk/debug/management-test-controller-debug.apk')]);
  run(adb, ['-s', serial, 'shell', 'dpm', 'set-device-owner', 'org.opentriage.managementtest/.AdminReceiver']); ownsController = true;
  const restrictions = { configurationVersion: 1, serverOrigin: fixtures[0].origin, publicCaPem: await readFile(fixtures[0].caPath, 'utf8') };
  const policy = value => run(adb, ['-s', serial, 'shell', 'am', 'broadcast', '--include-stopped-packages', '-a', 'org.opentriage.managementtest.SET_CONFIGURATION', '-n', 'org.opentriage.managementtest/.ConfigurationReceiver', '--es', 'targetPackage', 'org.opentriage.android', '--es', 'configurationBase64', Buffer.from(JSON.stringify(value)).toString('base64')]);
  policy(restrictions);
  let incomingAssignment, upgradeReport;
  const policyInstrument=(version,expectedStatus,legacy=false)=>{
    const output=execFileSync(adb,adbShellArguments(['-s',serial,'shell','am','instrument','-w','-r','-e','class','org.opentriage.development.UpgradePolicyTransportTest','-e','expectedVersion',String(version),'-e','assignmentId',incomingAssignment,'-e','expectedStatus',String(expectedStatus),'-e','legacy',legacy?'1':'0',`${a.applicationId}.test/androidx.test.runner.AndroidJUnitRunner`]),{cwd:root,encoding:'utf8',timeout:120000});
    console.log(output);assert.match(output,/OK \(1 test\)/,'Real installed APK transport must enforce retirement without launching or modifying the pending WebView');
  };
  await runReportRecoveryJourney({ root, fixture: fixtures[0], adb, serial, run, api, applicationId: 'org.opentriage.android', upgrade: true, preparationProfile, upgradeReceipt,
    hooks:{afterRecovery:async({instrument})=>{
      if(preparationProfile==='historical-a1-text-v1')instrument('post-upgrade-photo',fixtures[0].clinician.username,fixtures[0].clinicianPassword);
      else instrument('upgrade-session-snapshot',fixtures[0].clinician.username,fixtures[0].clinicianPassword);
    },afterOfflineStartup:async output=>{await fontProfile.verifyForPid(/opentriage_startup_pid=(\d+)/.exec(output)?.[1]);},beforeProcessKill:async({db,report,opened,ca})=>{
      upgradeReport={...report,id:opened.id};
      incomingAssignment=randomUUID();const incident=randomUUID();
      await db.query(`insert into clinical.incident(id,organization_id,synthetic) select $1,organization_id,synthetic from clinical.incident where id=$2`,[incident,report.incidentId]);
      await db.query(`insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,dispatched_at,dispatch_reason,chief_complaint,synthetic,synthetic_generated_by,expires_at)
        select $1,organization_id,unit_id,$2,$4,dispatched_at,dispatch_reason,chief_complaint,synthetic,synthetic_generated_by,expires_at
        from clinical.call_assignment where id=$3`,[incomingAssignment,incident,report.assignmentId,upgradeProbeCallNumber(incomingAssignment,report.callNumber)]);
      const retired=await api(fixtures[0],ca,'__android-upgrade-policy/retire','POST');assert.equal(retired.status,200);assert.equal(retired.body.retired,true);
    }},
    afterProcessStop: async () => {
      // Old A is still installed. Prove the actual legacy transport is refused
      // new work after retirement, without starting its retained WebView.
      run(adb,['-s',serial,'shell','svc','wifi','enable']);run(adb,['-s',serial,'shell','svc','data','enable']);
      policyInstrument(a.versionCode,426,true);
      // Stage B, then abandon before commit to model interruption without
      // replacing A or touching its Keystore/clinical state.
      const beforeStage=execFileSync(adb,['-s',serial,'shell','dumpsys','package',a.applicationId],{encoding:'utf8'});
      const originalUid=/userId=(\d+)/.exec(beforeStage)?.[1];assert(originalUid,'Installed A must have an actual Android UID');
      const staged='/data/local/tmp/opentriage-upgrade-staged.apk';
      let session;
      try{
        run(adb,['-s',serial,'push',join(bDirectory,b.artifact),staged]);
        const created=execFileSync(adb,['-s',serial,'shell','pm','install-create','-r','-S',String(b.apkBytes)],{encoding:'utf8'});
        session=/\[(\d+)\]/.exec(created)?.[1];assert(session,'Package Installer must create a real staged session');
        run(adb,['-s',serial,'shell','pm','install-write','-S',String(b.apkBytes),session,'base.apk',staged]);
      }finally{
        try{if(session)run(adb,['-s',serial,'shell','pm','install-abandon',session]);}
        finally{run(adb,['-s',serial,'shell','rm','-f',staged]);}
      }
      const unchanged=execFileSync(adb,['-s',serial,'shell','dumpsys','package',a.applicationId],{encoding:'utf8'});
      assert(unchanged.includes(`versionCode=${a.versionCode} `),'Abandoned staged upgrade must leave original APK installed');
      assert.equal(/userId=(\d+)/.exec(unchanged)?.[1],originalUid,'Interrupted staging preserves A UID');
      run(adb,['-s',serial,'shell','svc','wifi','disable']);run(adb,['-s',serial,'shell','svc','data','disable']);
      const retained=execFileSync(adb,adbShellArguments(['-s',serial,'shell','am','instrument','-w','-r','-e','class','org.opentriage.development.ReportRecoveryJourneyTest','-e','phase','offline','-e','upgrade','1','-e','apiOrigin',fixtures[0].origin,'-e','reportId',upgradeReport.id,'-e','callNumber',upgradeReport.callNumber,`${a.applicationId}.test/androidx.test.runner.AndroidJUnitRunner`]),{cwd:root,encoding:'utf8',timeout:120000});
      console.log(retained);assert.match(retained,/OK \(1 test\)/,'Original A retains exact encrypted ciphertext, Keystore/CA/enrollment/managed settings and presentation after interrupted staging');
      assert.match(retained,/retained_sha256=[a-f0-9]{64}/,'The original A must report its actual opaque retained record digest');
      run(adb,['-s',serial,'shell','am','force-stop',a.applicationId]);
      // No uninstall, data clear, downgrade flag or clinical file copying during upgrade.
      run(adb, ['-s', serial, 'install', '-r', join(bDirectory, b.artifact)]);
      const installed = execFileSync(adb, ['-s', serial, 'shell', 'dumpsys', 'package', b.applicationId], { encoding: 'utf8' });
      assert(installed.includes(`versionCode=${b.versionCode} `), 'Release B actually installed');
      const rejected = spawnSync(adb, ['-s', serial, 'install', '-r', join(aDirectory, a.artifact)], { encoding: 'utf8' });
      assert.notEqual(rejected.status, 0, 'Ordinary package installation must reject downgrade');
      assert.match(rejected.stdout + rejected.stderr, /INSTALL_FAILED_VERSION_DOWNGRADE/);
    } });
  policyInstrument(b.versionCode,200);
  const evidence = { schemaVersion: 1, status: 'passed', testSourceCommit, preparationProfile, serverAndroidApiProtocol, serverAndroidApiCapabilities, releaseA: a, releaseB: b, androidApi: execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], { encoding: 'utf8' }).trim(), assertions: [...requiredUpgradeAssertions,...requiredUpgradeGateAssertions], deviceScope: 'isolated Android emulator; physical/MDM rollout remains separate' };
  await writeFile(join(bDirectory, 'upgrade-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  policy({});
  console.log('PASS permanent production identity A/B upgrade with retained managed pairing, presentation and encrypted pending work');
} catch (error) {
  await preserveAndroidFailure(error, {root,adb,serial,applicationId:'org.opentriage.android'});
} finally {
  restoreAndroidDisplay(restoreDisplay);
  if (ownsController) spawnSync(adb, ['-s', serial, 'shell', 'dpm', 'remove-active-admin', 'org.opentriage.managementtest/.AdminReceiver'], { stdio: 'inherit' });
  await stopFixtureChildren(children);
  spawnSync(process.env.DOCKER_COMMAND ?? 'docker', ['rm', '--force', container], { stdio: 'inherit' });
}
}).finally(()=>rm(directory,{recursive:true,force:true}));
