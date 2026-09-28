import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogLocalizationSeed } from "../scripts/lib/catalog-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"));
const file = path.join(root, "defines/localization/localization_sv.json");
async function withSeed(value, run) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "catalog-localization-"));
  try { const target = path.join(folder, "seed.json"); await writeFile(target, JSON.stringify(value)); await run(target); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

async function shippedSeed() { return JSON.parse(await readFile(file, "utf8")); }

test("one Swedish definition covers every identity in the current catalog", async () => {
  const result = await readCatalogLocalizationSeed(file, catalog);
  assert.deepEqual(result.coverage.expected, { elements: 453, groups: 88, lists: 215,
    choices: 3656, specialChoices: 559 });
  assert.deepEqual(result.coverage.supplied, result.coverage.expected);
  assert.deepEqual(result.coverage.available, result.coverage.expected);
  assert.ok(Object.values(result.coverage.missing).every((entries) => entries.length === 0));
  assert.equal(result.coverage.reviewPending.length, 0);
  assert.deepEqual(result.coverage.sourceChanges, []);
  const shipped = await shippedSeed();
  assert.deepEqual(Object.keys(shipped), ["schemaVersion", "language", "catalog", "validationRules"]);
  assert.equal(shipped.schemaVersion, 1);
  assert.equal(shipped.language, "sv");
  assert.equal(shipped.catalog.elements["eVitals.10"].sourceLabel, "Heart Rate");
  assert.equal(shipped.catalog.elements["eVitals.10"].sourceDescription, "The patient's heart rate expressed as a number per minute.");
  assert.equal(shipped.catalog.elements["eVitals.10"].label, "Hjärtfrekvens");
  assert.equal(shipped.catalog.groups.eVitalsSection.sourceName, "Vitals");
  assert.equal(shipped.catalog.groups.eVitalsSection.name, "Vitalparametrar");
  assert.equal(shipped.catalog.codeLists["inline:eMedications.06"].sourceName, "Medication Dosage Units");
  assert.equal(shipped.catalog.codeLists["inline:eMedications.06"].choices[""]["3706021"].sourceLabel, "Milligrams (mg)");
  assert.equal(shipped.catalog.codeLists["inline:eMedications.06"].choices[""]["3706021"].label, "Milligram (mg)");
  assert.equal(shipped.catalog.specialChoices["eVitals.10"]["not-value"]["7701003"].sourceLabel, "Not Recorded");
  assert.equal(shipped.catalog.specialChoices["eVitals.10"]["not-value"]["7701003"].label, "Ej registrerat");
  assert.equal(result.elementLocalization["eVitals.10"].sv.reviewedSource.label, "Heart Rate");
  assert.equal(result.codeListLocalization["inline:eMedications.06"].values[""]["3706021"].sv.reviewedSource.label, "Milligrams (mg)");
  assert.match(result.seedSha256, /^[0-9a-f]{64}$/);
});

test("entries for future catalogs coexist and are selected only by matching identities", async () => {
  const seed = await shippedSeed();
  seed.catalog.elements["future.01"] = { sourceLabel: "Future field", sourceDescription: "Future description",
    label: "Framtida fält", description: "Framtida beskrivning" };
  seed.catalog.groups.futureGroup = { sourceName: "Future group", name: "Framtida grupp" };
  seed.catalog.codeLists.futureList = { sourceName: "Future list", name: "Framtida lista", choices: { "urn:future": {
    F1: { sourceLabel: "Future choice", label: "Framtida val" },
  } } };
  seed.catalog.specialChoices["future.01"] = { "not-value": { F2: { sourceLabel: "Future special value", label: "Framtida specialvärde" } } };
  await withSeed(seed, async (target) => {
    const result = await readCatalogLocalizationSeed(target, catalog);
    assert.deepEqual(result.coverage.supplied, result.coverage.expected);
    assert.deepEqual(result.coverage.available, { elements: 454, groups: 89, lists: 216,
      choices: 3657, specialChoices: 560 });
    assert.equal(result.elementLocalization["future.01"], undefined);
  });
});

test("a future catalog reuses matching IDs while reporting changed source text", async () => {
  const changedCatalog = structuredClone(catalog);
  const heartRate = changedCatalog.elements.find(({ id }) => id === "eVitals.10");
  heartRate.name = "Pulse rate";
  heartRate.definition = "The current catalog description.";
  const result = await readCatalogLocalizationSeed(file, changedCatalog);
  assert.equal(result.elementLocalization["eVitals.10"].sv.label, "Hjärtfrekvens");
  assert.deepEqual(result.elementLocalization["eVitals.10"].sv.reviewedSource, {
    label: "Heart Rate", description: "The patient's heart rate expressed as a number per minute.",
  });
  assert.deepEqual(result.coverage.sourceChanges, [{
    kind: "element", id: "eVitals.10", changedFields: ["sourceLabel", "sourceDescription"],
  }]);
});

test("coverage reports current-catalog omissions separately from review markers", async () => {
  const seed = await shippedSeed();
  delete seed.catalog.elements["eVitals.10"];
  seed.catalog.elements["eVitals.14"].reviewPending = "Granska klinisk term";
  await withSeed(seed, async (target) => {
    const { coverage } = await readCatalogLocalizationSeed(target, catalog);
    assert.deepEqual(coverage.missing.elements, ["eVitals.10"]);
    assert.deepEqual(coverage.reviewPending, [{ kind: "element", id: "eVitals.14", reason: "Granska klinisk term" }]);
  });
});

test("the language-level definition rejects malformed localized values", async () => {
  const seed = await shippedSeed();
  delete seed.catalog.elements["eVitals.10"].sourceLabel;
  await withSeed(seed, (target) => assert.rejects(readCatalogLocalizationSeed(target, catalog),
    /Malformed catalog localization text eVitals\.10/));
  const malformedChoice = await shippedSeed();
  malformedChoice.catalog.codeLists["inline:eProcedures.06"].choices[""]["9923003"].extra = true;
  await withSeed(malformedChoice, (target) => assert.rejects(readCatalogLocalizationSeed(target, catalog),
    /Malformed catalog localization text/));
});
