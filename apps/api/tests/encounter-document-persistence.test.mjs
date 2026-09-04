import assert from "node:assert/strict";
import test from "node:test";
import { dispatchEntityId, seedDispatchEncounter } from "../dist/reports/encounter-document.persistence.js";

const reportId = "42000000-0000-4000-8000-000000000002";

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
});
