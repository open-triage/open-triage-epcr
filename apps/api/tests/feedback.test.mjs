import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from "@nestjs/common";
import { FeedbackController } from "../dist/feedback/feedback.controller.js";
import { createFeedbackReference, FeedbackService } from "../dist/feedback/feedback.service.js";
import { validateCreateFeedback } from "../dist/feedback/feedback.validation.js";

const context = {
  schemaVersion: 1, appVersion: "0.1.0", buildVersion: "test-build", mode: "mobile", screen: "calls",
  browserFamily: "chromium", viewport: { width: 390, height: 844, category: "narrow" }, connectivity: "online"
};
const featureDiagnostics = { status: "available", payload: context };
const bugDiagnostics = { status: "available", payload: { ...context, screen: "encounter", structure: {
  nodes: [{ kind: "main", depth: 1 }, { kind: "button", depth: 2 }], truncated: false
}, interactions: ["feedback.opened", "session.refresh.requested", "draft-sync.server-conflict", "draft-sync.retry-exhausted"], requestFailures: [{
  timestamp: "2026-09-16T10:00:00.000Z", method: "GET", endpointPattern: "/api/reports/{value}?cursor={value}",
  status: 503, durationMs: 42
}] } };
const idempotencyKey = "40000000-0000-4000-8000-000000000003";

test("feedback validation trims bounded descriptions and requires a UUID idempotency key", () => {
  assert.deepEqual(validateCreateFeedback({ idempotencyKey, type: "bug", description: "  It stopped  ", diagnostics: bugDiagnostics }),
    { idempotencyKey, type: "bug", description: "It stopped", diagnostics: bugDiagnostics });
  assert.deepEqual(validateCreateFeedback({ idempotencyKey, type: "feature", description: "Let me filter calls", diagnostics: featureDiagnostics }),
    { idempotencyKey, type: "feature", description: "Let me filter calls", diagnostics: featureDiagnostics });
  assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "   ", diagnostics: bugDiagnostics }), BadRequestException);
  assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "x".repeat(4001), diagnostics: bugDiagnostics }), /4,000/);
  assert.throws(() => validateCreateFeedback({ idempotencyKey: "reused", type: "bug", description: "Valid", diagnostics: bugDiagnostics }), /UUID/);
  for (const field of ["actorId", "organizationId", "actorDisplayName", "status", "priority", "reviewNote"]) {
    assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "Valid", diagnostics: bugDiagnostics, [field]: "forged" }),
      new RegExp(field));
  }
});

test("feedback diagnostics reject unknown, oversized, type-inappropriate, and value-bearing fields", () => {
  const command = (type, diagnostics) => ({ idempotencyKey, type, description: "Valid", diagnostics });
  assert.throws(() => validateCreateFeedback(command("feature", bugDiagnostics)), /structure/);
  assert.throws(() => validateCreateFeedback(command("bug", featureDiagnostics)), /structural snapshot/);
  assert.throws(() => validateCreateFeedback(command("feature", {
    status: "available", payload: { ...context, url: "https://example.test/private?id=patient" }
  })), /url/);
  for (const forbidden of ["text", "value", "ariaLabel", "dataset", "id", "attributes", "cookie", "headers", "body"]) {
    assert.throws(() => validateCreateFeedback(command("bug", {
      status: "available", payload: { ...bugDiagnostics.payload, structure: {
        nodes: [{ kind: "main", depth: 1, [forbidden]: "SENSITIVE" }], truncated: false
      } }
    })), new RegExp(forbidden));
  }
  assert.throws(() => validateCreateFeedback(command("feature", {
    status: "available", payload: { ...context, browserFamily: { name: "chromium" } }
  })), /browser family/);
  assert.throws(() => validateCreateFeedback(command("feature", {
    status: "available", payload: { ...context, padding: "x".repeat(20_000) }
  })), /16,384/);
  assert.throws(() => validateCreateFeedback(command("bug", { status: "available", payload: {
    ...bugDiagnostics.payload, interactions: Array(21).fill("feedback.opened")
  } })), /at most 20/);
  assert.throws(() => validateCreateFeedback(command("bug", { status: "available", payload: {
    ...bugDiagnostics.payload, interactions: ["clicked-patient-SENSITIVE"]
  } })), /unsupported/);
  assert.throws(() => validateCreateFeedback(command("bug", { status: "available", payload: {
    ...bugDiagnostics.payload, requestFailures: Array(11).fill(bugDiagnostics.payload.requestFailures[0])
  } })), /at most 10/);
  for (const forbidden of ["url", "headers", "requestBody", "responseBody", "token"]) {
    assert.throws(() => validateCreateFeedback(command("bug", { status: "available", payload: {
      ...bugDiagnostics.payload, requestFailures: [{ ...bugDiagnostics.payload.requestFailures[0], [forbidden]: "SENSITIVE" }]
    } })), new RegExp(forbidden));
  }
  assert.throws(() => validateCreateFeedback(command("bug", { status: "available", payload: {
    ...bugDiagnostics.payload, requestFailures: [{ ...bugDiagnostics.payload.requestFailures[0], endpointPattern: "/api/reports/patient-123" }]
  } })), /endpoint pattern/);
  assert.deepEqual(validateCreateFeedback(command("bug", {
    status: "unavailable", schemaVersion: 1, reason: "capture-failed"
  })).diagnostics, { status: "unavailable", schemaVersion: 1, reason: "capture-failed" });
});

