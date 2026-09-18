import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  NEMSIS_351_EMS_BUILD,
  NEMSIS_351_EMS_NORMALIZATIONS,
  NEMSIS_351_EMS_RELEASE,
  NEMSIS_351_EMS_SOURCE_SHA256,
  NemsisSchematronCompatibilityError,
  compareNemsisFixtureParity,
  compileValidationRule,
  evaluateValidationBundle,
  importNemsisEmsSchematron,
  type CompiledValidationBundle,
  type EncounterDocument,
  type NemsisFixtureOutcome,
} from "@open-triage/contracts";

const source = readFileSync(resolve(process.cwd(), "../../packages/contracts/fixtures/nemsis-3.5.1/EMSDataSet.sch.xml"), "utf8");
const officialFixtures = JSON.parse(readFileSync(resolve(process.cwd(),
  "../../packages/contracts/fixtures/nemsis-3.5.1/ems-fixture-outcomes.json"), "utf8")) as NemsisFixtureOutcome[];
const fixtureEncounters = JSON.parse(readFileSync(resolve(process.cwd(),
  "../../packages/contracts/fixtures/nemsis-3.5.1/ems-fixture-encounters.json"), "utf8")) as {
    base: Record<string, FixtureGroup>; deltas: Record<string, Record<string, FixtureGroup | null>>;
  };
type FixtureGroup = { key: string; groupId: string; instanceId: string; parentInstanceId?: string; elements: Record<string, unknown[]> };

test("the pinned official EMS corpus is completely accounted for with immutable provenance", () => {
  const imported = importNemsisEmsSchematron(source, NEMSIS_351_EMS_NORMALIZATIONS,
    { release: NEMSIS_351_EMS_RELEASE, build: NEMSIS_351_EMS_BUILD, sha256: NEMSIS_351_EMS_SOURCE_SHA256 });
  assert.equal(imported.assertions.length, 188);
  assert.equal(imported.rules.flatMap(({ provenance }) => provenance).length, 188);
  assert.deepEqual(imported.controls, { namespaces: 2, globalVariables: 4, patterns: 14, contextRules: 129,
    localVariables: 129, nonFindingReports: 6, diagnostics: 1, properties: 1, xsltInstructions: 28 });
  assert.equal(imported.compatibility.compatible, true);
  const example = imported.rules.flatMap(({ provenance }) => provenance).find(({ sourceIdentity }) => sourceIdentity === "nemSch_e162")!;
  assert.equal(example.sourceRelease, "3.5.1");
  assert.equal(example.sourceBuild, "3.5.1.251001CP2");
  assert.equal(example.sourceSha256, NEMSIS_351_EMS_SOURCE_SHA256);
  assert.match(example.originalExpression, /starts-with/);
  assert.match(example.originalMessage, /sch:value-of/);
  assert.match(example.targetExpression, /eDisposition\.06|\./);
});

test("every official fixture firing identity resolves to imported provenance and parity mismatches are exact", () => {
  const imported = importNemsisEmsSchematron(source, NEMSIS_351_EMS_NORMALIZATIONS);
  const identities = new Set(imported.rules.flatMap(({ provenance }) => provenance.map(({ sourceIdentity }) => sourceIdentity)));
  for (const fixture of officialFixtures) for (const identity of fixture.firingSourceIdentities) assert.ok(identities.has(identity), `${fixture.fixture}: ${identity}`);
  assert.deepEqual(compareNemsisFixtureParity(officialFixtures, structuredClone(officialFixtures)), []);
  const changed = structuredClone(officialFixtures);
  changed[1]!.firingSourceIdentities = [];
  assert.deepEqual(compareNemsisFixtureParity(officialFixtures, changed)[0],
    { fixture: "EMSDataSet-nemSch_e001_A", expected: ["nemSch_e001"], actual: [] });
});

test("the shared runtime fires the exact official identity set for every pinned EMS fixture", () => {
  const imported = importNemsisEmsSchematron(source, NEMSIS_351_EMS_NORMALIZATIONS);
  const catalogIds = new Set(Object.values(fixtureEncounters.base).flatMap(({ elements }) => Object.keys(elements)));
  for (const delta of Object.values(fixtureEncounters.deltas)) for (const group of Object.values(delta)) {
    if (group) for (const id of Object.keys(group.elements)) catalogIds.add(id);
  }
  const compiled = imported.rules.map((rule) => {
    const result = compileValidationRule(rule, "nemsis-3.5.1", catalogIds);
    assert.deepEqual(result.diagnostics, [], `${rule.id}: ${JSON.stringify(result.diagnostics)}`);
    return result.compiled!;
  });
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "nemsis-3.5.1", catalogReleaseId: "nemsis-3.5.1", rules: compiled };
  const observed: NemsisFixtureOutcome[] = officialFixtures.map(({ fixture }) => {
    const values = structuredClone(fixtureEncounters.base);
    for (const [id, replacement] of Object.entries(fixtureEncounters.deltas[fixture] ?? {})) {
      if (replacement === null) delete values[id]; else values[id] = replacement;
    }
    const byGroup = Map.groupBy(Object.values(values), ({ groupId }) => groupId);
    const document = { $schema: "./encounter-document.schema-1.0.0.json", documentType: "open-triage.encounter",
      modelVersion: "1.1.0", reportId: fixture, catalog: {}, form: {}, extensions: {}, groups: [...byGroup].map(([id, instances]) => ({ id,
        instances: instances.map((instance) => ({ instanceId: instance.instanceId, ...(instance.parentInstanceId ? { parentInstanceId: instance.parentInstanceId } : {}),
          elements: Object.entries(instance.elements).map(([elementId, elementValues]) => ({ id: elementId, values: elementValues })) })) })) } as unknown as EncounterDocument;
    return { fixture, firingSourceIdentities: [...new Set(evaluateValidationBundle(bundle, document, "live",
      { timestamp: "2026-01-01T00:00:00Z", limits: { maxTraversalSteps: 100_000, maxValues: 50_000 } }).map(({ ruleId }) => ruleId))].sort() };
  });
  assert.deepEqual(compareNemsisFixtureParity(officialFixtures, observed), []);
});

