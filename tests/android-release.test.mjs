import { isAndroidReleaseCompatible } from '@open-triage/contracts/android-release';
import { ANDROID_API_PROTOCOL_VERSION, ANDROID_API_CAPABILITIES, ANDROID_CLIENT_REQUIRED_CAPABILITIES, ANDROID_CLIENT_API_PROTOCOL_RANGE, isAndroidApiProtocolCompatible } from '@open-triage/contracts/android-client-protocol';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibility, validateReleaseInputs, validateUpgrade, verifyApkMetadata, validatePublicationEvidence, requiredUpgradeAssertions, requiredUpgradeGateAssertions } from '../scripts/android/release-contract.mjs';
const inputs = { ANDROID_KEYSTORE_PATH: '/protected/key.p12', ANDROID_KEYSTORE_PASSWORD: 'synthetic', ANDROID_KEY_PASSWORD: 'synthetic', ANDROID_KEY_ALIAS: 'synthetic', ANDROID_CERTIFICATE_SHA256: 'ab'.repeat(32), ANDROID_VERSION_CODE: '2', ANDROID_VERSION_NAME: '0.1.0-rc.2' };
const a = { applicationId: 'org.opentriage.android', versionCode: 1, certificateSha256: 'ab'.repeat(32), apkSha256: 'a'.repeat(64) };
const b = { ...a, versionCode: 2, apkSha256: 'b'.repeat(64) };
test('future live-audio clients require duration-less WebM support even from a protocol-one server', () => {
  const descriptor = { compatibility };
  assert.equal(isAndroidReleaseCompatible(descriptor, 1, ANDROID_API_CAPABILITIES.filter(value => value !== 'audio-webm-live-v1')), false);
  assert.equal(isAndroidReleaseCompatible(descriptor, 1, ANDROID_API_CAPABILITIES), true);
  assert.equal(isAndroidReleaseCompatible({ compatibility: { ...compatibility, requiredCapabilities: undefined } }, 1, []), true);
});
test('release signing fails closed for every missing required input and malformed versions/fingerprint', () => {
  assert.equal(validateReleaseInputs(inputs).versionCode, 2);
  for (const name of Object.keys(inputs)) { const missing = { ...inputs }; delete missing[name]; assert.throws(() => validateReleaseInputs(missing), /Missing required/); }
  for (const code of ['0', '-1', '1.5', '01', '2100000001', 'Infinity', '2;echo']) assert.throws(() => validateReleaseInputs({ ...inputs, ANDROID_VERSION_CODE: code }), /version code/);
  for (const version of ['latest', '1', '1.0.0/evil', '1.0.0\n']) assert.throws(() => validateReleaseInputs({ ...inputs, ANDROID_VERSION_NAME: version }), /version name/);
  assert.throws(() => validateReleaseInputs({ ...inputs, ANDROID_CERTIFICATE_SHA256: 'ab:cd' }), /digest/);
});
test('upgrade rejects changed identity, key, nonincreasing code and reused artifacts', () => {
  validateUpgrade(a, b);
  for (const changed of [{ applicationId: 'wrong' }, { certificateSha256: 'cd'.repeat(32) }, { versionCode: 1 }, { versionCode: 0 }, { apkSha256: a.apkSha256 }]) assert.throws(() => validateUpgrade(a, { ...b, ...changed }));
});
test('APK verification checks real package metadata, release flag and certificate rather than filenames', () => {
  const expected = validateReleaseInputs(inputs), metadata = "package: name='org.opentriage.android' versionCode='2' versionName='0.1.0-rc.2'", signature = `Signer #1 certificate SHA-256 digest: ${expected.certificateSha256}`;
  verifyApkMetadata(metadata, signature, expected);
  for (const altered of [metadata.replace('org.opentriage.android', 'org.opentriage.development'), metadata.replace("versionCode='2'", "versionCode='1'"), metadata.replace('rc.2', 'rc.1'), metadata + '\napplication-debuggable']) assert.throws(() => verifyApkMetadata(altered, signature, expected));
  assert.throws(() => verifyApkMetadata(metadata, signature.replace('ab', 'cd'), expected));
  assert.throws(() => verifyApkMetadata(metadata, signature + '\nSigner #2 certificate SHA-256 digest: ' + 'ab'.repeat(32), expected));
});

 test('publication rejects incomplete acceptance, mismatched descriptors and unverified preflight', () => {
  const descriptor = { ...b, sourceCommit: 'a'.repeat(40), minAndroidApi: 33, compatibility: { pairingArtifact: 1, protectedReportSchema: 1, recoveryEnvelope: 1, api: ANDROID_CLIENT_API_PROTOCOL_RANGE } };
  const evidence = { status: 'passed', serverAndroidApiProtocol: ANDROID_API_PROTOCOL_VERSION, releaseA: { ...a, sourceCommit: descriptor.sourceCommit, minAndroidApi: 33 }, releaseB: descriptor, androidApi: '33', assertions: [...requiredUpgradeAssertions] };
  const preflight = { status: 'passed', command: 'npm run check:ci', sourceCommit: descriptor.sourceCommit };
  const identity = { applicationId: b.applicationId, certificateSha256: b.certificateSha256 };
  validatePublicationEvidence(descriptor, evidence, preflight, identity);
  for (const missing of requiredUpgradeAssertions) assert.throws(() => validatePublicationEvidence(descriptor, { ...evidence, assertions: evidence.assertions.filter(value => value !== missing) }, preflight, identity), /Missing upgrade acceptance/);
  for (const altered of [{ status: 'failed' }, { serverAndroidApiProtocol: 2 }, { serverAndroidApiProtocol: undefined }, { androidApi: '32' }, { releaseB: { ...descriptor, uiSha256: 'tampered' } }]) assert.throws(() => validatePublicationEvidence(descriptor, { ...evidence, ...altered }, preflight, identity));
  for (const altered of [{ status: 'failed' }, { command: 'npm test' }, { sourceCommit: 'b'.repeat(40) }]) assert.throws(() => validatePublicationEvidence(descriptor, evidence, { ...preflight, ...altered }, identity));
});

