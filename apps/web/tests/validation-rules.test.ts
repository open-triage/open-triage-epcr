import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, encounterValueFacets, evaluateValidationBundle,
  evaluateValidationBundleSafely, explainValidationRule, formatValidationSource, validationRuleText,
  type CompiledValidationBundle, type EncounterDocument, type ValidationCatalog,
  type ValidationRuleSource } from "@open-triage/contracts";
import syntheticEncounter from "../app/data/synthetic-encounter-document.json";

const versionId = "51000000-0000-4000-8000-000000000001";
const evaluation = { timestamp: "2026-01-01T00:00:00.000Z" };
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
  const live = evaluateValidationBundle(bundle, missing as unknown as EncounterDocument, "live", evaluation);
  const sign = evaluateValidationBundle(bundle, missing as unknown as EncounterDocument, "sign", evaluation);
  assert.equal(live.length, 1);
  assert.equal(sign.length, 1);
  assert.equal(live[0]?.primaryTarget.elementId, "eResponse.03");
  assert.equal(live[0]?.ruleId, rule.id);
  assert.equal(live[0]?.inputFingerprint, sign[0]?.inputFingerprint);
  assert.deepEqual(evaluateValidationBundle(bundle, syntheticEncounter as EncounterDocument, "sign", evaluation), []);
});

test("patient care report validation ignores demographic targets and dependencies", () => {
  const catalog = new Set(["dAgency.01", "dAgency.02", "eResponse.01", "eResponse.03"]);
  const sources: ValidationRuleSource[] = [
    { ...rule, id: "demographic-target", primaryTargetElementId: "dAgency.01",
      source: 'require minimum("dAgency.01", 1)' },
    { ...rule, id: "demographic-reference", primaryTargetElementId: "eResponse.01",
      source: 'require compare("eResponse.01", "equal", "dAgency.02")' },
    { ...rule, id: "report-target" },
  ];
  const compiled = sources.map((source) => compileValidationRule(source, versionId, catalog).compiled!);
  assert.ok(compiled.every(Boolean));
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: compiled };
  const document = structuredClone(syntheticEncounter) as unknown as {
    groups: Array<{ instances: Array<{ elements: Array<{ id: string; values: unknown[] }> }> }>;
  };
  for (const group of document.groups) for (const instance of group.instances) {
    instance.elements = instance.elements.filter(({ id }) => id !== "eResponse.03");
  }
  for (const target of ["live", "sign"] as const) {
    const result = evaluateValidationBundleSafely(bundle, document as unknown as EncounterDocument, target, evaluation);
    assert.deepEqual(result.findings.map(({ ruleId }) => ruleId), ["report-target"]);
    assert.deepEqual(result.failures, []);
  }
});

test("an evaluation-time warning keeps its acknowledgement fingerprint as the clock advances", () => {
  const timed = compileValidationRule({ ...rule, severity: "warning", primaryTargetElementId: "eTimes.03",
    source: 'require timeCompare("eTimes.03", "same-or-before", "evaluation-time")' },
  versionId, { elements: [{ elementId: "eTimes.03", label: "Dispatch time", baseDatatype: "dateTime" }], codes: [] });
  assert.deepEqual(timed.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [timed.compiled!] };
  const future = structuredClone(syntheticEncounter) as EncounterDocument;
  const element = future.groups.flatMap((group) => group.instances).flatMap((instance) => instance.elements)
    .find(({ id }) => id === "eTimes.03");
  assert.ok(element);
  (element as unknown as { values: unknown[] }).values = [{ kind: "scalar", occurrenceId: "future-time", value: "2030-01-01T00:00:00Z" }];
  const first = evaluateValidationBundle(bundle, future, "live", { timestamp: "2026-01-01T00:00:00Z" });
  const later = evaluateValidationBundle(bundle, future, "sign", { timestamp: "2026-01-02T00:00:00Z" });
  assert.equal(first.length, 1);
  assert.equal(first[0]?.inputFingerprint, later[0]?.inputFingerprint);
});

