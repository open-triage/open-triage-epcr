import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import synthetic from "../app/data/synthetic-encounter-document.json";
import customConfiguration from "../app/data/example-custom-elements.json";
import { createElementCatalog, resolveConfiguredElementForm, validateCustomDataSet } from "../app/custom-data-elements";
import { loadEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { compileEncounterFormProfile, standardEncounterFormProfile } from "../app/encounter-form-profile";
import { loadShellState, saveShellState } from "../app/local-persistence";
import { exportNemsisXml, importNemsisXml } from "../app/nemsis-interchange";
import { INITIAL_SHELL_STATE, type ShellState } from "../app/standard-encounter";

test("a standard field traces from profile through catalog, canonical JSON, and XML", () => {
  const profileField = standardEncounterFormProfile.sections.find(({ id }) => id === "vitals")!.elements[0]!;
  assert.equal(createElementCatalog().require(profileField).element.id, profileField);
  const document = loadEncounterDocument(synthetic);
  const occurrence = document.groups.flatMap(({ instances }) => instances).flatMap(({ elements }) => elements).find(({ id }) => id === profileField);
  assert.equal(occurrence?.id, profileField);
  assert.ok(serializeEncounterDocument(document).includes(`"id": "${profileField}"`));
  assert.ok(exportNemsisXml(document).includes(`<${profileField}`));
});

test("a configuration-only custom field completes the canonical and interchange journey", () => {
  const catalog = createElementCatalog(customConfiguration);
  const [configured] = resolveConfiguredElementForm(catalog, { id: "test-stroke", fields: ["org.example.ems:stroke-score"] });
  assert.equal(configured?.provenance, "custom");
  if (!configured || configured.provenance !== "custom") throw new Error("custom configuration did not resolve");
  const captured = validateCustomDataSet(catalog, { results: [{ elementId: configured!.element.id, correlationId: "stroke-1", values: [{ value: "7" }] }] });
  const candidate = structuredClone(synthetic) as any;
  candidate.groups.find(({ id }: { id: string }) => id === "org.example.ems:stroke-assessment").instances = [{ instanceId: "stroke-1", elements: [{ id: configured.element.id, values: [{ kind: "scalar", occurrenceId: "score-1", value: 7 }] }] }];
  const document = loadEncounterDocument(candidate);
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document, customData: captured } } as ShellState;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  saveShellState(storage, state);
  assert.equal(loadShellState(storage)!.encounter.customData?.results[0]?.values[0]?.value, "7");
  const reviewAndSummary = `${configured!.element.title}: ${captured.results[0]!.values[0]!.value}`;
  assert.equal(reviewAndSummary, "Local stroke score: 7");
  assert.match(serializeEncounterDocument(document), /org\.example\.ems:stroke-score/);
  const xml = exportNemsisXml(document);
  assert.match(xml, /<eCustomResults\.02>org\.example\.ems:stroke-score<\/eCustomResults\.02>/);
  assert.deepEqual(importNemsisXml(xml), document);
});

test("production entry points use only the pinned catalog and neutral standard profile", async () => {
  const [profileSource, customSource] = await Promise.all([
    readFile(new URL("../app/encounter-form-profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/custom-data-elements.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profileSource, /standard-encounter-form\.json/);
  assert.doesNotMatch(profileSource, /example-custom-elements/);
  assert.doesNotMatch(customSource, /example-custom-elements/);
  assert.doesNotThrow(() => compileEncounterFormProfile(standardEncounterFormProfile));
});
