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
    [{ code: "occurrence-bound", severity: "error" }]);
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
    if (sql.includes("select target.id from catalog.release")) return [{ id: targetCatalogId }];
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
  assert.ok(calls.some(({ sql, parameters }) => sql.includes("select target.id from catalog.release")
    && parameters[1] === organizationId && parameters[2] === published.catalog_release_id));
});

test("publication persists source and compiled integrity with a complete actor-attributed rule diff", async () => {
  const addedId = randomUUID();
  const baselineRule = { ...sourceRule, executionTargets: ["live", "sign"] };
  const changedRule = { ...sourceRule, name: "Historical incident number", enabled: false, executionTargets: ["review"] };
  const addedRule = { ...sourceRule, id: addedId, name: "Require disposition" };
  const baseline = { id: randomUUID(), organization_id: organizationId, catalog_release_id: "catalog", rule_id: ruleId,
    cloned_from_id: null, revision: 1, display_name: "Baseline", source_rule: [baselineRule], status: "published",
    version: 1, source_sha256: "a".repeat(64), compiled_bundle: { rules: [] }, compiled_sha256: "b".repeat(64),
    created_at: new Date(), updated_at: new Date(), published_at: new Date() };
  const row = { ...baseline, id: versionId, cloned_from_id: baseline.id, revision: 3, display_name: "Draft",
    source_rule: [changedRule, addedRule], status: "draft", version: null, source_sha256: null,
    compiled_bundle: null, compiled_sha256: null, published_at: null };
  let audit;
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("for update")) return [row];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03", name: "Incident", base_datatype: "string" }];
    if (sql.includes("from catalog.group_definition") || sql.includes("from catalog.element_option")) return [];
    if (sql.includes("status='published'")) return [baseline];
    if (sql.includes("next_version")) return [{ next_version: 2 }];
    if (sql.includes("with updated as")) return [{ ...row, status: "published", version: 2,
      source_sha256: parameters[6], compiled_sha256: parameters[8], published_at: new Date("2026-09-18T12:00:00Z") }];
    if (sql.includes("insert into validation.change_event")) { audit = parameters; return []; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).publish("session", versionId, {
    expectedRevision: 3, displayName: "Published update", changeNote: "Reviewed policy changes",
  });
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.compiledSha256, /^[a-f0-9]{64}$/);
  const changes = JSON.parse(audit[6]);
  assert.deepEqual(changes.additions, [{ ruleId: addedId, name: "Require disposition" }]);
  assert.deepEqual(changes.disablements, [{ ruleId }]);
  assert.deepEqual(changes.executionTargetChanges, [{ ruleId, before: ["live", "sign"], after: ["review"] }]);
  assert.ok(changes.modifications[0].fields.includes("name"));
  assert.equal(audit[0], organizationId);
  assert.equal(audit[2], baseline.id);
  assert.equal(audit[5], "Reviewed policy changes");
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