test("legacy imported scene rule does not warn until Mass Casualty Incident is Yes", () => {
  const old = compileValidationRule({ ...rule, id: "scene-rule", severity: "warning", primaryTargetElementId: "eScene.06",
    message: 'should be "Multiple" when is "Yes".',
    source: 'require any(compareValue("eScene.06", "equal", "2707001"), compareValue("eScene.07", "not-equal", "9923003"))',
  }, versionId, new Set(["eScene.06", "eScene.07"]));
  assert.deepEqual(old.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [old.compiled!] };
  const document = structuredClone(syntheticEncounter) as EncounterDocument;
  const scene = document.groups.find(({ id }) => id === "eSceneSection");
  assert.ok(scene);
  const instance = scene.instances[0];
  assert.ok(instance);
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), []);
  (instance.elements as Array<unknown>).push({ id: "eScene.07", values: [{ kind: "coded", occurrenceId: "mci",
    code: "9923003" }] });
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), [],
    "a Schematron element-context rule does not run before its target is documented");
  (instance.elements as Array<unknown>).push({ id: "eScene.06", values: [{ kind: "coded", occurrenceId: "count",
    code: "2707002" }] });
  const warning = evaluateValidationBundle(bundle, document, "live", evaluation);
  assert.equal(warning.length, 1);
  assert.equal(warning[0]?.message,
    'Number of Patients at Scene should be "Multiple" when Mass Casualty Incident is "Yes".');
  const count = instance.elements.find(({ id }) => id === "eScene.06");
  assert.ok(count);
  (count.values as unknown as Array<{ code: string }>)[0]!.code = "2707001";
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), []);
});

test("legacy imported rules outside Sweden retain their Schematron element context", () => {
  const old = compileValidationRule({ ...rule, id: "legacy-response-rule", severity: "warning",
    primaryTargetElementId: "eResponse.01",
    message: "in the patient care report should match in the agency demographic information.",
    source: 'require compare("eResponse.01", "equal", "dAgency.02")',
  }, versionId, new Set(["eResponse.01", "dAgency.02"]));
  assert.deepEqual(old.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [old.compiled!] };
  const document = structuredClone(syntheticEncounter) as EncounterDocument;
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), []);
  const response = document.groups.find(({ id }) => id === "eResponseSection")?.instances[0];
  assert.ok(response);
  (response.elements as Array<unknown>).push({ id: "eResponse.01", values: [{ kind: "scalar",
    occurrenceId: "agency", value: "agency-a" }] });
  const findings = evaluateValidationBundle(bundle, document, "live", evaluation);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.message,
    "EMS Agency Number in the patient care report should match EMS Agency Number in the agency demographic information.");
});

test("not-equal comparisons treat undocumented values as not matching the named code", () => {
  const compiled = compileValidationRule({ ...rule, id: "conditional-not-equal", primaryTargetElementId: "eScene.07",
    source: 'require compareValue("eScene.07", "not-equal", "9923003")',
  }, versionId, new Set(["eScene.07"]));
  assert.deepEqual(compiled.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [compiled.compiled!] };
  const document = structuredClone(syntheticEncounter) as EncounterDocument;
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), []);
  const scene = document.groups.find(({ id }) => id === "eSceneSection")!.instances[0]!;
  (scene.elements as Array<unknown>).push({ id: "eScene.07", values: [{ kind: "coded", occurrenceId: "mci",
    code: "9923003" }] });
  assert.equal(evaluateValidationBundle(bundle, document, "live", evaluation).length, 1);
});

const conditionalCatalog: ValidationCatalog = { elements: [
  { elementId: "eSituation.13", label: "Primary Symptom", baseDatatype: "string" },
  { elementId: "eResponse.03", label: "Incident Number", baseDatatype: "string" },
  { elementId: "eVitals.06", label: "Systolic Blood Pressure", baseDatatype: "integer" },
], codes: [{ elementId: "eSituation.13", codeSystem: "SNOMED-CT", code: "267036007", label: "Dyspnea" }] };

const conditionalRule: ValidationRuleSource = { ...rule,
  source: `when all(
    coded("eSituation.13", "SNOMED-CT", "267036007"),
    not(equals("eVitals.06", 0))
  )
  require any(
    present("eResponse.03"),
    all(equals("eVitals.06", 200), not(equals("eVitals.06", 0)))
  )`,
};

