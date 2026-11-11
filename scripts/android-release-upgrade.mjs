import { preserveAndroidFailure } from './android/diagnostics.mjs';
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
import { validateUpgrade, verifyApkMetadata, requiredUpgradeAssertions } from './android/release-contract.mjs';
const root = resolve(import.meta.dirname, '..');
const [aDirectory, bDirectory] = process.argv.slice(2).map(value => resolve(value));
assert(aDirectory && bDirectory, 'Supply release A and B artifact directories');
const a = JSON.parse(await readFile(join(aDirectory, 'release.json'))), b = JSON.parse(await readFile(join(bDirectory, 'release.json')));
validateUpgrade(a, b);
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
const directory = await mkdtemp(join(tmpdir(), 'open-triage-upgrade-')), container = `open-triage-upgrade-${randomUUID()}`;
const children = []; let ownsController = false;
try {
  const fixtures = await prepareFixtures(root, directory, run, process.env.DOCKER_COMMAND ?? 'docker', container);
  for (const fixture of fixtures) {
    const file = join(directory, `fixture-${fixture.index}.json`); await writeFile(file, JSON.stringify(fixture));
    const child = fork(fileURLToPath(new URL('./android/fixture-api.mjs', import.meta.url)), [file], { cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }); children.push(child);
    await new Promise((ready, reject) => { const timer = setTimeout(() => reject(new Error('Synthetic API startup timeout')), 45000); child.once('message', () => { clearTimeout(timer); ready(); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic API exited ${code}`)); }); });
  }
  const health = await api(fixtures[0], await readFile(fixtures[0].caPath), 'health');
  assert.equal(health.status, 200);
  const serverAndroidApiProtocol = health.body.androidApiProtocol;
  const serverAndroidApiCapabilities = health.body.androidApiCapabilities ?? [];
  for (const descriptor of [a, b]) assert(isAndroidReleaseCompatible(descriptor, serverAndroidApiProtocol, serverAndroidApiCapabilities), 'A/B client must support the real server protocol and capabilities');
  // Only initial synthetic setup is reset. A-to-B itself never clears/uninstalls data.
  const previousFixture = spawnSync(adb, ['-s', serial, 'shell', 'pm', 'path', a.applicationId], { encoding: 'utf8' });
  if (previousFixture.status === 0 && previousFixture.stdout.includes('package:')) run(adb, ['-s', serial, 'uninstall', a.applicationId]);
  run(adb, ['-s', serial, 'install', '-r', join(aDirectory, a.artifact)]);
  run(adb, ['-s', serial, 'install', '-r', join(root, 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk')]);
  run(adb, ['-s', serial, 'install', '-t', '-r', join(root, 'android/management-test-controller/build/outputs/apk/debug/management-test-controller-debug.apk')]);
  run(adb, ['-s', serial, 'shell', 'dpm', 'set-device-owner', 'org.opentriage.managementtest/.AdminReceiver']); ownsController = true;
  const restrictions = { configurationVersion: 1, serverOrigin: fixtures[0].origin, publicCaPem: await readFile(fixtures[0].caPath, 'utf8') };
  const policy = value => run(adb, ['-s', serial, 'shell', 'am', 'broadcast', '--include-stopped-packages', '-a', 'org.opentriage.managementtest.SET_CONFIGURATION', '-n', 'org.opentriage.managementtest/.ConfigurationReceiver', '--es', 'targetPackage', 'org.opentriage.android', '--es', 'configurationBase64', Buffer.from(JSON.stringify(value)).toString('base64')]);
  policy(restrictions);
  await runReportRecoveryJourney({ root, fixture: fixtures[0], adb, serial, run, api, applicationId: 'org.opentriage.android', upgrade: true,
    afterProcessStop: async () => {
      // No uninstall, data clear, downgrade flag or direct file copying during upgrade.
      run(adb, ['-s', serial, 'install', '-r', join(bDirectory, b.artifact)]);
      const installed = execFileSync(adb, ['-s', serial, 'shell', 'dumpsys', 'package', b.applicationId], { encoding: 'utf8' });
      assert(installed.includes(`versionCode=${b.versionCode} `), 'Release B actually installed');
      const rejected = spawnSync(adb, ['-s', serial, 'install', '-r', join(aDirectory, a.artifact)], { encoding: 'utf8' });
      assert.notEqual(rejected.status, 0, 'Ordinary package installation must reject downgrade');
      assert.match(rejected.stdout + rejected.stderr, /INSTALL_FAILED_VERSION_DOWNGRADE/);
    } });
  const evidence = { schemaVersion: 1, status: 'passed', serverAndroidApiProtocol, serverAndroidApiCapabilities, releaseA: a, releaseB: b, androidApi: execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], { encoding: 'utf8' }).trim(), assertions: requiredUpgradeAssertions, deviceScope: 'isolated Android emulator; physical/MDM rollout remains separate' };
  await writeFile(join(bDirectory, 'upgrade-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  policy({});
  console.log('PASS permanent production identity A/B upgrade with retained managed pairing, presentation and encrypted pending work');
} catch (error) {
  await preserveAndroidFailure(error, {root,adb,serial,applicationId:'org.opentriage.android'});
} finally {
  if (ownsController) spawnSync(adb, ['-s', serial, 'shell', 'dpm', 'remove-active-admin', 'org.opentriage.managementtest/.AdminReceiver'], { stdio: 'inherit' });
  for (const child of children) child.kill('SIGTERM');
  spawnSync(process.env.DOCKER_COMMAND ?? 'docker', ['rm', '--force', container], { stdio: 'inherit' });
  await rm(directory, { recursive: true, force: true });
}
