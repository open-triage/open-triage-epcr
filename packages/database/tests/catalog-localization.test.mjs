import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogLocalizationSeed } from "../scripts/lib/catalog-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("Swedish installation seed binds to a stable element and retains English review source", async () => {
  const catalog = JSON.parse(await readFile(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"));
  const result = await readCatalogLocalizationSeed(path.join(root, "defines/localization/sv/catalog_nemsis-3.5.1.json"), "nemsis-3.5.1", catalog);
  assert.equal(result.elementLocalization["eVitals.10"].sv.label, "Hjärtfrekvens");
  assert.equal(result.elementLocalization["eVitals.10"].sv.reviewedSource.label, "Heart Rate");
  assert.match(result.seedSha256, /^[0-9a-f]{64}$/);
});

test("installation seed rejects unknown element identities", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "catalog-localization-"));
  try {
    const file = path.join(folder, "seed.json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, catalogKey: "nemsis-3.5.1",
      elements: { "unknown.01": { label: "Okänd" } } }));
    await assert.rejects(readCatalogLocalizationSeed(file, "nemsis-3.5.1", { elements: [] }), /unknown.01/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("seed choices bind list, code system, code and reject duplicate or unknown identities", async () => {
  const catalog = JSON.parse(await readFile(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"));
  const installed = await readCatalogLocalizationSeed(path.join(root, "defines/localization/sv/catalog_nemsis-3.5.1.json"), "nemsis-3.5.1", catalog);
  assert.equal(installed.codeListLocalization["inline:eProcedures.06"].values["\u00009923003"].sv.label, "Ja");
  assert.equal(installed.codeListLocalization["inline:eMedications.06"].values["\u00003706021"].sv.reviewedSource.label, "Milligrams (mg)");
  assert.equal(installed.specialChoiceLocalization["eVitals.10"]["not-value\u00007701003"].sv.label, "Ej registrerat");
  const folder = await mkdtemp(path.join(os.tmpdir(), "catalog-choice-seed-"));
  try {
    const file = path.join(folder, "seed.json");
    const base = { schemaVersion: 1, catalogKey: "nemsis-3.5.1", elements: {} };
    await writeFile(file, JSON.stringify({ ...base, choices: [{ listId: "inline:eProcedures.06", codeSystem: "", code: "unknown", label: "Okänd" }] }));
    await assert.rejects(readCatalogLocalizationSeed(file, "nemsis-3.5.1", catalog), /Unknown or duplicate choice/);
    const choice = { listId: "inline:eProcedures.06", codeSystem: "", code: "9923003", label: "Ja" };
    await writeFile(file, JSON.stringify({ ...base, choices: [choice, choice] }));
    await assert.rejects(readCatalogLocalizationSeed(file, "nemsis-3.5.1", catalog), /Unknown or duplicate choice/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
