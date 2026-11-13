import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import legacy from '../fixtures/android-published-legacy-releases.json' with {type:'json'};
import {androidApkArtifactName,approvedAndroidReleaseUrl,parseAndroidReleaseDescriptor} from '@open-triage/contracts/android-release';

export function latestApprovedAndroidRelease() {
 const selected=catalog.releases.reduce((latest,entry)=>!latest||entry.descriptor.versionCode>latest.descriptor.versionCode?entry:latest,null);
 assert(selected,'Committed approved release required');
 return {...selected,descriptor:parseAndroidReleaseDescriptor(selected.descriptor)};
}

export function historicalAndroidRelease(versionCode) {
 const selected=legacy.releases.find(entry=>entry.descriptor.versionCode===versionCode);
 assert(selected,'Explicit immutable historical release required');
 return structuredClone(selected);
}

/** Synthetic transport bytes retain the selected committed version/tag/capability contract. */
export function syntheticApprovedAndroidRelease(bytes,selected=latestApprovedAndroidRelease()) {
 const descriptor=structuredClone(selected.descriptor);
 descriptor.apkSha256=createHash('sha256').update(bytes).digest('hex');descriptor.apkBytes=bytes.length;
 descriptor.artifact=androidApkArtifactName(descriptor.versionName);
 return {status:'available',tag:selected.tag,descriptor,downloadUrl:approvedAndroidReleaseUrl(selected.tag,descriptor)};
}
