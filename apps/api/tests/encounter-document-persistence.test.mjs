import assert from "node:assert/strict";
import test from "node:test";
import { ENCOUNTER_DOCUMENT_SCHEMA, ENCOUNTER_DOCUMENT_TYPE, ENCOUNTER_MODEL_VERSION } from "@open-triage/contracts";
import { assembleEncounterDocument, dispatchEntityId, encounterDocument, nextPcrNumber, seedDispatchEncounter, storedEncounterValue } from "../dist/reports/encounter-document.persistence.js";

const reportId = "42000000-0000-4000-8000-000000000002";

test("encounter documents distinguish untouched dispatch groups from clinician, demo and mixed ownership", () => {
  const report = { id: reportId, created_at: "2026-10-06T12:00:00Z", updated_at: "2026-10-06T12:00:00Z",
    form_id: "form", form_version: 1, catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet" };
  for (const [provenance, expected] of [
    [["dispatch"], "dispatch"], [["clinician"], "clinician"], [["dispatch", "clinician"], "clinician"],
    [["demo"], undefined], [["dispatch", "demo"], undefined], [[], undefined],
  ]) {
    const group = { id: "scene", group_id: "eSceneSection", parent_group_instance_id: null,
      ordinal: 0, documented_time: null, correlation_id: null };
    const occurrences = provenance.map((kind, ordinal) => ({ id: `value-${ordinal}`, group_instance_id: "scene",
      element_id: "eScene.09", value_kind: "coded", code: "Y92.03", code_system: "ICD-10-CM", code_display: "Apartment/condo",
      ordinal, provenance_kind: kind, provenance_detail: null }));
    const document = assembleEncounterDocument(report, [group], occurrences);
    assert.equal(document.groups[0].instances[0].attributes?.["x-open-triage-owner"], expected, provenance.join(","));
    assert.equal(document.groups[0].instances[0].elements[0]?.values[0]?.code, provenance.length ? "Y92.03" : undefined);
  }
});

test("server PCR numbers preserve sequence order and minimum width", async () => {
  const numbers = ["1", "2", "1000000000"];
  const manager = { query: async (sql) => {
    assert.match(sql, /nextval\('clinical\.pcr_number_sequence'\)/);
    return [{ number: numbers.shift() }];
  } };
  assert.equal(await nextPcrNumber(manager), "PCR-000000001");
  assert.equal(await nextPcrNumber(manager), "PCR-000000002");
  assert.equal(await nextPcrNumber(manager), "PCR-1000000000");
});

test("agency catalog labels rehydrate as their stable NEMSIS data-model version", async () => {
  let reportQuery = "";
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from clinical.report r")) {
      reportQuery = normalized;
      return [{ id: reportId, created_at: "2026-09-08T12:00:00.000Z", updated_at: "2026-09-08T12:00:00.000Z",
        form_id: "form", form_version: 2, catalog_standard: "NEMSIS", catalog_version: "3.5.1",
        catalog_dataset: "EMSDataSet" }];
    }
    if (normalized.includes("from clinical.group_instance") || normalized.includes("from clinical.element_occurrence")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const document = await encounterDocument(manager, reportId);
  assert.equal(document.dataModel.version, "3.5.1");
  assert.match(reportQuery, /cr\.provenance->>'dataModelVersion'/);
  assert.match(reportQuery, /left join catalog\.release source_cr/);
});

test("payload identities map stably while nested and hidden values are seeded with a server PCR number", async () => {
  const groups = [];
  const occurrences = [];
  let groupInsertQueries = 0;
  let occurrenceInsertQueries = 0;
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("insert into clinical.group_instance")) {
      groupInsertQueries += 1;
      groups.push(...JSON.parse(parameters[3]));
      return [];
    }
    if (normalized.includes("from catalog.element_definition")) return parameters[1].map((elementId, index) => ({
      element_id: elementId,
      element_identity_id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      base_datatype: elementId === "ePatient.17" ? "date" : "string",
      analytical_repeatable: false,
      identifying: elementId === "ePatient.17"
    }));
    if (normalized.includes("insert into clinical.element_occurrence")) {
      occurrenceInsertQueries += 1;
      occurrences.push(...JSON.parse(parameters[3]));
      return [];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const payload = { groups: [
    { id: "EMSDataSet", instances: [{ instanceId: "dataset", elements: [] }] },
    { id: "HeaderGroup", instances: [{ instanceId: "header", parentInstanceId: "dataset", elements: [] }] },
    { id: "PatientCareReportGroup", instances: [{ instanceId: "pcr", parentInstanceId: "header", elements: [] }] },
    { id: "ePatientSection", instances: [{ instanceId: "patient", parentInstanceId: "pcr", elements: [
      { id: "ePatient.17", values: [{ kind: "scalar", occurrenceId: "hidden-dob", value: "1980-01-01" }] }
    ] }] }
  ] };

  await seedDispatchEncounter(manager, reportId, "catalog", "clinician", payload, "PCR-AGENCY-0001");

  const patient = groups.find((row) => row.group_id === "ePatientSection");
  assert.equal(patient.id, dispatchEntityId(reportId, "group:patient"));
  assert.equal(patient.parent_group_instance_id, dispatchEntityId(reportId, "group:pcr"));
  assert.equal(occurrences.find((row) => row.element_id === "ePatient.17").id,
    dispatchEntityId(reportId, "occurrence:hidden-dob"));
  assert.equal(occurrences.find((row) => row.element_id === "ePatient.17").value_date, "1980-01-01");
  const record = occurrences.find((row) => row.element_id === "eRecord.01");
  assert.equal(record.value_text, "PCR-AGENCY-0001");
  assert.equal(occurrences.length, 2);
  assert.equal(groupInsertQueries, 4, "groups are inserted once per dependency layer, not once per row");
  assert.equal(occurrenceInsertQueries, 1, "all occurrences are inserted in one batch");
  assert.equal(dispatchEntityId(reportId, "group:patient"), dispatchEntityId(reportId, "group:patient"));
  assert.match(dispatchEntityId(reportId, "group:patient"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("all supported canonical scalar datatypes retain their database and transport values", async () => {
  const cases = [
    ["string", "alpha", "text", "value_text", "alpha"],
    ["anyURI", "https://example.test/record", "uri", "value_text", "https://example.test/record"],
    ["integer", 42, "integer", "value_integer", 42],
    ["decimal", 37.5, "numeric", "value_numeric", 37.5],
    ["boolean", true, "boolean", "value_boolean", true],
    ["date", "2026-09-10", "date", "value_date", "2026-09-10"],
    ["dateTime", "2026-09-10T10:20:30+00:00", "datetime", "value_datetime", "2026-09-10T10:20:30+00:00"],
    ["time", "10:20:30", "time", "value_time", "10:20:30"],
    ["duration", "PT5M", "duration", "value_duration", "PT5M"],
    ["binary", "AQID", "binary", "value_binary", "AQID"],
  ];
  const occurrences = [];
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("insert into clinical.group_instance")) return [];
    if (normalized.includes("from catalog.element_definition")) return parameters[1].map((elementId, index) => ({
      element_id: elementId,
      element_identity_id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      base_datatype: elementId === "eRecord.01" ? "string" : elementId.slice("custom:test:".length),
      analytical_repeatable: false,
      identifying: false,
    }));
    if (normalized.includes("insert into clinical.element_occurrence")) {
      occurrences.push(...JSON.parse(parameters[3]));
      return [];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const elements = cases.map(([datatype, value]) => ({
    id: `custom:test:${datatype}`,
    values: [{ kind: "scalar", occurrenceId: `source-${datatype}`, value }],
  }));

  await seedDispatchEncounter(manager, reportId, "catalog", "clinician", {
    groups: [{ id: "custom:test-group", instances: [{ instanceId: "test-instance", elements }] }],
  }, "PCR-TEST");

  for (const [datatype, _input, databaseKind, databaseColumn, expectedValue] of cases) {
    const row = occurrences.find((candidate) => candidate.element_id === `custom:test:${datatype}`);
    assert.equal(row.value_kind, databaseKind, `${datatype} discriminator`);
    assert.equal(row[databaseColumn], expectedValue, `${datatype} database value`);
    assert.equal(storedEncounterValue({ ...row, provenance_detail: null }).value, expectedValue, `${datatype} transport value`);
  }
});

test("rehydrated encounter documents stamp the schema, document type, and model version from @open-triage/contracts, not a stale local literal", async () => {
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from clinical.report")) return [{
      id: reportId, created_at: new Date("2026-09-04T00:00:00Z"), updated_at: new Date("2026-09-04T01:00:00Z"),
      form_id: "standard-encounter-v1", form_version: "1",
      catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet",
    }];
    if (normalized.includes("from clinical.group_instance")) return [];
    if (normalized.includes("from clinical.element_occurrence")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };

  const document = await encounterDocument(manager, reportId);

  assert.equal(document.$schema, ENCOUNTER_DOCUMENT_SCHEMA);
  assert.equal(document.documentType, ENCOUNTER_DOCUMENT_TYPE);
  assert.equal(document.modelVersion, ENCOUNTER_MODEL_VERSION);
});

test("edited dispatch occurrences rehydrate current values instead of retained dispatch provenance", () => {
  const row = {
    id: "0beb9656-4dee-4514-90c1-f57198158cd4", element_id: "eScene.09",
    value_kind: "coded", code: "Y92.0", code_display: "Private residence",
    provenance_detail: {
      sourceValue: { kind: "coded", occurrenceId: "dispatch-location", code: "Y92.03", display: "Apartment/condo" },
      clinicianValue: { kind: "coded", code: "Y92.0" },
    },
  };
  assert.deepEqual(storedEncounterValue({ ...row, provenance_kind: "dispatch" }), {
    ...row.provenance_detail.sourceValue, occurrenceId: row.id,
  });
  for (const provenance_kind of ["clinician", "demo", "amendment"]) {
    assert.deepEqual(storedEncounterValue({ ...row, provenance_kind }), {
      occurrenceId: row.id, kind: "coded", code: "Y92.0", display: "Private residence",
    }, provenance_kind);
    for (const [columns, expected] of [
      [{ value_kind: "text", value_text: "Corrected address" }, { kind: "scalar", value: "Corrected address" }],
      [{ value_kind: "integer", value_integer: "118" }, { kind: "scalar", value: 118 }],
      [{ value_kind: "numeric", value_numeric: "1.2" }, { kind: "scalar", value: 1.2 }],
      [{ value_kind: "boolean", value_boolean: false }, { kind: "scalar", value: false }],
      [{ value_kind: "null", absence_code: "7701003" }, { kind: "null", notValue: { code: "7701003" } }],
      [{ value_kind: "pertinent-negative", absence_code: "8801019" }, { kind: "pertinent-negative", code: "8801019" }],
      [{ value_kind: "absent" }, { kind: "absent" }],
    ]) {
      assert.deepEqual(storedEncounterValue({ ...row, ...columns, provenance_kind }), {
        occurrenceId: row.id, ...expected,
      }, `${provenance_kind}: ${columns.value_kind}`);
    }
  }
});

test("stored scalar values rehydrate lexical, precision, offset, binary, and source attributes", () => {
  const common = {
    id: "62000000-0000-4000-8000-000000000060", group_instance_id: "group", element_id: "test", ordinal: 0,
    value_kind: "datetime", value_text: null, value_integer: null, value_numeric: null, value_boolean: null,
    value_date: null, value_datetime: "2026-09-04T16:30:45.120Z", value_time: null, value_duration: null,
    value_binary: null, value_lexical: null, value_utc_offset_minutes: -240, value_precision: "fractional-3",
    code: null, code_system: null, code_display: null, absence_code: null, absence_display: null,
    not_value_code: null, not_value_display: null,
    pertinent_negative_code: null, pertinent_negative_display: null,
    source_attributes: { source: "monitor" }, provenance_kind: "clinician", provenance_detail: null,
  };
  assert.deepEqual(storedEncounterValue(common), {
    kind: "scalar", occurrenceId: common.id, value: "2026-09-04T12:30:45.120-04:00",
    attributes: { source: "monitor" }, utcOffsetMinutes: -240, precision: "fractional-3",
  });
  assert.equal(storedEncounterValue({
    ...common, value_datetime: new Date("2026-09-04T16:30:45Z"), value_utc_offset_minutes: 0,
    value_precision: "second",
  }).value, "2026-09-04T16:30:45+00:00");
  assert.deepEqual(storedEncounterValue({
    ...common, value_kind: "numeric", value_datetime: null, value_numeric: "001.20", value_lexical: "001.20",
    value_utc_offset_minutes: null, value_precision: null,
  }), {
    kind: "scalar", occurrenceId: common.id, value: 1.2, lexical: "001.20", attributes: { source: "monitor" },
  });
  assert.deepEqual(storedEncounterValue({
    ...common, value_kind: "integer", value_datetime: null, value_integer: "118", value_lexical: "0118",
    value_utc_offset_minutes: null, value_precision: null,
  }), {
    kind: "scalar", occurrenceId: common.id, value: 118, lexical: "0118", attributes: { source: "monitor" },
  });
  assert.deepEqual(storedEncounterValue({
    ...common, value_kind: "date", value_date: new Date("2000-01-01T00:00:00.000Z"), value_datetime: null,
    value_utc_offset_minutes: null, value_precision: "day",
  }), {
    kind: "scalar", occurrenceId: common.id, value: "2000-01-01", precision: "day", attributes: { source: "monitor" },
  });
  assert.equal(storedEncounterValue({
    ...common, value_kind: "date", value_date: "2000-01-01T00:00:00.000Z", value_datetime: null,
    value_utc_offset_minutes: null, value_precision: "day",
  }).value, "2000-01-01");
  assert.deepEqual(storedEncounterValue({
    ...common, value_kind: "binary", value_datetime: null, value_binary: "AAEC/w==",
    value_utc_offset_minutes: null, value_precision: null,
  }).value, "AAEC/w==");
  assert.deepEqual(storedEncounterValue({
    ...common, value_kind: "integer", value_datetime: null, value_integer: "118",
    value_utc_offset_minutes: null, value_precision: null,
    pertinent_negative_code: "8801019", pertinent_negative_display: "Denied",
  }), {
    kind: "scalar", occurrenceId: common.id, value: 118, attributes: { source: "monitor" },
    pertinentNegative: { code: "8801019", display: "Denied" },
  });
});
