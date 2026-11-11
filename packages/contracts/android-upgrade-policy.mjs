import { parseAndroidReleaseDescriptor, isAndroidReleaseCompatible } from "./android-release.mjs";
export const ANDROID_UPGRADE_GRACE_DEFAULT_DAYS = 90;
export const ANDROID_UPGRADE_GRACE_MAX_DAYS = 365;
export function parseAndroidUpgradeGraceDays(value) {
  if (!Number.isInteger(value) || value < 0 || value > ANDROID_UPGRADE_GRACE_MAX_DAYS) throw new Error("Invalid Android upgrade grace");
  return value;
}
export function parseAndroidReleaseLifecycle(input, releases) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.retirements) || input.retirements.length > 256) throw new Error("Invalid Android release lifecycle");
  const versions = new Set();
  return input.retirements.map(value => {
    const old = releases.find(entry => entry.descriptor.versionCode === value?.versionCode);
    const replacement = releases.find(entry => entry.tag === value?.replacementTag);
    if (!old || !replacement || versions.has(value.versionCode) || typeof value.supersededAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.supersededAt) ||
        !Number.isFinite(Date.parse(value.supersededAt)) || new Date(value.supersededAt).toISOString() !== value.supersededAt ||
        parseAndroidReleaseDescriptor(replacement.descriptor).versionCode <= parseAndroidReleaseDescriptor(old.descriptor).versionCode) throw new Error("Invalid Android release retirement");
    versions.add(value.versionCode);
    return { versionCode: value.versionCode, supersededAt: value.supersededAt, replacementTag: value.replacementTag };
  });
}
/** Server time and fixed release metadata are the only clocks. Grace never changes format support. */
export function evaluateAndroidUpgrade({ versionCode, releases, retirements, graceDays, serverTime, serverProtocol, serverCapabilities, replacement }) {
  parseAndroidUpgradeGraceDays(graceDays);
  const now = Date.parse(serverTime);
  if (!Number.isFinite(now)) throw new Error("Invalid Android policy server time");
  const release = releases.find(entry => entry.descriptor.versionCode === versionCode);
  const update = replacement?.status === "available" && isAndroidReleaseCompatible(replacement.descriptor, serverProtocol, serverCapabilities)
    ? { tag: replacement.tag, versionCode: replacement.descriptor.versionCode, versionName: replacement.descriptor.versionName, downloadUrl: replacement.downloadUrl, apkSha256: replacement.descriptor.apkSha256 } : null;
  const base = { versionCode, serverTime, deadline: null, replacement: update };
  if (!release) return { ...base, status: "upgrade-required", reason: "unknown-release" };
  if (!isAndroidReleaseCompatible(release.descriptor, serverProtocol, serverCapabilities)) return { ...base, status: "upgrade-required", reason: "unsupported" };
  const retirement = retirements.find(entry => entry.versionCode === versionCode);
  if (!retirement) return { ...base, status: "compatible", reason: "supported" };
  if (!update || retirement.replacementTag !== update.tag || update.versionCode <= versionCode) return { ...base, status: "compatible", reason: "replacement-unavailable" };
  const deadline = new Date(Date.parse(retirement.supersededAt) + graceDays * 86_400_000).toISOString();
  return { ...base, deadline, status: now >= Date.parse(deadline) ? "upgrade-required" : "approaching-upgrade", reason: "retired" };
}
