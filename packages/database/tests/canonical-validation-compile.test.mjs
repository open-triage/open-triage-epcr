import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileMetricLibrary, compileValidationRule } from "@open-triage/contracts";
import { canonicalValidationCatalog } from "./helpers/canonical-validation-catalog.mjs";

test("every enabled canonical NEMSIS rule compiles against the canonical catalog", async () => {
  const catalogDefinition = JSON.parse(await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url)));
  const validation = JSON.parse(await readFile(new URL("../../../defines/validation/validation_nemsis-full.json", import.meta.url)));
  const catalog = canonicalValidationCatalog(catalogDefinition);
  const versionId = "00000000-0000-4000-8000-000000000000";
  const library = compileMetricLibrary(validation.metrics, versionId, catalog);
  assert.deepEqual(library.diagnostics, []);
  assert.equal(library.metrics.length, 6);
  for (const rule of validation.rules) {
    assert.equal(rule.enabled, !rule.unresolved?.length, `${rule.name}: only rules awaiting mappings should be disabled`);
  }
  const failures = validation.rules.filter((rule) => rule.enabled).flatMap((rule) => {
    const result = compileValidationRule(rule, versionId, catalog, library.metrics);
    return result.compiled ? [] : [{ name: rule.name, diagnostics: result.diagnostics }];
  });
  assert.deepEqual(failures, []);
});
