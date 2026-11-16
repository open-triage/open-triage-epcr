import assert from "node:assert/strict";
import test from "node:test";
import { clearFeedbackTelemetry, feedbackTelemetrySnapshot, installFeedbackRequestTracking, installFeedbackRuntimeTracking } from "../app/feedback-telemetry";

test("runtime errors retain only bounded categories and listeners are removed on cleanup", () => {
  clearFeedbackTelemetry();
  const target = new EventTarget();
  const stop = installFeedbackRuntimeTracking(target as unknown as Window);
  for (let index = 0; index < 12; index++) {
    const event = new Event(index % 2 ? "error" : "unhandledrejection");
    Object.assign(event, { error: new TypeError("PATIENT SECRET stack URL token"), reason: { patient: "SECRET" } });
    target.dispatchEvent(event);
  }
  const errors = feedbackTelemetrySnapshot().runtimeErrors!;
  assert.equal(errors.length, 10);
  assert.equal(errors[0]?.kind, "TypeError");
  assert.equal(errors[1]?.kind, "other");
  assert.doesNotMatch(JSON.stringify(errors), /PATIENT|SECRET|token|stack|URL/);
  stop();
  clearFeedbackTelemetry();
  target.dispatchEvent(new Event("error"));
  assert.deepEqual(feedbackTelemetrySnapshot().runtimeErrors, []);
});

test("cancelled requests are distinct from transport failures and late completions cannot cross a cleared session", async () => {
  clearFeedbackTelemetry();
  let rejectRequest: (reason: unknown) => void = () => {};
  const fake = { location: { origin: "https://example.test" }, fetch: () => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; }) } as unknown as Window;
  const restore = installFeedbackRequestTracking(fake);
  try {
    const controller = new AbortController();
    const cancelled = fake.fetch("/api/reports/private/eps/context", { signal: controller.signal });
    controller.abort();
    rejectRequest(new DOMException("SENSITIVE", "AbortError"));
    await assert.rejects(cancelled);
    assert.equal(feedbackTelemetrySnapshot().requestFailures?.[0]?.failureKind, "cancelled");
    assert.equal(feedbackTelemetrySnapshot().requestFailures?.[0]?.endpointPattern, "/api/reports/{value}/eps/context");
    const network = fake.fetch("/api/reports/private/cos/context");
    rejectRequest(new TypeError("SECRET"));
    await assert.rejects(network);
    assert.equal(feedbackTelemetrySnapshot().requestFailures?.[0]?.failureKind, "network");
    const late = fake.fetch("/api/reports/private");
    clearFeedbackTelemetry();
    rejectRequest(new Error("old user"));
    await assert.rejects(late);
    assert.deepEqual(feedbackTelemetrySnapshot().requestFailures, []);
  } finally { restore(); }
});
