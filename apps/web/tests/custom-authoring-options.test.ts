import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogDraftDefinition } from "@open-triage/contracts";
import { customCorrelationOptions, customSpecialOptions } from "../app/custom-authoring-options";

const catalog = { schemaVersion: 1, sourceReleaseId: "pinned", hiddenElementIds: ["eHidden.01"],
  elements: [
    { elementId: "eVitals.01", storageSemantics: { groupPath: ["PatientCareReportGroup", "eVitals.VitalGroup"] } },
    { elementId: "eHidden.01", storageSemantics: { groupPath: ["PatientCareReportGroup", "eMedications.MedicationGroup"] } },
  ],
  codeLists: [{ listId: "inline:eCustomConfiguration.07", elementIds: ["eCustomConfiguration.07"], values: [
    { code: "7701001", label: "Not Applicable", enabled: true },
    { code: "7701003", label: "Not Recorded", enabled: false },
  ] }],
} as unknown as CatalogDraftDefinition;

test("correlation options reflect visible repeated groups in the draft", () => {
  const options = customCorrelationOptions(catalog);
  assert.ok(options.some((group) => group.id === "eVitals.VitalGroup"));
  assert.ok(!options.some((group) => group.id === "eMedications.MedicationGroup"));
  assert.ok(!options.some((group) => group.id === "PatientCareReportGroup"));
});

test("exceptional options use the draft's enabled labeled values", () => {
  assert.deepEqual(customSpecialOptions(catalog, "eCustomConfiguration.07").map((value) => value.label), ["Not Applicable"]);
});
