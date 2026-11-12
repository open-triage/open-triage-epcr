import assert from "node:assert/strict";
import test from "node:test";
import { validatedUpgradeDownload } from "../app/android-client-policy";
const replacement = (candidate = true) => ({
  versionCode: 2, versionName: "0.1.0-rc.2", apkSha256: "a".repeat(64),
  tag: `android-${candidate ? "candidate-" : "v"}2-0.1.0-rc.2`,
  downloadUrl: `https://github.com/open-triage/open-triage-epcr/releases/download/android-${candidate ? "candidate-" : "v"}2-0.1.0-rc.2/opentriage-0.1.0-rc.2-2-${"a".repeat(64)}.apk`,
});
test("upgrade links bind both approved tag forms to exact replacement metadata", () => {
  for (const candidate of [true, false]) {
    const value = replacement(candidate);
    assert.equal(validatedUpgradeDownload(value, 1), value.downloadUrl);
    for (const change of [
      { downloadUrl: value.downloadUrl.replace("github.com", "attacker.invalid") },
      { downloadUrl: value.downloadUrl.replace("open-triage-epcr", "foreign") },
      { downloadUrl: value.downloadUrl + "?token=secret" }, { downloadUrl: value.downloadUrl + "#fragment" },
      { downloadUrl: value.downloadUrl.replace("github.com", "user@github.com") },
      { downloadUrl: value.downloadUrl.replace("/opentriage-", "/%6fpentriage-") },
      { downloadUrl: value.downloadUrl.replace("a".repeat(64), "b".repeat(64)) },
      { versionCode: 3 }, { versionCode: 1 }, { versionCode: 2100000001 },
      { versionName: "0.2.0" }, { tag: "other-release" }, { apkSha256: "invalid" },
    ]) assert.throws(() => validatedUpgradeDownload({ ...value, ...change }, 1));
  }
});
