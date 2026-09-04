import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import syntheticEncounter from "../app/data/synthetic-encounter-document.json";
import {
  EncounterDocumentError,
  deserializeEncounterDocument,
  encounterDocumentDiagnostics,
  loadEncounterDocument,
  serializeEncounterDocument,
} from "../app/encounter-document";

const schema = JSON.parse(readFileSync(new URL("../../../packages/contracts/encounter-document.schema-1.0.0.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function withVitals() {
  const candidate = structuredClone(syntheticEncounter) as unknown as { groups: Array<Record<string, unknown>> };
  candidate.groups.push({
    id: "eVitals.VitalGroup",
    instances: [
      { instanceId: "blood-pressure-1", parentInstanceId: "synthetic-pcr-1", attributes: { correlationId: "vitals-1435" }, elements: [{ id: "eVitals.06", values: [{ kind: "scalar", occurrenceId: "systolic-1", value: 118, attributes: { units: "mmHg" } }] }] },
      { instanceId: "blood-pressure-2", parentInstanceId: "synthetic-pcr-1", elements: [{ id: "eVitals.06", values: [{ kind: "null", occurrenceId: "systolic-2", notValue: { code: "7701003", display: "Not Recorded" } }] }] },
    ],
  });
  return candidate;
}

test("the small synthetic encounter is readable, catalog-compatible, and valid against the shared schema", () => {
  assert.equal(validateSchema(syntheticEncounter), true, JSON.stringify(validateSchema.errors));
  const document = loadEncounterDocument(syntheticEncounter, { formProfiles: { "standard-encounter-v1": ["1"] } });
  assert.equal(document.encounter.id, syntheticEncounter.encounter.id);
  assert.equal(document.groups[0]?.id, "EMSDataSet");
  const text = readFileSync(new URL("../app/data/synthetic-encounter-document.json", import.meta.url), "utf8");
  assert.ok(text.includes("\n  \"documentType\""));
  assert.ok(text.split("\n").length < 400);
  assert.doesNotMatch(text, /systolicField|patientNameInput|vitalDraft/);
});

test("absent, null, pertinent-negative, coded, scalar, and repeating values remain unambiguous", () => {
  const candidate = structuredClone(syntheticEncounter) as unknown as { groups: Array<Record<string, unknown>> };
  candidate.groups.push({
    id: "org.example.ems:explicit-value-states",
    instances: [{
      instanceId: "states-1",
      elements: [{
        id: "org.example.ems:value",
        values: [
          { kind: "absent", occurrenceId: "value-1" },
          { kind: "null", occurrenceId: "value-2", notValue: { code: "7701003", display: "Not Recorded" } },
          { kind: "pertinent-negative", occurrenceId: "value-3", code: "8801019", display: "Refused" },
          { kind: "coded", occurrenceId: "value-4", code: "local-1", system: "org.example.ems" },
          { kind: "scalar", occurrenceId: "value-5", value: 42 },
        ],
      }],
    }],
  });
  const document = loadEncounterDocument(candidate);
  const values = document.groups.at(-1)?.instances[0]?.elements[0]?.values;
  assert.deepEqual(values?.map(({ kind }) => kind), ["absent", "null", "pertinent-negative", "coded", "scalar"]);
  assert.equal(new Set(values?.map(({ occurrenceId }) => occurrenceId)).size, 5);
  assert.equal(validateSchema(document), true, JSON.stringify(validateSchema.errors));
});

test("repeating NEMSIS groups retain stable group and occurrence identities plus attributes", () => {
  const document = loadEncounterDocument(withVitals());
  const vitals = document.groups.find(({ id }) => id === "eVitals.VitalGroup")!;
  assert.deepEqual(vitals.instances.map(({ instanceId }) => instanceId), ["blood-pressure-1", "blood-pressure-2"]);
  assert.equal(vitals.instances[0]?.attributes?.correlationId, "vitals-1435");
  assert.equal(vitals.instances[0]?.elements[0]?.values[0]?.attributes?.units, "mmHg");
  assert.equal(vitals.instances[1]?.elements[0]?.values[0]?.kind, "null");
});

test("model 1.1 retains nested parent identities and rejects missing or cyclic parents", () => {
  const candidate = structuredClone(syntheticEncounter) as unknown as { modelVersion: string; groups: Array<{ instances: Array<{ instanceId: string; parentInstanceId?: string }> }> };
  candidate.groups[1]!.instances[0]!.parentInstanceId = candidate.groups[0]!.instances[0]!.instanceId;
  assert.equal(loadEncounterDocument(candidate).groups[1]!.instances[0]!.parentInstanceId, candidate.groups[0]!.instances[0]!.instanceId);
  candidate.groups[1]!.instances[0]!.parentInstanceId = "missing-parent";
  assert.ok(encounterDocumentDiagnostics(candidate).some(({ path, message }) => path.endsWith(".parentInstanceId") && message.includes("missing")));
  candidate.groups[1]!.instances[0]!.parentInstanceId = candidate.groups[1]!.instances[0]!.instanceId;
  assert.ok(encounterDocumentDiagnostics(candidate).some(({ path, message }) => path.endsWith(".parentInstanceId") && message.includes("itself")));
  candidate.modelVersion = "1.0.0";
  assert.ok(encounterDocumentDiagnostics(candidate).some(({ path }) => path === "$.modelVersion"));
});

test("standard coded, NV, and PN values are checked against the pinned NEMSIS model", () => {
  const coded = structuredClone(syntheticEncounter) as unknown as { groups: Array<Record<string, unknown>> };
  assert.doesNotThrow(() => loadEncounterDocument(coded));

  const invalidCode = structuredClone(coded) as typeof coded;
  const patientGroup = invalidCode.groups.find((group) => group.id === "ePatientSection") as { instances: Array<{ elements: Array<{ id: string; values: Array<{ code: string }> }> }> };
  patientGroup.instances[0]!.elements.find(({ id }) => id === "ePatient.25")!.values[0]!.code = "not-a-code";
  assert.ok(encounterDocumentDiagnostics(invalidCode).some(({ path, message }) => path.endsWith(".code") && message.includes("exhaustive value set")));

  const pertinentNegative = structuredClone(syntheticEncounter) as unknown as { groups: Array<Record<string, unknown>> };
  const nameGroup = pertinentNegative.groups.find(({ id }) => id === "ePatient.PatientNameGroup") as { instances: Array<{ elements: Array<{ values: unknown[] }> }> };
  nameGroup.instances[0]!.elements[0]!.values = [{ kind: "pertinent-negative", occurrenceId: "last-name-1", code: "8801019" }];
  assert.doesNotThrow(() => loadEncounterDocument(pertinentNegative));
});

test("compatible unknown extensions and custom content survive a pretty-printed round trip losslessly", () => {
  const candidate = structuredClone(syntheticEncounter) as unknown as Record<string, unknown>;
  candidate["net.partner.registry:transport"] = { revision: 7, flags: ["received", "verified"] };
  const groups = candidate.groups as Array<Record<string, unknown>>;
  groups.push({ id: "org.example.ems:stroke-assessment", instances: [{ instanceId: "stroke", elements: [{ id: "org.example.ems:stroke-score", values: [{ kind: "scalar", occurrenceId: "score", value: 7 }] }] }] });
  const customGroup = groups.at(-1)!;
  customGroup.partnerMetadata = { source: "field-device", sequence: 9 };
  const serialized = serializeEncounterDocument(loadEncounterDocument(candidate));
  assert.ok(serialized.includes("\n  \"groups\""));
  const restored = deserializeEncounterDocument(serialized);
  assert.deepEqual(restored, candidate);
});

test("loading reports actionable model, profile, group, element, and value paths", () => {
  const invalid = structuredClone(syntheticEncounter) as unknown as {
    dataModel: { version: string };
    formProfile: { version: string };
    groups: Array<{ id: string; instances: Array<{ elements: Array<{ id: string; values: Array<Record<string, unknown>> }> }> }>;
  };
  invalid.dataModel.version = "3.6.0";
  invalid.formProfile.version = "99";
  const responseIndex = invalid.groups.findIndex(({ id }) => id === "eResponseSection");
  invalid.groups[responseIndex]!.id = "eVitals.VitalGroup";
  invalid.groups[responseIndex]!.instances[0]!.elements[0]!.values[0] = { kind: "mystery", occurrenceId: "bad-value" };

  const diagnostics = encounterDocumentDiagnostics(invalid, { formProfiles: { "standard-encounter-v1": ["1"] } });
  assert.ok(diagnostics.some(({ path }) => path === "$.dataModel.version"));
  assert.ok(diagnostics.some(({ path }) => path === "$.formProfile.version"));
  assert.ok(diagnostics.some(({ path, message }) => path === `$.groups[${responseIndex}].instances[0].elements[0].id` && message.includes("does not belong")));
  assert.ok(diagnostics.some(({ path }) => path === `$.groups[${responseIndex}].instances[0].elements[0].values[0].kind`));
  assert.throws(
    () => loadEncounterDocument(invalid, { formProfiles: { "standard-encounter-v1": ["1"] } }),
    (error: unknown) => error instanceof EncounterDocumentError && error.message.includes(`$.groups[${responseIndex}].instances[0].elements[0].values[0].kind`),
  );
});

test("duplicate repeat identities and standard cardinality violations are rejected with local paths", () => {
  const invalid = withVitals() as unknown as {
    groups: Array<{ id: string; instances: Array<{ instanceId: string; elements: Array<{ values: Array<Record<string, unknown>> }> }> }>;
  };
  const vitals = invalid.groups.find(({ id }) => id === "eVitals.VitalGroup")!;
  vitals.instances[1]!.instanceId = vitals.instances[0]!.instanceId;
  vitals.instances[0]!.elements[0]!.values.push({ kind: "scalar", occurrenceId: "systolic-extra", value: 120 });
  const diagnostics = encounterDocumentDiagnostics(invalid);
  assert.ok(diagnostics.some(({ path, message }) => path.endsWith(".instances") && message.includes("duplicate instanceId")));
  assert.ok(diagnostics.some(({ path, message }) => path.endsWith(".values") && message.includes("at most 1 occurrence")));
});
