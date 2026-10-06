import assert from "node:assert/strict";
import test from "node:test";
import { compiledValidationBundleSha256 } from "@open-triage/contracts";
import { clinicalFormConfiguration } from "../dist/forms/clinical-form-configuration.js";

function configurationReader(connection = {}) {
  const reads = [];
  const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "validation",
    catalogReleaseId: "release", rules: [] };
  const digest = compiledValidationBundleSha256(bundle);
  return { reads, digest, manager: { connection, query: async (sql, params) => {
    reads.push([sql, params]);
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1,
      sections: [{ key: params[0], fields: [] }] } }];
    if (sql.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: digest }];
    if (sql.includes("customGroupDefinitions") || sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } } };
}

test("opening reports reuses published configuration across transactions without sharing mutable responses", async () => {
  const owner = {};
  const first = configurationReader(owner), next = configurationReader(owner);
  const original = await clinicalFormConfiguration(first.manager, "form", "release", "validation", first.digest);
  const expected = structuredClone(original);
  original.definition.sections[0].key = "changed by response consumer";
  original.validation.bundle.rules.push({ ruleId: "not-published" });
  const reused = await clinicalFormConfiguration(next.manager, "form", "release", "validation", first.digest);
  assert.deepEqual(reused, expected);
  assert.ok(first.reads.length > 0);
  assert.equal(next.reads.length, 0);
  reused.definition.sections.length = 0;
  assert.deepEqual(await clinicalFormConfiguration(next.manager, "form", "release", "validation", first.digest), expected);
});

test("configuration reuse respects every pinned version, integrity digest and database owner", async () => {
  const reader = configurationReader();
  await clinicalFormConfiguration(reader.manager, "form", "release", "validation", reader.digest);
  const count = reader.reads.length;
  await assert.rejects(clinicalFormConfiguration(reader.manager, "form", "release", "validation", "0".repeat(64)), /integrity/);
  assert.ok(reader.reads.length > count);
  for (const [form, release, validation] of [["new-form", "release", "validation"],
    ["form", "new-release", "validation"], ["form", "release", "new-validation"]]) {
    const before = reader.reads.length;
    await clinicalFormConfiguration(reader.manager, form, release, validation, reader.digest);
    assert.ok(reader.reads.length > before);
  }
  const other = configurationReader();
  await clinicalFormConfiguration(other.manager, "form", "release", "validation", other.digest);
  assert.ok(other.reads.length > 0);
});

test("configuration cache evicts least recently used bundles and retries failed loads", async () => {
  const reader = configurationReader();
  for (let index = 0; index < 8; index++) await clinicalFormConfiguration(reader.manager, `form-${index}`, "release");
  const beforeReuse = reader.reads.length;
  await clinicalFormConfiguration(reader.manager, "form-0", "release");
  assert.equal(reader.reads.length, beforeReuse);
  await clinicalFormConfiguration(reader.manager, "form-8", "release");
  const beforeEvicted = reader.reads.length;
  await clinicalFormConfiguration(reader.manager, "form-1", "release");
  assert.ok(reader.reads.length > beforeEvicted);
  const failing = configurationReader();
  const query = failing.manager.query;
  failing.manager.query = async () => { throw new Error("database unavailable"); };
  await assert.rejects(clinicalFormConfiguration(failing.manager, "form", "release"), /database unavailable/);
  failing.manager.query = query;
  assert.equal((await clinicalFormConfiguration(failing.manager, "form", "release")).definition.sections[0].key, "form");
});

test("oversized published configurations are returned without being retained", async () => {
  const reader = configurationReader();
  const query = reader.manager.query;
  reader.manager.query = async (sql, params) => {
    const rows = await query(sql, params);
    if (sql.includes("from forms.form_version")) rows[0].canonical_definition.description = "x".repeat(16 * 1024 * 1024);
    return rows;
  };
  await clinicalFormConfiguration(reader.manager, "large-form", "release");
  const before = reader.reads.length;
  const again = await clinicalFormConfiguration(reader.manager, "large-form", "release");
  assert.ok(reader.reads.length > before);
  assert.equal(again.definition.description.length, 16 * 1024 * 1024);
});

test("report opening reads choices once, preserving pinned selections while excluding disabled legacy choices", async () => {
  let fieldsRead = 0;
  let choicesRead = 0;
  const manager = { query: async (sql, params) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [
      { key: "care", fields: [
        { key: "pinned", source: { kind: "nemsis", elementId: "eAirway.03" }, choicePolicy: [
          { kind: "code", code: "old", codeSystem: "LOCAL" }] },
        { key: "legacy", source: { kind: "nemsis", elementId: "eAirway.04" } },
      ] }
    ] } }];
    if (sql.includes("from catalog.element_definition")) {
      fieldsRead++;
      return ["eAirway.03", "eAirway.04"].map(element_id => ({ element_id, min_occurs: 0, max_occurs: 1 }));
    }
    if (sql.includes("from catalog.value_set_element")) {
      choicesRead++;
      assert.equal(params[2], true);
      return ["eAirway.03", "eAirway.04"].flatMap(element_id => [
        { element_id, code: "old", code_system: "LOCAL", label: "Historical", enabled: false },
        { element_id, code: "new", code_system: "LOCAL", label: "Current", enabled: true },
      ]);
    }
    if (sql.includes("from catalog.group_definition") || sql.includes("customGroupDefinitions")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const config = await clinicalFormConfiguration(manager, "form", "release");
  assert.deepEqual(config.catalogFields["eAirway.03"].codeChoices.map(c => c.code), ["old"]);
  assert.deepEqual(config.catalogFields["eAirway.04"].codeChoices.map(c => c.code), ["new"]);
  assert.equal(fieldsRead, 1);
  assert.equal(choicesRead, 1);
});

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
    if (sql.includes("customGroupDefinitions")) return [];
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
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  assert.equal((await clinicalFormConfiguration(manager, "old-form", "old-release")).customFields[id].title, "Original note");
  assert.equal((await clinicalFormConfiguration(manager, "new-form", "new-release")).customFields[id].title, "Clearer note");
});

test("report configuration verifies the pinned artifact and includes enabled live and sign rules for review", async () => {
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
    if (sql.includes("from catalog.element_definition") || sql.includes("from catalog.value_set_element")) return [];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const configuration = await clinicalFormConfiguration(manager, "form-version", "catalog-release", "validation-1", digest);
  assert.deepEqual(configuration.validation.bundle.rules.map(({ ruleId }) => ruleId), ["live", "sign"]);
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
    if (sql.includes("customGroupDefinitions")) return [];
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
    if (sql.includes("customGroupDefinitions")) return [];
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
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const oldReport = await clinicalFormConfiguration(manager, "form-old", "old");
  const newReport = await clinicalFormConfiguration(manager, "form-new", "new");
  assert.deepEqual(oldReport.catalogGroups["eVitals.VitalGroup"], { name: "Vital Group" });
  assert.equal(newReport.catalogGroups["eVitals.VitalGroup"].localization.sv.name, "Vitalparametrar");
});
