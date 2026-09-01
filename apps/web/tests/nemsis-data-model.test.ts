import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { NEMSIS_DATA_MODEL, NEMSIS_ELEMENT_IDS, getNemsisDataElement } from "../app/nemsis-data-model";
import catalog from "../app/data/nemsis-data-model-3.5.1.json";

const catalogPath = fileURLToPath(new URL("../app/data/nemsis-data-model-3.5.1.json", import.meta.url));
const dataRoot = new URL("../app/data/", import.meta.url);

test("contains the complete official EMSDataSet element universe", () => {
  assert.equal(catalog.dataset, "EMSDataSet");
  assert.equal(catalog.release, "3.5.1");
  assert.equal(catalog.elementCount, 453);
  assert.equal(catalog.elements.length, 453);
  assert.equal(NEMSIS_ELEMENT_IDS.size, 453);
  assert.deepEqual(catalog.elements.map((element) => element.id), [...catalog.elements.map((element) => element.id)].sort((left, right) => {
    const [leftSection = "", leftNumber = ""] = left.split(".");
    const [rightSection = "", rightNumber = ""] = right.split(".");
    return leftSection === rightSection ? Number(leftNumber) - Number(rightNumber) : leftSection < rightSection ? -1 : 1;
  }));
  for (const element of catalog.elements) {
    assert.ok(element.id && element.name && element.definition && element.sourceDatatype);
    assert.match(element.usage, /^(Mandatory|Required|Recommended|Optional)$/);
    assert.ok(Number.isInteger(element.occurrence.min));
    assert.ok(element.occurrence.max === "unbounded" || Number.isInteger(element.occurrence.max));
  }
});

test("preserves representative designation, datatype, and occurrence metadata", () => {
  assert.deepEqual(getNemsisDataElement("eRecord.01"), {
    id: "eRecord.01", section: "eRecord", name: "Patient Care Report Number",
    definition: "The unique number automatically assigned by the EMS agency for each Patient Care Report (PCR). This should be a unique number for the EMS agency for all of time.",
    national: true, state: true, usage: "Mandatory", sourceDatatype: "PatientCareReportNumber",
    occurrence: { min: 1, max: 1 },
  });
  assert.deepEqual(getNemsisDataElement("eHistory.08")?.occurrence, { min: 0, max: "unbounded" });
  assert.equal(getNemsisDataElement("ePatient.13")?.name, "Gender (DEPRECATED)");
});

test("records verifiable provenance for every pinned source", () => {
  assert.equal(catalog.provenance.release, "NEMSIS 3.5.1");
  assert.match(catalog.provenance.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(catalog.provenance.sources.length, 29);
  for (const source of catalog.provenance.sources) {
    assert.match(source.url, /^https:\/\/nemsis\.org\/media\/nemsis_v3\/release-3\.5\.1\//);
    const bytes = readFileSync(new URL(source.path, dataRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  }
});

test("regenerates byte-for-byte deterministically without network access", async () => {
  // @ts-expect-error The dependency-free generator is intentionally plain ESM.
  const { generateCatalog } = await import("../scripts/generate-nemsis-data-model.mjs") as { generateCatalog: () => Promise<string> };
  const first = await generateCatalog();
  const second = await generateCatalog();
  assert.equal(first, second);
  assert.equal(first, readFileSync(catalogPath, "utf8"));
});

test("production loader reads the bundled catalog", () => {
  assert.equal(NEMSIS_DATA_MODEL, catalog);
  const loader = readFileSync(fileURLToPath(new URL("../app/nemsis-data-model.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(loader, /fetch\s*\(|https?:\/\//);
});
