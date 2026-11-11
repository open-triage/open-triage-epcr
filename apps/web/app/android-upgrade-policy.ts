import type { AndroidUpgradePolicyView, AndroidUpgradePolicyPreview } from "@open-triage/contracts/android-upgrade-policy";
import { apiRequestUrl, browserRequestInit } from "./browser-api";
import { platformRequestError } from "./platform-errors";
async function request<T>(method: string, csrfToken?: string, body?: unknown, preview = false): Promise<T> {
  const url = apiRequestUrl(`/api/super-admin/android/upgrade-policy${preview ? "/preview" : ""}`);
  if (!url) throw new Error("android.policyOnlineRequired");
  const response = await fetch(url, browserRequestInit({ method, headers: { ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<T>;
}
export const loadAndroidUpgradePolicy = () => request<AndroidUpgradePolicyView>("GET");
export const previewAndroidUpgradePolicy = (csrf: string, graceDays: number, expectedRevision: number) => request<AndroidUpgradePolicyPreview>("POST", csrf, { graceDays, expectedRevision }, true);
export const saveAndroidUpgradePolicy = (csrf: string, preview: AndroidUpgradePolicyPreview) => request<AndroidUpgradePolicyView>("PUT", csrf, { graceDays: preview.proposedGraceDays, expectedRevision: preview.policy.revision, previewToken: preview.previewToken });