test("optional applicability and arbitrarily nested Boolean requirements compile, format, and explain with labels", () => {
  const compiled = compileValidationRule(conditionalRule, versionId, conditionalCatalog);
  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(compiled.compiled?.applicability?.operator, "all");
  assert.equal(compiled.compiled?.assertion.operator, "any");
  assert.deepEqual(compiled.compiled?.references.elementIds, ["eResponse.03", "eSituation.13", "eVitals.06"]);
  const formatted = formatValidationSource(conditionalRule.source);
  assert.match(formatted.formatted ?? "", /^when all\(/);
  assert.match(formatted.formatted ?? "", /\nrequire any\(/);
  const explanation = explainValidationRule(compiled.compiled!, conditionalCatalog);
  assert.match(explanation, /Finding target: Incident Number \(eResponse\.03\)/);
  assert.match(explanation, /Applies when/);
  assert.match(explanation, /Requires/);
  assert.match(explanation, /Dyspnea \(SNOMED-CT\|267036007\)/);
});

test("a blank applicability condition is always applicable and nested outcomes are deterministic", () => {
  const blank = compileValidationRule({ ...rule, source: 'when\nrequire present("eResponse.03")' }, versionId, conditionalCatalog).compiled!;
  assert.equal(blank.applicability, undefined);
  const conditional = compileValidationRule(conditionalRule, versionId, conditionalCatalog).compiled!;
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [conditional] };
  const applicable = structuredClone(syntheticEncounter) as unknown as { groups: Array<{ instances: Array<{
    elements: Array<{ id: string; values: Array<Record<string, unknown>> }> }> }> };
  (applicable.groups[0]!.instances[0]!.elements as Array<unknown>).push(
    { id: "eSituation.13", values: [{ kind: "coded", occurrenceId: "symptom", code: "267036007", system: "SNOMED-CT" }] },
    { id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "bp", value: 120 }] },
  );
  for (const group of applicable.groups) for (const instance of group.instances) {
    instance.elements.splice(0, instance.elements.length,
      ...instance.elements.filter(({ id }) => id !== "eResponse.03"));
  }
  assert.equal(evaluateValidationBundle(bundle, applicable as unknown as EncounterDocument, "live", evaluation).length, 1,
    "the applicable nested requirement produces a finding");
  for (const group of applicable.groups) for (const instance of group.instances) {
    const bloodPressure = instance.elements.find(({ id }) => id === "eVitals.06");
    if (bloodPressure) bloodPressure.values[0]!.value = 200;
  }
  assert.equal(evaluateValidationBundle(bundle, applicable as unknown as EncounterDocument, "live", evaluation).length, 0,
    "the nested alternate requirement clears the finding");
  for (const group of applicable.groups) for (const instance of group.instances) {
    const bloodPressure = instance.elements.find(({ id }) => id === "eVitals.06");
    if (bloodPressure) bloodPressure.values[0]!.value = 0;
  }
  assert.equal(evaluateValidationBundle(bundle, applicable as unknown as EncounterDocument, "live", evaluation).length, 0,
    "the false applicability condition suppresses the requirement");
});

