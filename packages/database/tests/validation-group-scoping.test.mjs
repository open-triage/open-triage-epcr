import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validationOccurrenceScope } from "@open-triage/contracts/validation-group-scope";
import { compileValidationRule, compiledValidationBundleSha256, evaluateValidationBundle,
  evaluateValidationBundleSafely, minimumRuleCoversRequirement } from "@open-triage/contracts";

const catalogDefinition = JSON.parse(await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url)));
const catalog = {
  elements: catalogDefinition.elements.map((element) => ({ elementId: element.id, label: element.name,
    baseDatatype: element.datatype.base, groupPath: element.groupPath, intrinsicOccurrence: element.occurrence })),
  groups: catalogDefinition.groups.map((group) => ({ groupId: group.id, label: group.name, repeating: group.repeating,
    parentGroupId: group.parentId, intrinsicOccurrence: group.occurrence })),
};
const context = { timestamp: "2026-10-03T00:00:00Z" };
const groupDefinitions = new Map(catalog.groups.map((group) => [group.groupId, group]));
const scopeFor = (elementId) => validationOccurrenceScope(
  catalog.elements.find((element) => element.elementId === elementId).groupPath.at(-1), groupDefinitions);
function rowDocument(elementId, rows) {
  const element = catalog.elements.find((element) => element.elementId === elementId);
  const path = element.groupPath.slice(element.groupPath.indexOf(scopeFor(elementId)));
  return { groups: path.map((groupId, depth) => ({ id: groupId, instances: rows.map(({ id, values }) => ({
    instanceId: depth === 0 ? id : `${id}:${groupId}`,
    ...(depth ? { parentInstanceId: depth === 1 ? id : `${id}:${path[depth - 1]}` } : {}),
    elements: depth === path.length - 1 ? [{ id: elementId, values }] : [],
  })) })) };
}
const targets = ["live", "sign", "review"];
const bundleOf = (rules) => ({ schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "test",
  catalogReleaseId: "test", rules });
function compile(source) {
  const result = compileValidationRule({ ...source, executionTargets: targets }, "test", catalog);
  assert.ok(result.compiled, JSON.stringify(result.diagnostics));
  return result.compiled;
}
function occurrenceRule(elementId, kind = "minimum", count = 1) {
  const element = catalog.elements.find((element) => element.elementId === elementId);
  return { id: `${elementId}-${kind}`, name: `${element.label} documented ${kind}`, enabled: true,
    severity: "error", executionTargets: targets, sourceKind: "catalog", primaryTargetElementId: elementId,
    message: `${element.label} ${kind === "minimum" ? "requires at least" : "permits at most"} ${count} documented occurrence(s)`,
    source: `require ${kind}("${elementId}", ${count})` };
}

test("foreach skips assertion and applicability evaluation when any named group has no instances", () => {
  const result = compileValidationRule({ id: "custom", name: "Custom row", enabled: true, severity: "error",
    executionTargets: targets, primaryTargetElementId: "agency.measurement", message: "Complete the row",
    source: 'for each("agency.RowGroup")\nwhen all(always(), always())\nrequire never()',
  }, "test", { elements: [{ elementId: "agency.measurement", label: "Measurement", baseDatatype: "integer",
    groupPath: ["agency.RowGroup"] }], groups: [{ groupId: "agency.RowGroup", label: "Row", repeating: true,
    intrinsicOccurrence: { min: 0, max: "unbounded" } }] });
  assert.ok(result.compiled, JSON.stringify(result.diagnostics));
  const bundle = bundleOf([result.compiled]);
  for (const target of targets) {
    for (const groups of [[], [{ id: "agency.RowGroup", instances: [] }]]) {
      assert.deepEqual(evaluateValidationBundleSafely(bundle, { groups }, target,
        { ...context, limits: { maxExpressionNodes: 1 } }), { findings: [], failures: [] });
    }
    const groups = [{ id: "agency.RowGroup", instances: [{ instanceId: "empty", elements: [] }] }];
    assert.equal(evaluateValidationBundle(bundle, { groups }, target, context).length, 1);
  }
});

