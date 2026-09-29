import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  canonicalDefinitionSha256,
  FormPublicationValidationError,
  validateCanonicalFormDefinition
} from "../dist/forms/form-publication.validation.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";

const formVersionId = "42000000-0000-4000-8000-000000000001";
const validPublishInput = {
  publishedBy: "32000000-0000-4000-8000-000000000003",
  changeNote: "Initial release",
  definitionSha256: "a".repeat(64)
};

test("canonical form hashes do not depend on object key order", () => {
  const left = { schemaVersion: 1, sections: [{ key: "one", fields: [] }] };
  const right = { sections: [{ fields: [], key: "one" }], schemaVersion: 1 };
  assert.equal(canonicalDefinitionSha256(left), canonicalDefinitionSha256(right));
});

test("canonical form validation rejects malformed and dangling rules", () => {
  assert.throws(() => validateCanonicalFormDefinition({
    schemaVersion: 1,
    sections: [{
      key: "one",
      fields: [{
        key: "known",
        source: { kind: "nemsis", elementId: "eVitals.06" },
        rules: [{ kind: "visibility", expression: { operator: "equals", field: "missing", value: true } }]
      }]
    }]
  }), (error) => error instanceof FormPublicationValidationError &&
    error.findings.some((finding) => finding.includes("unknown field")));
});

test("a serialization failure during publish surfaces as a retriable conflict, not a raw 500", async () => {
  const dataSource = {
    transaction: async () => {
      const error = new Error("could not serialize access due to concurrent update");
      error.code = "40001";
      throw error;
    }
  };
  const service = new FormPublicationService(dataSource);

  await assert.rejects(
    service.publish(formVersionId, validPublishInput),
    (error) => error instanceof ConflictException && error.getStatus() === 409
  );
});

test("a not-found error during publish keeps its original status instead of becoming a conflict", async () => {
  const dataSource = {
    transaction: async (isolation, work) => work({ query: async () => [] })
  };
  const service = new FormPublicationService(dataSource);

  await assert.rejects(
    service.publish(formVersionId, validPublishInput),
    (error) => error instanceof NotFoundException && error.getStatus() === 404
  );
});

test("publishing a complete Stationary form retains read-only NEMSIS metadata without analytics mappings", async () => {
  const definition = { schemaVersion: 1, sections: [{ key: "DemographicGroup", name: "Agency details", fields: [{
    key: "dAgency.01", source: { kind: "nemsis", elementId: "dAgency.01" },
  }] }] };
  const digest = canonicalDefinitionSha256(definition);
  const fieldWrites = [];
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from forms.form_version fv") && normalized.includes("for update")) return [{
      id: formVersionId, display_name: "Complete Stationary", status: "draft",
      canonical_definition: definition, definition_sha256: digest, published_at: null,
      organization_id: "32000000-0000-4000-8000-000000000001", catalog_release_id: "catalog-release",
    }];
    if (normalized.includes("from app_identity.app_user")) return [{ id: validPublishInput.publishedBy }];
    if (normalized.includes("with wording as materialized")) return [];
    if (normalized.includes("from catalog.element_definition e")) {
      assert.match(normalized, /left join catalog\.analytics_element_mapping/);
      return [{ element_id: "dAgency.01", element_identity_id: "agency-identity",
        analytical_location: null, permitted_absence_states: [] }];
    }
    if (normalized.startsWith("delete from")) return [];
    if (normalized.includes("insert into forms.form_section")) return [];
    if (normalized.includes("insert into forms.form_field")) { fieldWrites.push(parameters); return []; }
    if (normalized.includes("with updated as")) return [{ published_at: "2026-09-13T10:00:00.000Z" }];
    if (normalized.includes("insert into app_identity.configuration_event")) return [];
    if (normalized.includes("from forms.form_section where form_version_id")) {
      return [{ sections: 1, fields: 1, rules: 0 }];
    }
    if (normalized.includes("select display_name from forms.form_version")) return [{ display_name: "Complete Stationary" }];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new FormPublicationService({ transaction: async (_isolation, work) => work(manager) });

  const published = await service.publish(formVersionId, {
    ...validPublishInput, definitionSha256: digest,
  });

  assert.equal(published.status, "published");
  assert.equal(definition.sections[0].name, "Agency details");
  assert.equal(canonicalDefinitionSha256(definition), digest);
  assert.equal(fieldWrites.length, 1);
  assert.equal(fieldWrites[0][10], false);
});

test("direct form publication rejects a custom field retired in its pinned catalog", async () => {
  const id = "da77b0fc-a701-41b0-a387-18b07662ed71";
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition")) return [];
    if (sql.includes("from forms.custom_element_definition")) return [{
      id, organization_id: "org-1", base_datatype: "string", retired_at: null
    }];
    if (sql.includes("customElementDefinitions")) return [{ definitions: [{ id, retired: true }] }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new FormPublicationService({});
  await assert.rejects(service.resolveMetadata(manager, {
    organization_id: "org-1", catalog_release_id: "new-release"
  }, { schemaVersion: 1, sections: [{ key: "notes", fields: [{ key: "note",
    source: { kind: "custom", elementDefinitionId: id } }] }] }),
  (error) => error.getStatus?.() === 422 &&
    error.getResponse().findings.some((finding) => finding.includes("unavailable custom element")));
});


test("visual section names round-trip without changing field binding and reject invalid names", () => {
  const definition = { schemaVersion: 1, sections: [{ key: "local-care", name: "Care given", fields: [
    { key: "medication", source: { kind: "nemsis", elementId: "eMedications.03" } }
  ] }, { key: "next", name: "Next steps", fields: [] }] };
  assert.deepEqual(validateCanonicalFormDefinition(JSON.parse(JSON.stringify(definition))), definition);
  for (const name of ["", "   ", "a".repeat(121), 42]) {
    assert.throws(() => validateCanonicalFormDefinition({ ...definition, sections: [{ ...definition.sections[0], name }] }), /sections\[0\].name/);
  }
});