test("missing normalizations and finding-producing reports fail with compatibility reports", () => {
  assert.throws(() => importNemsisEmsSchematron(source, {}), (error) => error instanceof NemsisSchematronCompatibilityError
    && error.report.problems.some(({ code, sourceIdentity }) => code === "normalization" && sourceIdentity === "nemSch_e001"));
  const incompatible = source.replace('<sch:report role="[WARNING]" diagnostics="nemsisDiagnostic" test="false()">',
    '<sch:report role="[WARNING]" diagnostics="nemsisDiagnostic" test="true()">');
  assert.throws(() => importNemsisEmsSchematron(incompatible, NEMSIS_351_EMS_NORMALIZATIONS),
    (error) => error instanceof NemsisSchematronCompatibilityError
      && error.report.problems.some(({ code }) => code === "construct"));
});

test("exact duplicate normalized assertions execute once and retain both source links", () => {
  const mini = `<?xml version="1.0"?><sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" id="EMSDataSet" schemaVersion="3.5.1.test">
    <sch:pattern id="p"><sch:rule id="r" context="nem:eResponse.03"><sch:let name="nemsisElements" value="."/>
      <sch:assert id="a" role="[ERROR]" test=". != ''">Document incident</sch:assert>
      <sch:assert id="b" role="[ERROR]" test=". != ''">Document incident</sch:assert>
    </sch:rule></sch:pattern></sch:schema>`;
  const normalized = { source: 'require present("eResponse.03")', primaryTargetElementId: "eResponse.03" };
  const imported = importNemsisEmsSchematron(mini, { a: normalized, b: normalized });
  assert.equal(imported.rules.length, 1);
  assert.deepEqual(imported.rules[0]!.provenance.map(({ sourceIdentity }) => sourceIdentity), ["a", "b"]);
});

test("dynamic targets, sibling prefix, and CodeType semantics are browser/server deterministic", () => {
  const catalog = new Set(["eDisposition.05", "eDisposition.06", "eMedications.03"]);
  const sources = [
    { id: "dynamic", primaryTargetElementId: "*", source: 'require allElements("pn-needs-empty-no-nv")' },
    { id: "prefix", primaryTargetElementId: "eDisposition.06", source: 'require startsWith("eDisposition.06", "eDisposition.05")' },
    { id: "code-type", primaryTargetElementId: "eMedications.03", source: 'require codeType("eMedications.03", "9924003")' },
  ].map((candidate) => compileValidationRule({ ...candidate, name: candidate.id, enabled: true, severity: "error" as const,
    executionTargets: ["live", "sign"], message: candidate.id }, "version", catalog).compiled!);
  assert.ok(sources.every(Boolean));
  const document = { $schema: "./encounter-document.schema-1.0.0.json", documentType: "open-triage.encounter", modelVersion: "1.1.0",
    reportId: "report", catalog: { standard: "NEMSIS", version: "3.5.1", dataset: "EMS" }, form: { id: "form", version: 1 }, extensions: {}, groups: [{ id: "root", instances: [{ instanceId: "row", elements: [
      { id: "eDisposition.05", values: [{ kind: "scalar", occurrenceId: "city", value: "123" }] },
      { id: "eDisposition.06", values: [{ kind: "scalar", occurrenceId: "zip", value: "12345" }] },
      { id: "eMedications.03", values: [{ kind: "coded", occurrenceId: "med", code: "123", system: "9924003",
        pertinentNegative: { code: "8801019" } }] },
    ] }] }] } as unknown as EncounterDocument;
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "version",
    catalogReleaseId: "catalog", rules: sources };
  const context = { timestamp: "2026-01-01T00:00:00Z" };
  const live = evaluateValidationBundle(bundle, document, "live", context);
  const sign = evaluateValidationBundle(bundle, document, "sign", context);
  assert.deepEqual(live, sign.map((finding) => ({ ...finding, executionTarget: "live" })));
  assert.deepEqual(live.map(({ ruleId }) => ruleId), ["dynamic"]);
  assert.equal(live[0]!.primaryTarget.elementId, "eMedications.03");
  assert.equal(live[0]!.primaryTarget.occurrenceId, "med");
});
