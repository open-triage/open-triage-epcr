import type {AndroidReleaseDescriptor} from '@open-triage/contracts/android-release';
interface ApprovedAndroidRelease {tag: string; descriptor: AndroidReleaseDescriptor; downloadUrl: string}
export function latestApprovedAndroidRelease(): ApprovedAndroidRelease;
export function historicalAndroidRelease(versionCode: 1 | 2): ApprovedAndroidRelease;
export function syntheticApprovedAndroidRelease(bytes: Uint8Array, selected?: ApprovedAndroidRelease): ApprovedAndroidRelease & {status: 'available'};
