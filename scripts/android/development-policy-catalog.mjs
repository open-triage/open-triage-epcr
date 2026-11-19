import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import { androidApkArtifactName, approvedAndroidReleaseUrl } from '@open-triage/contracts/android-release';
import { compatibility } from './release-contract.mjs';

export function developmentPolicyCatalog() {
  const versionCode = 1;
  const versionName = '0.1.0-development';
  const tag = `android-candidate-${versionCode}-${versionName}`;
  // The policy service validates the production catalog format. This entry
  // models debug-client compatibility and is never selected for APK download.
  const descriptor = {
    schemaVersion: 1,
    ...catalog.signingIdentity,
    versionCode,
    versionName,
    apkSha256: '0'.repeat(64),
    apkBytes: 1,
    uiSha256: '0'.repeat(64),
    sourceCommit: '0'.repeat(40),
    compatibility,
    minAndroidApi: 33,
    targetAndroidApi: 36,
    artifact: androidApkArtifactName(versionName),
  };
  return { ...catalog, releases: [{ tag, descriptor, downloadUrl: approvedAndroidReleaseUrl(tag, descriptor) }] };
}
