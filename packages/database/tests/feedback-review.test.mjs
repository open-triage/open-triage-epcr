import assert from "node:assert/strict";
import test from "node:test";
import {
  StaleDecisionError, UsageError, applyBulk, decodeCursor, dryRunBulk, dryRunDecision, encodeCursor,
  listFeedback, listOpenFeedback, parseArguments, proposeFeedback, recordDecision, run, showFeedback
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

test("list-open accepts shared filters but owns status and pagination", () => {
  const parsed = parseArguments([
    "list-open", "--type", "feature", "--priority", "unassigned",
    "--created-from", "2026-09-01T00:00:00Z"
  ]);
  assert.equal(parsed.command, "list-open");
  assert.equal(parsed.type, "feature");
  assert.equal(parsed.priority, "unassigned");
  assert.throws(() => parseArguments(["list-open", "--status", "new"]), /Unsupported argument/);
  assert.throws(() => parseArguments(["list-open", "--cursor", "opaque"]), /Unsupported argument/);
  assert.throws(() => parseArguments(["list-open", "--limit", "1"]), /Unsupported argument/);
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

test("list-open exhausts every open status and groups counts", async () => {
  const calls = [];
  const client = { query: async (_sql, values) => {
    calls.push(values);
    const status = values[1];
    const cursorId = values[9];
    if (status !== "new") return { rows: [] };
    if (cursorId) return { rows: [{ reference_code: "AAAAAAAAAAA4", created_at: new Date("2026-09-16T11:59:58.000Z"), cursor_id: "4" }] };
    return { rows: [
      { reference_code: "AAAAAAAAAAA2", created_at: new Date("2026-09-16T12:00:00.000Z"), cursor_id: "2" },
      { reference_code: "AAAAAAAAAAA3", created_at: new Date("2026-09-16T11:59:59.000Z"), cursor_id: "3" },
      { reference_code: "AAAAAAAAAAA4", created_at: new Date("2026-09-16T11:59:58.000Z"), cursor_id: "4" },
    ] };
  } };
  const result = await listOpenFeedback(client, {}, 2);
  assert.deepEqual(result.counts, { new: 3, triaged: 0, planned: 0, in_progress: 0 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.new.map(({ reference_code }) => reference_code), [
    "AAAAAAAAAAA2", "AAAAAAAAAAA3", "AAAAAAAAAAA4"
  ]);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((values) => values[0] === 3));
});

test("detail uses only the opaque reference and missing references are safe", async () => {
  await assert.rejects(showFeedback({ query: async () => ({ rowCount: 0, rows: [] }) }, {
    reference: "J7M4Q2K6X5PN"
  }), /Feedback submission not found/);
  assert.throws(() => parseArguments(["show", "--reference", "1 OR 1=1"]), UsageError);
});

test("list commands assume the non-login reviewer role in read-only transactions", async () => {
  for (const command of ["list", "list-open"]) {
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
    await run([command], {
      Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" },
      stdout: { write(value) { output += value; } }
    });
    assert.deepEqual(calls.slice(0, 3), ["connect", "begin read only", "set local role open_triage_feedback_reviewer"]);
    assert.equal(calls.at(-2), "commit");
    assert.equal(calls.at(-1), "end");
    assert.ok(output.endsWith("\n"));
  }
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

test("duplicate and external-work arguments are explicit, bounded, and safe", () => {
  const base = [
    "apply", "--reference", "J7M4Q2K6X5PN", "--expected-version", "2",
    "--status", "duplicate", "--priority", "normal", "--note", "Confirmed duplicate",
    "--human-reviewer", "maintainer-1", "--duplicate-of", "T7M4Q2K6X5PA",
    "--external-kind", "issue", "--external-url", "https://github.com/open-triage/open-triage-epcr/issues/403"
  ];
  const parsed = parseArguments(base);
  assert.equal(parsed.duplicateOf, "T7M4Q2K6X5PA");
  assert.equal(parsed.externalKind, "issue");
  assert.throws(() => parseArguments(base.filter((value, index) => index < base.indexOf("--duplicate-of") || index > base.indexOf("--duplicate-of") + 1)), /require --duplicate-of/);
  assert.throws(() => parseArguments(base.map((value) => value === "T7M4Q2K6X5PA" ? "J7M4Q2K6X5PN" : value)), /another valid/);
  assert.throws(() => parseArguments(base.map((value) => value.startsWith("https://") ? "file:///tmp/issue" : value)), /HTTPS/);
  assert.throws(() => parseArguments(base.filter((value) => value !== "--external-kind" && value !== "issue")), /together/);
  assert.throws(() => parseArguments(base.map((value, index) =>
    index === base.indexOf("--status") + 1 ? "planned" : value)), UsageError);
});

test("bulk apply requires confirmation while bulk preview remains read-only", () => {
  const common = [
    "--item", "J7M4Q2K6X5PN:0", "--item", "T7M4Q2K6X5PA:3",
    "--status", "planned", "--priority", "high", "--note", "Approved bulk decision",
    "--human-reviewer", "maintainer-1"
  ];
  assert.throws(() => parseArguments(["bulk-apply", ...common]), /requires --confirm-bulk/);
  assert.equal(parseArguments(["bulk-apply", ...common, "--confirm-bulk"]).confirmed, true);
  assert.equal(parseArguments(["bulk-dry-run", ...common]).items.length, 2);
  assert.throws(() => parseArguments(["bulk-dry-run", ...common, "--confirm-bulk"]), UsageError);
  assert.throws(() => parseArguments(["bulk-apply", ...common, "--item", "J7M4Q2K6X5PN:1", "--confirm-bulk"]), /unique/);
});

test("unconfirmed bulk apply fails before opening a database connection", async () => {
  class Client {
    constructor() { throw new Error("must not connect"); }
  }
  await assert.rejects(run([
    "bulk-apply", "--item", "J7M4Q2K6X5PN:0", "--status", "planned",
    "--priority", "normal", "--note", "Approved bulk decision",
    "--human-reviewer", "maintainer-1"
  ], { Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" } }), /requires --confirm-bulk/);
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
  assert.equal(calls[0].values.length, 13);
});

test("bulk preview is non-mutating and confirmed apply reports known partial failures", async () => {
  const options = {
    items: [
      { reference: "J7M4Q2K6X5PN", expectedVersion: 0 },
      { reference: "T7M4Q2K6X5PA", expectedVersion: 1 }
    ], status: "planned", priority: "normal", note: "Approved bulk note",
    reviewerType: "human", humanReviewer: "maintainer-1"
  };
  const reads = [];
  const preview = await dryRunBulk({ query: async (sql, values) => {
    reads.push({ sql, values });
    return { rowCount: 1, rows: [{ submission: { reviewVersion: values[0] === "J7M4Q2K6X5PN" ? 0 : 2 } }] };
  } }, options);
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.results.map(({ ok }) => ok), [true, false]);
  assert.ok(reads.every(({ sql }) => sql === "select * from feedback.review_detail($1::text)"));

  const writes = [];
  const applied = await applyBulk({ query: async (sql, values) => {
    writes.push({ sql, values });
    if (sql.startsWith("select * from feedback.record_review_decision") && values[0] === "T7M4Q2K6X5PA") {
      const error = new Error("unsafe detail"); error.code = "PT002"; throw error;
    }
    if (sql.startsWith("select * from feedback.record_review_decision")) return { rows: [{ reference_code: values[0] }] };
    return { rows: [] };
  } }, options);
  assert.equal(applied.partialFailure, true);
  assert.deepEqual(applied.results.map(({ ok }) => ok), [true, false]);
  assert.equal(JSON.stringify(applied).includes("unsafe detail"), false);
  assert.ok(writes.some(({ sql }) => sql === "rollback to savepoint feedback_bulk_1"));
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

test("proposal, dry-run, and bulk preview commands use database-enforced read-only transactions", async () => {
  for (const command of ["propose", "dry-run", "bulk-dry-run"]) {
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
    const arguments_ = command === "bulk-dry-run" ? [
      command, "--item", "J7M4Q2K6X5PN:0", "--status", "triaged", "--priority", "normal",
      "--note", "Suggested note", "--human-reviewer", "maintainer-1"
    ] : [command, "--reference", "J7M4Q2K6X5PN", "--status", "triaged",
      "--priority", "normal", "--note", "Suggested note"];
    if (command === "dry-run") arguments_.push("--expected-version", "0", "--human-reviewer", "maintainer-1");
    await run(arguments_, {
      Client, env: { FEEDBACK_REVIEW_DATABASE_URL: "postgresql://reviewer.invalid/db" },
      stdout: { write() {} }
    });
    assert.deepEqual(calls.slice(0, 3), ["connect", "begin read only", "set local role open_triage_feedback_reviewer"]);
    assert.equal(calls.some((sql) => typeof sql === "string" && sql.includes("record_review_decision")), false);
  }
});
