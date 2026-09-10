import assert from "node:assert/strict";
import test from "node:test";
import exampleConfiguration from "../app/data/example-custom-elements.json";
import {
  CustomConfigurationError,
  createElementCatalog,
  customConfigurationDiagnostics,
  resolveConfiguredElementForm,
  validateCustomConfiguration,
  type CustomDataSet,
} from "../app/custom-data-elements";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { INITIAL_SHELL_STATE, type ShellState } from "../app/standard-encounter";

function storage(): LocalStoragePort & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

test("the documented JSON custom contract validates all NEMSIS custom configuration metadata", () => {
  const configuration = validateCustomConfiguration(exampleConfiguration);
  assert.equal(configuration.elements[0]?.title, "Local stroke score");
  assert.equal(configuration.elements[0]?.definition, "Locally configured prehospital stroke assessment score.");
  assert.equal(configuration.elements[0]?.datatype, "number");
  assert.equal(configuration.elements[0]?.recurrence, "multiple");
  assert.equal(configuration.elements[0]?.usage, "Recommended");
  assert.deepEqual(configuration.elements[0]?.potentialValues, []);
  assert.deepEqual(configuration.elements[0]?.permittedNV, ["7701003"]);
  assert.deepEqual(configuration.elements[0]?.permittedPN, []);
  assert.equal(configuration.elements[0]?.groupId, "org.example.ems:stroke-assessment");
});

test("custom identifiers cannot collide with or masquerade as standard NEMSIS identifiers", () => {
  const invalid = structuredClone(exampleConfiguration) as unknown as { elements: Array<{ id: string }> };
  invalid.elements[0]!.id = "eVitals.06";
  const diagnostics = customConfigurationDiagnostics(invalid);
  assert.ok(diagnostics.some(({ path, message }) => path === "$.elements[0].id" && message.includes("namespaced")));
  assert.throws(() => validateCustomConfiguration(invalid), CustomConfigurationError);
});

test("validation reports datatype, constraint, coded-value, and group errors with paths", () => {
  const invalid = structuredClone(exampleConfiguration) as unknown as { elements: Array<Record<string, unknown>> };
  Object.assign(invalid.elements[0]!, {
    datatype: "temperature",
    constraints: { minLength: 8, maxLength: 2, minimum: 10, maximum: 1, secret: true },
    potentialValues: [{ code: "same", label: "First" }, { code: "same", label: "Second" }],
    permittedNV: ["not-a-nemsis-code"],
    groupId: "org.example.ems:missing-group",
  });
  let message = "";
  try { validateCustomConfiguration(invalid); } catch (error) { assert.ok(error instanceof CustomConfigurationError); message = error.message; }
  assert.ok(message);
  assert.match(message, /\$\.elements\[0\]\.datatype/);
  assert.match(message, /minLength must not exceed maxLength/);
  assert.match(message, /duplicate code same/);
  assert.match(message, /not permitted by the NEMSIS 3\.5\.1 catalog/);
  assert.match(message, /must reference a configured group/);
});

test("one catalog queries standard and deployment-owned elements with explicit provenance", () => {
  const catalog = createElementCatalog(exampleConfiguration);
  const standard = catalog.require("eVitals.06");
  const custom = catalog.require("org.example.ems:stroke-score");
  assert.deepEqual({ provenance: standard.provenance, owner: standard.owner }, { provenance: "standard", owner: "NEMSIS" });
  assert.deepEqual({ provenance: custom.provenance, owner: custom.owner }, { provenance: "custom", owner: "Example County EMS" });
  assert.equal(catalog.resolveValues("org.example.ems:stroke-score").notValues[0]?.code, "7701003");
});

test("a test form selects a new custom element through JSON configuration only", () => {
  const deployment = structuredClone(exampleConfiguration) as unknown as { namespace: string; owner: string; elements: Array<Record<string, unknown>>; groups: unknown[]; $schema: string; schemaVersion: string };
  deployment.elements.push({
    id: "org.example.ems:destination-notes", title: "Destination notes", definition: "Local notes for the receiving facility.", datatype: "string",
    recurrence: "single", usage: "Optional", constraints: { maxLength: 500 }, potentialValues: [], permittedNV: [], permittedPN: [],
  });
  const fields = resolveConfiguredElementForm(createElementCatalog(deployment), { id: "handoff", fields: ["eDisposition.21", "org.example.ems:destination-notes"] });
  assert.deepEqual(fields.map(({ provenance }) => provenance), ["standard", "custom"]);
  assert.equal(fields[1]?.element.id, "org.example.ems:destination-notes");
});

test("persisted custom data survives application save and recovery without interpretation", () => {
  const customData: CustomDataSet = {
    formatExtension: { vendor: 2 },
    results: [{ elementId: "net.partner.registry:unknown-score", correlationId: "assessment-1", partnerMetadata: { revision: 7 }, values: [{ value: "4", units: "points" }] }],
  };
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, customData } } as ShellState;
  const local = storage(); saveShellState(local, state);
  const restored = loadShellState(local)!;
  assert.deepEqual(restored.encounter.customData, customData);
});
