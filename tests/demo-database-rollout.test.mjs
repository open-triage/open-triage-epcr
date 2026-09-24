import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/prepare-demo-database.sh", import.meta.url), "utf8");

test("the explicit preparation Job is bounded, source-bound, and retained independently", () => {
  assert.match(script, /Source revision must be a full commit SHA/);
  assert.match(script, /Preparation image must use the source revision tag/);
  assert.match(script, /job="open-triage-database-prepare-/);
  assert.match(script, /app\.kubernetes\.io\/component: database-preparation/);
  assert.match(script, /ttlSecondsAfterFinished: 86400/);
  assert.match(script, /backoffLimit: 0/);
  assert.match(script, /activeDeadlineSeconds: 900/);
  assert.match(script, /prepare:demo:runtime/);
  assert.match(script, /open-triage-migration-database/);
});

test("destructive mode needs explicit disposable identity configuration", () => {
  for (const variable of [
    "DEMO_DATABASE_PREPARE_MODE",
    "DEMO_DATABASE_EXPECTED_HOST",
    "DEMO_DATABASE_PROJECT_REF",
    "DEMO_DATABASE_RESET_CONFIRMATION",
  ]) assert.ok(script.includes(variable), `missing ${variable}`);
  assert.match(script, /reinitialize-open-triage-public-disposable-demo/);
  assert.match(script, /DEMO_DATABASE_TARGET, value: open-triage-public-disposable-demo/);
  assert.match(script, /DEMO_DATABASE_EXPECTED_NAME, value: postgres/);
  assert.doesNotMatch(script, /set -x|printenv|echo .*\$\{?\w*database_url/i);
});
