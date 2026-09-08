import assert from "node:assert/strict";
import test from "node:test";
import { dispatchEntityId, encounterDocument, seedDispatchEncounter, storedEncounterValue } from "../dist/reports/encounter-document.persistence.js";

const reportId = "42000000-0000-4000-8000-000000000002";

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
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("insert into clinical.group_instance")) { groups.push(parameters); return []; }
    if (normalized.includes("from catalog.element_definition")) return parameters[1].map((elementId, index) => ({
      element_id: elementId,
      element_identity_id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      base_datatype: elementId === "ePatient.17" ? "date" : "string",
      analytical_repeatable: false,
      identifying: elementId === "ePatient.17"
    }));
    if (normalized.includes("insert into clinical.element_occurrence")) { occurrences.push(parameters); return []; }
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

  const patient = groups.find((parameters) => parameters[4] === "ePatientSection");
  assert.equal(patient[0], dispatchEntityId(reportId, "group:patient"));
  assert.equal(patient[3], dispatchEntityId(reportId, "group:pcr"));
  assert.equal(occurrences.find((parameters) => parameters[5] === "ePatient.17")[0], dispatchEntityId(reportId, "occurrence:hidden-dob"));
  assert.equal(occurrences.find((parameters) => parameters[5] === "ePatient.17")[14], "1980-01-01");
  const record = occurrences.find((parameters) => parameters[5] === "eRecord.01");
  assert.equal(record[10], "PCR-AGENCY-0001");
  assert.equal(dispatchEntityId(reportId, "group:patient"), dispatchEntityId(reportId, "group:patient"));
  assert.match(dispatchEntityId(reportId, "group:patient"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("stored scalar values rehydrate lexical, precision, offset, binary, and source attributes", () => {
  const common = {
    id: "62000000-0000-4000-8000-000000000060", group_instance_id: "group", element_id: "test", ordinal: 0,
    value_kind: "datetime", value_text: null, value_integer: null, value_numeric: null, value_boolean: null,
    value_date: null, value_datetime: "2026-09-04T16:30:45.120Z", value_time: null, value_duration: null,
    value_binary: null, value_lexical: null, value_utc_offset_minutes: -240, value_precision: "fractional-3",
    code: null, code_system: null, code_display: null, absence_code: null, absence_display: null,
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
});
