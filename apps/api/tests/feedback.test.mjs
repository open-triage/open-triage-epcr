import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from "@nestjs/common";
import { FeedbackController } from "../dist/feedback/feedback.controller.js";
import { createFeedbackReference, FeedbackService } from "../dist/feedback/feedback.service.js";
import { validateCreateFeedback } from "../dist/feedback/feedback.validation.js";

const idempotencyKey = "40000000-0000-4000-8000-000000000003";

test("feedback validation trims bounded descriptions and requires a UUID idempotency key", () => {
  assert.deepEqual(validateCreateFeedback({ idempotencyKey, type: "bug", description: "  It stopped  " }),
    { idempotencyKey, type: "bug", description: "It stopped" });
  assert.deepEqual(validateCreateFeedback({ idempotencyKey, type: "feature", description: "Let me filter calls" }),
    { idempotencyKey, type: "feature", description: "Let me filter calls" });
  assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "   " }), BadRequestException);
  assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "x".repeat(4001) }), /4,000/);
  assert.throws(() => validateCreateFeedback({ idempotencyKey: "reused", type: "bug", description: "Valid" }), /UUID/);
  for (const field of ["actorId", "organizationId", "actorDisplayName", "status", "priority", "reviewNote"]) {
    assert.throws(() => validateCreateFeedback({ idempotencyKey, type: "bug", description: "Valid", [field]: "forged" }),
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
    .create("verified-session-token", { idempotencyKey, type: "feature", description: "A preserved idea" });

  assert.deepEqual(result.accepted, true);
  assert.match(result.referenceCode, /^[A-Z2-7]{12}$/);
  const insert = queries.find(({ sql }) => sql.includes("insert into feedback.submission"));
  assert.ok(insert);
  assert.deepEqual(insert.parameters.slice(1), [
    idempotencyKey,
    "feature", "A preserved idea", "org-from-session", "user-from-session",
    "Verified Organization", "Verified User"
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
  assert.deepEqual(await service.create("token", { idempotencyKey, type: "bug", description: "Retry me" }),
    { accepted: true, referenceCode: "J7M4Q2K8X5PN" });
  assert.equal(statements.some((sql) => sql.includes("count(*)")), false);
  await assert.rejects(service.create("token", { idempotencyKey, type: "feature", description: "Changed" }), ConflictException);
});

test("a sixth distinct submission in a rolling hour receives a safe retry response", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("where actor_id = $1 and idempotency_key")) return [];
    if (sql.includes("count(*)")) return [{ submission_count: 5, retry_after_seconds: 721 }];
    return [];
  } };
  const service = new FeedbackService({ transaction: (work) => work(manager) }, { get: async () => ({
    user: { id: "actor", displayName: "Actor" }, organization: { id: "org", name: "Org" }
  }) });
  await assert.rejects(service.create("token", { idempotencyKey, type: "bug", description: "Sixth" }),
    (error) => error instanceof HttpException && error.getStatus() === 429
      && error.getResponse().retryAfterSeconds === 721);
});

test("the feedback controller exposes create only and requires authentication", () => {
  const methods = Object.getOwnPropertyNames(FeedbackController.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(methods, ["create"]);
  const controller = new FeedbackController({ create: async () => ({ accepted: true, referenceCode: "ABCDEFGHIJKL" }) });
  assert.throws(() => controller.create({ type: "bug", description: "Valid" }), UnauthorizedException);
});
