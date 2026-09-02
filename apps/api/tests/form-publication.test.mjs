import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDefinitionSha256,
  FormPublicationValidationError,
  validateCanonicalFormDefinition
} from "../dist/forms/form-publication.validation.js";

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
