import { approvedAndroidReleaseUrl } from "@open-triage/contracts/android-release";
import type { AndroidUpgradeClientPolicy } from "@open-triage/contracts/android-upgrade-policy";
import { applicationVisible } from "./application-foreground";
import { AndroidConnection } from "./android-runtime";
import { apiRequestUrl, browserRequestInit } from "./browser-api";
import { platformRequestError } from "./platform-errors";

export function validatedUpgradeDownload(replacement: NonNullable<AndroidUpgradeClientPolicy["replacement"]>, installedVersion: number): string {
  if (!/^[a-f0-9]{64}$/.test(replacement.apkSha256) || typeof replacement.versionName !== "string" || replacement.versionName.length > 100 ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(replacement.versionName) || !Number.isSafeInteger(replacement.versionCode) ||
      replacement.versionCode <= installedVersion || replacement.versionCode > 21e8) throw new Error("android.policyOnlineRequired");
  const descriptor = { versionCode: replacement.versionCode, versionName: replacement.versionName,
    artifact: `opentriage-${replacement.versionName}-${replacement.versionCode}-${replacement.apkSha256}.apk` };
  if (replacement.downloadUrl !== approvedAndroidReleaseUrl(replacement.tag, descriptor)) throw new Error("android.policyOnlineRequired");
  return replacement.downloadUrl;
}

/** Native package metadata is separate from the WebView's mutable presentation state. */
export async function loadAndroidClientPolicy(signal: AbortSignal, current: () => boolean = () => true): Promise<AndroidUpgradeClientPolicy> {
  const mayDispatch = () => {
    if (signal.aborted) throw signal.reason;
    if (!applicationVisible() || !current()) throw new Error("android.policyOnlineRequired");
  };
  mayDispatch();
  const { versionCode } = await AndroidConnection.version();
  // Native callbacks may wait behind another operation. React effect cleanup
  // can lag the lifecycle/installation event, so guard the actual HTTP dispatch.
  mayDispatch();
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 21e8) throw new Error("android.upgradeRequired");
  const url = apiRequestUrl(`/api/android/compatibility?versionCode=${versionCode}`);
  if (!url) throw new Error("android.policyOnlineRequired");
  const response = await fetch(url, browserRequestInit({ signal, cache: "no-store" }));
  if (!response.ok) throw await platformRequestError(response);
  const value = await response.json() as AndroidUpgradeClientPolicy;
  if (value.versionCode !== versionCode || !["compatible", "approaching-upgrade", "upgrade-required"].includes(value.status) ||
      !Number.isFinite(Date.parse(value.serverTime)) || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1 ||
      !Number.isInteger(value.graceDays) || value.graceDays < 0 || value.graceDays > 365 || value.deadline !== null && !Number.isFinite(Date.parse(value.deadline)))
    throw new Error("android.policyOnlineRequired");
  if (value.replacement) validatedUpgradeDownload(value.replacement, versionCode);
  return value;
}
