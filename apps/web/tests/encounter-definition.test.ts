import assert from "node:assert/strict";
import test from "node:test";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { createBundledDefinitionProvider, EncounterDefinitionError, validateEncounterDefinition } from "../app/encounter-definition";

test("validates and serves the bundled versioned encounter definition", () => {
  const provider = createBundledDefinitionProvider([standardEncounterDefinition]);
  const definition = provider.get("standard-encounter-v1");

  assert.equal(definition.schemaVersion, 1);
  assert.equal(definition.version, 1);
  assert.equal(definition.patient.initial.name, "Rivera, Jordan");
  assert.equal(definition.dispatch.incident.complaint, "Medical assistance requested");
  assert.equal(definition.patient.references.name, "ePatient.02");
  assert.equal(definition.dispatch.references.complaint, "eDispatch.01");
  assert.equal(definition.events.note.quickAction.visible, true);
  assert.equal(definition.events.note.quickAction.label, "Add clinical note");
  assert.equal(definition.events.note.required.summary, true);
  assert.equal(definition.events.note.references.summary, "eNarrative.01");
  assert.deepEqual(definition.events.procedure.fieldOrder, ["procedure", "time", "attempts", "success", "outcome", "complications"]);
  assert.equal(definition.events.procedure.terminology.catalog, "nemsis-procedures-3.5.1");
  assert.equal(definition.events.procedure.references.procedure, "eProcedures.03");
  assert.equal(definition.events.medication.terminology.catalog, "nemsis-3.5.1-medications");
  assert.deepEqual(definition.events.medication.fields.map((field) => field.id), ["medication", "time", "dose", "unit", "route", "response"]);
  assert.deepEqual(definition.events.vitals.fields.slice(0, 3).map(({ id }) => id), ["systolic", "diastolic", "heartRate"]);
  assert.equal(definition.events.vitals.fields[0]?.unit, "mmHg");
  assert.equal(definition.events.vitals.fields[0]?.reference, "eVitals.06");
});

test("rejects an incomplete procedure event definition with actionable diagnostics", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as { events: { procedure: Record<string, unknown> } };
  invalid.events.procedure.fieldOrder = ["procedure", "procedure"];
  invalid.events.procedure.required = { procedure: true };
  assert.throws(() => validateEncounterDefinition(invalid), (error: unknown) => error instanceof EncounterDefinitionError
    && error.message.includes("events.procedure.fieldOrder must contain every procedure field exactly once")
    && error.message.includes("events.procedure.required.time must be a boolean"));
});

test("rejects incomplete medication configuration before the interface can consume it", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as Record<string, unknown>;
  const events = invalid.events as Record<string, unknown>;
  events.medication = { quickAction: { visible: true, label: "Add treatment" }, terminology: { catalog: "remote" }, fields: [], doseUnits: [], routes: [] };

  assert.throws(
    () => validateEncounterDefinition(invalid),
    (error: unknown) => error instanceof EncounterDefinitionError
      && error.message.includes("events.medication.terminology.catalog must be nemsis-3.5.1-medications")
      && error.message.includes("events.medication.fields must include medication")
      && error.message.includes("events.medication.doseUnits must contain strings")
      && error.message.includes("events.medication.validationMessages must be an object"),
  );
});

test("rejects invalid vital configuration with actionable diagnostics", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as Record<string, unknown>;
  const events = (invalid.events as { vitals: { fields: Array<Record<string, unknown>>; summary: Array<Record<string, unknown>> } });
  events.vitals.fields[0]!.required = "yes";
  events.vitals.fields[0]!.boundaries = { min: 500, max: 0, warningLow: 70, warningHigh: 220 };
  events.vitals.summary[0]!.fields = ["missing"];

  assert.throws(
    () => validateEncounterDefinition(invalid),
    (error: unknown) => error instanceof EncounterDefinitionError
      && error.message.includes("events.vitals.fields[0].required must be a boolean")
      && error.message.includes("events.vitals.fields[0].boundaries.min must not exceed max")
      && error.message.includes("events.vitals.summary[0].fields contains an unconfigured field"),
  );
});

test("rejects an incomplete note event definition with actionable diagnostics", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as Record<string, unknown>;
  invalid.events = { note: { quickAction: { visible: "yes" }, required: { time: true } } };

  assert.throws(
    () => validateEncounterDefinition(invalid),
    (error: unknown) => error instanceof EncounterDefinitionError
      && error.message.includes("events.note.quickAction.visible must be a boolean")
      && error.message.includes("events.note.labels must be an object")
      && error.message.includes("events.note.required.summary must be a boolean")
      && error.message.includes("events.note.references must be an object"),
  );
});

test("rejects an invalid definition with actionable field diagnostics", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as Record<string, unknown>;
  invalid.version = 0;
  invalid.dispatch = { crew: "", events: [] };

  assert.throws(
    () => validateEncounterDefinition(invalid),
    (error: unknown) => error instanceof EncounterDefinitionError
      && error.message.includes("version must be a positive integer")
      && error.message.includes("dispatch.crew is required")
      && error.message.includes("dispatch.incident must be an object")
      && error.message.includes("dispatch.events must contain at least one event"),
  );
});

test("reports a missing definition instead of returning partial configuration", () => {
  const provider = createBundledDefinitionProvider([standardEncounterDefinition]);
  assert.throws(() => provider.get("missing"), /Invalid encounter definition "missing": definition was not found/);
});

test("rejects unsupported configuration constructs with their exact path", () => {
  const invalid = structuredClone(standardEncounterDefinition) as unknown as { events: { note: Record<string, unknown>; vitals: { fields: Array<Record<string, unknown>> } } };
  invalid.events.note.displayWhen = { dispatchReason: "medical assistance" };
  invalid.events.vitals.fields[0]!.computedValue = "systolic - diastolic";

  assert.throws(
    () => validateEncounterDefinition(invalid),
    (error: unknown) => error instanceof EncounterDefinitionError
      && error.message.includes("events.note.displayWhen is not supported by schemaVersion 1")
      && error.message.includes("events.vitals.fields[0].computedValue is not supported by schemaVersion 1"),
  );
});

test("rejects duplicate bundled definition identities", () => {
  assert.throws(
    () => createBundledDefinitionProvider([standardEncounterDefinition, structuredClone(standardEncounterDefinition)]),
    /bundled definition id must be unique/,
  );
});
