import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import {
  canonicalDefinitionSha256,
  FormPublicationValidationError,
  validateCanonicalFormDefinition
} from "../dist/forms/form-publication.validation.js";

test("synthetic demo blocks direct form publication before database access", async () => {
  const original = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
  process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
  let queried = false;
  const service = new FormPublicationService({ transaction: async () => { queried = true; } });
  try {
    await assert.rejects(service.publish("50000000-0000-4000-8000-000000000001", {}),
      (error) => error instanceof ForbiddenException && /Drafts can still be/.test(error.message));
    assert.equal(queried, false);
  } finally {
    if (original === undefined) delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    else process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = original;
  }
});

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
