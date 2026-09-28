import assert from "node:assert/strict";
import test from "node:test";
import { configuredQuickActions } from "../app/encounter-definition";
import { compileEncounterFormProfile, EncounterFormProfileError, standardEncounterFormProfile } from "../app/encounter-form-profile";

test("compiles the neutral JSON form while preserving catalog-owned semantics", () => {
  const definition = compileEncounterFormProfile(structuredClone(standardEncounterFormProfile));
  const systolic = definition.events.vitals.fields[0]!;
  assert.equal(systolic.reference, "eVitals.06");
  assert.equal(systolic.required, true);
  assert.deepEqual(systolic.boundaries, { min: 0, max: 500, warningLow: 70, warningHigh: 220 });
  assert.ok(systolic.absenceStates.some(({ kind }) => kind === "NV"));
  assert.ok(definition.events.procedure.complicationOptions.length > 1);
  assert.equal(definition.events.procedure.attempts.max, 10);
  assert.deepEqual(configuredQuickActions(definition).map(({ id }) => id), ["vitals", "medication", "procedure", "note"]);
});

test("a test profile hides, removes, adds, and reorders supported elements", () => {
  const profile = structuredClone(standardEncounterFormProfile) as unknown as {
    sections: Array<{ id: string; visible: boolean; elements: string[] }>;
    summary: { vitalOrder: string[] };
  };
  const medication = profile.sections.find(({ id }) => id === "medication")!;
  const vitals = profile.sections.find(({ id }) => id === "vitals")!;
  medication.visible = false;
  vitals.elements = vitals.elements.filter((id) => id !== "eVitals.27");
  vitals.elements = ["eVitals.10", "eVitals.27", ...vitals.elements.filter((id) => id !== "eVitals.10")];
  profile.summary.vitalOrder = ["eVitals.10", "eVitals.27", ...profile.summary.vitalOrder.filter((id) => id !== "eVitals.10" && id !== "eVitals.27")];
  const definition = compileEncounterFormProfile(profile);

  assert.ok(!configuredQuickActions(definition).some(({ id }) => id === "medication"));
  assert.deepEqual(definition.events.vitals.fields.slice(0, 2).map(({ reference }) => reference), ["eVitals.10", "eVitals.27"]);
});

test("reports unknown elements, duplicate placements, illegal semantic overrides, and bad groups with JSON paths", () => {
  const profile = structuredClone(standardEncounterFormProfile) as unknown as Record<string, unknown>;
  const sections = profile.sections as Array<{ elements: string[] }>;
  sections[0]!.elements = ["eVitals.06", "eVitals.06", "acme:unknown"];
  profile.cardinality = { min: 0 };
  profile.labels = { "eVitals.06": "Override" };
  const review = profile.review as { groups: unknown[] };
  review.groups = [{ severity: "error", title: "Errors", empty: "None" }];

  assert.throws(() => compileEncounterFormProfile(profile), (error: unknown) => error instanceof EncounterFormProfileError
    && error.message.includes("$.cardinality: illegal override")
    && error.message.includes("$.labels: illegal override")
    && error.message.includes("$.sections[0].elements[1]: duplicate placement")
    && error.message.includes("$.sections[0].elements[2]: unknown standard or namespaced custom element")
    && error.message.includes("$.review.groups: must contain error and warning exactly once"));
});

test("rejects a patient-specific editor section", () => {
  const profile = structuredClone(standardEncounterFormProfile) as unknown as { sections: unknown[] };
  profile.sections.push({ id: "patient", visible: true, quickActionLabel: "Edit patient", elements: [] });
  assert.throws(() => compileEncounterFormProfile(profile), /unsupported section patient/);
});

test("rejects obsolete completed-summary event ordering while retaining vital summary order", () => {
  const profile = structuredClone(standardEncounterFormProfile) as unknown as {
    summary: { vitalOrder: string[]; sectionOrder?: string[] };
  };
  profile.summary.sectionOrder = ["vitals", "medication", "procedure", "note"];

  assert.throws(() => compileEncounterFormProfile(profile),
    /\$\.summary\.sectionOrder: unsupported completed-summary configuration/);
  delete profile.summary.sectionOrder;
  assert.doesNotThrow(() => compileEncounterFormProfile(profile));
});
