import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { adultChestPainDefinition } from "../app/adult-chest-pain-definition";
import { NEMSIS_DATA_MODEL, NEMSIS_ELEMENT_IDS, getNemsisDataElement, resolveNemsisElementValues } from "../app/nemsis-data-model";
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
    assert.match(element.datatype.xsdBase, /^xs:/);
    assert.ok(element.datatype.base);
    assert.ok(["scalar", "inline-enumerated", "bundled-list", "external-code-system"].includes(element.valueSource.kind));
    assert.ok(Array.isArray(element.permittedNotValues));
    assert.ok(Array.isArray(element.permittedPertinentNegatives));
    assert.ok(Number.isInteger(element.occurrence.min));
    assert.ok(element.occurrence.max === "unbounded" || Number.isInteger(element.occurrence.max));
  }
});

test("resolves source datatypes to form-usable bases and constraints", () => {
  const record = getNemsisDataElement("eRecord.01");
  assert.equal(record?.sourceDatatype, "PatientCareReportNumber");
  assert.deepEqual(record?.datatype, { base: "string", xsdBase: "xs:string", constraints: { minLength: 3, maxLength: 50 } });
  assert.deepEqual(getNemsisDataElement("eVitals.06")?.datatype, { base: "integer", xsdBase: "xs:integer", constraints: { minInclusive: 0, maxInclusive: 500 } });
  assert.equal(getNemsisDataElement("eProcedures.03")?.datatype.constraints.maxInclusive, "999999999999999999");
  assert.deepEqual(getNemsisDataElement("eHistory.08")?.occurrence, { min: 0, max: "unbounded" });
});

test("embeds every official inline enumeration and every permitted NV/PN choice", () => {
  assert.deepEqual(catalog.statistics, {
    inlineEnumerationElements: 205,
    inlineEnumerationValues: 2515,
    bundledLists: 10,
    bundledListValues: 1141,
    elementsWithNotValues: 193,
    notValues: 441,
    elementsWithPertinentNegatives: 63,
    pertinentNegatives: 118,
  });
  const gender = getNemsisDataElement("ePatient.13");
  assert.equal(gender?.valueSource.kind, "inline-enumerated");
  assert.deepEqual(gender?.permittedNotValues, [
    { code: "7701003", label: "Not Recorded" },
    { code: "7701001", label: "Not Applicable" },
  ]);
  const systolic = getNemsisDataElement("eVitals.06");
  assert.ok(systolic?.permittedPertinentNegatives.some((value) => value.code === "8801005" && value.label === "Exam Finding Not Present"));
});

test("pins all official defined and suggested lists without treating them as exhaustive", () => {
  assert.equal(catalog.bundledLists.length, 10);
  assert.equal(catalog.bundledLists.filter((list) => list.classification === "defined").length, 6);
  assert.equal(catalog.bundledLists.filter((list) => list.classification === "suggested").length, 4);
  assert.equal(catalog.bundledLists.reduce((total, list) => total + list.values.length, 0), 1141);
  for (const list of catalog.bundledLists) {
    assert.equal(list.exhaustive, false);
    assert.equal(list.valueCount, list.values.length);
    assert.ok(list.applicableElements.length && list.systems.length && list.values.length);
  }
  const medication = getNemsisDataElement("eMedications.03");
  assert.equal(medication?.valueSource.kind, "external-code-system");
  if (medication?.valueSource.kind !== "external-code-system") assert.fail("Medication should have an external value source");
  assert.equal(medication.valueSource.exhaustive, false);
  assert.deepEqual(medication.valueSource.bundledListIds, ["medications-given"]);
  assert.deepEqual(medication.valueSource.systems.map((system) => system.id), ["RxNorm", "SNOMED-CT"]);
  assert.equal(resolveNemsisElementValues(medication).permissibleValues.length, 70);
});

test("every field rendered by the app resolves entirely through the generated catalog", () => {
  const renderedElementIds = new Set(JSON.stringify(adultChestPainDefinition).match(/e[A-Za-z]+\.\d{2}/g) ?? []);
  assert.ok(renderedElementIds.size > 20);
  for (const id of renderedElementIds) {
    const element = getNemsisDataElement(id);
    assert.ok(element, `${id} is absent from the generated catalog`);
    assert.ok(element.datatype.base && element.datatype.xsdBase, `${id} has no resolved datatype`);
    const resolved = resolveNemsisElementValues(element);
    assert.ok(Array.isArray(resolved.permissibleValues), `${id} has no permissible-value resolution`);
    assert.ok(Array.isArray(resolved.notValues), `${id} has no NV resolution`);
    assert.ok(Array.isArray(resolved.pertinentNegatives), `${id} has no PN resolution`);
    if (element.valueSource.kind === "inline-enumerated") assert.ok(resolved.permissibleValues.length, `${id} lost its inline enumeration`);
    if ("bundledListIds" in element.valueSource && element.valueSource.bundledListIds.length) assert.ok(resolved.permissibleValues.length, `${id} lost its bundled list values`);
    if (element.valueSource.kind === "external-code-system") assert.ok(resolved.externalCodeSystems.length, `${id} has no external code-system identity`);
  }
});

test("records verifiable provenance for every pinned source", () => {
  assert.equal(catalog.provenance.release, "NEMSIS 3.5.1");
  assert.match(catalog.provenance.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(catalog.provenance.sources.length, 40);
  assert.equal(catalog.provenance.sources.filter((source) => source.role === "xsd").length, 28);
  assert.equal(catalog.provenance.sources.filter((source) => source.role === "defined-list").length, 6);
  assert.equal(catalog.provenance.sources.filter((source) => source.role === "suggested-list").length, 4);
  for (const source of catalog.provenance.sources) {
    assert.match(source.url, /^https:\/\/nemsis\.org\/media\/nemsis_v3\//);
    const bytes = readFileSync(new URL(source.path, dataRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  }
});

test("regenerates byte-for-byte deterministically without network access", async () => {
  // @ts-expect-error The dependency-free generator is intentionally plain ESM.
  const { generateCatalog } = await import("../scripts/generate-nemsis-data-model.mjs") as { generateCatalog: () => Promise<string> };
  assert.equal(await generateCatalog(), await generateCatalog());
  assert.equal(await generateCatalog(), readFileSync(catalogPath, "utf8"));
});

test("production loader reads only the bundled catalog", () => {
  assert.equal(NEMSIS_DATA_MODEL, catalog);
  const loader = readFileSync(fileURLToPath(new URL("../app/nemsis-data-model.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(loader, /fetch\s*\(|https?:\/\//);
});
