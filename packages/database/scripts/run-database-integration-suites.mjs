import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIsolatedDatabaseSuite } from "./lib/isolated-database-suite.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["database-foundation", "tests/postgres.integration.test.mjs"],
  ["database-feedback", "tests/feedback-postgres.integration.test.mjs"],
  ["database-feedback-retention", "tests/feedback-diagnostic-retention-postgres.integration.test.mjs"],
  ["database-feedback-triage", "tests/feedback-triage-postgres.integration.test.mjs"],
  ["database-feedback-review", "tests/feedback-review-postgres.integration.test.mjs"],
];

let firstFailure;
for (const [lane, suite] of suites) {
  try {
    await runIsolatedDatabaseSuite({
      lane,
      command: process.execPath,
      args: ["--test", suite],
      cwd: packageRoot,
      env: { ...process.env, REQUIRE_DATABASE_INTEGRATION: "1" },
    });
  } catch (error) {
    firstFailure ??= error;
  }
}

if (firstFailure) throw firstFailure;
