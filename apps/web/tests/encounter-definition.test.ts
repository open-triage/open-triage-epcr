import assert from "node:assert/strict";
import test from "node:test";
import { adultChestPainDefinition } from "../app/adult-chest-pain-definition";
import { createBundledDefinitionProvider, EncounterDefinitionError, validateEncounterDefinition } from "../app/encounter-definition";

test("validates and serves the bundled versioned encounter definition", () => {
  const provider = createBundledDefinitionProvider([adultChestPainDefinition]);
  const definition = provider.get("adult-chest-pain-v2");

  assert.equal(definition.schemaVersion, 1);
  assert.equal(definition.version, 1);
  assert.equal(definition.patient.initial.name, "Lindqvist, Margareta");
  assert.equal(definition.dispatch.incident.complaint, "Central chest pain radiating to left arm");
  assert.equal(definition.patient.references.name, "ePatient.02");
  assert.equal(definition.dispatch.references.complaint, "eDispatch.01");
  assert.equal(definition.events.note.quickAction.visible, true);
  assert.equal(definition.events.note.quickAction.label, "Add clinical note");
  assert.equal(definition.events.note.required.summary, true);
  assert.equal(definition.events.note.references.summary, "eNarrative.01");
  assert.equal(definition.events.medication.terminology.catalog, "nemsis-3.5.1-medications");
  assert.deepEqual(definition.events.medication.fields.map((field) => field.id), ["medication", "time", "dose", "unit", "route", "response"]);
});

test("rejects incomplete medication configuration before the interface can consume it", () => {
  const invalid = structuredClone(adultChestPainDefinition) as unknown as Record<string, unknown>;
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

test("rejects an incomplete note event definition with actionable diagnostics", () => {
  const invalid = structuredClone(adultChestPainDefinition) as unknown as Record<string, unknown>;
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
  const invalid = structuredClone(adultChestPainDefinition) as unknown as Record<string, unknown>;
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
  const provider = createBundledDefinitionProvider([adultChestPainDefinition]);
  assert.throws(() => provider.get("missing"), /Invalid encounter definition "missing": definition was not found/);
});
