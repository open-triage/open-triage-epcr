import assert from "node:assert/strict";
import test from "node:test";
import {
  StaleDecisionError, UsageError, decodeCursor, dryRunDecision, encodeCursor,
  listFeedback, parseArguments, proposeFeedback, recordDecision, run, showFeedback
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

test("decision commands require explicit valid inputs and AI provenance", () => {
  const arguments_ = [
    "apply", "--reference", "J7M4Q2K6X5PN", "--expected-version", "2",
    "--status", "planned", "--priority", "high", "--summary", "Approved summary",
    "--note", "Human-approved triage note", "--reviewer-type", "ai-assisted",
    "--model", "gpt-5", "--review-run", "review-run-42", "--human-reviewer", "maintainer-1"
  ];
  const parsed = parseArguments(arguments_);
  assert.equal(parsed.expectedVersion, 2);
  assert.equal(parsed.reviewerType, "ai-assisted");
  assert.equal(parsed.humanReviewer, "maintainer-1");
  const without = (name) => {
    const index = arguments_.indexOf(name);
    return arguments_.filter((_value, candidate) => candidate !== index && candidate !== index + 1);
  };
  for (const required of ["--expected-version", "--status", "--priority", "--note", "--human-reviewer"]) {
    assert.throws(() => parseArguments(without(required)), UsageError);
  }
  assert.throws(() => parseArguments(without("--model")), UsageError);
  assert.throws(() => parseArguments(without("--review-run")), UsageError);
  assert.throws(() => parseArguments([...arguments_, "--sql", "update feedback.submission"]), /Unsupported argument/);
});

test("proposal and dry run inspect current state without writing", async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    return { rowCount: 1, rows: [{ submission: { reviewVersion: 3 }, diagnostics: null, review_history: [] }] };
  } };
  const common = {
    reference: "J7M4Q2K6X5PN", status: "triaged", priority: "normal", note: "Approved note",
    summary: "Summary", reviewerType: "human", humanReviewer: "maintainer-1"
  };
  const proposal = await proposeFeedback(client, common);
  assert.equal(proposal.proposal.expectedVersion, 3);
  const dryRun = await dryRunDecision(client, { ...common, expectedVersion: 3 });
  assert.equal(dryRun.dryRun, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql === "select * from feedback.review_detail($1::text)"));
  await assert.rejects(dryRunDecision(client, { ...common, expectedVersion: 2 }), StaleDecisionError);
});

test("apply uses only the fixed atomic decision function", async () => {
  const calls = [];
  const options = {
    reference: "J7M4Q2K6X5PN", expectedVersion: 0, status: "triaged", priority: "high",
    summary: "Summary", note: "Approved note", reviewerType: "ai-assisted",
    humanReviewer: "maintainer-1", model: "gpt-5", reviewRun: "run-1"
  };
  const result = await recordDecision({ query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ reference_code: options.reference, review_version: "1" }] };
  } }, options);
  assert.equal(result.applied, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^select \* from feedback\.record_review_decision/);
  assert.equal(calls[0].values[6], "ai_assisted");
});

test("apply is the only command that opens a write-capable transaction", async () => {
  const calls = [];
  class Client {
    async connect() { calls.push("connect"); }
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("select * from feedback.record_review_decision")) return { rows: [{}] };
      return { rows: [] };
    }
    async end() { calls.push("end"); }
  }
  await run([
    "apply", "--reference", "J7M4Q2K6X5PN", "--expected-version", "0",
    "--status", "triaged", "--priority", "normal", "--note", "Approved note",
    "--human-reviewer", "maintainer-1"
  ], {
    Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" },
    stdout: { write() {} }
  });
  assert.deepEqual(calls.slice(0, 3), ["connect", "begin", "set local role open_triage_feedback_reviewer"]);
});

test("proposal and dry-run commands use database-enforced read-only transactions", async () => {
  for (const command of ["propose", "dry-run"]) {
    const calls = [];
    class Client {
      async connect() { calls.push("connect"); }
      async query(sql) {
        calls.push(sql);
        if (sql === "select * from feedback.review_detail($1::text)") {
          return { rowCount: 1, rows: [{ submission: { reviewVersion: 0 } }] };
        }
        return { rows: [] };
      }
      async end() { calls.push("end"); }
    }
    const arguments_ = [
      command, "--reference", "J7M4Q2K6X5PN", "--status", "triaged",
      "--priority", "normal", "--note", "Suggested note"
    ];
    if (command === "dry-run") arguments_.push("--expected-version", "0", "--human-reviewer", "maintainer-1");
    await run(arguments_, {
      Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" },
      stdout: { write() {} }
    });
    assert.deepEqual(calls.slice(0, 3), ["connect", "begin read only", "set local role open_triage_feedback_reviewer"]);
    assert.equal(calls.some((sql) => typeof sql === "string" && sql.includes("record_review_decision")), false);
  }
});
