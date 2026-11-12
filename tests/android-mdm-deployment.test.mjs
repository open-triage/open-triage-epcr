import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {approvedMdmRelease, verifyMdmDownload, headwindDeploymentTarget, headwindInstalledInventory, retainedMdmUpgrade} from '../scripts/android/mdm-deployment-contract.mjs';
import catalog from '../packages/contracts/config/android-releases.json' with {type: 'json'};

const selected = catalog.releases[0], descriptor = selected.descriptor;
const mdmUrl = 'http://127.0.0.1:18080/files/approved.apk';
const configuration = {id: 4, applications: [{pkg: descriptor.applicationId, selected: true, action: 1, version: descriptor.versionName, versionCode: 0, url: mdmUrl}],
  applicationSettings: [{applicationPkg: descriptor.applicationId, name: 'managedConfig', type: 'STRING', value: '{"configurationVersion":1,"serverOrigin":"https://fixture.invalid","publicCaPem":""}', readonly: true, variable: false}]};
const device = {configurationId: 4, lastUpdate: 200, info: {applications: [{pkg: descriptor.applicationId, version: descriptor.versionName}]}};
const installed = {applicationId: descriptor.applicationId, versionCode: descriptor.versionCode, versionName: descriptor.versionName,
  certificateSha256: descriptor.certificateSha256, apkSha256: descriptor.apkSha256, apkBytes: descriptor.apkBytes, uid: 10123, observedAt: 200};
const clone = value => structuredClone(value);

test('MDM artifact selection is bound to Admin catalog identity and complete approved URL', () => {
  assert.deepEqual(approvedMdmRelease(catalog, selected.tag).descriptor, descriptor);
  for (const mutation of [c => c.releases.push(clone(selected)), c => c.releases[0].downloadUrl += '?changed',
    c => c.signingIdentity.certificateSha256 = 'f'.repeat(64), c => c.releases[0].descriptor.applicationId = 'org.other.app']) {
    const altered = clone(catalog); mutation(altered); assert.throws(() => approvedMdmRelease(altered, selected.tag));
  }
  assert.throws(() => approvedMdmRelease(catalog, 'latest'));
});

test('real MDM rehost verifies exact streamed bytes and never sends console credentials or follows redirects', async () => {
  const bytes = Buffer.from('synthetic APK bytes'), expected = {apkBytes: bytes.length, apkSha256: createHash('sha256').update(bytes).digest('hex')};
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, mdmUrl); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(Object.keys(options.headers), ['accept-encoding']);
    return new Response(new ReadableStream({start(controller) {controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close();}}));
  };
  assert.deepEqual(await verifyMdmDownload(mdmUrl, 'http://127.0.0.1:18080', expected, fetcher), expected);
  assert.equal(calls, 1);
  for (const response of [new Response(bytes.subarray(1)), new Response(Buffer.alloc(bytes.length)), new Response(Buffer.concat([bytes, bytes])),
    new Response(null, {status: 302, headers: {location: 'https://other.invalid/a.apk'}}), new Response(bytes, {headers: {'content-length': '999'}})]) {
    await assert.rejects(verifyMdmDownload(mdmUrl, 'http://127.0.0.1:18080', expected, async () => response));
  }
  for (const url of ['http://other.invalid/a.apk', mdmUrl + '?token=private', mdmUrl + '#fragment', 'http://user:secret@127.0.0.1:18080/a.apk']) {
    await assert.rejects(verifyMdmDownload(url, 'http://127.0.0.1:18080', expected, fetcher));
  }
  await assert.rejects(verifyMdmDownload('http://mdm.invalid/a.apk', 'http://mdm.invalid', expected, fetcher));
});