test("feedback accepts bounded error evidence while rejecting arbitrary error content", () => {
  const visibleAlert = { area: "storage", source: "close", messageKey: "mobile.protectedBeforeClose", fontSizePx: 48, width: 371, height: 100, overflowing: true };
  const runtimeError = { source: "error", kind: "TypeError", timestamp: "2026-11-16T12:00:00.000Z" };
  const validate = (extra, type = "bug") => validateCreateFeedback({ idempotencyKey, type, description: "Valid",
    diagnostics: { status: "available", payload: { ...(type === "bug" ? bugDiagnostics.payload : context), ...extra } } });
  const extra = { visibleAlerts: [visibleAlert], runtimeErrors: [runtimeError],
    requestFailures: [{ ...bugDiagnostics.payload.requestFailures[0], endpointPattern: "/api/reports/{value}/eps/context", failureKind: "http" }] };
  assert.deepEqual(validate(extra).diagnostics.payload.visibleAlerts, [visibleAlert]);
  assert.deepEqual(validate(extra).diagnostics.payload.runtimeErrors, [runtimeError]);
  assert.equal(validate(extra).diagnostics.payload.requestFailures[0].failureKind, "http");
  for (const forbidden of ["text", "message", "stack", "url", "value", "patientId"]) {
    assert.throws(() => validate({ visibleAlerts: [{ ...visibleAlert, [forbidden]: "SECRET" }] }), new RegExp(forbidden));
    assert.throws(() => validate({ runtimeErrors: [{ ...runtimeError, [forbidden]: "SECRET" }] }), new RegExp(forbidden));
  }
  for (const invalid of [{ messageKey: "PATIENT SECRET" }, { source: "SECRET" }, { area: "SECRET" }, { fontSizePx: -1 }, { width: 10_001 }, { height: 1.5 }, { overflowing: "yes" }]) {
    assert.throws(() => validate({ visibleAlerts: [{ ...visibleAlert, ...invalid }] }), BadRequestException);
  }
  for (const invalid of [{ kind: "PATIENT SECRET" }, { source: "console" }, { timestamp: "invalid" }]) {
    assert.throws(() => validate({ runtimeErrors: [{ ...runtimeError, ...invalid }] }), BadRequestException);
  }
  assert.throws(() => validate({ visibleAlerts: Array(11).fill(visibleAlert) }), /at most 10/);
  assert.throws(() => validate({ runtimeErrors: Array(11).fill(runtimeError) }), /at most 10/);
  for (const field of ["visibleAlerts", "runtimeErrors"]) assert.throws(() => validate({ [field]: [] }, "feature"), new RegExp(field));
  for (const failureKind of ["SECRET", "network", "cancelled"]) {
    assert.throws(() => validate({ requestFailures: [{ ...bugDiagnostics.payload.requestFailures[0], failureKind }] }), /failure kind/);
  }
  for (const failureKind of ["network", "cancelled"]) {
    assert.equal(validate({ requestFailures: [{ ...bugDiagnostics.payload.requestFailures[0], status: 0, failureKind }] })
      .diagnostics.payload.requestFailures[0].failureKind, failureKind);
  }
});

test("feedback references are fixed-length opaque base32 values", () => {
  assert.match(createFeedbackReference(Buffer.from("01234567")), /^[A-Z2-7]{12}$/);
});

test("feedback persistence derives immutable attribution from the verified session", async () => {
  const queries = [];
  const session = {
    user: { id: "user-from-session", displayName: "Verified User" },
    organization: { id: "org-from-session", name: "Verified Organization" }
  };
  const manager = { query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("where actor_id = $1 and idempotency_key")) return [];
    if (sql.includes("count(*)")) return [{ submission_count: 0, retry_after_seconds: null }];
    return sql.includes("insert into") ? [[], 1] : [];
  } };
  const dataSource = { transaction: (work) => work(manager) };
  const sessions = { get: async (token, _now, allowPasswordChange, suppliedManager) => {
    assert.equal(token, "verified-session-token");
    assert.equal(allowPasswordChange, false);
    assert.equal(suppliedManager, manager);
    return session;
  } };

  const result = await new FeedbackService(dataSource, sessions)
    .create("verified-session-token", { idempotencyKey, type: "feature", description: "A preserved idea", diagnostics: featureDiagnostics });

  assert.deepEqual(result.accepted, true);
  assert.match(result.referenceCode, /^[A-Z2-7]{12}$/);
  const insert = queries.find(({ sql }) => sql.includes("insert into feedback.submission"));
  assert.ok(insert);
  assert.deepEqual(insert.parameters.slice(1), [
    idempotencyKey,
    "feature", "A preserved idea", "org-from-session", "user-from-session",
    "Verified Organization", "Verified User", "available", null, JSON.stringify(context)
  ]);
});

