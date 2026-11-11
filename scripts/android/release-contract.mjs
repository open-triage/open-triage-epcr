import { ANDROID_CLIENT_API_PROTOCOL_RANGE, isAndroidApiProtocolCompatible } from '@open-triage/contracts/android-client-protocol';
import assert from 'node:assert/strict';
export const applicationId = 'org.opentriage.android';
export const compatibility = Object.freeze({ pairingArtifact: 1, protectedReportSchema: 1, recoveryEnvelope: 1, api: ANDROID_CLIENT_API_PROTOCOL_RANGE });
export function validateReleaseInputs(env) {
  for (const name of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_CERTIFICATE_SHA256', 'ANDROID_VERSION_CODE', 'ANDROID_VERSION_NAME']) assert(env[name], `Missing required ${name}`);
  assert(/^[1-9]\d{0,9}$/.test(env.ANDROID_VERSION_CODE) && Number(env.ANDROID_VERSION_CODE) <= 2100000000, 'Invalid Android version code');
  assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(env.ANDROID_VERSION_NAME), 'Invalid Android version name');
  assert(/^[a-fA-F0-9]{64}$/.test(env.ANDROID_CERTIFICATE_SHA256), 'Expected SHA-256 certificate digest without separators');
  return { applicationId, versionCode: Number(env.ANDROID_VERSION_CODE), versionName: env.ANDROID_VERSION_NAME, certificateSha256: env.ANDROID_CERTIFICATE_SHA256.toLowerCase() };
}
export function validateUpgrade(previous, next) {
  assert.equal(next.applicationId, previous.applicationId, 'Upgrade application identity changed');
  assert.equal(next.certificateSha256, previous.certificateSha256, 'Upgrade signing certificate changed');
  assert(next.versionCode > previous.versionCode, 'Android version code must increase');
  assert.notEqual(next.apkSha256, previous.apkSha256, 'Upgrade must identify a new immutable APK');
}
export function verifyApkMetadata(metadata, signature, expected) {
  const match = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(metadata);
  assert(match, 'APK package metadata missing');
  assert.equal(match[1], expected.applicationId); assert.equal(Number(match[2]), expected.versionCode); assert.equal(match[3], expected.versionName);
  assert(!/application-debuggable/.test(metadata), 'Production APK must not be debuggable');
  assert.equal(/Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)/.exec(signature)?.[1]?.toLowerCase(), expected.certificateSha256, 'Unexpected production signing certificate');
  assert(!/Signer #2 certificate/.test(signature), 'Unexpected extra APK signer');
}
export const requiredUpgradeAssertions = Object.freeze(['in-place-install-r', 'downgrade-rejected', 'same-uid', 'keystore-connection-ca-enrollment', 'managed-policy', 'presentation-preference', 'exact-pending-ciphertext', 'offline-no-plaintext', 'other-clinician-denied', 'original-clinician-recovery-sync', 'pinned-versions-and-deadline', 'packaged-ui-no-service-worker', 'remote-web-deployment-keeps-installed-ui']);
export function validatePublicationEvidence(descriptor, evidence, preflight, identity) {
  assert.equal(descriptor.applicationId, identity.applicationId); assert.equal(descriptor.certificateSha256, identity.certificateSha256);
  assert.match(descriptor.sourceCommit, /^[a-f0-9]{40}$/);
  assert(isAndroidApiProtocolCompatible(descriptor.compatibility?.api, evidence.serverAndroidApiProtocol), 'Release must support the actually tested server protocol');
  assert.equal(evidence.status, 'passed'); validateUpgrade(evidence.releaseA, evidence.releaseB);
  const covered = [evidence.releaseA, evidence.releaseB].find(value => value.apkSha256 === descriptor.apkSha256);
  assert.deepEqual(covered, descriptor, 'Evidence must cover the complete exact release descriptor');
  assert.equal(evidence.releaseB.sourceCommit, descriptor.sourceCommit, 'Evidence must cover the release source');
  assert(Number(evidence.androidApi) >= descriptor.minAndroidApi, 'Supported Android runtime acceptance is required');
  for (const assertion of requiredUpgradeAssertions) assert(evidence.assertions?.includes(assertion), `Missing upgrade acceptance: ${assertion}`);
  assert.equal(preflight.status, 'passed'); assert.equal(preflight.command, 'npm run check:ci'); assert.equal(preflight.sourceCommit, descriptor.sourceCommit);
}
