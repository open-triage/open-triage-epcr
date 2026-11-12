import type { AndroidUpgradeClientPolicy } from "@open-triage/contracts/android-upgrade-policy";
import { AndroidConnection } from "./android-runtime";
import { apiRequestUrl, browserRequestInit } from "./browser-api";
import { platformRequestError } from "./platform-errors";

/** Native package metadata is separate from the WebView's mutable presentation state. */
export async function loadAndroidClientPolicy(signal: AbortSignal): Promise<AndroidUpgradeClientPolicy> {
  const { versionCode } = await AndroidConnection.version();
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
  if (value.replacement) {
    const url = new URL(value.replacement.downloadUrl);
    if (url.origin !== "https://github.com" || !url.pathname.startsWith("/open-triage/open-triage-epcr/releases/download/") || url.username || url.password || url.search || url.hash ||
        !/^[a-f0-9]{64}$/.test(value.replacement.apkSha256) || typeof value.replacement.versionName !== "string" || value.replacement.versionName.length > 100 ||
        !Number.isSafeInteger(value.replacement.versionCode) || value.replacement.versionCode <= versionCode)
      throw new Error("android.policyOnlineRequired");
  }
  return value;
}
