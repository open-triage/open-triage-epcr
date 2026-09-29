import assert from "node:assert/strict";
import test from "node:test";
import { compiledValidationBundleSha256 } from "@open-triage/contracts";
import { clinicalFormConfiguration } from "../dist/forms/clinical-form-configuration.js";

test("a newly published form receives agency custom codes from its pinned catalog", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [
      { key: "local-airway", name: "Airway care", fields: [{ key: "device", source: { kind: "nemsis", elementId: "eAirway.03" } }] }
    ] } }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eAirway.03",
      agency_required: false, agency_required_severity: null, min_occurs: 0, max_occurs: 1,
      nillable: true, supports_not_values: true, supports_pertinent_negatives: false }];
    if (sql.includes("from catalog.value_set_element")) return [{ element_id: "eAirway.03", code: "AGENCY-DEVICE",
      code_system: "LOCAL", label: "Agency airway device", terminology_version: null }];
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };

  const configuration = await clinicalFormConfiguration(manager, "form-version", "catalog-release");
  assert.equal(configuration.definition.sections[0].key, "local-airway");
  assert.equal(configuration.definition.sections[0].name, "Airway care");
  assert.deepEqual(configuration.definition.sections[0].fields[0].source, { kind: "nemsis", elementId: "eAirway.03" });
  assert.deepEqual(configuration.catalogFields["eAirway.03"].codeChoices, [
    { code: "AGENCY-DEVICE", codeSystem: "LOCAL", label: "Agency airway device" }
  ]);
});

test("custom wording is resolved from the report's pinned catalog release", async () => {
  const id = "da77b0fc-a701-41b0-a387-18b07662ed71";
  const original = { id, title: "Original note", definition: "Original meaning", datatype: "string" };
  const revised = { ...original, title: "Clearer note", definition: "Clearer description" };
  const manager = { query: async (sql, params) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [
      { key: "notes", fields: [{ key: "note", source: { kind: "custom", elementDefinitionId: id } }] }
    ] } }];
    if (sql.includes("from forms.custom_element_definition")) return [{ id, definition: original }];
    if (sql.includes("customElementDefinitions")) return [{ definitions: params[0] === "new-release" ? [revised] : [original] }];
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  assert.equal((await clinicalFormConfiguration(manager, "old-form", "old-release")).customFields[id].title, "Original note");
  assert.equal((await clinicalFormConfiguration(manager, "new-form", "new-release")).customFields[id].title, "Clearer note");
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
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const configuration = await clinicalFormConfiguration(manager, "form-version", "catalog-release", "validation-1", digest);
  assert.deepEqual(configuration.validation.bundle.rules.map(({ ruleId }) => ruleId), ["live"]);
  assert.equal(configuration.validation.compiledSha256, compiledValidationBundleSha256(configuration.validation.bundle));
  await assert.rejects(clinicalFormConfiguration(manager, "form-version", "catalog-release", "validation-1", "0".repeat(64)),
    /integrity/);
});

test("clinical form text is loaded only from its pinned catalog release", async () => {
  const releases = new Map([
    ["old-release", { name: "Heart Rate", description: "Heart rate per minute", localization: null }],
    ["new-release", { name: "Heart Rate", description: "Heart rate per minute",
      localization: { schemaVersion: 1, sv: { label: "Hjärtfrekvens", description: "Hjärtfrekvens per minut" } } }],
  ]);
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [
      { key: "vitals", fields: [{ key: "heart-rate", source: { kind: "nemsis", elementId: "eVitals.10" } }] }
    ] } }];
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eVitals.10",
      ...releases.get(parameters[0]), agency_required: false, agency_required_severity: null,
      min_occurs: 0, max_occurs: 1, nillable: true, supports_not_values: true,
      supports_pertinent_negatives: false }];
    if (sql.includes("from catalog.value_set_element")) return [];
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const oldReport = await clinicalFormConfiguration(manager, "form-old", "old-release");
  const newReport = await clinicalFormConfiguration(manager, "form-new", "new-release");
  assert.equal(oldReport.catalogFields["eVitals.10"].localization, undefined);
  assert.equal(newReport.catalogFields["eVitals.10"].localization.sv.label, "Hjärtfrekvens");
  assert.equal(oldReport.catalogFields["eVitals.10"].name, "Heart Rate");
});

test("pinned Swedish choice metadata preserves code system and English source label", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition")) return [{ element_id: "eProcedures.06",
      name: "Procedure Successful", description: "", localization: null,
      exceptional_choices: [{ key: "not-value:7701003", localization: { schemaVersion: 1, sv: { label: "Ej registrerat" } } }],
      agency_required: false, agency_required_severity: null, min_occurs: 0, max_occurs: 1,
      nillable: true, supports_not_values: true, supports_pertinent_negatives: false }];
    if (sql.includes("from catalog.value_set_element")) return [{ element_id: "eProcedures.06", code: "9923003",
      code_system: "", label: "Yes", localization: { schemaVersion: 1, sv: { label: "Ja" } },
      terminology_version: null }];
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const fields = await (await import("../dist/forms/clinical-form-configuration.js"))
    .catalogFieldsConfiguration(manager, "published-release", ["eProcedures.06"]);
  assert.equal(fields["eProcedures.06"].codeChoices[0].code, "9923003");
  assert.equal(fields["eProcedures.06"].codeChoices[0].label, "Yes");
  assert.equal(fields["eProcedures.06"].codeChoices[0].localization.sv.label, "Ja");
  assert.equal(fields["eProcedures.06"].exceptionalChoices[0].localization.sv.label, "Ej registrerat");
});

test("group translations follow the pinned release, including untranslated older releases", async () => {
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [] } }];
    if (sql.includes("from catalog.group_definition")) return [{ group_id: "eVitals.VitalGroup", name: "Vital Group",
      localization: parameters[0] === "new" ? { schemaVersion: 1, sv: { name: "Vitalparametrar" } } : null }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const oldReport = await clinicalFormConfiguration(manager, "form-old", "old");
  const newReport = await clinicalFormConfiguration(manager, "form-new", "new");
  assert.deepEqual(oldReport.catalogGroups["eVitals.VitalGroup"], { name: "Vital Group" });
  assert.equal(newReport.catalogGroups["eVitals.VitalGroup"].localization.sv.name, "Vitalparametrar");
});
