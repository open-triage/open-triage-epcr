import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogLocalizationSeed } from "../scripts/lib/catalog-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"));
const file = path.join(root, "defines/localization/sv/catalog_nemsis-3.5.1.json");
const emptyDomain = () => ({ elements: {}, groups: {}, lists: [], choices: [], specialChoices: [] });
const seed = (domain, content) => ({ schemaVersion: 2, catalogKey: "nemsis-3.5.1",
  domains: { [domain]: { ...emptyDomain(), ...content } } });
async function withSeed(value, run) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "catalog-localization-"));
  try { const target = path.join(folder, "seed.json"); await writeFile(target, JSON.stringify(value)); await run(target); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

test("shipped Swedish seed covers every catalog identity and preserves source and review status", async () => {
  const result = await readCatalogLocalizationSeed(file, "nemsis-3.5.1", catalog);
  assert.deepEqual(result.coverage.expected, { elements: 453, groups: 88, lists: 215,
    choices: 3656, specialChoices: 559 });
  assert.deepEqual(result.coverage.supplied, result.coverage.expected);
  assert.ok(Object.values(result.coverage.missing).every((entries) => entries.length === 0));
  assert.ok(result.coverage.reviewPending.length > 0);
  assert.equal(result.elementLocalization["eVitals.10"].sv.label, "Hjärtfrekvens");
  assert.equal(result.elementLocalization["eVitals.10"].sv.reviewedSource.label, "Heart Rate");
  assert.equal(result.codeListLocalization["inline:eProcedures.06"].values[""]["9923003"].sv.label, "Ja");
  assert.equal(result.codeListLocalization["inline:eMedications.06"].values[""]["3706021"].sv.reviewedSource.label, "Milligrams (mg)");
  assert.equal(result.specialChoiceLocalization["eVitals.10"]["not-value"]["7701003"].sv.label, "Ej registrerat");
  assert.match(result.seedSha256, /^[0-9a-f]{64}$/);
});

test("seed reports missing text separately from pending review", async () => {
  await withSeed(seed("eVitals", { elements: { "eVitals.10": { label: "Hjärtfrekvens",
    description: "Hjärtfrekvens per minut", reviewPending: "Granska klinisk term" } } }), async (target) => {
    const { coverage } = await readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog);
    assert.equal(coverage.supplied.elements, 1);
    assert.equal(coverage.missing.elements.length, 452);
    assert.deepEqual(coverage.reviewPending, [{ kind: "element", id: "eVitals.10", reason: "Granska klinisk term" }]);
  });
});

test("seed rejects malformed identities and parameters", async () => {
  await withSeed(seed("eVitals", { elements: { "unknown.01": { label: "Okänd", description: "Okänd" } } }),
    (target) => assert.rejects(readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog), /unknown.01/));
  await withSeed(seed("eVitals", { elements: { "eVitals.10": { label: "", description: "Beskrivning" } } }),
    (target) => assert.rejects(readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog), /Malformed catalog localization text/));
  await withSeed(seed("eVitals", { choices: [{ listId: "inline:eVitals.03", codeSystem: "", code: "unknown", label: "Okänd" }] }),
    (target) => assert.rejects(readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog), /Unknown catalog choice/));
  const choice = { listId: "inline:eProcedures.06", codeSystem: "", code: "9923003", label: "Ja" };
  await withSeed(seed("eProcedures", { choices: [choice, choice] }),
    (target) => assert.rejects(readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog), /Duplicate catalog localization choices/));
  await withSeed(seed("eProcedures", { choices: [{ ...choice, codeSystem: "SNOMED" }] }),
    (target) => assert.rejects(readCatalogLocalizationSeed(target, "nemsis-3.5.1", catalog), /Unknown catalog choice/));
});
