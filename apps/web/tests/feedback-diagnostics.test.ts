import assert from "node:assert/strict";
import test from "node:test";
import { captureFeedbackDiagnostics, diagnosticsForSubmission, FEEDBACK_STRUCTURE_MAX_NODES } from "../app/feedback-diagnostics";
import {
  clearFeedbackTelemetry, feedbackTelemetrySnapshot, installFeedbackRequestTracking,
  normalizeFeedbackEndpoint, recordFeedbackInteraction
} from "../app/feedback-telemetry";
import identifyingPolicy from "../../../packages/database/config/identifying-elements.json";

class FakeElement {
  readonly children: FakeElement[];
  constructor(readonly tagName: string, private readonly attributes: Record<string, string> = {}, children: FakeElement[] = []) {
    this.children = children;
  }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
}

function fakeWindow(body: FakeElement, overrides: Record<string, unknown> = {}): Window {
  return {
    innerWidth: 390,
    innerHeight: 844,
    navigator: { userAgent: "SensitiveBrowser Chrome/120 token=secret", onLine: true },
    document: { body, cookie: "session=patient-secret; token=credential-secret" },
    location: { href: "https://user:password@example.test/report/private-record?token=secret" },
    localStorage: { secret: "patient-secret" },
    ...overrides
  } as unknown as Window;
}

test("bug diagnostics contain bounded value-free structure and no adversarial browser content", () => {
  const sensitive = "SENSITIVE-PATIENT-VALUE";
  const body = new FakeElement("BODY", { "aria-label": sensitive, "data-secret": sensitive }, [
    new FakeElement("MAIN", { id: `generated-${sensitive}` }, [
      ...identifyingPolicy.elements.map((elementId) =>
        new FakeElement("SECTION", { "data-element-id": elementId, "aria-label": `${sensitive}-${elementId}` }, [new FakeElement("FORM")])
      ),
      new FakeElement("SECTION", { "data-element-id": "org.example.custom.secret", title: sensitive }, [new FakeElement("TABLE")]),
      new FakeElement("ARTICLE", { "aria-description": sensitive }, [new FakeElement("BUTTON", { value: sensitive })]),
      new FakeElement("patient-card", { title: sensitive }, [new FakeElement("NAV")]),
      new FakeElement("DIV", { role: "alert", "data-private": sensitive })
    ])
  ]);

  const result = captureFeedbackDiagnostics(fakeWindow(body), "mobile", "encounter");
  assert.equal(result.status, "available");
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /SENSITIVE|patient-secret|credential-secret|private-record|password|token=secret|generated-|ePatient|eScene/i);
  if (result.status === "available") {
    assert.deepEqual(result.payload.structure?.nodes.map(({ kind }) => kind), ["main", "article", "button", "alert"]);
  }
});

test("feature diagnostics retain only lightweight context", () => {
  clearFeedbackTelemetry();
  recordFeedbackInteraction("session.refresh.requested");
  const captured = captureFeedbackDiagnostics(fakeWindow(new FakeElement("BODY", {}, [new FakeElement("MAIN")])), "stationary", "calls");
  const feature = diagnosticsForSubmission(captured, "feature");
  assert.equal(feature.status, "available");
  if (feature.status === "available") {
    assert.equal(feature.payload.structure, undefined);
    assert.deepEqual(feature.payload.viewport, { width: 390, height: 844, category: "narrow" });
    assert.equal(feature.payload.browserFamily, "chromium");
    assert.equal(feature.payload.interactions, undefined);
    assert.equal(feature.payload.requestFailures, undefined);
  }
});

