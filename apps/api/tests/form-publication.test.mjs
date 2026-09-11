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
  const left = { schemaVersion: 1, sections: [{ key: "one", presentation: { title: "One", order: 1 }, fields: [] }] };
  const right = { sections: [{ fields: [], presentation: { order: 1, title: "One" }, key: "one" }], schemaVersion: 1 };
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
