import assert from "node:assert/strict";
import test from "node:test";
import { ReviewService } from "../dist/review/review.service.js";

test("creating an outcome accepts TypeORM's PostgreSQL RETURNING tuple", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const optionId = "22222222-2222-4222-8222-222222222222";
  const commandId = "33333333-3333-4333-8333-333333333333";
  const manager = { async query(sql) {
    if (sql.includes("from app_identity.organization")) return [{ id: organizationId }];
    if (sql.includes("from clinical.review_outcome_revision")) return [];
    if (sql.includes("insert into clinical.review_outcome_option")) return [[{ id: optionId }], 1];
    if (sql.includes("insert into clinical.review_outcome_revision")) return [[], 1];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const service = new ReviewService({ transaction: async (work) => work(manager) },
    { get: async () => ({ user: { id: optionId }, organization: { id: organizationId },
      capabilities: ["review:all", "review:admin"] }), assertCsrf: async () => {} });
  const result = await service.configureOutcome("token", { commandId, label: "Reviewed",
    meaning: "Complete review", active: true }, "valid");
  assert.deepEqual(result, { id: optionId, revision: 1, label: "Reviewed",
    meaning: "Complete review", active: true });
});

test("concurrent progress commands serialize on the item and stale command conflicts", async () => {
  const item = { version: 1, status: "new", assignee_id: "reviewer",
    outcome_option_id: null, outcome_revision: null, documenting_user_id: "author",
    independent_review: false };
  const history = [];
  const manager = { async query(sql, params) {
    if (sql.includes("from app_identity.organization")) return [{ id: params[0] }];
    if (sql.includes("for update of i")) return [{ ...item, version: String(item.version) }];
    if (sql.includes("from clinical.review_progress_history"))
      return history.filter((event) => event.command_id === params[1]);
    if (sql.includes("update clinical.review_item set status=")) {
      item.status = params[2]; item.version++; return [];
    }
    if (sql.includes("insert into clinical.review_progress_history")) {
      history.push({ command_id: params[2], actor_id: params[3], item_version: params[4],
        status: params[5], outcome_option_id: params[6] }); return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  let tail = Promise.resolve();
  const database = { transaction: async (work) => {
    const prior = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await work(manager); } finally { release(); }
  } };
  const session = { user: { id: "reviewer" }, organization: { id: "organization" },
    capabilities: ["review:all"] };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  service.item = async () => ({ ...item, progressHistory: history });
  const command = (commandId) => ({ commandId, expectedVersion: 1, dataset: "real", status: "in-review" });
  const settled = await Promise.allSettled([
    service.progress("token", "item", command("123e4567-e89b-42d3-a456-426614174001"), "valid"),
    service.progress("token", "item", command("123e4567-e89b-42d3-a456-426614174002"), "valid"),
  ]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  assert.equal(item.version, 2);
  assert.equal(history.length, 1);
});
