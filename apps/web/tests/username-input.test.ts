import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const [component, expectedCount] of [
  ["clinician-session-gate", 1],
  ["admin-directory", 2],
] as const) {
  test(`${component} username fields disable automatic text changes`, () => {
    const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8");
    const inputs = source.match(/<input\b[^>]*\bname="username"[^>]*>/g) ?? [];
    assert.equal(inputs.length, expectedCount);
    for (const input of inputs) {
      assert.match(input, /\bautoCapitalize="none"/);
      assert.match(input, /\bautoCorrect="off"/);
      assert.match(input, /\bspellCheck=\{false\}/);
    }
  });
}
