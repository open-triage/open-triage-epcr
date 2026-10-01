import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, evaluateValidationBundle } from "@open-triage/contracts";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ValidationAuthoringService, migrateFormExpression } from "../dist/admin/validation-authoring.service.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";

const organizationId = randomUUID();
const versionId = randomUUID();
const ruleId = randomUUID();
const sourceRule = { id: ruleId, name: "Require incident number", enabled: true, severity: "error",
  executionTargets: ["live", "sign"], primaryTargetElementId: "eResponse.03",
  message: "Incident number is required", source: 'assert present("eResponse.03")' };

function service(manager, capabilityCalls = []) {
  const database = { ...manager, query: (sql, ...args) => sql.includes("provenance->'customElementDefinitions'")
    ? [{ definitions: [] }] : manager.query(sql, ...args) };
  return new ValidationAuthoringService({ manager: database, query: (...args) => database.query(...args),
    transaction: async (_isolation, work) => work(database) }, {
    requireCapability: async (_token, capability) => {
      capabilityCalls.push(capability);
      return { organization: { id: organizationId }, user: { id: randomUUID() } };
    }
  });
}

test("validation draft lookup is scoped to its author", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters) => { calls.push({ sql, parameters }); return []; } };
  assert.equal(await service(manager).current("session"), null);
  assert.match(calls[0].sql, /organization_id=\$1 and created_by=\$2 and status='draft'/);
  assert.equal(calls[0].parameters[0], organizationId);
  assert.match(calls[0].parameters[1], /^[0-9a-f-]{36}$/);
});

