import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";

const organizationId = randomUUID();
const versionId = randomUUID();
const ruleId = randomUUID();
const sourceRule = { id: ruleId, name: "Require incident number", enabled: true, severity: "error",
  executionTargets: ["live", "sign"], primaryTargetElementId: "eResponse.03",
  message: "Incident number is required", source: 'assert present("eResponse.03")' };

function service(manager, capabilityCalls = []) {
  return new ValidationAuthoringService({ manager, query: (...args) => manager.query(...args) }, {
    requireCapability: async (_token, capability) => {
      capabilityCalls.push(capability);
      return { organization: { id: organizationId }, user: { id: randomUUID() } };
    }
  });
}

test("validation uses read authority and compiles a catalog-bound draft", async () => {
  const capabilities = [];
  const manager = { query: async (sql) => {
    if (sql.includes("select * from validation.version")) return [{ id: versionId, organization_id: organizationId,
      catalog_release_id: "catalog", rule_id: ruleId, revision: 2, display_name: "Agency checks",
      source_rule: sourceRule, status: "draft", version: null, compiled_bundle: null, compiled_sha256: null,
      created_at: new Date(), updated_at: new Date(), published_at: null }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eResponse.03" }];
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
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await service(manager).validate("session", versionId);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "catalog-reference");
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
