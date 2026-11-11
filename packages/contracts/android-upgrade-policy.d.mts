import type { AndroidReleaseAvailability, AndroidReleaseDescriptor } from "./android-release.mjs";
export declare const ANDROID_UPGRADE_GRACE_DEFAULT_DAYS = 90;
export declare const ANDROID_UPGRADE_GRACE_MAX_DAYS = 365;
export interface AndroidReleaseRecord { tag: string; descriptor: AndroidReleaseDescriptor; downloadUrl: string }
export interface AndroidReleaseRetirement { versionCode: number; supersededAt: string; replacementTag: string }
export interface AndroidUpgradeEvaluation {
  versionCode: number; serverTime: string; status: "compatible" | "approaching-upgrade" | "upgrade-required";
  reason: "supported" | "unknown-release" | "unsupported" | "replacement-unavailable" | "retired";
  deadline: string | null;
  replacement: { tag: string; versionCode: number; versionName: string; downloadUrl: string; apkSha256: string } | null;
}
export interface AndroidUpgradePolicy { graceDays: number; revision: number; updatedAt: string; }
export interface AndroidUpgradePolicyView { policy: AndroidUpgradePolicy; serverTime: string; clients: AndroidUpgradeEvaluation[]; }
export interface AndroidUpgradePolicyPreview extends AndroidUpgradePolicyView { proposedGraceDays: number; previewToken: string; proposedClients: AndroidUpgradeEvaluation[]; }
export interface AndroidUpgradeClientPolicy extends AndroidUpgradeEvaluation { policyRevision: number; graceDays: number; }
export declare function parseAndroidUpgradeGraceDays(value: unknown): number;
export declare function parseAndroidReleaseLifecycle(input: unknown, releases: readonly AndroidReleaseRecord[]): AndroidReleaseRetirement[];
export declare function evaluateAndroidUpgrade(input: {versionCode: number; releases: readonly AndroidReleaseRecord[]; retirements: readonly AndroidReleaseRetirement[]; graceDays: number; serverTime: string; serverProtocol: number; serverCapabilities: readonly string[]; replacement: AndroidReleaseAvailability}): AndroidUpgradeEvaluation;
