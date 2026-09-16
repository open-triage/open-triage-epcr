import assert from "node:assert/strict";
import test from "node:test";
import { UsageError, expireBatch, parseArguments, run } from "../scripts/expire-feedback-diagnostics.mjs";

test("retention arguments have hard per-batch and per-run bounds", () => {
  assert.deepEqual(parseArguments([]), { batchSize: 100, maxBatches: 10 });
  assert.deepEqual(parseArguments(["--batch-size", "1000", "--max-batches", "100"]), {
    batchSize: 1000, maxBatches: 100
  });
  for (const arguments_ of [
    ["--batch-size", "0"], ["--batch-size", "1001"], ["--max-batches", "101"],
    ["--max-batches", "not-a-number"], ["--sql", "delete from feedback.diagnostic"]
  ]) assert.throws(() => parseArguments(arguments_), UsageError);
});

test("each cleanup batch is atomic and rolls back on failure", async () => {
  const calls = [];
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith("select * from feedback.expire")) {
      return { rows: [{ deleted_count: 3, remaining_eligible: 2 }] };
    }
    return { rows: [] };
  } };
  assert.deepEqual(await expireBatch(client, 25), { deleted: 3, remainingEligible: 2 });
  assert.deepEqual(calls.map(({ sql }) => sql), [
    "begin", "set local role open_triage_feedback_retention",
    "select * from feedback.expire_terminal_diagnostics($1::integer)", "commit"
  ]);
  assert.deepEqual(calls[2].values, [25]);

  const failed = [];
  await assert.rejects(expireBatch({ query: async (sql) => {
    failed.push(sql);
    if (sql.startsWith("select *")) throw new Error("database unavailable");
    return { rows: [] };
  } }, 10), /database unavailable/);
  assert.equal(failed.at(-1), "rollback");
});

test("operator run is bounded and emits counts without record or diagnostic contents", async () => {
  const responses = [
    { deleted_count: 2, remaining_eligible: 1 },
    { deleted_count: 1, remaining_eligible: 0 }
  ];
  const calls = [];
  class Client {
    async connect() { calls.push("connect"); }
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("select *")) return { rows: [responses.shift()] };
      return { rows: [] };
    }
    async end() { calls.push("end"); }
  }
  let output = "";
  const summary = await run(["--batch-size", "2", "--max-batches", "5"], {
    Client, env: { FEEDBACK_RETENTION_DATABASE_URL: "postgresql://retention.invalid/db" },
    stdout: { write(value) { output += value; } }
  });
  assert.deepEqual(summary, { batches: 2, deleted: 3, remainingEligible: 0, batchSize: 2, maxBatches: 5 });
  assert.equal(output, `${JSON.stringify(summary)}\n`);
  assert.doesNotMatch(output, /reference|payload|description|actor|organization/i);
  assert.equal(calls.filter((sql) => sql.startsWith?.("select *")).length, 2);
  assert.equal(calls.at(-1), "end");
});
