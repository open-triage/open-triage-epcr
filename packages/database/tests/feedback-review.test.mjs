import assert from "node:assert/strict";
import test from "node:test";
import {
  UsageError, decodeCursor, encodeCursor, listFeedback, parseArguments, run, showFeedback
} from "../scripts/feedback-review.mjs";

test("list arguments are bounded and support every approved filter", () => {
  const options = parseArguments([
    "list", "--limit", "50", "--status", "triaged", "--type", "bug", "--priority", "urgent",
    "--organization", "4f4eaaf0-3ad8-4abe-980f-42aeb329ae10",
    "--created-from", "2026-09-01T00:00:00Z", "--created-before", "2026-10-01T00:00:00+02:00"
  ]);
  assert.equal(options.limit, 50);
  assert.equal(options.status, "triaged");
  assert.equal(options.type, "bug");
  assert.equal(options.priority, "urgent");
  assert.equal(options.createdFrom, "2026-09-01T00:00:00.000Z");
  assert.equal(options.createdBefore, "2026-09-30T22:00:00.000Z");

  assert.throws(() => parseArguments(["list", "--limit", "101"]), UsageError);
  assert.throws(() => parseArguments(["list", "--status", "anything"]), UsageError);
  assert.throws(() => parseArguments(["list", "--sql", "select 1"]), /Unsupported argument/);
});

test("cursor round trips a stable boundary and invalid cursors fail locally", () => {
  const cursor = encodeCursor("2026-09-16T12:00:00.000Z", "42");
  assert.deepEqual(decodeCursor(cursor), { createdAt: "2026-09-16T12:00:00.000Z", id: "42" });
  for (const invalid of ["", "not-json", Buffer.from("{}").toString("base64url"), "a".repeat(257)]) {
    assert.throws(() => decodeCursor(invalid), /Invalid cursor/);
  }
});

test("list uses one fixed function call, strips cursor ids, and emits the final item boundary", async () => {
  const calls = [];
  const rows = [1, 2, 3].map((id) => ({
    reference_code: `AAAAAAAAAA${id + 1}`, created_at: new Date(`2026-09-16T12:00:0${4 - id}.000Z`), cursor_id: String(id)
  }));
  const page = await listFeedback({ query: async (sql, values) => (calls.push({ sql, values }), { rows }) }, {
    limit: 2, priority: "unassigned"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^select \* from feedback\.review_queue/);
  assert.equal(calls[0].values[0], 3);
  assert.equal(calls[0].values[4], true);
  assert.equal(page.items.length, 2);
  assert.equal("cursor_id" in page.items[0], false);
  assert.deepEqual(decodeCursor(page.nextCursor), { createdAt: "2026-09-16T12:00:02.000Z", id: "2" });
});

test("detail uses only the opaque reference and missing references are safe", async () => {
  await assert.rejects(showFeedback({ query: async () => ({ rowCount: 0, rows: [] }) }, {
    reference: "J7M4Q2K6X5PN"
  }), /Feedback submission not found/);
  assert.throws(() => parseArguments(["show", "--reference", "1 OR 1=1"]), UsageError);
});

test("run always assumes the non-login reviewer role in a read-only transaction", async () => {
  const calls = [];
  class Client {
    async connect() { calls.push("connect"); }
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("select * from feedback.review_queue")) return { rows: [] };
      return { rows: [] };
    }
    async end() { calls.push("end"); }
  }
  let output = "";
  await run(["list"], {
    Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" },
    stdout: { write(value) { output += value; } }
  });
  assert.deepEqual(calls.slice(0, 3), ["connect", "begin read only", "set local role open_triage_feedback_reviewer"]);
  assert.equal(calls.at(-2), "commit");
  assert.equal(calls.at(-1), "end");
  assert.equal(output, '{"items":[],"nextCursor":null}\n');
});