test('target validation catches wrong devices, remove actions, skipped versions, duplicate APKs and lost policy', () => {
  const snapshot = headwindDeploymentTarget(configuration, device, descriptor, mdmUrl);
  assert.match(snapshot.policySha256, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(snapshot).includes('fixture.invalid'), 'Evidence exposes only policy digest');
  for (const mutation of [c => c.applications[0].action = 0, c => c.applications[0].action = '2', c => c.applications[0].remove = true,
    c => c.applications[0].skipVersion = true, c => c.applications[0].version = '0', c => c.applications[0].versionCode = 999,
    c => c.applications[0].url += '.changed', c => c.applications.push(clone(c.applications[0])), c => c.applicationSettings = []]) {
    const altered = clone(configuration); mutation(altered); assert.throws(() => headwindDeploymentTarget(altered, device, descriptor, mdmUrl));
  }
  assert.throws(() => headwindDeploymentTarget(configuration, {...device, configurationId: 9}, descriptor, mdmUrl));
  for (const action of [1, 2, '1', '2']) {
    const altered = clone(configuration); altered.applications.push({pkg: 'com.hmdm.launcher', action, version: '6.37'});
    assert.throws(() => headwindDeploymentTarget(altered, device, descriptor, mdmUrl), /removable test agent/);
  }
});

test('version-name-only or stale management inventory cannot establish the actual installed Android identity', () => {
  assert.equal(headwindInstalledInventory(device, descriptor, installed, 100).versionCode, descriptor.versionCode);
  for (const change of [{versionCode: 999}, {certificateSha256: 'f'.repeat(64)}, {uid: 1000}, {observedAt: 99}, {observedAt: '200'}, {applicationId: 'org.other.app'}]) {
    assert.throws(() => headwindInstalledInventory(device, descriptor, {...installed, ...change}, 100));
  }
  assert.throws(() => headwindInstalledInventory({...device, lastUpdate: 99}, descriptor, installed, 100));
  assert.throws(() => headwindInstalledInventory({...device, info: {applications: []}}, descriptor, installed, 100));
  assert.throws(() => headwindInstalledInventory(device, descriptor, {}, 100));
});

test('an installed APK with the approved version and signer still requires the exact approved bytes', () => {
  const observed = headwindInstalledInventory(device, descriptor, installed, 100);
  assert.equal(observed.apkSha256, descriptor.apkSha256);
  assert.equal(observed.apkBytes, descriptor.apkBytes);
  for (const change of [{apkSha256: '0'.repeat(64)}, {apkBytes: descriptor.apkBytes - 1},
    {apkSha256: undefined}, {apkBytes: undefined}, {apkBytes: String(descriptor.apkBytes)}]) {
    assert.throws(() => headwindInstalledInventory(device, descriptor, {...installed, ...change}, 100));
  }
});

test('upgrade keeps target and policy exactly, including changes to types, readonly and substitutions', () => {
  const before = headwindDeploymentTarget(configuration, device, descriptor, mdmUrl);
  const after = {...before, versionCode: before.versionCode + 1, apkSha256: 'f'.repeat(64)};
  retainedMdmUpgrade(before, after);
  for (const key of ['configurationId', 'applicationId', 'versionCode', 'certificateSha256', 'apkSha256', 'policySha256']) {
    const missing = {...before}; delete missing[key]; assert.throws(() => retainedMdmUpgrade(missing, after));
  }
  for (const change of [{certificateSha256: 'e'.repeat(64)}, {configurationId: 9}, {applicationId: 'org.other.app'}, {versionCode: before.versionCode}, {apkSha256: before.apkSha256}]) {
    assert.throws(() => retainedMdmUpgrade(before, {...after, ...change}));
  }
  for (const change of [{type: 'INTEGER'}, {readonly: false}, {variable: true}, {value: '{}'}]) {
    const altered = clone(configuration); Object.assign(altered.applicationSettings[0], change);
    const policy = headwindDeploymentTarget(altered, device, descriptor, mdmUrl);
    assert.throws(() => retainedMdmUpgrade(before, {...after, policySha256: policy.policySha256}));
  }
});