test("an identical retry returns its original reference without consuming quota", async () => {
  const statements = [];
  const manager = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("where actor_id = $1 and idempotency_key")) {
      return [{ reference_code: "J7M4Q2K8X5PN", submission_type: "bug", original_description: "Retry me" }];
    }
    return [];
  } };
  const service = new FeedbackService({ transaction: (work) => work(manager) }, { get: async () => ({
    user: { id: "actor", displayName: "Actor" }, organization: { id: "org", name: "Org" }
  }) });
  assert.deepEqual(await service.create("token", { idempotencyKey, type: "bug", description: "Retry me", diagnostics: bugDiagnostics }),
    { accepted: true, referenceCode: "J7M4Q2K8X5PN" });
  assert.equal(statements.some((sql) => sql.includes("count(*)")), false);
  await assert.rejects(service.create("token", {
    idempotencyKey, type: "feature", description: "Changed", diagnostics: featureDiagnostics
  }), ConflictException);
});

test("a second distinct submission in a rolling minute receives a safe retry response", async () => {
  let rateLimitSql = "";
  const manager = { query: async (sql) => {
    if (sql.includes("where actor_id = $1 and idempotency_key")) return [];
    if (sql.includes("count(*)")) {
      rateLimitSql = sql;
      return [{ submission_count: 1, retry_after_seconds: 21 }];
    }
    return [];
  } };
  const service = new FeedbackService({ transaction: (work) => work(manager) }, { get: async () => ({
    user: { id: "actor", displayName: "Actor" }, organization: { id: "org", name: "Org" }
  }) });
  await assert.rejects(service.create("token", { idempotencyKey, type: "bug", description: "Second", diagnostics: bugDiagnostics }),
    (error) => error instanceof HttpException && error.getStatus() === 429
      && error.getResponse().retryAfterSeconds === 21
      && error.getResponse().message === "You have sent feedback in the last minute. Please try again later.");
  assert.match(rateLimitSql, /max\(created_at\) \+ interval '1 minute'/);
  assert.match(rateLimitSql, /created_at > now\(\) - interval '1 minute'/);
});

test("the feedback controller exposes create only and requires authentication", () => {
  const methods = Object.getOwnPropertyNames(FeedbackController.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(methods, ["create"]);
  const controller = new FeedbackController({ create: async () => ({ accepted: true, referenceCode: "ABCDEFGHIJKL" }) });
  assert.throws(() => controller.create({ type: "bug", description: "Valid" }), UnauthorizedException);
});

test("optional Android diagnostics accept old clients and APKs while strictly bounding new fields", () => {
  const event = { operation: "request", code: "TLS_FAILED", timestamp: "2026-11-16T12:00:00.000Z", durationMs: 12 };
  const runtime = { platform: "android", versionCode: 17, versionName: "0.1.7", androidApiLevel: 36, webViewVersion: "142.0.7444.48" };
  const command = (extra, type = "bug") => ({ idempotencyKey, type, description: "Valid", diagnostics: {
    status: "available", payload: { ...(type === "bug" ? bugDiagnostics.payload : context), ...extra }
  } });
  for (const value of [{}, { runtime: { platform: "browser" } }, { runtime: { platform: "android", versionCode: 1 } }, { runtime, nativeEvents: [event] }]) {
    assert.deepEqual(validateCreateFeedback(command(value)), command(value));
  }
  assert.deepEqual(validateCreateFeedback(command({ runtime }, "feature")), command({ runtime }, "feature"));
  for (const invalid of [
    { runtime, nativeEvents: Array(21).fill(event) },
    { runtime, nativeEvents: [{ ...event, code: "SECRET" }] },
    { runtime, nativeEvents: [{ ...event, operation: "SECRET" }] },
    { runtime, nativeEvents: [{ ...event, message: "SECRET" }] },
    { runtime, nativeEvents: [{ ...event, timestamp: "SECRET" }] },
    { runtime, nativeEvents: [{ ...event, durationMs: 300001 }] },
    { nativeEvents: [event] }, { runtime: { platform: "browser" }, nativeEvents: [event] },
    { runtime: { ...runtime, versionCode: -1 } }, { runtime: { ...runtime, androidApiLevel: 1001 } },
    { runtime: { ...runtime, webViewVersion: "SECRET /patient" } }, { runtime: { ...runtime, deviceId: "SECRET" } }
  ]) assert.throws(() => validateCreateFeedback(command(invalid)), BadRequestException);
  assert.throws(() => validateCreateFeedback(command({ runtime, nativeEvents: [event] }, "feature")), /nativeEvents/);
});
