import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const catalogId = "20000000-0000-4000-8000-000000000001";
const sourceCatalogId = "20000000-0000-4000-8000-000000000002";
const sourceFormId = "30000000-0000-4000-8000-000000000001";
const formId = "40000000-0000-4000-8000-000000000001";
const draftId = "50000000-0000-4000-8000-000000000001";

const session = {
  user: { id: "60000000-0000-4000-8000-000000000001", displayName: "Owner" },
  organization: { id: organizationId, name: "Example EMS" }
};

const definition = {
  schemaVersion: 1,
  sections: [{ key: "patient", fields: [
    { key: "compatible", source: { kind: "nemsis", elementId: "ePatient.01" } },
    { key: "missing", source: { kind: "nemsis", elementId: "ePatient.02" } },
    { key: "changed", source: { kind: "nemsis", elementId: "ePatient.03" } },
    { key: "disabled", source: { kind: "nemsis", elementId: "ePatient.04" } }
  ] }]
};

function element(element_id, overrides = {}) {
  return { element_id, element_identity_id: `identity-${element_id}`, base_datatype: "string",
    source_datatype: "string", usage: "Optional", definition: {}, analytical_location: "wide", ...overrides };
}

test("cloning copies compatible references, reports conflicts, and leaves the source aggregate unchanged", async () => {
  const original = structuredClone(definition);
  const sourceElements = definition.sections[0].fields.map(({ source }) => element(source.elementId));
  const targetElements = [
    element("ePatient.01"),
    element("ePatient.03", { base_datatype: "dateTime" }),
    element("ePatient.04", { usage: "Not Used" })
  ];
  const manager = {
    async query(sql, parameters) {
      if (sql.includes("pg_advisory_xact_lock")) return [];
      if (sql.includes("join catalog.authoring_draft")) return [{ id: catalogId }];
      if (sql.includes("exists (select 1 from app_identity.operational_unit")) return [{
        id: sourceFormId, form_id: formId, catalog_release_id: sourceCatalogId, version: 1,
        canonical_definition: definition
      }];
      if (sql.includes("status='draft' for update")) return [];
      if (sql.includes("from catalog.element_definition")) {
        return parameters[0] === sourceCatalogId ? sourceElements : targetElements;
      }
      if (sql.includes("insert into forms.form_version")) return [{
        id: draftId, form_id: formId, catalog_release_id: catalogId, cloned_from_id: sourceFormId,
        revision: 1, canonical_definition: JSON.parse(parameters[2]), definition_sha256: parameters[3],
        updated_at: "2026-09-07T01:00:00.000Z"
      }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const service = new FormAuthoringService({ manager, transaction: async (_level, work) => work(manager) }, {
    requireCapability: async (token, capability) => {
      assert.equal(token, "owner-session");
      assert.equal(capability, "installation:administer");
      return session;
    }
  });

  const draft = await service.clone("owner-session", { catalogReleaseId: catalogId });
  assert.deepEqual(draft.definition.sections[0].fields.map(({ key }) => key), ["compatible"]);
  assert.deepEqual(draft.diagnostics.map(({ code }) => code), [
    "missing-reference", "incompatible-reference", "disabled-reference"
  ]);
  assert.deepEqual(definition, original, "the published source definition was not mutated");
  assert.equal(draft.catalogReleaseId, catalogId);
  assert.equal(draft.clonedFromId, sourceFormId);
});

test("a stale form save fails before any content is overwritten", async () => {
  let updated = false;
  const manager = { query: async (sql) => {
    if (sql.includes("for update")) return [{ id: draftId, form_id: formId, catalog_release_id: catalogId,
      cloned_from_id: sourceFormId, revision: 2, canonical_definition: definition,
      definition_sha256: "a".repeat(64), updated_at: new Date() }];
    if (sql.includes("update forms.form_version")) updated = true;
    return [];
  } };
  const service = new FormAuthoringService({ transaction: async (_level, work) => work(manager) }, {
    requireCapability: async () => session
  });
  await assert.rejects(service.save("owner-session", draftId, { expectedRevision: 1, definition }),
    (error) => error instanceof ConflictException && error.getResponse().actualRevision === 2);
  assert.equal(updated, false);
});

test("form authoring rejects callers without Admin capability before querying", async () => {
  let queried = false;
  const service = new FormAuthoringService({ transaction: async () => { queried = true; } }, {
    requireCapability: async () => { throw new UnauthorizedException("Admin capability is required"); }
  });
  await assert.rejects(service.clone("clinician-session", { catalogReleaseId: catalogId }), UnauthorizedException);
  assert.equal(queried, false);
});