test('API compatibility uses an explicit protocol range across source revisions and rejects unsupported or missing contracts', () => {
  assert(isAndroidApiProtocolCompatible(ANDROID_CLIENT_API_PROTOCOL_RANGE, ANDROID_API_PROTOCOL_VERSION));
  assert(isAndroidApiProtocolCompatible({ minimum: 1, maximum: 2 }, 1));
  assert(isAndroidApiProtocolCompatible({ minimum: 1, maximum: 2 }, 2));
  for (const version of [undefined, null, 0, 2, '1', 1.5, NaN]) assert.equal(isAndroidApiProtocolCompatible(ANDROID_CLIENT_API_PROTOCOL_RANGE, version), false);
  for (const range of [undefined, null, { minimum: 0, maximum: 1 }, { minimum: 2, maximum: 1 }, { minimum: 1.5, maximum: 2 }]) assert.equal(isAndroidApiProtocolCompatible(range, 1), false);
});

test('publication requires acceptance evidence for every native extension required by a future APK', () => {
  const descriptor = { ...b, sourceCommit: 'a'.repeat(40), minAndroidApi: 33,
    compatibility: { pairingArtifact: 1, protectedReportSchema: 1, recoveryEnvelope: 1, api: ANDROID_CLIENT_API_PROTOCOL_RANGE, requiredCapabilities: ['native-enrollment-attempt-v1'] } };
  const evidence = { status: 'passed', serverAndroidApiProtocol: 1, releaseA: { ...a, sourceCommit: descriptor.sourceCommit },
    releaseB: descriptor, androidApi: '33', assertions: [...requiredUpgradeAssertions] };
  const preflight = { status: 'passed', command: 'npm run check:ci', sourceCommit: descriptor.sourceCommit };
  const identity = { applicationId: b.applicationId, certificateSha256: b.certificateSha256 };
  for (const serverAndroidApiCapabilities of [undefined, [], ['native-oidc-return-v1'], 'native-enrollment-attempt-v1']) {
    assert.throws(() => validatePublicationEvidence(descriptor, { ...evidence, serverAndroidApiCapabilities }, preflight, identity), /protocol and capabilities/);
  }
  validatePublicationEvidence(descriptor, { ...evidence, serverAndroidApiCapabilities: ['native-enrollment-attempt-v1'] }, preflight, identity);
});

