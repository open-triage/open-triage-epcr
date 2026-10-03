import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, evaluateValidationBundle, evaluateValidationBundleSafely,
  explainValidationRule, formatValidationSource, type CompiledValidationBundle,
  type EncounterDocument, type ValidationCatalog, type ValidationRuleSource } from "@open-triage/contracts";

const vitals = "eVitals.VitalGroup";
const catalog: ValidationCatalog = {
  elements: [{ elementId: "eVitals.01", label: "Vitals timestamp", baseDatatype: "dateTime", groupPath: ["report", vitals] }],
  groups: [
    { groupId: "report", label: "Report", repeating: true, intrinsicOccurrence: { min: 0, max: "unbounded" } },
    { groupId: vitals, label: "Vital signs", repeating: true, parentGroupId: "report", intrinsicOccurrence: { min: 0, max: "unbounded" } },
    { groupId: "empty-group", label: "Empty group", repeating: true, intrinsicOccurrence: { min: 0, max: "unbounded" } },
  ],
};
const rule: ValidationRuleSource = { id: "group-count", name: "At least one set of vitals", enabled: true,
  severity: "warning", reviewPriority: "low", executionTargets: ["review"], primaryTargetElementId: "eVitals.01",
  message: "Document at least one set of vital signs.", source: `require minimumGroups("${vitals}", 1)` };
const context = { timestamp: "2026-10-03T10:00:00.000Z" };
const document = (groups: EncounterDocument["groups"]): EncounterDocument => ({
  $schema: "./encounter-document.schema-1.0.0.json", documentType: "open-triage.encounter", modelVersion: "1.1.0",
  dataModel: { standard: "NEMSIS", version: "3.5.1", dataset: "EMSDataSet" }, formProfile: { id: "test", version: "1" },
  encounter: { id: "test", createdAt: context.timestamp, updatedAt: context.timestamp }, groups,
});
const instance = (instanceId: string, parentInstanceId?: string) => ({ instanceId, elements: [], ...(parentInstanceId ? { parentInstanceId } : {}) });
function bundle(source = rule.source): CompiledValidationBundle {
  const result = compileValidationRule({ ...rule, source }, "version", catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.compiled);
  return { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "version", catalogReleaseId: "catalog", rules: [result.compiled] };
}
const findings = (groups: EncounterDocument["groups"], source?: string) => evaluateValidationBundle(bundle(source), document(groups), "review", context);

test("group minimum catches missing/zero instances and accepts a vitals set without a timestamp", () => {
  assert.equal(findings([]).length, 1);
  assert.equal(findings([{ id: vitals, instances: [] }]).length, 1);
  assert.equal(findings([{ id: "unrelated", instances: [instance("other")] }]).length, 1);
  assert.deepEqual(findings([{ id: vitals, instances: [instance("vital")] }]), []);
  assert.deepEqual(findings([{ id: vitals, instances: [instance("vital-a"), instance("vital-b")] }]), []);
  assert.equal(findings([])[0]?.severity, "warning");
  assert.equal(bundle().rules[0]?.reviewPriority, "low");
  for (const target of ["live", "sign"] as const) assert.deepEqual(evaluateValidationBundle(bundle(), document([]), target, context), []);
});

test("group references compile, format, and explain independently of element references", () => {
  assert.deepEqual(bundle().rules[0]?.references, { elementIds: [], groupIds: [vitals], codes: [] });
  assert.match(explainValidationRule(bundle().rules[0]!, catalog), /Vital signs.*at least 1 group instance/);
  const source = `when not(maximumGroups("${vitals}", 0))\nrequire minimumGroups("${vitals}", 2)`;
  assert.equal(formatValidationSource(source).formatted, source);
  assert.equal(findings([{ id: vitals, instances: [instance("a")] }], source).length, 1);
  assert.equal(findings([], source).length, 0);
  const pathOnly = compileValidationRule(rule, "version", { elements: catalog.elements });
  assert.ok(pathOnly.compiled, "Browser catalog element paths identify groups");
  assert.ok(compileValidationRule({ ...rule, source: 'require minimumGroups("empty-group", 1)' }, "version", catalog).compiled);
});

test("group counts reject unknown groups, element IDs, missing catalog metadata, and invalid counts", () => {
  for (const source of ['require minimumGroups("missing", 1)', 'require minimumGroups("eVitals.01", 1)']) {
    const result = compileValidationRule({ ...rule, source }, "version", catalog);
    assert.equal(result.compiled, undefined);
    assert.equal(result.diagnostics[0]?.code, "catalog-reference");
  }
  assert.equal(compileValidationRule(rule, "version", new Set(["eVitals.01"])).compiled, undefined);
  for (const count of ["-1", "1.5", "9007199254740992", '"1"']) {
    for (const fn of ["minimumGroups", "maximumGroups"]) {
      assert.equal(compileValidationRule({ ...rule, source: `require ${fn}("${vitals}", ${count})` }, "version", catalog).compiled, undefined);
    }
  }
  assert.deepEqual(findings([], `require minimumGroups("${vitals}", 0)`), []);
});

test("maximum group counts count instances rather than timestamps", () => {
  const source = `require maximumGroups("${vitals}", 1)`;
  assert.deepEqual(findings([], source), []);
  assert.deepEqual(findings([{ id: vitals, instances: [instance("a")] }], source), []);
  assert.equal(findings([{ id: vitals, instances: [instance("a"), instance("b")] }], source).length, 1);
});

test("scoped group counts stay within their root and descendants", () => {
  const groups = [{ id: "report", instances: [instance("report-a"), instance("report-b")] },
    { id: vitals, instances: [instance("vital-a", "report-a")] }];
  const result = findings(groups, `for each("report")\nrequire minimumGroups("${vitals}", 1)`);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.primaryTarget.groupInstanceId, "report-b");
  assert.deepEqual(findings(groups, 'for each("report")\nrequire maximumGroups("report", 1)'), []);
});

test("group finding fingerprints track membership and ignore element values and ordering", () => {
  const source = `require minimumGroups("${vitals}", 3)`;
  const first = [{ id: vitals, instances: [instance("a"), instance("b")] }];
  const fingerprint = findings(first, source)[0]!.inputFingerprint;
  assert.equal(findings([{ id: vitals, instances: [...first[0]!.instances].reverse() }], source)[0]!.inputFingerprint, fingerprint);
  assert.equal(findings([{ id: vitals, instances: [{ ...instance("a"), elements: [{ id: "eVitals.01", values: [
    { kind: "scalar", occurrenceId: "time", value: context.timestamp },
  ] }] }, instance("b")] }], source)[0]!.inputFingerprint, fingerprint);
  assert.notEqual(findings([{ id: vitals, instances: [instance("a")] }], source)[0]!.inputFingerprint, fingerprint);
  assert.notEqual(findings([{ id: vitals, instances: [instance("a"), instance("c")] }], source)[0]!.inputFingerprint, fingerprint);
});

test("empty group traversal remains bounded", () => {
  const result = evaluateValidationBundleSafely(bundle(), document([{ id: vitals,
    instances: Array.from({ length: 20 }, (_, i) => instance(`vital-${i}`)) }]), "review",
  { ...context, limits: { maxTraversalSteps: 10 } });
  assert.equal(result.failures[0]?.code, "resource-limit");
});
