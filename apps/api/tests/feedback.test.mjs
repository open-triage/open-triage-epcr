import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
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
} } };

test("feedback validation trims bounded descriptions and rejects empty or forged fields", () => {
  assert.deepEqual(validateCreateFeedback({ type: "bug", description: "  It stopped  ", diagnostics: bugDiagnostics }),
    { type: "bug", description: "It stopped", diagnostics: bugDiagnostics });
  assert.deepEqual(validateCreateFeedback({ type: "feature", description: "Let me filter calls", diagnostics: featureDiagnostics }),
    { type: "feature", description: "Let me filter calls", diagnostics: featureDiagnostics });
  assert.throws(() => validateCreateFeedback({ type: "bug", description: "   ", diagnostics: bugDiagnostics }), BadRequestException);
  assert.throws(() => validateCreateFeedback({ type: "bug", description: "x".repeat(4001), diagnostics: bugDiagnostics }), /4,000/);
  for (const field of ["actorId", "organizationId", "actorDisplayName", "status", "priority", "reviewNote"]) {
    assert.throws(() => validateCreateFeedback({ type: "bug", description: "Valid", diagnostics: bugDiagnostics, [field]: "forged" }),
      new RegExp(field));
  }
});

test("feedback diagnostics reject unknown, oversized, type-inappropriate, and value-bearing fields", () => {
  const command = (type, diagnostics) => ({ type, description: "Valid", diagnostics });
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
  assert.deepEqual(validateCreateFeedback(command("bug", {
    status: "unavailable", schemaVersion: 1, reason: "capture-failed"
  })).diagnostics, { status: "unavailable", schemaVersion: 1, reason: "capture-failed" });
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
  const manager = { query: async (sql, parameters) => { queries.push({ sql, parameters }); return [[], 1]; } };
  const dataSource = { transaction: (work) => work(manager) };
  const sessions = { get: async (token, _now, allowPasswordChange, suppliedManager) => {
    assert.equal(token, "verified-session-token");
    assert.equal(allowPasswordChange, false);
    assert.equal(suppliedManager, manager);
    return session;
  } };

  const result = await new FeedbackService(dataSource, sessions)
    .create("verified-session-token", { type: "feature", description: "A preserved idea", diagnostics: featureDiagnostics });

  assert.deepEqual(result.accepted, true);
  assert.match(result.referenceCode, /^[A-Z2-7]{12}$/);
  assert.match(queries[0].sql, /insert into feedback\.submission/);
  assert.deepEqual(queries[0].parameters.slice(1), [
    "feature", "A preserved idea", "org-from-session", "user-from-session",
    "Verified Organization", "Verified User", "available", null, JSON.stringify(context)
  ]);
});

test("the feedback controller exposes create only and requires authentication", () => {
  const methods = Object.getOwnPropertyNames(FeedbackController.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(methods, ["create"]);
  const controller = new FeedbackController({ create: async () => ({ accepted: true, referenceCode: "ABCDEFGHIJKL" }) });
  assert.throws(() => controller.create({ type: "bug", description: "Valid" }), UnauthorizedException);
});
