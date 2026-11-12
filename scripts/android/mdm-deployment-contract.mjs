import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approvedAndroidReleaseUrl, parseAndroidReleaseDescriptor} from '../../packages/contracts/android-release.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Select the same immutable artifact as Admin; never infer an approved APK from its filename. */
export function approvedMdmRelease(catalog, tag) {
  const matches = catalog.releases.filter(value => value.tag === tag);
  assert.equal(matches.length, 1, 'Select one explicitly approved release tag');
  const selected = matches[0], descriptor = parseAndroidReleaseDescriptor(selected.descriptor);
  assert.equal(descriptor.applicationId, catalog.signingIdentity.applicationId);
  assert.equal(descriptor.certificateSha256, catalog.signingIdentity.certificateSha256);
  assert.equal(selected.downloadUrl, approvedAndroidReleaseUrl(tag, descriptor));
  return {...selected, descriptor};
}

/** Verify a rehosted MDM APK without forwarding private console cookies to its download URL. */
export async function verifyMdmDownload(url, allowedOrigin, descriptor, fetcher = fetch) {
  const target = new URL(url), origin = new URL(allowedOrigin);
  assert.equal(origin.href, origin.origin + '/', 'Supply an exact MDM origin');
  assert.equal(target.origin, origin.origin, 'MDM download escaped the selected origin');
  assert(!target.username && !target.password && !target.hash && !target.search, 'MDM artifact URL must be public and immutable');
  assert(target.protocol === 'https:' || (target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname)), 'HTTP is limited to the isolated loopback lab');
  assert(Number.isSafeInteger(descriptor.apkBytes) && descriptor.apkBytes > 0 && descriptor.apkBytes <= 128 * 1024 * 1024);
  assert.match(descriptor.apkSha256, /^[a-f0-9]{64}$/);
  const response = await fetcher(target.href, {redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20_000), headers: {'accept-encoding': 'identity'}});
  if (response.status !== 200 || !response.body || (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== descriptor.apkBytes)) {
    await response.body?.cancel();
    throw new Error('MDM artifact response changed or redirected');
  }
  const hash = createHash('sha256'), reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      assert(bytes <= descriptor.apkBytes, 'MDM artifact exceeds approved length');
      hash.update(value);
    }
    assert.equal(bytes, descriptor.apkBytes, 'MDM artifact length changed');
    assert.equal(hash.digest('hex'), descriptor.apkSha256, 'MDM artifact digest changed');
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return {apkSha256: descriptor.apkSha256, apkBytes: bytes};
}

/** Validate actual console target rows, including dangerous remove/skip-version selections. */
export function headwindDeploymentTarget(configuration, device, descriptor, mdmUrl) {
  assert(Number.isSafeInteger(configuration.id) && configuration.id > 0, 'Configuration identity required');
  assert.equal(device.configurationId, configuration.id, 'Device targets another configuration');
  assert(!configuration.applications.some(value => value.pkg === 'com.hmdm.launcher' && String(value.action ?? 0) !== '0'),
    'Acceptance configuration must preserve the independently installed removable test agent');
  const applications = configuration.applications.filter(value => value.pkg === descriptor.applicationId && String(value.action) !== '0');
  assert.equal(applications.length, 1, 'Exactly one selected clinical APK is required');
  const application = applications[0];
  assert(!application.remove && String(application.action) === '1', 'Target would remove retained clinical work');
  assert(!application.skipVersion, 'Version targeting must remain explicit');
  assert.equal(application.version, descriptor.versionName, 'Wrong targeted APK version');
  // Headwind can omit code or record zero; this is not proof of an installed Android version.
  if (application.versionCode != null && application.versionCode !== 0) assert.equal(application.versionCode, descriptor.versionCode, 'Wrong targeted APK code');
  assert.equal(application.url, mdmUrl, 'Target points to another APK URL');
  const settings = configuration.applicationSettings.filter(value => value.applicationPkg === descriptor.applicationId);
  assert(settings.length > 0, 'Configuration lost clinical managed settings');
  const policy = settings.map(({name, type, value, readonly, variable}) => ({name, type, value, readonly, variable}))
    .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  return {configurationId: configuration.id, applicationId: descriptor.applicationId, versionCode: descriptor.versionCode,
    versionName: descriptor.versionName, certificateSha256: descriptor.certificateSha256, apkSha256: descriptor.apkSha256, policySha256: sha256(JSON.stringify(policy))};
}

/** The server reports version names only: require an independent Android metadata observation. */
export function headwindInstalledInventory(device, descriptor, installed, notBefore) {
  assert(Number.isSafeInteger(notBefore) && notBefore > 0, 'Deployment start timestamp required');
  assert(Number.isSafeInteger(device.lastUpdate) && device.lastUpdate >= notBefore, 'Inventory predates deployment');
  const matches = device.info?.applications?.filter(value => value.pkg === descriptor.applicationId) ?? [];
  assert.equal(matches.length, 1, 'Clinical app absent or duplicated in actual server inventory');
  assert.equal(matches[0].version, descriptor.versionName, 'Server inventory reports another installed version');
  assert.equal(installed.applicationId, descriptor.applicationId);
  assert.equal(installed.versionCode, descriptor.versionCode, 'Android installed code differs');
  assert.equal(installed.versionName, descriptor.versionName);
  assert.equal(installed.certificateSha256, descriptor.certificateSha256, 'Android installed signer differs');
  assert(Number.isSafeInteger(installed.uid) && installed.uid >= 10000, 'Clinical app must use an ordinary application UID');
  assert.equal(Number.isSafeInteger(installed.observedAt) && installed.observedAt >= notBefore, true, 'Android metadata predates deployment');
  return {versionName: matches[0].version, versionCode: installed.versionCode, uid: installed.uid, inventoryAt: device.lastUpdate};
}

export function retainedMdmUpgrade(before, after) {
  for (const snapshot of [before, after]) {
    assert(Number.isSafeInteger(snapshot.configurationId) && snapshot.configurationId > 0, 'Upgrade target identity required');
    assert(Number.isSafeInteger(snapshot.versionCode) && snapshot.versionCode > 0, 'Upgrade code observation required');
    assert(typeof snapshot.applicationId === 'string' && snapshot.applicationId.length > 0, 'Upgrade application identity required');
    for (const key of ['certificateSha256', 'apkSha256', 'policySha256']) assert.match(snapshot[key] ?? '', /^[a-f0-9]{64}$/, `Upgrade ${key} observation required`);
  }
  assert.equal(after.configurationId, before.configurationId, 'Upgrade changed device targeting');
  assert.equal(after.applicationId, before.applicationId, 'Upgrade changed clinical application');
  assert.equal(after.certificateSha256, before.certificateSha256, 'Upgrade changed clinical signer');
  assert(after.versionCode > before.versionCode, 'Upgrade code must increase');
  assert.notEqual(after.apkSha256, before.apkSha256, 'Upgrade reused the original artifact');
  assert.equal(after.policySha256, before.policySha256, 'Upgrade lost or changed managed configuration');
}
