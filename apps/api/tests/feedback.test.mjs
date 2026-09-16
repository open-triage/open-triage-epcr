import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { FeedbackController } from "../dist/feedback/feedback.controller.js";
import { createFeedbackReference, FeedbackService } from "../dist/feedback/feedback.service.js";
import { validateCreateFeedback } from "../dist/feedback/feedback.validation.js";

test("feedback validation trims bounded descriptions and rejects empty or forged fields", () => {
  assert.deepEqual(validateCreateFeedback({ type: "bug", description: "  It stopped  " }),
    { type: "bug", description: "It stopped" });
  assert.deepEqual(validateCreateFeedback({ type: "feature", description: "Let me filter calls" }),
    { type: "feature", description: "Let me filter calls" });
  assert.throws(() => validateCreateFeedback({ type: "bug", description: "   " }), BadRequestException);
  assert.throws(() => validateCreateFeedback({ type: "bug", description: "x".repeat(4001) }), /4,000/);
  for (const field of ["actorId", "organizationId", "actorDisplayName", "status", "priority", "reviewNote"]) {
    assert.throws(() => validateCreateFeedback({ type: "bug", description: "Valid", [field]: "forged" }),
      new RegExp(field));
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
  const manager = { query: async (sql, parameters) => { queries.push({ sql, parameters }); return [[], 1]; } };
  const dataSource = { transaction: (work) => work(manager) };
  const sessions = { get: async (token, _now, allowPasswordChange, suppliedManager) => {
    assert.equal(token, "verified-session-token");
    assert.equal(allowPasswordChange, false);
    assert.equal(suppliedManager, manager);
    return session;
  } };

  const result = await new FeedbackService(dataSource, sessions)
    .create("verified-session-token", { type: "feature", description: "A preserved idea" });

  assert.deepEqual(result.accepted, true);
  assert.match(result.referenceCode, /^[A-Z2-7]{12}$/);
  assert.match(queries[0].sql, /insert into feedback\.submission/);
  assert.deepEqual(queries[0].parameters.slice(1), [
    "feature", "A preserved idea", "org-from-session", "user-from-session",
    "Verified Organization", "Verified User"
  ]);
});

test("the feedback controller exposes create only and requires authentication", () => {
  const methods = Object.getOwnPropertyNames(FeedbackController.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(methods, ["create"]);
  const controller = new FeedbackController({ create: async () => ({ accepted: true, referenceCode: "ABCDEFGHIJKL" }) });
  assert.throws(() => controller.create({ type: "bug", description: "Valid" }), UnauthorizedException);
});
