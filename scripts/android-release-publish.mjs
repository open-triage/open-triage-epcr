import { verifyApkSignature } from './android/apk-signature.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { validatePublicationEvidence, verifyApkMetadata } from './android/release-contract.mjs';
const root = resolve(import.meta.dirname, '..'), repository = 'open-triage/open-triage-epcr';
const [folderArgument, evidenceArgument, preflightArgument, tag] = process.argv.slice(2);
assert(folderArgument && evidenceArgument && preflightArgument && /^android-(?:v|candidate-)\d+-[0-9A-Za-z.-]+$/.test(tag ?? ''), 'Supply artifact directory, upgrade evidence, preflight evidence and Android release tag');
const folder = resolve(folderArgument), descriptor = JSON.parse(readFileSync(join(folder, 'release.json')));
const evidence = JSON.parse(readFileSync(resolve(evidenceArgument))), preflight = JSON.parse(readFileSync(resolve(preflightArgument)));
const identity = JSON.parse(readFileSync(join(root, 'docs/releases/android/signing-identity.json')));
validatePublicationEvidence(descriptor, evidence, preflight, identity);
const apk = join(folder, descriptor.artifact), sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
assert.equal(createHash('sha256').update(readFileSync(apk)).digest('hex'), descriptor.apkSha256);
verifyApkMetadata(execFileSync(join(sdk, 'build-tools/36.0.0/aapt'), ['dump', 'badging', apk], { encoding: 'utf8' }), verifyApkSignature(sdk, apk), descriptor);
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8' });
assert.equal(JSON.parse(gh(['api', `repos/${repository}/immutable-releases`])).enabled, true, 'Repository immutable releases must be enabled');
const releases = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat();
for (const release of releases.filter(value => /^android-(?:v|candidate-)/.test(value.tag_name))) {
  assert.notEqual(release.tag_name, tag, 'Release tag already exists');
  const previousCode = Number(/^android-(?:v|candidate-)(\d+)-/.exec(release.tag_name)?.[1]);
  assert(descriptor.versionCode > previousCode, 'Release version code must exceed every published Android release');
}
const notes = join(folder, 'RELEASE-NOTES.md');
writeFileSync(notes, `Signed Android release candidate ${descriptor.versionName} (code ${descriptor.versionCode}).\n\nApplication: ${descriptor.applicationId}\nCertificate SHA-256: ${descriptor.certificateSha256}\nAPK SHA-256: ${descriptor.apkSha256}\nSource: ${descriptor.sourceCommit}\n\nThe attached evidence verifies the exact signed A/B in-place upgrade on an isolated Android emulator. Initial local login, managed connection/CA and enrollment, retained presentation preferences, encrypted pending work, offline confidentiality, cross-user denial and authorized recovery were checked. Repository preflight passed. Physical device, actual Intune/MDM and operational rollout acceptance remain separate checkpoints.\n`);
// gh stages all assets before publishing an immutable release; never upload a test APK.
console.log(gh(['release', 'create', tag, '--repo', repository, '--target', descriptor.sourceCommit, '--prerelease', '--latest=false', '--title', `Android ${descriptor.versionName} (${descriptor.versionCode})`, '--notes-file', notes, apk, join(folder, 'release.json'), join(folder, 'SHA256SUMS'), resolve(evidenceArgument), resolve(preflightArgument)]));
const published = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]));
assert.equal(published.immutable, true, 'Published release must be immutable');
console.log(`Immutable signed release published: ${published.html_url}`);
