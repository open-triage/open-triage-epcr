import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

test("web lint excludes generated build and browser artifacts while retaining source checks", async () => {
  const cwd = path.resolve(import.meta.dirname, "../apps/web");
  const eslint = new ESLint({ cwd });
  for (const directory of [".next", ".next-e2e", "test-results", "playwright-report"]) {
    assert.equal(await eslint.isPathIgnored(path.join(cwd, directory, "trace", "generated.js")), true, directory);
  }
  assert.equal(await eslint.isPathIgnored(path.join(cwd, "app/clinician-session.ts")), false);
});