for (const key of ["nemsis-full", "sweden"]) {
  test(`${key}: every generated catalog bound respects required and optional group ancestry`, async () => {
    const definition = JSON.parse(await readFile(new URL(`../../../defines/validation/validation_${key}.json`, import.meta.url)));
    const sources = definition.rules.filter((rule) => rule.sourceKind === "catalog");
    assert.ok(sources.length > 300);
    for (const source of sources) {
      const rule = compile(source);
      assert.deepEqual(rule.scope, { groupId: scopeFor(source.primaryTargetElementId), iteration: "each" }, source.name);
    }
    const reportRules = sources.filter((rule) => rule.enabled && rule.primaryTargetElementId.startsWith("e"));
    const installed = bundleOf(definition.rules.filter((rule) => rule.enabled).map(compile));
    for (const target of targets) {
      assert.deepEqual(evaluateValidationBundleSafely(installed, { groups: [] }, target, context), { findings: [], failures: [] },
        "the complete installed rule set does not require data in absent groups");
    }
    const current = bundleOf(reportRules.map(compile));
    // Simulate published artifacts from before singleton-group scopes were added.
    const legacy = bundleOf(reportRules.map((source) => compile({ ...source,
      source: source.source.replace(/^for each\("[^"]+"\)\n/, "") })));
    for (const bundle of [current, legacy]) {
      const hash = compiledValidationBundleSha256(bundle);
      for (const groups of [[], [{ id: "unrelated", instances: [{ instanceId: "unrelated", elements: [] }] }],
        catalog.groups.map(({ groupId }) => ({ id: groupId, instances: [] }))]) {
        for (const target of targets) {
          assert.deepEqual(evaluateValidationBundleSafely(bundle, { groups }, target, context), { findings: [], failures: [] });
        }
      }
      assert.equal(compiledValidationBundleSha256(bundle), hash, "evaluation preserves pinned artifact integrity");
    }
  });
}

test("required singleton children are required as soon as their containing row exists", () => {
  for (const elementId of ["eVitals.06", "eMedications.05", "ePatient.15", "eResponse.03"]) {
    const source = occurrenceRule(elementId);
    const owner = catalog.elements.find((element) => element.elementId === elementId).groupPath.at(-1);
    const scope = scopeFor(elementId);
    for (const sourceText of [source.source, `for each("${owner}")\n${source.source}`, `for each("${scope}")\n${source.source}`]) {
      const bundle = bundleOf([compile({ ...source, source: sourceText })]);
      for (const target of targets) {
        assert.deepEqual(evaluateValidationBundle(bundle, { groups: [] }, target, context), []);
        const missing = { groups: [{ id: scope, instances: [{ instanceId: "parent", elements: [] }] }] };
        assert.deepEqual(evaluateValidationBundle(bundle, missing, target, context).map(({ primaryTarget }) => primaryTarget),
          [{ elementId, groupInstanceId: "parent" }]);
        const document = rowDocument(elementId, [
          { id: "empty", values: [] },
          { id: "complete", values: [{ kind: "scalar", occurrenceId: "value", value: 1 }] },
        ]);
        const findings = evaluateValidationBundle(bundle, document, target, context);
        assert.deepEqual(findings.map(({ primaryTarget }) => primaryTarget),
          [{ elementId, groupInstanceId: owner === scope ? "empty" : `empty:${owner}` }]);
      }
    }
  }
});

test("optional singleton and repeating groups remain conditional on their own existence", () => {
  for (const elementId of ["eVitals.24", "eHistory.10"]) {
    const rule = compile(occurrenceRule(elementId));
    const owner = catalog.elements.find((element) => element.elementId === elementId).groupPath.at(-1);
    assert.equal(scopeFor(elementId), owner);
    const parent = catalog.groups.find((group) => group.groupId === owner).parentGroupId;
    const bundle = bundleOf([rule]);
    for (const target of targets) {
      assert.deepEqual(evaluateValidationBundle(bundle, { groups: [{ id: parent,
        instances: [{ instanceId: "parent", elements: [] }] }] }, target, context), []);
      assert.equal(evaluateValidationBundle(bundle, rowDocument(elementId, [{ id: "empty", values: [] }]), target, context).length, 1);
    }
  }
});

test("maxima are evaluated per singleton child rather than summed across repeated rows", () => {
  for (const elementId of ["eVitals.06", "eMedications.05"]) {
    const source = occurrenceRule(elementId, "maximum");
    const rule = compile(source);
    const owner = catalog.elements.find((element) => element.elementId === elementId).groupPath.at(-1);
    const { groups } = rowDocument(elementId, ["first", "second"].map((id) => ({ id,
      values: [{ kind: "scalar", occurrenceId: id, value: 1 }] })));
    const bundle = bundleOf([rule]);
    for (const target of targets) {
      assert.deepEqual(evaluateValidationBundle(bundle, { groups }, target, context), []);
      const invalid = structuredClone(groups);
      invalid.at(-1).instances[1].elements[0].values.push({ kind: "scalar", occurrenceId: "extra", value: 2 });
      assert.deepEqual(evaluateValidationBundle(bundle, { groups: invalid }, target, context)
        .map(({ primaryTarget }) => primaryTarget.groupInstanceId), [`second:${owner}`]);
    }
  }
});

test("legacy generated agency and form requirements respect owning groups", () => {
  const elementId = "eMedications.05";
  const source = occurrenceRule(elementId);
  const label = catalog.elements.find((element) => element.elementId === elementId).label;
  for (const [name, message, expression] of [
    [`${label} agency required`, `${label} is required by agency policy`, source.source],
    [`${label} form required`, `${label} is required by the form`, source.source],
    [`${label} conditional form required`, `${label} is required by its current form condition`, `when always()\nrequire present("${elementId}")`],
  ]) {
    const bundle = bundleOf([compile({ ...source, name, message, source: expression })]);
    for (const target of targets) {
      assert.deepEqual(evaluateValidationBundle(bundle, { groups: [] }, target, context), []);
      assert.equal(evaluateValidationBundle(bundle, { groups: [{ id: "eMedications.MedicationGroup",
        instances: [{ instanceId: "empty", elements: [] }] }] }, target, context).length, 1);
    }
  }
});

test("explicit scopes and authored report-wide requirements retain their meaning", () => {
  const source = occurrenceRule("eVitals.06");
  for (const changed of [
    { name: "Agency-wide minimum" }, { message: "Agency policy requires a blood pressure" },
    { source: `when always()\n${source.source}` },
  ]) {
    const rule = compile({ ...source, ...changed });
    assert.equal(evaluateValidationBundle(bundleOf([rule]), { groups: [] }, "sign", context).length, 1);
  }
  const explicit = compile({ ...source, source: `for each("eVitals.VitalGroup")\n${source.source}` });
  assert.equal(evaluateValidationBundle(bundleOf([explicit]), { groups: [{ id: "eVitals.VitalGroup",
    instances: [{ instanceId: "vital", elements: [] }] }] }, "sign", context)[0].primaryTarget.groupInstanceId, "vital");
  const legacy = compile(source);
  assert.equal(minimumRuleCoversRequirement(bundleOf([legacy]), "eVitals.06", 1, "error", "sign", "eVitals.VitalGroup", false), true);
  assert.equal(minimumRuleCoversRequirement(bundleOf([legacy]), "eVitals.06", 1, "error", "sign", "eVitals.BloodPressureGroup"), false);
});
