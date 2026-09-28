import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { NEMSIS_DATA_MODEL } from "../app/nemsis-data-model";
import customConfiguration from "../app/data/example-custom-elements.json";
import layout from "../app/data/stationary-layout-1.0.0.json";
import schema from "../app/data/stationary-layout.schema-1.0.0.json";
import { compileStationaryLayout, stationaryLayoutDiagnostics } from "../app/stationary-layout";

test("canonical stationary layout is schema-valid and covers the pinned catalog exactly once", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(layout), true, JSON.stringify(validate.errors));
  assert.equal(layout.elements.length, 453);
  assert.equal(layout.groups.length, 88);
  assert.deepEqual(new Set(layout.elements.map(({ id }) => id)), new Set(NEMSIS_DATA_MODEL.elements.map(({ id }) => id)));
  assert.deepEqual(new Set(layout.groups.map(({ id }) => id)), new Set(NEMSIS_DATA_MODEL.groups.map(({ id }) => id)));
  assert.equal(stationaryLayoutDiagnostics(layout).length, 0);
  assert.equal(compileStationaryLayout(layout).hierarchy[0]?.id, "EMSDataSet");
});

test("separates editable patient care, enhanced custom results, and read-only metadata", () => {
  const byId = new Map(layout.elements.map((element) => [element.id, element]));
  assert.equal(byId.get("ePatient.01")?.mode, "editable");
  assert.equal(byId.get("eCustomResults.01")?.mode, "enhanced");
  assert.equal(byId.get("dAgency.01")?.mode, "read-only");
  assert.equal(byId.get("eCustomConfiguration.01")?.mode, "read-only");
});

test("reports unknown, duplicate, missing, and invalid-ancestry placements by path", () => {
  const malformed = structuredClone(layout) as unknown as { groups: Array<Record<string, unknown>>; elements: Array<Record<string, unknown>> };
  malformed.elements[0]!.id = "eUnknown.99";
  malformed.elements[1]!.id = malformed.elements[2]!.id;
  malformed.elements[3]!.groupId = "ePatientSection";
  malformed.groups[4]!.parentId = "ePatientSection";
  const diagnostics = stationaryLayoutDiagnostics(malformed);
  assert.ok(diagnostics.some(({ path, message }) => path === "$.elements[0].id" && message.includes("unknown")));
  assert.ok(diagnostics.some(({ path, message }) => path.startsWith("$.elements[") && path.endsWith("].id") && message.includes("duplicates")));
  assert.ok(diagnostics.some(({ path, message }) => path === "$.elements" && message.includes("missing catalog element")));
  assert.ok(diagnostics.some(({ path, message }) => path === "$.elements[3].groupId" && message.includes("invalid group ancestry")));
  assert.ok(diagnostics.some(({ path, message }) => path === "$.groups[4].parentId" && message.includes("invalid group ancestry")));
});

test("rejects custom namespaces not backed by matching custom definitions", () => {
  const malformed = structuredClone(layout) as unknown as { customNamespaces: string[]; elements: Array<Record<string, unknown>> };
  malformed.customNamespaces.push("org.example.ems");
  malformed.elements.push({ id: "org.other:stroke-score", groupId: "eCustomResultsSection", mode: "enhanced" });
  const diagnostics = stationaryLayoutDiagnostics(malformed, [customConfiguration]);
  assert.ok(diagnostics.some(({ path, message }) => path.endsWith(".id") && message.includes("declared configured namespace")));
});

test("compiles configured custom identities beneath the enhanced custom-results hierarchy", () => {
  const extended = structuredClone(layout) as unknown as { customNamespaces: string[]; groups: Array<Record<string, unknown>>; elements: Array<Record<string, unknown>> };
  extended.customNamespaces.push("org.example.ems");
  extended.groups.push({ id: "org.example.ems:stroke-assessment", parentId: "eCustomResultsSection", mode: "enhanced", presentation: { kind: "table", label: "Stroke assessment", dialog: { addLabel: "Add stroke assessment", editLabel: "Edit stroke assessment" }, columns: [{ elementId: "org.example.ems:stroke-score" }] } });
  extended.elements.push({ id: "org.example.ems:stroke-score", groupId: "org.example.ems:stroke-assessment", mode: "enhanced", label: "Local stroke score" });
  assert.equal(stationaryLayoutDiagnostics(extended, [customConfiguration]).length, 0);
  assert.doesNotThrow(() => compileStationaryLayout(extended, [customConfiguration]));
});

test("rejects attempts to override catalog-owned datatype, cardinality, values, NV, and PN", () => {
  for (const property of ["datatype", "cardinality", "valueSet", "NV", "PN"] as const) {
    const malformed = structuredClone(layout) as unknown as { elements: Array<Record<string, unknown>> };
    malformed.elements[0]![property] = {};
    const diagnostics = stationaryLayoutDiagnostics(malformed);
    assert.ok(diagnostics.some(({ path, message }) => path === `$.elements[0].${property}` && message.includes("catalog-owned semantics")), property);
  }
});

test("standard table metadata leaves wording to the catalog and validates descendant columns", () => {
  const repeating = layout.groups.find(({ id }) => id === "eVitals.VitalGroup")!;
  assert.equal(repeating.presentation.kind, "table");
  assert.ok(!("label" in repeating.presentation));
  assert.ok(!("help" in repeating.presentation));
  assert.ok(!("dialog" in repeating.presentation));
  assert.ok(repeating.presentation.columns?.length);
  const malformed = structuredClone(layout) as unknown as { groups: Array<{ id: string; presentation: { columns?: Array<{ elementId: string }> } }> };
  malformed.groups.find(({ id }) => id === "eVitals.VitalGroup")!.presentation.columns = [{ elementId: "ePatient.01" }];
  assert.ok(stationaryLayoutDiagnostics(malformed).some(({ path, message }) => path.includes("columns[0]") && message.includes("not a descendant")));
});

test("regenerates byte-for-byte and detects catalog/profile drift", async () => {
  // @ts-expect-error The dependency-free generator is intentionally plain ESM.
  const { generateStationaryLayout } = await import("../scripts/generate-stationary-layout.mjs") as { generateStationaryLayout: () => Promise<string> };
  const path = fileURLToPath(new URL("../app/data/stationary-layout-1.0.0.json", import.meta.url));
  assert.equal(await generateStationaryLayout(), readFileSync(path, "utf8"));
  const stale = structuredClone(layout) as unknown as { elements: unknown[]; catalog: { elementCount: number } };
  stale.elements.pop();
  stale.catalog.elementCount -= 1;
  const diagnostics = stationaryLayoutDiagnostics(stale);
  assert.ok(diagnostics.some(({ path }) => path === "$.catalog.elementCount"));
  assert.ok(diagnostics.some(({ path, message }) => path === "$.elements" && message.includes("missing catalog element")));
});
