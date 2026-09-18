import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { evaluateValidationBundle } from "@open-triage/contracts";
import { UnauthorizedException } from "@nestjs/common";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";

const organizationId = randomUUID();
const versionId = randomUUID();
const ruleId = randomUUID();
const sourceRule = { id: ruleId, name: "Require incident number", enabled: true, severity: "error",
  executionTargets: ["live", "sign"], primaryTargetElementId: "eResponse.03",
  message: "Incident number is required", source: 'assert present("eResponse.03")' };

function service(manager, capabilityCalls = []) {
  return new ValidationAuthoringService({ manager, query: (...args) => manager.query(...args),
    transaction: async (_isolation, work) => work(manager) }, {
    requireCapability: async (_token, capability) => {
      capabilityCalls.push(capability);
      return { organization: { id: organizationId }, user: { id: randomUUID() } };
    }
  });
}

test("new drafts persist documented minimum and maximum as separate rules without changing Catalog bounds", async () => {
  let persistedRules;
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from validation.version where organization_id") && !sql.includes("insert")) return [];
    if (sql.includes("select distinct cr.id")) return [{ id: "51000000-0000-4000-8000-000000000099" }];
    if (sql.includes("select e.element_id,e.name,e.min_occurs")) return [{ element_id: "eVitals.06", name: "Systolic Blood Pressure",
      min_occurs: 1, max_occurs: 2, group_id: "eVitals.VitalGroup", group_repeating: true }];
    if (sql.includes("insert into validation.rule_identity")) return [];
    if (sql.includes("insert into validation.version")) {
      persistedRules = JSON.parse(parameters[5]);
      return [{ id: parameters[0], organization_id: organizationId, catalog_release_id: parameters[2], rule_id: parameters[3],
        revision: 1, display_name: parameters[4], source_rule: persistedRules, status: "draft", version: null,
        compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const created = await service(manager).create("session", {
    catalogReleaseId: "51000000-0000-4000-8000-000000000099", displayName: "Vitals policies",
  });
  assert.equal(created.rules.length, 2);
  assert.deepEqual(persistedRules.map(({ source }) => source), [
    'for each("eVitals.VitalGroup")\nrequire minimum("eVitals.06", 1)',
    'for each("eVitals.VitalGroup")\nrequire maximum("eVitals.06", 2)',
  ]);
  assert.notEqual(created.rules[0].id, created.rules[1].id);
});

test("validation uses read authority and compiles a catalog-bound draft", async () => {
  const capabilities = [];
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 2, display_name: "Agency checks",
      source_rule: sourceRule, status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03" }];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager, capabilities).validate("session", versionId);
  assert.equal(result.valid, true);
  assert.equal(result.compiledBundle.rules[0].assertion.elementId, "eResponse.03");
  assert.match(result.compiledSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(capabilities, ["validation:read"]);
});

test("validation reports a structured diagnostic for a reference outside the bound catalog", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 1, display_name: "Agency checks",
      source_rule: sourceRule, status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "catalog-reference");
});

test("server validation compiles and evaluates the same nested conditional semantics used by the browser", async () => {
  const nestedRule = { ...sourceRule, source: `when all(
    coded("eSituation.13", "SNOMED-CT", "267036007"),
    not(equals("eVitals.06", 0))
  )
  require any(present("eResponse.03"), equals("eVitals.06", 200))` };
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 2, display_name: "Conditional checks",
      source_rule: nestedRule, status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [
      { element_id: "eResponse.03", name: "Incident Number", base_datatype: "string" },
      { element_id: "eSituation.13", name: "Primary Symptom", base_datatype: "string" },
      { element_id: "eVitals.06", name: "Systolic Blood Pressure", base_datatype: "integer" },
    ];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("from catalog.element_option")) return [
      { element_id: "eSituation.13", code: "267036007", code_system: "SNOMED-CT", label: "Dyspnea", enabled: true },
    ];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, true);
  assert.match(result.explanation, /Applies when/);
  const document = { groups: [{ instances: [{ instanceId: "encounter", elements: [
    { id: "eSituation.13", values: [{ kind: "coded", occurrenceId: "symptom", code: "267036007", system: "SNOMED-CT" }] },
    { id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "bp", value: 120 }] },
  ] }] }] };
  assert.equal(evaluateValidationBundle(result.compiledBundle, document, "sign").length, 1);
  document.groups[0].instances[0].elements[1].values[0].value = 200;
  assert.equal(evaluateValidationBundle(result.compiledBundle, document, "sign").length, 0);
});

test("server compiles independently persisted minimum and maximum policies for a repeating group", async () => {
  const rules = [
    { ...sourceRule, name: "Phone minimum", source: 'for each("ePatient.PatientGroup")\nrequire minimum("ePatient.18", 0)', enabled: false,
      primaryTargetElementId: "ePatient.18" },
    { ...sourceRule, id: randomUUID(), name: "Phone maximum", source: 'for each("ePatient.PatientGroup")\nrequire maximum("ePatient.18", 2)',
      primaryTargetElementId: "ePatient.18" },
  ];
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 2, display_name: "Occurrence policies",
      source_rule: rules, status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "ePatient.18", name: "Phone", base_datatype: "string",
      group_path: ["ePatient.PatientGroup"], min_occurs: 1, max_occurs: 2 }];
    if (sql.includes("from catalog.group_definition")) return [{ group_id: "ePatient.PatientGroup", name: "Patient", repeating: true,
      parent_group_id: null, min_occurs: 1, max_occurs: 1 }];
    if (sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, true);
  assert.equal(result.compiledBundle.rules.length, 2);
  assert.equal(result.compiledBundle.rules[0].enabled, false);
  assert.equal(result.compiledBundle.rules[1].assertion.operator, "maximum-occurrences");
  assert.equal(result.compiledBundle.rules[1].scope.groupId, "ePatient.PatientGroup");
});

test("every Validation endpoint independently authorizes before reading or mutating data", async () => {
  const attempts = [
    { name: "current", required: "validation:read", invoke: (subject) => subject.current("session") },
    { name: "validate", required: "validation:read", invoke: (subject) => subject.validate("session", versionId) },
    { name: "create", required: "validation:write", invoke: (subject) => subject.create("session", {}) },
    { name: "save", required: "validation:write", invoke: (subject) => subject.save("session", versionId, {}) },
    { name: "publish", required: "validation:publish", invoke: (subject) => subject.publish("session", versionId, {}) },
    { name: "activate", required: "validation:publish", invoke: (subject) => subject.activate("session", versionId, {}) },
  ];
  for (const attempt of attempts) {
    let queried = false;
    const requested = [];
    const manager = { query: async () => { queried = true; return []; } };
    const subject = new ValidationAuthoringService({ manager, query: (...args) => manager.query(...args) }, {
      requireCapability: async (_token, capability) => {
        requested.push(capability);
        throw new UnauthorizedException("The requested capability is required");
      }
    });
    await assert.rejects(attempt.invoke(subject), UnauthorizedException, attempt.name);
    assert.deepEqual(requested, [attempt.required], attempt.name);
    assert.equal(queried, false, `${attempt.name} queried before authorization`);
  }
});
