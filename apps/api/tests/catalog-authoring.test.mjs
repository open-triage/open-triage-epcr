import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { CatalogAuthoringService, catalogDefinitionSha256 } from "../dist/admin/catalog-authoring.service.js";

const sourceElement = {
  element_id: "ePatient.01", element_identity_id: "11111111-1111-4111-8111-111111111111",
  base_datatype: "string", source_datatype: "xs:string", group_path: ["Patient"], min_occurs: 0,
  max_occurs: 1, nillable: true, supports_not_values: true, supports_pertinent_negatives: false,
  usage: "Recommended", analytical_location: "wide", sql_type: "text"
};
const element = {
  elementId: sourceElement.element_id, identityId: sourceElement.element_identity_id, baseDatatype: "string",
  storageSemantics: { sourceDatatype: "xs:string", groupPath: ["Patient"], analyticalLocation: "wide", sqlType: "text" },
  agencyRequired: false,
  constraints: { minOccurs: 0, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: false }
};
const definition = { schemaVersion: 1, sourceReleaseId: "release-1", elements: [element], codeLists: [] };
const session = { user: { id: "owner-1" }, organization: { id: "org-1" } };

function serviceWith(manager, sessions = { requireCapability: async () => session }) {
  return new CatalogAuthoringService({ transaction: async (_level, work) => work(manager), manager }, sessions);
}

test("catalog hashes are stable across object key ordering", () => {
  assert.equal(catalogDefinitionSha256({ b: 2, a: 1 }), catalogDefinitionSha256({ a: 1, b: 2 }));
});

test("stale catalog saves fail before changing canonical content", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 3, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    throw new Error(`unexpected query: ${sql}`);
  } };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 2, definition }), ConflictException);
});

test("identity, datatype, storage, and unsupported constraint changes are rejected", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const changed = { ...definition, elements: [{ ...element, baseDatatype: "integer",
    constraints: { ...element.constraints, maxOccurs: null, supportsPertinentNegatives: true } }] };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: changed }),
    (error) => error instanceof UnprocessableEntityException && /identity, datatype, and storage/.test(JSON.stringify(error.getResponse())));
});

test("publication requires a human change note before database access", async () => {
  const manager = { query: async () => { throw new Error("database should not be queried"); } };
  await assert.rejects(serviceWith(manager).publish("session", "draft-1", {
    expectedRevision: 1, definitionSha256: catalogDefinitionSha256(definition), changeNote: " "
  }), UnprocessableEntityException);
});

test("catalog publication carries forward one effective agency demographic version", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return [{ id: "demographic-version-2" }];
  } };
  const service = serviceWith(manager);
  await service.cloneAgencyDemographics(manager, "org-1", "release-1", "release-2", "owner-1");
  assert.match(calls[0].sql, /insert into app_identity\.agency_demographic_version/);
  assert.match(calls[0].sql, /source\.catalog_release_id=\$2/);
  assert.deepEqual(calls[0].parameters, ["org-1", "release-1", "release-2", "owner-1"]);
});

test("catalog publication fails when its source has no effective agency demographics", async () => {
  const manager = { query: async () => [] };
  const service = serviceWith(manager);
  await assert.rejects(
    service.cloneAgencyDemographics(manager, "org-1", "release-1", "release-2", "owner-1"),
    (error) => error instanceof UnprocessableEntityException && /No effective agency demographics/.test(error.message)
  );
});

test("direct catalog authoring requires the administrator capability", async () => {
  const service = serviceWith({ query: async () => [] }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "installation:administer");
      throw new UnauthorizedException();
    }
  });
  await assert.rejects(service.current("clinician-session"), UnauthorizedException);
});

const sourceCodeList = { list_id: "patient-activity", name: "Patient Activity", classification: "suggested", values: [
  { code: "Y93.K", codeSystem: "ICD-10-CM", label: "Animal care activity",
    sourceLabel: "Activities involving animal care", category: "Animal Care", enabled: true },
  { code: "Y93.01", codeSystem: "ICD-10-CM", label: "Walking",
    sourceLabel: "Activity, walking", category: "Exercise", enabled: true }
] };

function listManager(currentDefinition) {
  return { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: currentDefinition,
      definition_sha256: catalogDefinitionSha256(currentDefinition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [sourceCodeList];
    if (sql.includes("update catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 2, canonical_definition: currentDefinition,
      definition_sha256: catalogDefinitionSha256(currentDefinition), updated_at: new Date(), published_release_id: null }];
    throw new Error(`unexpected query: ${sql}`);
  } };
}

test("recommended code lists support labels, enabled state, ordering, additions, and an enabled default", async () => {
  const changed = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", values: [
      { ...sourceCodeList.values[1], label: "Walking or hiking", enabled: false },
      sourceCodeList.values[0],
      { code: "LOCAL-1", codeSystem: "Example EMS", label: "Local activity", sourceLabel: "Local activity",
        category: null, enabled: true }
    ], defaultValue: { code: "LOCAL-1", codeSystem: "Example EMS" } }] };
  const saved = await serviceWith(listManager(changed)).save("session", "draft-1", { expectedRevision: 1, definition: changed });
  assert.equal(saved.revision, 2);
});

test("duplicate codes and removed published values fail validation", async () => {
  const invalid = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", values: [sourceCodeList.values[0], { ...sourceCodeList.values[0], label: "Duplicate", enabled: false }],
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  await assert.rejects(serviceWith(listManager(invalid)).save("session", "draft-1", { expectedRevision: 1, definition: invalid }),
    (error) => error instanceof UnprocessableEntityException && /duplicate code/.test(JSON.stringify(error.getResponse())) &&
      /cannot be deleted/.test(JSON.stringify(error.getResponse())));
});

test("a disabled code cannot be the list default", async () => {
  const invalid = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", values: sourceCodeList.values.map((value, index) => index === 0 ? { ...value, enabled: false } : value),
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  await assert.rejects(serviceWith(listManager(invalid)).save("session", "draft-1", { expectedRevision: 1, definition: invalid }),
    (error) => error instanceof UnprocessableEntityException && /default must reference an enabled value/.test(JSON.stringify(error.getResponse())));
});