test('merged enrollment attempt implementation is advertised and required by future APK descriptors', () => {
  assert(ANDROID_API_CAPABILITIES.includes('native-enrollment-attempt-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('native-enrollment-attempt-v1'));
  assert(ANDROID_API_CAPABILITIES.includes('native-enrollment-outcome-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('native-enrollment-outcome-v1'));
  assert(ANDROID_API_CAPABILITIES.includes('native-oidc-return-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('native-oidc-return-v1'));
  assert(ANDROID_API_CAPABILITIES.includes('audio-webm-live-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('audio-webm-live-v1'));

  assert(ANDROID_API_CAPABILITIES.includes('android-upgrade-policy-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('android-upgrade-policy-v1'));
  assert(ANDROID_API_CAPABILITIES.includes('native-agency-handoff-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('native-agency-handoff-v1'));
  assert(ANDROID_API_CAPABILITIES.includes('android-upgrade-gate-v1'));
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('android-upgrade-gate-v1'));
  assert.deepEqual(compatibility.requiredCapabilities, ANDROID_CLIENT_REQUIRED_CAPABILITIES);
});

test('future upgrade-gating APKs cannot mistake policy-only support for authoritative new-work enforcement', () => {
  assert(ANDROID_CLIENT_REQUIRED_CAPABILITIES.includes('android-upgrade-gate-v1'));
  const policyOnly = ANDROID_API_CAPABILITIES.filter(capability => capability !== 'android-upgrade-gate-v1');
  const descriptor = {compatibility};
  assert(isAndroidReleaseCompatible(descriptor, 1, ANDROID_API_CAPABILITIES));
  assert(!isAndroidReleaseCompatible(descriptor, 1, policyOnly));
});

test('publication of an upgrade-gating APK requires actual retirement, interrupted staging and current-replacement acceptance', () => {
 const descriptor={...b,sourceCommit:'a'.repeat(40),minAndroidApi:33,compatibility};
 const evidence={status:'passed',serverAndroidApiProtocol:1,serverAndroidApiCapabilities:ANDROID_API_CAPABILITIES,releaseA:a,releaseB:descriptor,androidApi:'33',assertions:[...requiredUpgradeAssertions,...requiredUpgradeGateAssertions]};
 const preflight={status:'passed',command:'npm run check:ci',sourceCommit:descriptor.sourceCommit},identity={applicationId:b.applicationId,certificateSha256:b.certificateSha256};
 validatePublicationEvidence(descriptor,evidence,preflight,identity);
 for(const missing of requiredUpgradeGateAssertions)assert.throws(()=>validatePublicationEvidence(descriptor,{...evidence,assertions:evidence.assertions.filter(value=>value!==missing)},preflight,identity),/Missing upgrade gate acceptance/);
});

test('a future OIDC APK cannot publish against an enrollment-only server', () => {
  const descriptor = { ...b, sourceCommit: 'a'.repeat(40), minAndroidApi: 33, compatibility };
  const evidence = {status: 'passed', serverAndroidApiProtocol: 1, releaseA: {...a,sourceCommit:descriptor.sourceCommit},releaseB:descriptor,androidApi:'33',assertions:[...requiredUpgradeAssertions,...requiredUpgradeGateAssertions]};
  const preflight={status:'passed',command:'npm run check:ci',sourceCommit:descriptor.sourceCommit};
  const identity={applicationId:b.applicationId,certificateSha256:b.certificateSha256};
  assert.throws(()=>validatePublicationEvidence(descriptor,{...evidence,serverAndroidApiCapabilities:['native-enrollment-attempt-v1']},preflight,identity),/protocol and capabilities/);
  validatePublicationEvidence(descriptor,{...evidence,serverAndroidApiCapabilities:ANDROID_API_CAPABILITIES},preflight,identity);
});

for (const missing of ['native-enrollment-outcome-v1','native-oidc-return-v1','audio-webm-live-v1']) test(`future clients cannot publish when the server lacks ${missing}`,()=>{
 const descriptor={...b,sourceCommit:'a'.repeat(40),minAndroidApi:33,compatibility};
 const evidence={status:'passed',serverAndroidApiProtocol:1,serverAndroidApiCapabilities:ANDROID_API_CAPABILITIES.filter(value=>value!==missing),releaseA:{...a,sourceCommit:descriptor.sourceCommit},releaseB:descriptor,androidApi:'33',assertions:[...requiredUpgradeAssertions,...requiredUpgradeGateAssertions]};
 const preflight={status:'passed',command:'npm run check:ci',sourceCommit:descriptor.sourceCommit},identity={applicationId:b.applicationId,certificateSha256:b.certificateSha256};
 assert.throws(()=>validatePublicationEvidence(descriptor,evidence,preflight,identity),/protocol and capabilities/);
 validatePublicationEvidence(descriptor,{...evidence,serverAndroidApiCapabilities:ANDROID_API_CAPABILITIES},preflight,identity);
});