test("published custom elements are available to validation compilation", async () => {
  const customId = "opentriage.org.Org32000000000040008000000000000001_WorkflowCheckOct01";
  const manager = { query: async (sql) => {
    if (sql.includes("provenance->'customElementDefinitions'")) return [{ definitions: [{
      id: randomUUID(), namespace: "opentriage.org", slug: "Org32000000000040008000000000000001_WorkflowCheckOct01",
      title: "Workflow check", definition: "Test field", datatype: "string", recurrence: "single",
      usage: "Optional", constraints: {}, identifying: false,
    }] }];
    if (sql.includes("from catalog.element_definition")) return [];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("from (")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const catalog = await service(manager).validationCatalog(manager, randomUUID());
  const compiled = compileValidationRule({ ...sourceRule, primaryTargetElementId: customId,
    source: `require present("${customId}")` }, versionId, catalog);
  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(compiled.compiled?.primaryTarget.elementId, customId);
});

test("discard deletes only an organization-scoped draft at its expected revision", async () => {
  const capabilities = [];
  const calls = [];
  const manager = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("select * from validation.version")) return [{ id: versionId, revision: 2, status: "draft" }];
    if (sql.includes("delete from validation.version")) return [{ id: versionId }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await service(manager, capabilities).delete("session", versionId, { expectedRevision: 2 });
  assert.deepEqual(capabilities, ["validation:write"]);
  assert.match(calls.at(-1).sql, /organization_id=\$2 and created_by=\$4 and status='draft' and revision=\$3/);
  assert.deepEqual(calls.at(-1).parameters, [versionId, organizationId, 2, calls[1].parameters[2]]);
  await assert.rejects(service(manager).delete("session", versionId, { expectedRevision: 1 }), ConflictException);
  const missing = { query: async (sql) => sql.includes("pg_advisory_xact_lock") ? [] : [] };
  await assert.rejects(service(missing).delete("session", versionId, { expectedRevision: 2 }), NotFoundException);
});

test("new drafts persist documented minimum and maximum as separate rules without changing Catalog bounds", async () => {
  let persistedRules;
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from validation.version where organization_id") && !sql.includes("insert")) return [];
    if (sql.includes("select distinct cr.id")) return [{ id: "51000000-0000-4000-8000-000000000099" }];
    if (sql.includes("select e.element_id,e.name,e.min_occurs")) return [{ element_id: "eVitals.06", name: "Systolic Blood Pressure",
      min_occurs: 1, max_occurs: 2, group_id: "eVitals.VitalGroup", group_repeating: true }];
    if (sql.includes("select fv.id,fv.canonical_definition")) return [];
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

test("new drafts migrate Catalog and Form requiredness into visible Validation rules", async () => {
  let persistedRules;
  const catalogReleaseId = "51000000-0000-4000-8000-000000000099";
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from validation.version where organization_id") && !sql.includes("insert")) return [];
    if (sql.includes("select distinct cr.id")) return [{ id: catalogReleaseId }];
    if (sql.includes("select e.element_id,e.name,e.min_occurs")) return [
      { element_id: "dAgency.01", name: "EMS Agency Unique State ID", min_occurs: 1, max_occurs: 1,
        group_id: "DemographicGroup", group_repeating: false, agency_required: true, agency_required_severity: "error" },
      { element_id: "ePatient.01", name: "Patient", min_occurs: 0, max_occurs: null,
        group_id: "ePatient.PatientGroup", group_repeating: false, agency_required: true, agency_required_severity: "warning" },
      { element_id: "ePatient.02", name: "Last Name", min_occurs: 0, max_occurs: 1,
        group_id: "ePatient.PatientGroup", group_repeating: false, agency_required: false, agency_required_severity: null },
    ];
    if (sql.includes("select fv.id,fv.canonical_definition")) return [{ id: "form-1", canonical_definition: {
      sections: [{ fields: [
        { key: "agency-id", source: { kind: "nemsis", elementId: "dAgency.01" }, required: true },
        { key: "patient", source: { kind: "nemsis", elementId: "ePatient.01" } },
        { key: "last-name", source: { kind: "nemsis", elementId: "ePatient.02" }, required: true,
          rules: [{ kind: "requiredness", expression: { operator: "exists", field: "patient" } }] },
      ] }],
    } }];
    if (sql.includes("insert into validation.rule_identity")) return [];
    if (sql.includes("insert into validation.version")) {
      persistedRules = JSON.parse(parameters[5]);
      return [{ id: parameters[0], organization_id: organizationId, catalog_release_id: parameters[2], rule_id: parameters[3],
        revision: 1, display_name: parameters[4], source_rule: persistedRules, status: "draft", version: null,
        compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await service(manager).create("session", { catalogReleaseId, displayName: "Migrated policy" });
  assert.deepEqual(persistedRules.map(({ sourceKind }) => sourceKind), ["catalog", "catalog", "form", "form"]);
  assert.equal(persistedRules[0].severity, "warning");
  assert.equal(persistedRules[2].source, 'require minimum("ePatient.02", 1)');
  assert.equal(persistedRules[3].source,
    'when present("ePatient.01")\nrequire present("ePatient.02")');
  assert.equal(persistedRules.some(({ primaryTargetElementId }) => primaryTargetElementId === "dAgency.01"), false);
});

test("legacy nested Form predicates have a deterministic Validation-language migration", () => {
  const fields = new Map([["present", "eResponse.03"], ["priority", "eDispatch.05"]]);
  assert.equal(migrateFormExpression({ operator: "and", conditions: [
    { operator: "exists", field: "present" },
    { operator: "not", condition: { operator: "equals", field: "priority", value: "routine" } },
  ] }, fields), 'all(present("eResponse.03"), not(equals("eDispatch.05", "routine")))');
  assert.equal(migrateFormExpression({ operator: "exists", field: "custom" }, fields), null);
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

test("publication validation promotes structural-bound diagnostics to blocking errors for enabled rules", async () => {
  const bounded = { ...sourceRule, primaryTargetElementId: "ePatient.18",
    source: 'require maximum("ePatient.18", 3)' };
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 1, display_name: "Bounds", source_rule: bounded,
      status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "ePatient.18", name: "Phone",
      base_datatype: "string", group_path: [], min_occurs: 0, max_occurs: 2 }];
    if (sql.includes("from catalog.group_definition") || sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics.map(({ code, severity }) => ({ code, severity })),
    [{ code: "occurrence-bound", severity: "error" }, { code: "wording", severity: "warning" }]);
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
  assert.equal(evaluateValidationBundle(result.compiledBundle, document, "sign", { timestamp: "2026-01-01T00:00:00Z" }).length, 1);
  document.groups[0].instances[0].elements[1].values[0].value = 200;
  assert.equal(evaluateValidationBundle(result.compiledBundle, document, "sign", { timestamp: "2026-01-01T00:00:00Z" }).length, 0);
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

test("rule library applies organization-scoped filters, stable pagination, provenance, and advisory diagnostics", async () => {
  const secondId = randomUUID();
  const rules = [sourceRule, { ...sourceRule, id: secondId, name: "Imported incident warning", severity: "warning",
    sourceKind: "nemsis", provenance: [{ standard: "NEMSIS", dataset: "EMS", sourceIdentity: "nemSch_1",
      sourceRelease: "3.5.1", originalExpression: "not(eResponse.03)", originalMessage: "Incident number required" }] }];
  const parameters = [];
  const manager = { query: async (sql, values = []) => {
    parameters.push(values);
    if (sql.includes("from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 1, display_name: "Library", source_rule: rules,
      status: "draft", version: null, compiled_bundle: null, compiled_sha256: null, created_at: new Date(),
      updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03", name: "Incident Number", base_datatype: "string" }];
    if (sql.includes("from catalog.group_definition") || sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const subject = service(manager);
  const first = await subject.library("session", { element: "eResponse.03", validity: "valid", limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = await subject.library("session", { element: "eResponse.03", validity: "valid", limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].rule.id, first.items[0].rule.id);
  const all = await subject.library("session", { element: "eResponse.03", validity: "valid", limit: "all" });
  assert.equal(all.items.length, all.total);
  assert.equal(all.nextCursor, null);
  const imported = await subject.library("session", { source: "nemsis", search: "nemSch_1" });
  assert.equal(imported.items[0].rule.provenance[0].originalExpression, "not(eResponse.03)");
  assert.ok(imported.items[0].diagnostics.some(({ code }) => code === "possible-conflict"));
  assert.ok(parameters.every((values) => !values.length || values[0] === organizationId || values[0] === "catalog"),
    "library lookup is constrained to the authenticated organization and its catalog");
});

test("disabled invalid rules remain authored but do not block publication or enter the executable bundle", async () => {
  const disabled = { ...sourceRule, id: randomUUID(), name: "Incomplete imported rule", enabled: false,
    source: "require unknownConstruct()", sourceKind: "nemsis" };
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 1, display_name: "Draft", source_rule: [sourceRule, disabled],
      status: "draft", version: null, compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03", name: "Incident Number", base_datatype: "string" }];
    if (sql.includes("from catalog.group_definition") || sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, true);
  assert.deepEqual(result.compiledBundle.rules.map(({ ruleId }) => ruleId), [ruleId]);
  assert.ok(result.diagnostics.some(({ ruleId: diagnosticRule, severity }) => diagnosticRule === disabled.id && severity === "warning"));
});

test("a published version clones onto a same-or-newer published Catalog and returns upgrade diagnostics", async () => {
  const targetCatalogId = randomUUID();
  const published = { id: versionId, organization_id: organizationId, catalog_release_id: randomUUID(), rule_id: ruleId,
    cloned_from_id: null, revision: 4, display_name: "Published policy", source_rule: [sourceRule], status: "published",
    version: 1, source_sha256: "a".repeat(64), compiled_bundle: { rules: [] }, compiled_sha256: "b".repeat(64),
    created_at: new Date(), updated_at: new Date(), published_at: new Date() };
  let insertedSource;
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("where id=$1") && sql.includes("status='published'")) return [published];
    if (sql.includes("status='draft' for update")) return [];
    if (sql.includes("from catalog.release target")) return [{ id: targetCatalogId }];
    if (sql.includes("insert into validation.version")) {
      insertedSource = JSON.parse(parameters[5]);
      return [{ ...published, id: parameters[0], catalog_release_id: targetCatalogId, cloned_from_id: versionId,
        revision: 1, display_name: parameters[4], source_rule: insertedSource, status: "draft", version: null,
        source_sha256: null, compiled_bundle: null, compiled_sha256: null, published_at: null }];
    }
    if (sql.includes("from catalog.element_definition") || sql.includes("from catalog.group_definition")
      || sql.includes("from catalog.element_option")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const cloned = await service(manager).clone("session", versionId, {
    catalogReleaseId: targetCatalogId, displayName: "Catalog upgrade policy",
  });
  assert.equal(cloned.clonedFromId, versionId);
  assert.deepEqual(insertedSource, [sourceRule]);
  assert.equal(cloned.diagnostics[0].code, "catalog-reference");
  assert.ok(calls.some(({ sql, parameters }) => sql.includes("from catalog.release target")
    && parameters[1] === organizationId && parameters[2] === published.catalog_release_id));
});

test("publication persists source and compiled integrity with a complete actor-attributed rule diff", async () => {
  const addedId = randomUUID();
  const baselineRule = { ...sourceRule, executionTargets: ["live", "sign"] };
  const changedRule = { ...sourceRule, name: "Historical incident number", enabled: false, executionTargets: ["review"] };
  const addedRule = { ...sourceRule, id: addedId, name: "Review disposition", executionTargets: ["review"] };
  const baseline = { id: randomUUID(), organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
    cloned_from_id: null, revision: 1, display_name: "Baseline", source_rule: [baselineRule], status: "published",
    version: 1, source_sha256: "a".repeat(64), compiled_bundle: { rules: [] }, compiled_sha256: "b".repeat(64),
    created_at: new Date(), updated_at: new Date(), published_at: new Date() };
  const row = { ...baseline, id: versionId, cloned_from_id: baseline.id, revision: 3, display_name: "Draft",
    source_rule: [changedRule, addedRule], status: "draft", version: null, source_sha256: null,
    compiled_bundle: null, compiled_sha256: null, published_at: null };
  let audit;
  let publishedBundle;
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("for update")) return [row];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03", name: "Incident", base_datatype: "string" }];
    if (sql.includes("from catalog.group_definition") || sql.includes("from catalog.element_option")) return [];
    if (sql.includes("next_version")) return [{ next_version: 2 }];
    if (sql.includes("with updated as")) {
      publishedBundle = JSON.parse(parameters[7]);
      return [{ ...row, status: "published", version: 2,
        source_sha256: parameters[6], compiled_sha256: parameters[8], published_at: new Date("2026-09-18T12:00:00Z") }];
    }
    if (sql.includes("status='published'")) return [baseline];
    if (sql.includes("insert into validation.change_event")) { audit = parameters; return []; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).publish("session", versionId, {
    expectedRevision: 3, displayName: "Published update", changeNote: "Reviewed policy changes",
  });
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.compiledSha256, /^[a-f0-9]{64}$/);
  const changes = JSON.parse(audit[6]);
  assert.deepEqual(changes.additions, [{ ruleId: addedId, name: "Review disposition" }]);
  assert.deepEqual(changes.disablements, [{ ruleId }]);
  assert.deepEqual(changes.executionTargetChanges, [{ ruleId, before: ["live", "sign"], after: ["review"] }]);
  assert.ok(changes.modifications[0].fields.includes("name"));
  assert.equal(audit[0], organizationId);
  assert.equal(audit[2], baseline.id);
  assert.equal(audit[5], "Reviewed policy changes");
  assert.deepEqual(publishedBundle.rules.find(({ ruleId: id }) => id === addedId).executionTargets, ["review"]);
});

test("Validation history is organization isolated and exposes immutable lifecycle evidence", async () => {
  const actorId = randomUUID();
  const manager = { query: async (sql, parameters) => {
    assert.match(sql, /from validation\.change_event where organization_id=\$1/);
    assert.deepEqual(parameters, [organizationId]);
    return [{ id: "7", actor_id: actorId, action: "validation.publish", source_version_id: null,
      destination_version_id: versionId, catalog_release_id: "catalog", change_note: "Initial policy",
      rule_changes: { additions: [], modifications: [], disablements: [], executionTargetChanges: [] },
      source_sha256: "a".repeat(64), compiled_sha256: "b".repeat(64), occurred_at: "2026-09-18T12:00:00Z" }];
  } };
  const events = await service(manager).history("session");
  assert.equal(events[0].actorId, actorId);
  assert.equal(events[0].destinationVersionId, versionId);
  assert.equal(events[0].occurredAt, "2026-09-18T12:00:00.000Z");
});

test("activation atomically selects and audits one compatible Form, Catalog, and Validation bundle", async () => {
  const formVersionId = randomUUID();
  const catalogReleaseId = randomUUID();
  const previousFormVersionId = randomUUID();
  const previousCatalogReleaseId = randomUUID();
  const previousValidationVersionId = randomUUID();
  const formDefinition = { schemaVersion: 1, sections: [{ key: "response", fields: [
    { key: "incident", source: { kind: "nemsis", elementId: "eResponse.03" } }
  ] }] };
  const compiledBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
    catalogReleaseId, rules: [{ ruleId, ruleVersion: versionId, name: sourceRule.name, enabled: true,
      severity: "error", executionTargets: ["live", "sign"], primaryTarget: { elementId: "eResponse.03" },
      message: sourceRule.message, scope: { kind: "report" }, assertion: { operator: "present", elementId: "eResponse.03" },
      references: { elementIds: ["eResponse.03"], groupIds: [], codeReferences: [] } }] };
  const compiledSha256 = compiledValidationBundleSha256(compiledBundle);
  const formSha256 = canonicalDefinitionSha256(formDefinition);
  const catalogSha256 = "c".repeat(64);
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("select vv.*")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: catalogReleaseId, rule_id: ruleId, cloned_from_id: null, revision: 1,
      display_name: "Published", source_rule: [sourceRule], status: "published", version: 2,
      source_sha256: "s".repeat(64), compiled_bundle: compiledBundle, compiled_sha256: compiledSha256,
      form_id: randomUUID(), form_definition: formDefinition, form_definition_sha256: formSha256,
      catalog_artifact_sha256: catalogSha256, catalog_sealed: true }];
    if (sql.includes("from forms.form_field")) return [{ element_id: "eResponse.03" }];
    if (sql.includes("from app_identity.active_configuration_bundle active")) return [{
      form_version_id: previousFormVersionId, catalog_release_id: previousCatalogReleaseId,
      validation_version_id: previousValidationVersionId, source_rule: [] }];
    if (sql.includes("insert into app_identity.active_configuration_bundle")) return [{ activated_at: "2026-09-18T18:00:00Z" }];
    if (sql.includes("insert into forms.agency_stationary_default") || sql.includes("insert into validation.active_version")
      || sql.includes("insert into app_identity.configuration_event") || sql.includes("insert into validation.change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const activated = await service(manager).activate("session", versionId, {
    formVersionId, catalogReleaseId, changeNote: "Restore reviewed configuration",
  });
  assert.deepEqual({ form: activated.formVersionId, catalog: activated.catalogReleaseId,
    validation: activated.validationVersionId }, { form: formVersionId, catalog: catalogReleaseId, validation: versionId });
  assert.equal(activated.formDefinitionSha256, formSha256);
  assert.equal(activated.catalogArtifactSha256, catalogSha256);
  assert.equal(activated.validationCompiledSha256, compiledSha256);
  assert.equal(activated.previousFormVersionId, previousFormVersionId);
  const audit = calls.find(({ sql }) => sql.includes("insert into app_identity.configuration_event"));
  assert.equal(audit.parameters[8], "Restore reviewed configuration");
  assert.deepEqual(JSON.parse(audit.parameters[12]).to, { formVersionId, catalogReleaseId, validationVersionId: versionId });
});

test("failed bundle compatibility and reference checks occur before active state changes", async () => {
  const formVersionId = randomUUID();
  const catalogReleaseId = randomUUID();
  for (const failure of ["binding", "reference"]) {
    let mutated = false;
    const formDefinition = { schemaVersion: 1, sections: [] };
    const compiledBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
      catalogReleaseId, rules: [{ enabled: true, executionTargets: ["sign"],
        primaryTarget: { elementId: "eVitals.06" }, references: { elementIds: [] } }] };
    const manager = { query: async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return [];
      if (sql.includes("select vv.*")) return failure === "binding" ? [] : [{ id: versionId,
        organization_id: organizationId, catalog_release_id: catalogReleaseId, rule_id: ruleId,
        source_rule: [sourceRule], status: "published", compiled_bundle: compiledBundle,
        compiled_sha256: compiledValidationBundleSha256(compiledBundle),
        form_definition: formDefinition, form_definition_sha256: canonicalDefinitionSha256(formDefinition),
        catalog_artifact_sha256: "c".repeat(64), catalog_sealed: true }];
      if (sql.includes("from forms.form_field")) return [];
      if (/insert into (app_identity\.active_configuration_bundle|forms\.agency_stationary_default|validation\.active_version)/.test(sql)) {
        mutated = true;
      }
      return [];
    } };
    await assert.rejects(service(manager).activate("session", versionId, {
      formVersionId, catalogReleaseId, changeNote: "Invalid candidate",
    }), failure === "binding" ? /published and bound/ : /cannot supply/);
    assert.equal(mutated, false, `${failure} failure changed active state`);
  }
});

test("editing an imported normalized copy retains immutable provenance", async () => {
  const provenance = [{ standard: "NEMSIS", dataset: "EMS", sourceIdentity: "nemSch_e001",
    sourceRelease: "3.5.1", originalExpression: "official xpath", originalMessage: "Official message" }];
  const imported = { ...sourceRule, sourceKind: "nemsis", provenance };
  let persisted;
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 3, display_name: "Imported", source_rule: [imported],
      status: "draft", version: null, compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from validation.rule_identity")) return [{ id: ruleId }];
    if (sql.includes("with updated as")) {
      persisted = JSON.parse(parameters[4]);
      return [{ id: versionId, organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
        revision: 4, display_name: parameters[3], source_rule: persisted, status: "draft", version: null,
        compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const updated = await service(manager).save("session", versionId, { expectedRevision: 3, displayName: "Agency copy",
    rules: [{ ...imported, name: "Agency-adjusted NEMSIS rule", source: 'require present("eResponse.03")', provenance: [] }] });
  assert.equal(updated.rules[0].name, "Agency-adjusted NEMSIS rule");
  assert.deepEqual(persisted[0].provenance, provenance);
  assert.equal(persisted[0].sourceKind, "nemsis");
});

test("a stale draft save reports a conflict without overwriting the newer revision", async () => {
  let attemptedUpdate = false;
  const current = { id: versionId, organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
    revision: 5, display_name: "Newer work", source_rule: [sourceRule], status: "draft", version: null,
    compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null };
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [current];
    if (sql.includes("from validation.rule_identity")) return [{ id: ruleId }];
    if (sql.includes("with updated as")) { attemptedUpdate = true; return []; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await assert.rejects(service(manager).save("session", versionId, {
    expectedRevision: 4, displayName: "Stale work", rules: [sourceRule],
  }), /revision is stale/);
  assert.equal(attemptedUpdate, true);
  assert.equal(current.display_name, "Newer work");
  assert.equal(current.revision, 5);
});

test("draft saves preserve historical rule identities by requiring disablement instead of removal", async () => {
  const second = { ...sourceRule, id: randomUUID(), name: "Historical rule" };
  const current = { id: versionId, organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
    revision: 2, display_name: "History", source_rule: [sourceRule, second], status: "draft", version: null,
    compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null };
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [current];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await assert.rejects(service(manager).save("session", versionId, {
    expectedRevision: 2, displayName: "History", rules: [sourceRule],
  }), /disabled rather than removed/);
});

test("disablement and restoration preserve rule identity while changing execution state", async () => {
  let row = { id: versionId, organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
    revision: 1, display_name: "Rules", source_rule: [sourceRule], status: "draft", version: null,
    compiled_bundle: null, compiled_sha256: null, created_at: new Date(), updated_at: new Date(), published_at: null };
  const sqlStatements = [];
  const manager = { query: async (sql, parameters = []) => {
    sqlStatements.push(sql);
    if (sql.includes("select * from validation.version")) return [row];
    if (sql.includes("with updated as")) {
      row = { ...row, revision: row.revision + 1, source_rule: JSON.parse(parameters[2]), updated_at: new Date() };
      return [row];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const subject = service(manager);
  const disabled = await subject.setRuleEnabled("session", versionId, ruleId, false, { expectedRevision: 1 });
  assert.equal(disabled.rules[0].id, ruleId);
  assert.equal(disabled.rules[0].enabled, false);
  const restored = await subject.setRuleEnabled("session", versionId, ruleId, true, { expectedRevision: 2 });
  assert.equal(restored.rules[0].id, ruleId);
  assert.equal(restored.rules[0].enabled, true);
  assert.ok(sqlStatements.every((sql) => !/delete\s+from\s+validation/i.test(sql)));
});

test("every Validation endpoint independently authorizes before reading or mutating data", async () => {
  const attempts = [
    { name: "current", required: "validation:read", invoke: (subject) => subject.current("session") },
    { name: "library", required: "validation:read", invoke: (subject) => subject.library("session", {}) },
    { name: "validate", required: "validation:read", invoke: (subject) => subject.validate("session", versionId) },
    { name: "create", required: "validation:write", invoke: (subject) => subject.create("session", {}) },
    { name: "clone", required: "validation:write", invoke: (subject) => subject.clone("session", versionId, {}) },
    { name: "save", required: "validation:write", invoke: (subject) => subject.save("session", versionId, {}) },
    { name: "createRule", required: "validation:write", invoke: (subject) => subject.createRule("session", versionId, {}) },
    { name: "setRuleEnabled", required: "validation:write", invoke: (subject) => subject.setRuleEnabled("session", versionId, ruleId, false, {}) },
    { name: "publish", required: "validation:publish", invoke: (subject) => subject.publish("session", versionId, {}) },
    { name: "activate", required: "validation:publish", invoke: (subject) => subject.activate("session", versionId, {}) },
    { name: "history", required: "validation:read", invoke: (subject) => subject.history("session") },
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
