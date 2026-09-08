import assert from "node:assert/strict";
import test from "node:test";
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
