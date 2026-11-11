import { stopFixtureChildren } from './android/fixture-processes.mjs';
import { execFileSync, fork, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepareFixtures } from './android/fixtures.mjs';
import { fixtureApi as api } from './android/fixture-client.mjs';
import { runManagedJourneys } from './android/managed-journey.mjs';
import { runReassignmentTransition } from './android/reassignment-journey.mjs';
import { runReportRecoveryJourney } from './android/report-journey.mjs';

const root = resolve(import.meta.dirname, '..'), directory = await mkdtemp(join(tmpdir(), 'open-triage-android-'));
const docker = process.env.DOCKER_COMMAND || 'docker', container = `open-triage-android-${randomUUID()}`;
const adb = join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '', 'platform-tools/adb');
const serial = process.env.ANDROID_SERIAL || 'emulator-5554', children = [];
let ownsContainer = false;
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
try {
  assert.equal(execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).trim(), '1', 'Start an Android 13+ emulator and wait for boot before running android:test.');
  if (!process.argv.includes('--skip-build')) { run('npm', ['run', 'android:build']); run('npm', ['run', 'build', '-w', '@open-triage/api']); }
  const fixturesArgument = process.argv.indexOf('--fixtures');
  let fixtures;
  if (fixturesArgument !== -1) fixtures = JSON.parse(await readFile(process.argv[fixturesArgument + 1], 'utf8'));
  else { ownsContainer = true; fixtures = await prepareFixtures(root, directory, run, docker, container); }
  run(adb, ['-s', serial, 'install', '-r', join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')]);
  run(adb, ['-s', serial, 'install', '-r', join(root, 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]);
  run(adb, ['-s', serial, 'shell', 'pm', 'clear', 'org.opentriage.development']);
  const legacyVault = execFileSync(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'org.opentriage.development.LegacyConnectionVaultTest', 'org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner'], {cwd: root, encoding: 'utf8', timeout: 600000});
  console.log(legacyVault); assert.match(legacyVault, /OK \(1 test\)/, 'Actual Keystore legacy provenance migration');
  const startup = execFileSync(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'org.opentriage.development.NativeStartupTest', 'org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner'], {cwd: root, encoding: 'utf8', timeout: 600000});
  console.log(startup); assert.match(startup, /OK \(1 test\)/, 'Actual installed native startup excludes remote font providers');
  for (const fixture of fixtures) {
    const file = join(directory, `fixture-${fixture.index}.json`); await writeFile(file, JSON.stringify(fixture));
    if (!process.argv.includes('--external-apis')) {
      const child = fork(fileURLToPath(new URL('./android/fixture-api.mjs', import.meta.url)), [file], { cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }); children.push(child);
      await new Promise((ready, reject) => { const timer = setTimeout(() => reject(new Error('Synthetic API startup timed out')), 45000); child.once('message', () => { clearTimeout(timer); ready(); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic API exited (${code})`)); }); });
    }
  }
  if (!process.argv.includes('--report-only')) for (const fixture of fixtures) for (const entry of ['import', 'scan']) {
    const ca = await readFile(fixture.caPath);
    const login = await api(fixture, ca, 'sessions', 'POST', { username: fixture.administrator.username, password: fixture.administratorPassword });
    assert.equal(login.status, 201, 'Synthetic administrator login');
    const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const beforeInventory = await api(fixture, ca, `admin/units/${fixture.unitId}/installations`, 'GET', undefined, { Cookie: cookie, 'x-organization-id': fixture.organizationId });
    assert.equal(beforeInventory.status, 200);
    const issued = await api(fixture, ca, `admin/units/${fixture.unitId}/enrollment`, 'POST', {}, { Cookie: cookie, 'x-csrf-token': login.body.csrfToken, 'x-organization-id': fixture.organizationId });
    assert.equal(issued.status, 201, 'Synthetic pairing issuance');
    const artifact = { version: 1, ...issued.body, caPem: ca.toString('utf8') };
    run(adb, ['-s', serial, 'shell', 'pm', 'clear', 'org.opentriage.development']);
    if (entry === 'scan') run(adb, ['-s', serial, 'shell', 'pm', 'revoke', 'org.opentriage.development', 'android.permission.CAMERA']);
    const journey = entry === 'scan' ? 'ScanPairingJourneyTest' : 'PairingJourneyTest';
    const result = execFileSync(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', `org.opentriage.development.${journey}`, '-e', 'artifactBase64', Buffer.from(JSON.stringify(artifact)).toString('base64'), '-e', 'wrongOrigin', fixtures.find(other => other.index !== fixture.index).origin, '-e', 'username', fixture.clinician.username, '-e', 'password', fixture.clinicianPassword, 'org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner'], { cwd: root, encoding: 'utf8', timeout: 600000 });
    console.log(result); assert.match(result, /OK \(1 test\)/, `Fixture ${fixture.index}: Android journey must pass`);
    const inventory = await api(fixture, ca, `admin/units/${fixture.unitId}/installations`, 'GET', undefined, { Cookie: cookie, 'x-organization-id': fixture.organizationId });
    assert.equal(inventory.status, 200); assert(inventory.body.items.some(item => item.name === 'Synthetic emulator ambulance'));
    assert.equal(inventory.body.items.length, beforeInventory.body.items.length + 1, 'A confirmed import/scan attempt creates exactly one installation');
    const replay = await api(fixture, ca, 'installations/preview', 'POST', { token: issued.body.token }, { 'x-installation-enrollment': '1' });
    assert.equal(replay.status, 401, 'Confirmed enrollment authorization must reject replay');
    console.log(`PASS fixture ${fixture.index} ${entry}: same APK, private CA, pairing/confirm/login/assigned calls/logout/retained pairing/inventory/replay rejection`);
  }
  await runReportRecoveryJourney({ root, fixture: fixtures[0], adb, serial, run, api, hooks: { beforeReconnect: runReassignmentTransition } });
  await runManagedJourneys({root, fixtures, run, api, adb, serial});
} finally {
  await stopFixtureChildren(children);
  if (ownsContainer) spawnSync(docker, ['rm', '--force', container], { stdio: 'inherit' });
  await rm(directory, { recursive: true, force: true });
}
