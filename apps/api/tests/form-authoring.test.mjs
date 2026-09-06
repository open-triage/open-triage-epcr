import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
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
      if (sql.includes("join forms.agency_stationary_default active")) return [{
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

test("form authoring rejects removal that leaves an invalid section structure", async () => {
  let queried = false;
  const service = new FormAuthoringService({ transaction: async () => { queried = true; } }, {
    requireCapability: async () => session
  });
  await assert.rejects(service.save("owner-session", draftId, {
    expectedRevision: 1, definition: { schemaVersion: 1, sections: [] }
  }), (error) => error.getStatus?.() === 422 && error.getResponse().findings.includes("sections must be a non-empty array"));
  assert.equal(queried, false);
});

test("catalog search is bounded to an authorized editable draft and returns pagination", async () => {
  const calls = [];
  const service = new FormAuthoringService({ query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes("select fv.catalog_release_id")) return [{ catalog_release_id: catalogId }];
    if (sql.includes("from catalog.element_definition")) return Array.from({ length: 41 }, (_, index) => ({
      element_id: `ePatient.${String(index + 1).padStart(2, "0")}`, name: `Patient ${index + 1}`,
      description: "Patient catalog element", base_datatype: "string", group_path: ["ePatient"]
    }));
    throw new Error(`Unexpected SQL: ${sql}`);
  } }, { requireCapability: async () => session });
  const page = await service.searchCatalog("owner-session", draftId, { query: " Patient ", offset: "40" });
  assert.equal(page.items.length, 40);
  assert.equal(page.nextOffset, 80);
  assert.deepEqual(calls[1].parameters, [catalogId, "patient", 41, 40]);
});

test("duplicate element placement fails API validation before persistence", async () => {
  let queried = false;
  const duplicate = { schemaVersion: 1, sections: [
    { key: "one", fields: [{ key: "first", source: { kind: "nemsis", elementId: "ePatient.01" } }] },
    { key: "two", fields: [{ key: "second", source: { kind: "nemsis", elementId: "ePatient.01" } }] }
  ] };
  const service = new FormAuthoringService({ transaction: async () => { queried = true; } }, {
    requireCapability: async () => session
  });
  await assert.rejects(service.save("owner-session", draftId, { expectedRevision: 1, definition: duplicate }),
    (error) => error instanceof UnprocessableEntityException &&
      error.getResponse().findings.includes("sections[1].fields[0].source is duplicated"));
  assert.equal(queried, false);
});

test("publishing requires a saved revision and note without changing the agency default", async () => {
  const calls = [];
  const publication = { publish: async (id, body, organization) => {
    calls.push({ id, body, organization });
    return { id, status: "published", definitionSha256: body.definitionSha256,
      publishedAt: "2026-09-07T02:00:00.000Z", projections: { sections: 1, fields: 4, rules: 0, locales: 0 } };
  } };
  const service = new FormAuthoringService({ query: async (sql) => {
    assert.doesNotMatch(sql, /agency_stationary_default/);
    return [{ id: draftId, form_id: formId, catalog_release_id: catalogId, cloned_from_id: sourceFormId,
      version: 2, revision: 3, canonical_definition: definition, definition_sha256: "a".repeat(64), updated_at: new Date() }];
  } }, { requireCapability: async () => session }, publication);
  await assert.rejects(service.publish("owner-session", draftId, {
    expectedRevision: 3, definitionSha256: "a".repeat(64), changeNote: " "
  }), UnprocessableEntityException);
  const result = await service.publish("owner-session", draftId, {
    expectedRevision: 3, definitionSha256: "a".repeat(64), changeNote: "Reviewed structure"
  });
  assert.equal(result.status, "published");
  assert.equal(result.structuralSummary.fields, 4);
  assert.deepEqual(calls[0], { id: draftId, organization: organizationId, body: {
    publishedBy: session.user.id, changeNote: "Reviewed structure", definitionSha256: "a".repeat(64)
  } });
});

test("activation pins one exact version and appends previous/new audit evidence", async () => {
  const queries = [];
  const manager = { query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from forms.form_version fv join forms.form f")) return [{
      form_id: formId, catalog_release_id: catalogId, definition_sha256: "b".repeat(64)
    }];
    if (sql.includes("from forms.agency_stationary_default")) return [{
      form_version_id: sourceFormId, catalog_release_id: sourceCatalogId
    }];
    if (sql.includes("insert into forms.agency_stationary_default")) return [{ activated_at: "2026-09-07T02:05:00.000Z" }];
    if (sql.includes("insert into app_identity.configuration_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new FormAuthoringService({ transaction: async (_level, work) => work(manager) },
    { requireCapability: async () => session }, {});
  const activation = await service.activate("owner-session", draftId, { changeNote: "Deploy reviewed form" });
  assert.equal(activation.formVersionId, draftId);
  assert.equal(activation.previousFormVersionId, sourceFormId);
  const audit = queries.find(({ sql }) => sql.includes("insert into app_identity.configuration_event"));
  assert.deepEqual(audit.parameters.slice(0, 8), [organizationId, session.user.id, draftId, catalogId,
    sourceFormId, sourceCatalogId, "Deploy reviewed form", "b".repeat(64)]);
});