test("syntax, unknown references, unknown codes, and datatype mismatches are diagnosed before publication", () => {
  assert.equal(compileValidationRule({ ...rule, source: 'require any(present("eResponse.03"))' }, versionId,
    conditionalCatalog).diagnostics[0]?.code, "syntax");
  assert.equal(compileValidationRule({ ...rule, source: 'require present("missing")' }, versionId,
    conditionalCatalog).diagnostics[0]?.code, "catalog-reference");
  assert.equal(compileValidationRule({ ...rule, source: 'require coded("eSituation.13", "SNOMED-CT", "unknown")' },
    versionId, conditionalCatalog).diagnostics[0]?.code, "catalog-reference");
  assert.equal(compileValidationRule({ ...rule, source: 'require equals("eVitals.06", "120")' }, versionId,
    conditionalCatalog).diagnostics[0]?.code, "datatype");
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

test("a named repeating-group scope evaluates and targets every failing row independently", () => {
  const catalog: ValidationCatalog = { elements: [
    { elementId: "eVitals.06", label: "Systolic Blood Pressure", baseDatatype: "integer",
      groupPath: ["eVitals.VitalGroup"], intrinsicOccurrence: { min: 0, max: 1 } },
    { elementId: "eVitals.07", label: "Diastolic Blood Pressure", baseDatatype: "integer",
      groupPath: ["eVitals.VitalGroup"], intrinsicOccurrence: { min: 0, max: 1 } },
  ], groups: [{ groupId: "eVitals.VitalGroup", label: "Vital", repeating: true,
    intrinsicOccurrence: { min: 0, max: "unbounded" } }] };
  const scoped = compileValidationRule({ ...rule, primaryTargetElementId: "eVitals.07",
    source: 'for each("eVitals.VitalGroup")\nwhen present("eVitals.06")\nrequire present("eVitals.07")' }, versionId, catalog).compiled!;
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [scoped] };
  const document = { groups: [{ id: "eVitals.VitalGroup", instances: [
    { instanceId: "vital-ok", elements: [
      { id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "systolic-ok", value: 120 }] },
      { id: "eVitals.07", values: [{ kind: "scalar", occurrenceId: "diastolic-ok", value: 80 }] },
    ] },
    { instanceId: "vital-failing-1", elements: [
      { id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "systolic-1", value: 110 }] },
      { id: "eVitals.07", values: [] },
    ] },
    { instanceId: "vital-failing-2", elements: [
      { id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "systolic-2", value: 100 }] },
    ] },
  ] }] } as unknown as EncounterDocument;
  const findings = evaluateValidationBundle(bundle, document, "live", evaluation);
  assert.deepEqual(findings.map(({ primaryTarget }) => primaryTarget), [
    { elementId: "eVitals.07", groupInstanceId: "vital-failing-1" },
    { elementId: "eVitals.07", groupInstanceId: "vital-failing-2" },
  ]);
  assert.notEqual(findings[0]!.inputFingerprint, findings[1]!.inputFingerprint);
});

test("minimum and maximum documented occurrence policies compile as independent editable rules within intrinsic bounds", () => {
  const catalog: ValidationCatalog = { elements: [{ elementId: "ePatient.18", label: "Phone", baseDatatype: "string",
    groupPath: ["ePatient.PatientGroup"], intrinsicOccurrence: { min: 1, max: 2 } }],
    groups: [{ groupId: "ePatient.PatientGroup", label: "Patient", repeating: true,
      intrinsicOccurrence: { min: 1, max: 1 } }] };
  const minimum = compileValidationRule({ ...rule, enabled: false, primaryTargetElementId: "ePatient.18",
    source: 'for each("ePatient.PatientGroup")\nrequire minimum("ePatient.18", 0)' }, versionId, catalog);
  const maximum = compileValidationRule({ ...rule, id: "52000000-0000-4000-8000-000000000002",
    primaryTargetElementId: "ePatient.18", source: 'for each("ePatient.PatientGroup")\nrequire maximum("ePatient.18", 3)' }, versionId, catalog);
  assert.equal(minimum.compiled?.enabled, false, "a documented minimum can be disabled or relaxed independently");
  assert.equal(minimum.compiled?.assertion.operator, "minimum-occurrences");
  assert.equal(maximum.compiled?.assertion.operator, "maximum-occurrences");
  assert.equal(maximum.diagnostics[0]?.code, "occurrence-bound",
    "a policy cannot broaden the visible intrinsic Catalog maximum");
});

