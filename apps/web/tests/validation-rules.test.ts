import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, encounterValueFacets, evaluateValidationBundle, type CompiledValidationBundle,
  type EncounterDocument, type ValidationRuleSource } from "@open-triage/contracts";
import syntheticEncounter from "../app/data/synthetic-encounter-document.json";

const versionId = "51000000-0000-4000-8000-000000000001";
const rule: ValidationRuleSource = {
  id: "52000000-0000-4000-8000-000000000001",
  name: "Require incident number",
  enabled: true,
  severity: "error",
  executionTargets: ["live", "sign"],
  primaryTargetElementId: "eResponse.03",
  message: "Document the incident number",
  source: 'assert present("eResponse.03")',
};

test("the reviewed required-element source compiles to one canonical catalog-bound assertion", () => {
  const result = compileValidationRule(rule, versionId, new Set(["eResponse.03"]));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.compiled?.assertion, { operator: "present", elementId: "eResponse.03" });
  assert.deepEqual(result.compiled?.executionTargets, ["live", "sign"]);
});

test("unknown references and non-contract source fail with structured diagnostics", () => {
  assert.equal(compileValidationRule({ ...rule, source: "required eResponse.03" }, versionId,
    new Set(["eResponse.03"])).diagnostics[0]?.code, "syntax");
  assert.equal(compileValidationRule(rule, versionId, new Set()).diagnostics[0]?.code, "catalog-reference");
});

test("browser and server targets produce the same targeted finding and clear when the value is present", () => {
  const compiled = compileValidationRule(rule, versionId, new Set(["eResponse.03"])).compiled!;
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [compiled] };
  const missing = structuredClone(syntheticEncounter) as unknown as {
    groups: Array<{ instances: Array<{ elements: Array<{ id: string; values: unknown[] }> }> }>;
  };
  for (const group of missing.groups) for (const instance of group.instances) {
    instance.elements = instance.elements.filter(({ id }) => id !== "eResponse.03");
  }
  const live = evaluateValidationBundle(bundle, missing as unknown as EncounterDocument, "live");
  const sign = evaluateValidationBundle(bundle, missing as unknown as EncounterDocument, "sign");
  assert.equal(live.length, 1);
  assert.equal(sign.length, 1);
  assert.equal(live[0]?.primaryTarget.elementId, "eResponse.03");
  assert.equal(live[0]?.ruleId, rule.id);
  assert.equal(live[0]?.inputFingerprint, sign[0]?.inputFingerprint);
  assert.deepEqual(evaluateValidationBundle(bundle, syntheticEncounter as EncounterDocument, "sign"), []);
});

test("rule inputs expose ordinary value, Not Value, Pertinent Negative, and emptiness independently", () => {
  assert.deepEqual(encounterValueFacets({ kind: "scalar", occurrenceId: "combined", value: "present",
    notValue: { code: "7701003" }, pertinentNegative: { code: "8801019" } }), {
    hasValue: true, hasNotValue: true, hasPertinentNegative: true, empty: false,
  });
  assert.deepEqual(encounterValueFacets({ kind: "absent", occurrenceId: "empty" }), {
    hasValue: false, hasNotValue: false, hasPertinentNegative: false, empty: true,
  });
});
