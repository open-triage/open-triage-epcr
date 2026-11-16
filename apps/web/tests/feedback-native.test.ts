import assert from "node:assert/strict";
import test from "node:test";
import { Capacitor } from "@capacitor/core";
import { clearFeedbackTelemetry, feedbackTelemetrySnapshot } from "../app/feedback-telemetry";
import { diagnosticsForSubmission } from "../app/feedback-diagnostics";
import { captureFeedbackAndroidVersion, clearNativeFeedback, feedbackRuntimeSnapshot, nativeFeedbackSnapshot, observeNativeFeedback,
  recordNativeFeedback, recordNativeMediaFailure, setFeedbackAndroidVersion } from "../app/feedback-native";

test("Android context and native failures are bounded, sanitized, and excluded from feature detail", async () => {
  const originalNative = Capacitor.isNativePlatform, originalPlatform = Capacitor.getPlatform;
  Capacitor.isNativePlatform = () => true;
  Capacitor.getPlatform = () => "android";
  try {
    clearFeedbackTelemetry();
    setFeedbackAndroidVersion({ versionCode: 17 }); // Older APK compatibility.
    assert.deepEqual(feedbackRuntimeSnapshot(), { platform: "android", versionCode: 17 });
    await assert.doesNotReject(captureFeedbackAndroidVersion(() => { throw new TypeError("Unavailable bridge method"); }));
    await assert.doesNotReject(captureFeedbackAndroidVersion(async () => { throw new Error("Native rejection"); }));
    assert.deepEqual(feedbackRuntimeSnapshot(), { platform: "android", versionCode: 17 });
    setFeedbackAndroidVersion({ versionCode: 18, versionName: "0.1.7", androidApiLevel: 36,
      webViewVersion: "142.0.7444.48", token: "SECRET", origin: "https://SECRET" });
    assert.deepEqual(feedbackRuntimeSnapshot(), { platform: "android", versionCode: 18, versionName: "0.1.7",
      androidApiLevel: 36, webViewVersion: "142.0.7444.48" });
    const failure = { code: "TLS_FAILED", message: "SECRET certificate", token: "SECRET" };
    const plugin = observeNativeFeedback({
      async request(_args: unknown) { throw failure; },
      async pdf() { return { opened: false, code: "pdf.too-large", body: "SECRET" }; },
      async authentication() { return { outcome: "denied", redirect: "SECRET" }; },
      async state() { return { blocked: true, origin: "SECRET" }; }
    }, { request: "request", pdf: "pdf", authentication: "authentication", state: "configuration" });
    await assert.rejects(plugin.request({ headers: "SECRET", path: "/patient/SECRET" }), error => error === failure);
    await plugin.pdf(); await plugin.authentication(); await plugin.state();
    await plugin.authentication(); await plugin.state(); // Stable polling states do not flood history.
    recordNativeMediaFailure("microphone", { name: "NotAllowedError", message: "SECRET" });
    recordNativeFeedback("lifecycle", "BACKGROUND");
    recordNativeFeedback("camera", "SECRET");
    assert.deepEqual(nativeFeedbackSnapshot().map(event => event.code), ["FAILED", "BACKGROUND", "PERMISSION_DENIED", "MANAGED_BLOCKED", "DENIED", "pdf.too-large", "TLS_FAILED"]);
    assert.doesNotMatch(JSON.stringify(feedbackTelemetrySnapshot()), /SECRET|certificate|headers|redirect|body/);
    const feature = diagnosticsForSubmission({ status: "available", payload: {
      schemaVersion: 1, appVersion: "0.1.7", buildVersion: "test", mode: "mobile", screen: "calls", browserFamily: "chromium",
      viewport: { width: 390, height: 844, category: "narrow" }, connectivity: "online", runtime: feedbackRuntimeSnapshot(),
      nativeEvents: nativeFeedbackSnapshot()
    } }, "feature");
    assert.equal(feature.status === "available" && feature.payload.nativeEvents, undefined);
    for (let index = 0; index < 25; index++) recordNativeFeedback("request", "CONNECTION_FAILED", Date.now() - 400_000);
    assert.equal(nativeFeedbackSnapshot().length, 20);
    assert.equal(nativeFeedbackSnapshot()[0]?.durationMs, 300_000);
    const snapshot = nativeFeedbackSnapshot(); snapshot[0]!.code = "FAILED";
    assert.equal(nativeFeedbackSnapshot()[0]?.code, "CONNECTION_FAILED");
    let reject!: (error: unknown) => void;
    const pending = observeNativeFeedback({ request: () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }) }, { request: "request" }).request();
    clearFeedbackTelemetry(); reject(failure); await assert.rejects(pending);
    assert.deepEqual(nativeFeedbackSnapshot(), []); // Stale completions cannot cross session/installation boundaries.
    setFeedbackAndroidVersion({ versionCode: -1, androidApiLevel: 1001, versionName: "SECRET /patient", webViewVersion: "SECRET" });
    assert.deepEqual(feedbackRuntimeSnapshot(), { platform: "android" });
    Capacitor.isNativePlatform = () => false;
    recordNativeFeedback("request", "TLS_FAILED");
    assert.deepEqual(nativeFeedbackSnapshot(), []);
    assert.deepEqual(feedbackRuntimeSnapshot(), { platform: "browser" });
  } finally {
    Capacitor.isNativePlatform = originalNative; Capacitor.getPlatform = originalPlatform; clearNativeFeedback();
  }
});