test("bounded domain constructs cover collection, membership, regex, cross-element, absence, time, and occurrence order", () => {
  const catalog: ValidationCatalog = { elements: [
    { elementId: "eA", label: "A", baseDatatype: "string" },
    { elementId: "eB", label: "B", baseDatatype: "string" },
    { elementId: "eLow", label: "Low", baseDatatype: "integer" },
    { elementId: "eHigh", label: "High", baseDatatype: "integer" },
    { elementId: "eTime", label: "Time", baseDatatype: "dateTime" },
    { elementId: "eMissing", label: "Missing", baseDatatype: "string" },
  ] };
  const source = `require all(
    anyValue("eA", member, "EMS", "PCR"),
    allValues("eA", matches, "^[A-Z]{3}$"),
    member("eA", "EMS"),
    compare("eLow", "less-than", "eHigh"),
    hasNotValue("eB", "7701003"),
    hasPertinentNegative("eB", "8801019"),
    timeCompare("eTime", "before", "evaluation-time", 60),
    undocumented("eMissing"),
    occurs("eA", "adjacent", "eB")
  )`;
  const compiled = compileValidationRule({ ...rule, primaryTargetElementId: "eA", source }, versionId, catalog);
  assert.deepEqual(compiled.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
    catalogReleaseId: "catalog", rules: [compiled.compiled!] };
  const document = { groups: [{ id: "root", instances: [{ instanceId: "row", elements: [
    { id: "eA", values: [{ kind: "scalar", occurrenceId: "a", value: "EMS" }] },
    { id: "eB", values: [{ kind: "scalar", occurrenceId: "b", value: "ok",
      notValue: { code: "7701003" }, pertinentNegative: { code: "8801019" } }] },
    { id: "eLow", values: [{ kind: "scalar", occurrenceId: "low", value: 1 }] },
    { id: "eHigh", values: [{ kind: "scalar", occurrenceId: "high", value: 2 }] },
    { id: "eTime", values: [{ kind: "scalar", occurrenceId: "time", value: "2025-12-31T23:59:30Z" }] },
  ] }] }] } as unknown as EncounterDocument;
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", evaluation), []);
  const formatted = formatValidationSource(source).formatted ?? "";
  assert.match(formatted, /timeCompare\("eTime"/);
  assert.deepEqual(formatValidationSource(formatted).diagnostics, [], "canonical source round-trips");
  assert.match(explainValidationRule(compiled.compiled!, catalog), /evaluation time/);

  const failing = structuredClone(document) as unknown as { groups: Array<{ instances: Array<{ elements: Array<{
    id: string; values: Array<{ value?: unknown }> }> }> }> };
  failing.groups[0]!.instances[0]!.elements.find(({ id }) => id === "eHigh")!.values[0]!.value = 0;
  const browser = evaluateValidationBundle(bundle, failing as unknown as EncounterDocument, "live", evaluation)[0]!;
  const server = evaluateValidationBundle({ ...bundle, rules: bundle.rules.map((item) => ({ ...item,
    executionTargets: [...item.executionTargets, "sign"] })) }, failing as unknown as EncounterDocument, "sign", evaluation)[0]!;
  assert.equal(browser.inputFingerprint, server.inputFingerprint);
  assert.equal(browser.message, server.message);
});

test("evaluation clock, expression and traversal limits, safe regex, and compatibility failures are explicit", () => {
  const catalog: ValidationCatalog = { elements: [{ elementId: "eA", label: "A", baseDatatype: "string" }] };
  assert.equal(compileValidationRule({ ...rule, primaryTargetElementId: "eA",
    source: 'require matches("eA", "(a+)+$")' }, versionId, catalog).diagnostics[0]?.code, "compatibility");
  assert.equal(compileValidationRule({ ...rule, primaryTargetElementId: "eA",
    source: 'require xpath("//eA")' }, versionId, catalog).diagnostics[0]?.code, "compatibility");
  for (const unsupported of ["fetch", "databaseQuery", "userFunction", "recurse"]) assert.equal(
    compileValidationRule({ ...rule, primaryTargetElementId: "eA",
      source: `require ${unsupported}("eA")` }, versionId, catalog).diagnostics[0]?.code, "compatibility");
  assert.equal(compileValidationRule({ ...rule, primaryTargetElementId: "eA",
    source: `require matches("eA", "${"a".repeat(300)}")` }, versionId, catalog).diagnostics[0]?.code, "resource-limit");
  assert.equal(compileValidationRule({ ...rule, primaryTargetElementId: "eA",
    source: `require ${"not(".repeat(34)}present("eA")${")".repeat(34)}` }, versionId, catalog).diagnostics[0]?.code, "resource-limit");

  const compiled = compileValidationRule({ ...rule, primaryTargetElementId: "eA",
    source: 'require matches("eA", "^\\d+$")' }, versionId, catalog).compiled!;
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
    catalogReleaseId: "catalog", rules: [compiled] };
  const document = { groups: [{ id: "root", instances: [{ instanceId: "row", elements: [
    { id: "eA", values: [{ kind: "scalar", occurrenceId: "a", value: "123" }] },
  ] }] }] } as unknown as EncounterDocument;
  assert.throws(() => evaluateValidationBundle(bundle, document, "live", { timestamp: "not-a-time" }), /timestamp/);
  assert.throws(() => evaluateValidationBundle(bundle, document, "live", { ...evaluation, limits: { maxTraversalSteps: 1 } }), /traversal/);
  const excessiveValue = structuredClone(document) as unknown as { groups: Array<{ instances: Array<{ elements: Array<{
    values: Array<{ kind: string; occurrenceId: string; value: string }> }> }> }> };
  excessiveValue.groups[0]!.instances[0]!.elements[0]!.values.push({ kind: "scalar", occurrenceId: "b", value: "456" });
  assert.throws(() => evaluateValidationBundle(bundle, excessiveValue as unknown as EncounterDocument, "live",
    { ...evaluation, limits: { maxValues: 1 } }), /value collection/);
  assert.throws(() => evaluateValidationBundle({ ...bundle, languageVersion: "2.0.0" as "1.0.0" }, document, "live", evaluation),
    /Unsupported validation bundle/);
  const future = structuredClone(bundle);
  future.rules[0]!.assertion = { operator: "future-construct" } as never;
  assert.throws(() => evaluateValidationBundle(future, document, "live", evaluation), /Unsupported compiled validation operator/);
  const safe = evaluateValidationBundleSafely(future, document, "live", evaluation);
  assert.deepEqual(safe.findings, []);
  assert.deepEqual(safe.failures.map(({ ruleId, code }) => ({ ruleId, code })), [{ ruleId: rule.id, code: "compatibility" }]);
  assert.equal(compiledValidationBundleSha256(bundle), compiledValidationBundleSha256(structuredClone(bundle)));
  assert.notEqual(compiledValidationBundleSha256(bundle), compiledValidationBundleSha256({ ...bundle, rules: [] }));
});


