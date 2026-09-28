import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDefinitionWriteViolations } from "../scripts/check-canonical-definitions.mjs";

test("canonical definition guard rejects direct and variable-based writes under defines", () => {
  assert.deepEqual(canonicalDefinitionWriteViolations(`await writeFile("defines/catalog/example.json", value);`, "direct.mjs"),
    ["direct.mjs: directly mutates a path under defines"]);
  assert.deepEqual(canonicalDefinitionWriteViolations(`const catalogPath = path.join(root, "defines/catalog/example.json");\nawait writeFile(catalogPath, value);`, "derived.mjs"),
    ["derived.mjs: mutates canonical defines path through catalogPath"]);
  assert.deepEqual(canonicalDefinitionWriteViolations(`const catalogPath = path.join(root, "defines/catalog/example.json");\nconst value = await readFile(catalogPath);\nawait writeFile(outputPath, value);`, "reader.mjs"), []);
});
