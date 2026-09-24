import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

test("Helm cannot hide database preparation in an install or upgrade hook", async () => {
  const output = execFileSync("helm", ["template", "open-triage", chart], { encoding: "utf8" });
  const values = await readFile(new URL("../values.yaml", import.meta.url), "utf8");

  assert.doesNotMatch(output, /helm\.sh\/hook|component: migration|migrate:runtime|bootstrap:synthetic/);
  assert.doesNotMatch(output, /open-triage-migration-database/);
  assert.doesNotMatch(values, /^migration:|^  migration:/m);
});
