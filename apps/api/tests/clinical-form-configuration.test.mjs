import assert from "node:assert/strict";
import test from "node:test";
import { compiledValidationBundleSha256 } from "@open-triage/contracts";
import { clinicalFormConfiguration } from "../dist/forms/clinical-form-configuration.js";

test("a newly published form receives agency custom codes from its pinned catalog", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [
      { key: "airway", fields: [{ key: "device", source: { kind: "nemsis", elementId: "eAirway.03" } }] }
    ] } }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eAirway.03",
      agency_required: false, agency_required_severity: null, min_occurs: 0, max_occurs: 1,
      nillable: true, supports_not_values: true, supports_pertinent_negatives: false }];
    if (sql.includes("from catalog.value_set_element")) return [{ element_id: "eAirway.03", code: "AGENCY-DEVICE",
      code_system: "LOCAL", label: "Agency airway device", terminology_version: null }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };

  const configuration = await clinicalFormConfiguration(manager, "form-version", "catalog-release");
  assert.deepEqual(configuration.catalogFields["eAirway.03"].codeChoices, [
    { code: "AGENCY-DEVICE", codeSystem: "LOCAL", label: "Agency airway device" }
  ]);
});

test("report configuration verifies the pinned artifact and distributes only its enabled live subset", async () => {
  const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "validation-1",
    catalogReleaseId: "catalog-release", rules: [
      { ruleId: "live", enabled: true, executionTargets: ["live"], message: "Live message", primaryTarget: { elementId: "eA" } },
      { ruleId: "sign", enabled: true, executionTargets: ["sign"], message: "Sign message", primaryTarget: { elementId: "eB" } },
      { ruleId: "disabled", enabled: false, executionTargets: ["live"], message: "Disabled", primaryTarget: { elementId: "eC" } },
      { ruleId: "demographic", enabled: true, executionTargets: ["live"], message: "Demographic", primaryTarget: { elementId: "dAgency.01" } },
      { ruleId: "demographic-reference", enabled: true, executionTargets: ["live"], message: "Cross-dataset",
        primaryTarget: { elementId: "eResponse.01" }, references: { elementIds: ["dAgency.02"] } },
    ] };
  const digest = compiledValidationBundleSha256(bundle);
  const manager = { query: async (sql) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [] } }];
    if (sql.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: digest }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const configuration = await clinicalFormConfiguration(manager, "form-version", "catalog-release", "validation-1", digest);
  assert.deepEqual(configuration.validation.bundle.rules.map(({ ruleId }) => ruleId), ["live"]);
  assert.equal(configuration.validation.compiledSha256, compiledValidationBundleSha256(configuration.validation.bundle));
  await assert.rejects(clinicalFormConfiguration(manager, "form-version", "catalog-release", "validation-1", "0".repeat(64)),
    /integrity/);
});