test("localized wording changes findings without changing outcomes, version, or acknowledgement identity", () => {
  const translated: ValidationRuleSource = { ...rule, executionTargets: ["live", "sign", "review"],
    message: "Document {item}", messageParameters: { item: "incident number" },
    localization: { schemaVersion: 1, sv: { name: "Dokumentera händelsenummer",
      message: "Dokumentera {item}", reviewedSource: { name: rule.name, message: "Document {item}" } } } };
  const compiled = compileValidationRule(translated, versionId, new Set(["eResponse.03"])).compiled!;
  assert.ok(compiled);
  assert.equal(validationRuleText(compiled, "sv", "name"), "Dokumentera händelsenummer");
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: versionId, catalogReleaseId: "catalog", rules: [compiled] };
  const missing = structuredClone(syntheticEncounter) as unknown as {
    groups: Array<{ instances: Array<{ elements: Array<{ id: string; values: unknown[] }> }> }>;
  };
  for (const group of missing.groups) for (const instance of group.instances)
    instance.elements = instance.elements.filter(({ id }) => id !== "eResponse.03");
  for (const target of ["live", "sign", "review"] as const) {
    const en = evaluateValidationBundleSafely(bundle, missing as unknown as EncounterDocument, target, { ...evaluation, language: "en" });
    const sv = evaluateValidationBundleSafely(bundle, missing as unknown as EncounterDocument, target, { ...evaluation, language: "sv" });
    assert.equal(en.findings[0]?.message, "Document incident number");
    assert.equal(sv.findings[0]?.message, "Dokumentera incident number");
    assert.deepEqual({ ...en.findings[0], message: undefined }, { ...sv.findings[0], message: undefined });
  }
  assert.equal(compileValidationRule({ ...translated, messageParameters: {} }, versionId,
    new Set(["eResponse.03"])).diagnostics.find(({ code }) => code === "message-parameters")?.severity, "error");
  assert.equal(compileValidationRule({ ...translated, localization: { schemaVersion: 1 } }, versionId,
    new Set(["eResponse.03"])).diagnostics.find(({ code }) => code === "wording")?.severity, "warning");
  const older = compileValidationRule(rule, versionId, new Set(["eResponse.03"])).compiled!;
  assert.equal(validationRuleText(older, "sv", "message"), rule.message);
  assert.notEqual(compiledValidationBundleSha256(bundle), compiledValidationBundleSha256({ ...bundle, rules: [older] }));
});
