import assert from "node:assert/strict";
import test from "node:test";
import { mergeDispatchEncounter, planDispatchMerge } from "../dist/dispatch/dispatch-encounter-merge.js";
import { dispatchEntityId } from "../dist/reports/encounter-document.persistence.js";

const incoming = (occurrenceId, value) => ({
  occurrenceId, elementId: "eDispatch.01", groupInstanceId: "group", ordinal: 0,
  value: { kind: "coded", occurrenceId: `source-${occurrenceId}`, code: value }
});

test("untouched vendor values update and retract while new values fill blank targets", () => {
  const actions = planDispatchMerge([
    { id: "updated", elementId: "eDispatch.01", provenanceKind: "dispatch", tombstoned: false },
    { id: "retracted", elementId: "ePatient.17", provenanceKind: "dispatch", tombstoned: false }
  ], [incoming("updated", "new"), incoming("filled", "added")]);
  assert.deepEqual(actions.map(({ kind }) => kind), ["apply", "apply", "retract"]);
});

test("clinician create, edit, clear, and affirm ownership blocks only differing dispatch targets", () => {
  const clinician = (id, clinicianValue, tombstoned = false) => ({
    id, elementId: "eDispatch.01", provenanceKind: "clinician", clinicianValue, tombstoned
  });
  const same = { kind: "coded", occurrenceId: "ignored", code: "same" };
  const actions = planDispatchMerge([
    clinician("edited", { kind: "coded", code: "mine" }),
    clinician("affirmed", same),
    clinician("cleared", null, true),
    { id: "untouched", elementId: "eTimes.04", provenanceKind: "dispatch", tombstoned: false }
  ], [incoming("edited", "vendor"), incoming("affirmed", "same"), incoming("cleared", "vendor"), incoming("untouched", "latest")]);
  assert.deepEqual(actions.map(({ kind, occurrenceId, target }) => [kind, occurrenceId ?? target?.occurrenceId]), [
    ["conflict", "edited"], ["conflict", "cleared"], ["apply", "untouched"]
  ]);
  assert.deepEqual(actions[0].clinicianValue, { kind: "coded", code: "mine" });
  assert.equal(actions[0].dispatchValue.code, "vendor");
});

test("dispatch retraction of clinician-owned source content is retained as a lineage conflict", () => {
  const actions = planDispatchMerge([{
    id: "owned", elementId: "ePatient.17", provenanceKind: "clinician",
    clinicianValue: { kind: "scalar", value: "1980-01-01" }, tombstoned: false
  }], []);
  assert.equal(actions[0].kind, "conflict");
  assert.equal(actions[0].dispatchValue, null);
});

test("different canonical scalar values with the same occurrence ID produce a dispatch update", () => {
  const actions = planDispatchMerge([{
    id: "same-occurrence", elementId: "ePatient.17", provenanceKind: "dispatch",
    clinicianValue: { kind: "scalar", occurrenceId: "source-occurrence", value: "1980-01-01" },
    tombstoned: false,
  }], [{
    occurrenceId: "same-occurrence", elementId: "ePatient.17", groupInstanceId: "group", ordinal: 0,
    value: { kind: "scalar", occurrenceId: "source-occurrence", value: "1990-01-01" },
  }]);

  assert.deepEqual(actions.map(({ kind }) => kind), ["apply"]);
});

test("database merge retains canonical clinician and dispatch values with receipt lineage", async () => {
  const reportId = "10000000-0000-4000-8000-000000000001";
  const ownedId = dispatchEntityId(reportId, "occurrence:owned-source");
  const queries = [];
  const writer = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    queries.push({ sql: normalized, parameters });
    if (normalized.includes("select catalog_release_id")) return [{
      catalog_release_id: "catalog", documenting_user_id: "clinician", revision: 3
    }];
    if (normalized.includes("from clinical.element_occurrence where report_id")) return [{
      id: ownedId, element_id: "eDispatch.01", provenance_kind: "clinician",
      provenance_detail: { sourceOccurrenceId: "owned-source", clinicianValue: { kind: "coded", code: "mine", codeSystem: "urn:test" } },
      tombstoned_at: null
    }];
    if (normalized.includes("from catalog.element_definition")) return [{
      element_id: "eDispatch.01", element_identity_id: "identity", base_datatype: "string",
      analytical_repeatable: false, identifying: false
    }];
    return [];
  } };
  const result = await mergeDispatchEncounter(writer, {
    reportId, receiptId: "20000000-0000-4000-8000-000000000002", dispatchRevision: 4,
    canonical: { groups: [{ id: "DispatchGroup", instances: [{
      instanceId: "group-source", elements: [{ id: "eDispatch.01", values: [
        { kind: "coded", occurrenceId: "owned-source", code: "vendor", system: "urn:test" },
        { kind: "scalar", occurrenceId: "new-source", value: "filled" }
      ] }]
    }] }] }
  });
  assert.deepEqual(result, { applied: 1, conflicts: 1, revision: 4 });
  const conflict = queries.find(({ sql }) => sql.includes("insert into clinical.dispatch_conflict"));
  assert.deepEqual(JSON.parse(conflict.parameters[3]), { kind: "coded", code: "mine", system: "urn:test" });
  assert.equal(JSON.parse(conflict.parameters[4]).code, "vendor");
  assert.equal(conflict.parameters[5], "20000000-0000-4000-8000-000000000002");
  assert.ok(queries.some(({ sql }) => sql.includes("insert into clinical.element_occurrence")));
});

test("database merge stores catalog decimals with the numeric discriminator and value", async () => {
  const queries = [];
  const writer = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    queries.push({ sql: normalized, parameters });
    if (normalized.includes("select catalog_release_id")) return [{
      catalog_release_id: "catalog", documenting_user_id: "clinician", revision: 1,
    }];
    if (normalized.includes("from clinical.element_occurrence where report_id")) return [];
    if (normalized.includes("from catalog.element_definition")) return [{
      element_id: "eVitals.10", element_identity_id: "identity", base_datatype: "decimal",
      analytical_repeatable: true, identifying: false,
    }];
    return [];
  } };

  const result = await mergeDispatchEncounter(writer, {
    reportId: "10000000-0000-4000-8000-000000000001",
    receiptId: "20000000-0000-4000-8000-000000000002",
    dispatchRevision: 2,
    canonical: { groups: [{ id: "VitalGroup", instances: [{
      instanceId: "vital-source", elements: [{ id: "eVitals.10", values: [{
        kind: "scalar", occurrenceId: "temperature-source", value: 37.5, lexical: "37.5",
      }] }],
    }] }] },
  });

  assert.deepEqual(result, { applied: 1, conflicts: 0, revision: 2 });
  const insert = queries.find(({ sql }) => sql.includes("insert into clinical.element_occurrence"));
  assert.equal(insert.parameters[9], "numeric");
  assert.equal(insert.parameters[12], 37.5);
  assert.equal(insert.parameters[19], "37.5");
});
