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
const definition = { schemaVersion: 1, sourceReleaseId: "release-1", elements: [element] };
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

test("direct catalog authoring requires the administrator capability", async () => {
  const service = serviceWith({ query: async () => [] }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "installation:administer");
      throw new UnauthorizedException();
    }
  });
  await assert.rejects(service.current("clinician-session"), UnauthorizedException);
});
