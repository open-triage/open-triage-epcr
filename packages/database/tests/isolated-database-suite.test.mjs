import assert from "node:assert/strict";
import test from "node:test";
import {
  isolatedDatabaseName,
  runIsolatedDatabaseSuite,
} from "../scripts/lib/isolated-database-suite.mjs";

const sourceEnvironment = {
  DATABASE_URL: "postgresql://owner:secret@localhost:5432/open_triage_test",
};

function harness({ commandFailure, cleanupFailure, setupFailure } = {}) {
  const queries = [];
  const commands = [];
  const reports = [];
  class Client {
    async connect() {
      if (setupFailure) throw setupFailure;
    }
    async query(sql) {
      queries.push(sql);
      if (sql === "select current_user") return { rows: [{ current_user: "suite_owner" }] };
      if (sql.startsWith("drop database") && cleanupFailure) throw cleanupFailure;
      return { rows: [] };
    }
    async end() {}
  }
  return {
    queries,
    commands,
    reports,
    dependencies: {
      Client,
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (commandFailure) throw commandFailure;
      },
      persistReport: async (_path, report) => reports.push(report),
      now: (() => {
        const dates = [new Date("2026-09-24T12:00:00Z"), new Date("2026-09-24T12:00:01Z")];
        return () => dates.shift();
      })(),
    },
  };
}

test("creates an explicitly owned template0 database and disposes it after the suite", async () => {
  const fake = harness();
  const report = await runIsolatedDatabaseSuite({
    lane: "api-integration",
    databaseName: "open_triage_test_api_101_2",
    command: "node",
    args: ["--test", "tests/postgres.integration.test.mjs"],
    env: sourceEnvironment,
  }, fake.dependencies);

  assert.match(fake.queries[1], /create database "open_triage_test_api_101_2" with owner "suite_owner" template template0/);
  assert.equal(fake.queries.at(-1), 'drop database "open_triage_test_api_101_2" with (force)');
  assert.equal(new URL(fake.commands[0].options.env.DATABASE_URL).pathname, "/open_triage_test_api_101_2");
  assert.equal(fake.commands[0].options.env.DATABASE_TEST_LANE, "api-integration");
  assert.equal(report.status, "passed");
  assert.equal(report.database.owner, "suite_owner");
});

test("a failed lane is removed and cannot change a subsequent independent lane", async () => {
  const causalFailure = new Error("deliberate first-suite failure");
  const failed = harness({ commandFailure: causalFailure });
  await assert.rejects(runIsolatedDatabaseSuite({
    lane: "database-foundation",
    command: "node",
    env: sourceEnvironment,
  }, failed.dependencies), (error) => error === causalFailure);
  assert.match(failed.queries.at(-1), /^drop database/);
  assert.equal(failed.reports[0].primaryFailure.message, causalFailure.message);

  const independent = harness();
  const result = await runIsolatedDatabaseSuite({
    lane: "database-feedback",
    command: "node",
    env: sourceEnvironment,
  }, independent.dependencies);
  assert.equal(result.status, "passed");
  assert.notEqual(failed.reports[0].database.name, result.database.name);
});

test("cleanup and setup errors never obscure the first causal suite failure", async () => {
  const causalFailure = new Error("nested suite root cause");
  const cleanupFailure = new Error("cleanup also failed");
  const fake = harness({ commandFailure: causalFailure, cleanupFailure });
  await assert.rejects(runIsolatedDatabaseSuite({
    lane: "database-feedback-triage",
    command: "node",
    env: sourceEnvironment,
  }, fake.dependencies), (error) => error === causalFailure);
  assert.equal(fake.reports[0].primaryFailure.message, causalFailure.message);
  assert.equal(fake.reports[0].cleanupFailure.message, cleanupFailure.message);

  const setupFailure = new Error("maintenance API unavailable");
  const unavailable = harness({ setupFailure });
  await assert.rejects(runIsolatedDatabaseSuite({
    lane: "database-feedback-review",
    command: "node",
    env: sourceEnvironment,
  }, unavailable.dependencies), (error) => error === setupFailure);
  assert.equal(unavailable.commands.length, 0);
  assert.equal(unavailable.queries.length, 0);
  assert.equal(unavailable.reports[0].primaryFailure.message, setupFailure.message);
});

test("lane names are safe, stable, and carry CI execution identity", () => {
  assert.equal(
    isolatedDatabaseName("scale-validation", { runId: "987", runAttempt: "3", processId: 1 }),
    "open_triage_test_scale_validation_987_3",
  );
  assert.throws(() => isolatedDatabaseName("unsafe lane"), /Database lane must match/);
});