test("semantic interactions, including value-free sync categories, are memory-only, bounded, and newest-first", () => {
  clearFeedbackTelemetry();
  const names = ["feedback.opened", "session.refresh.requested", "presentation.stationary.selected",
    "draft-sync.server-conflict", "draft-sync.validation-rejected", "draft-sync.recovered",
    "draft-sync.retry-exhausted"] as const;
  for (let index = 0; index < 23; index += 1) recordFeedbackInteraction(names[index % names.length]!);
  const snapshot = feedbackTelemetrySnapshot();
  assert.equal(snapshot.interactions?.length, 20);
  assert.deepEqual(snapshot.interactions?.slice(0, 3), [
    names[22 % names.length]!, names[21 % names.length]!, names[20 % names.length]!
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /localStorage|console|keystroke|patient/i);
});

test("failed requests retain only normalized bounded summaries", async () => {
  clearFeedbackTelemetry();
  const sensitive = "PATIENT-ABC-123";
  const calls: unknown[][] = [];
  const fake = {
    location: { origin: "https://example.test" },
    fetch: async (...args: unknown[]) => { calls.push(args); return new Response("SECRET RESPONSE", { status: 503 }); }
  } as unknown as Window;
  const restore = installFeedbackRequestTracking(fake);
  await fake.fetch(`https://example.test/api/reports/${sensitive}?token=BEARER-SECRET&cursor=record-99`, {
    method: "POST", headers: { authorization: "Bearer AUTH-SECRET", "x-patient": sensitive }, body: "SECRET BODY"
  });
  restore();
  assert.equal(calls.length, 1);
  const snapshot = feedbackTelemetrySnapshot();
  assert.deepEqual(snapshot.requestFailures?.map(({ method, endpointPattern, status }) => ({ method, endpointPattern, status })), [{
    method: "POST", endpointPattern: "/api/reports/{value}?cursor={value}&token={value}", status: 503
  }]);
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /PATIENT|BEARER|AUTH-SECRET|record-99|SECRET BODY|SECRET RESPONSE/i);
});

test("endpoint normalization replaces identifiers and query values before buffering", () => {
  assert.equal(normalizeFeedbackEndpoint("/api/admin/users/40000000-0000-4000-8000-000000000001/sessions?cursor=private&sort=secret"),
    "/api/admin/users/{value}/sessions?cursor={value}&sort={value}");
  assert.equal(normalizeFeedbackEndpoint("not a valid URL", "not a base"), "/{invalid}");
});

test("failed-request memory keeps only the ten newest summaries", async () => {
  clearFeedbackTelemetry();
  let count = 0;
  const fake = {
    location: { origin: "https://example.test" },
    fetch: async () => new Response(null, { status: 500 + count++ })
  } as unknown as Window;
  const restore = installFeedbackRequestTracking(fake);
  for (let index = 0; index < 12; index += 1) await fake.fetch(`/api/reports/private-${index}`);
  restore();
  assert.deepEqual(feedbackTelemetrySnapshot().requestFailures?.map(({ status }) => status),
    [511, 510, 509, 508, 507, 506, 505, 504, 503, 502]);
});

test("bug submission diagnostics attach current telemetry without browser persistence", () => {
  clearFeedbackTelemetry();
  recordFeedbackInteraction("feedback.opened");
  const captured = captureFeedbackDiagnostics(fakeWindow(new FakeElement("BODY", {}, [new FakeElement("MAIN")])), "mobile", "calls");
  const bug = diagnosticsForSubmission(captured, "bug");
  assert.equal(bug.status, "available");
  if (bug.status === "available") {
    assert.deepEqual(bug.payload.interactions, ["feedback.opened"]);
    assert.deepEqual(bug.payload.requestFailures, []);
  }
});

test("structural capture enforces its hard node bound", () => {
  const body = new FakeElement("BODY", {}, Array.from({ length: FEEDBACK_STRUCTURE_MAX_NODES + 20 }, () => new FakeElement("SECTION")));
  const result = captureFeedbackDiagnostics(fakeWindow(body), "admin", "admin");
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.payload.structure?.nodes.length, FEEDBACK_STRUCTURE_MAX_NODES);
    assert.equal(result.payload.structure?.truncated, true);
  }
});

test("capture failure returns a safe unavailable category without error detail", () => {
  const broken = fakeWindow(new FakeElement("BODY"), { document: { get body() { throw new Error("SECRET STACK DETAIL"); } } });
  assert.deepEqual(captureFeedbackDiagnostics(broken, "mobile", "calls"), {
    status: "unavailable", schemaVersion: 1, reason: "capture-failed"
  });
});
