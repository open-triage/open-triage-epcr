import { issueNamedFixtureEnrollment } from './pairing-fixture.mjs';
import {adbShellArguments} from './instrumentation.mjs';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

/** Exercise Android-standard management independently of scanner/offline fixture modules. */
export async function runManagedJourneys({root, fixtures, run, api, adb, serial}) {
  let ownsManagement = false;
  try {
    // The management controller is a separate test-only APK, never a clinical app role.
    run(adb, ['-s', serial, 'install', '-t', '-r', join(root, 'android/management-test-controller/build/outputs/apk/debug/management-test-controller-debug.apk')]);
    run(adb, ['-s', serial, 'shell', 'dpm', 'set-device-owner', 'org.opentriage.managementtest/.AdminReceiver']);
    ownsManagement = true;
    for (const fixture of fixtures) {
      const ca = await readFile(fixture.caPath);
      const login = await api(fixture, ca, 'sessions', 'POST', { username: fixture.administrator.username, password: fixture.administratorPassword });
      assert.equal(login.status, 201);
      const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
      const issued = await issueNamedFixtureEnrollment(api, fixture, ca, { Cookie: cookie, 'x-csrf-token': login.body.csrfToken, 'x-organization-id': fixture.organizationId }, 'Managed emulator ambulance');
      assert.equal(issued.status, 201);
      const artifact = { version: 1, ...issued.body, caPem: ca.toString('utf8') };
      run(adb, ['-s', serial, 'shell', 'pm', 'clear', 'org.opentriage.development']);
      const result = execFileSync(adb, adbShellArguments(['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'org.opentriage.development.ManagedConfigurationJourneyTest#standardManagementLocksAndSafelyTransitionsTheGenericApk', '-e', 'artifactBase64', Buffer.from(JSON.stringify(artifact)).toString('base64'), '-e', 'wrongOrigin', fixtures.find(other => other.index !== fixture.index).origin, 'org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner']), { cwd: root, encoding: 'utf8', timeout: 600000 });
      console.log(result); assert.match(result, /OK \(1 test\)/, `Fixture ${fixture.index}: standard managed-configuration journey must pass`);
      run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'org.opentriage.development']);
      const restarted = execFileSync(adb, adbShellArguments(['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'org.opentriage.development.ManagedConfigurationJourneyTest#missingPolicyRemainsLockedAfterProcessRestart', '-e', 'artifactBase64', Buffer.from(JSON.stringify(artifact)).toString('base64'), 'org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner']), {cwd: root, encoding: 'utf8', timeout: 600000});
      console.log(restarted); assert.match(restarted, /OK \(1 test\)/, `Fixture ${fixture.index}: managed policy and encrypted enrollment must survive process restart`);
      const inventory = await api(fixture, ca, `admin/units/${fixture.unitId}/installations`, 'GET', undefined, { Cookie: cookie, 'x-organization-id': fixture.organizationId });
      assert.equal(inventory.status, 200); assert(inventory.body.items.some(item => item.name === 'Managed emulator ambulance'));
      console.log(`PASS managed fixture ${fixture.index}: standard policy delivery, matching pairing, override rejection, pending/missing/malformed/changed policy, restored encrypted enrollment and restart`);
    }
  } finally {
    if (ownsManagement) {
      spawnSync(adb, ['-s', serial, 'shell', 'am', 'broadcast', '--include-stopped-packages', '-a', 'org.opentriage.managementtest.SET_CONFIGURATION', '-n', 'org.opentriage.managementtest/.ConfigurationReceiver', '--es', 'configurationBase64', Buffer.from('{}').toString('base64')], {stdio: 'inherit'});
      spawnSync(adb, ['-s', serial, 'shell', 'dpm', 'remove-active-admin', 'org.opentriage.managementtest/.AdminReceiver'], {stdio: 'inherit'});
    }
  }
}
