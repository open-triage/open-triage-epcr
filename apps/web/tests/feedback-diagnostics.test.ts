import assert from "node:assert/strict";
import test from "node:test";
import { captureFeedbackDiagnostics, diagnosticsForType, FEEDBACK_STRUCTURE_MAX_NODES } from "../app/feedback-diagnostics";
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
  const captured = captureFeedbackDiagnostics(fakeWindow(new FakeElement("BODY", {}, [new FakeElement("MAIN")])), "stationary", "calls");
  const feature = diagnosticsForType(captured, "feature");
  assert.equal(feature.status, "available");
  if (feature.status === "available") {
    assert.equal(feature.payload.structure, undefined);
    assert.deepEqual(feature.payload.viewport, { width: 390, height: 844, category: "narrow" });
    assert.equal(feature.payload.browserFamily, "chromium");
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
