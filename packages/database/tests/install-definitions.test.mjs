import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";

const definition = async (type, key) => JSON.parse(await readFile(
  new URL(`../../../defines/${type}/${key}.json`, import.meta.url), "utf8"));
const definitionsRoot = fileURLToPath(new URL("../../../defines", import.meta.url));

test("installation definitions provide one full default and a standalone Sweden form", async () => {
  const [catalog, fullForm, fullValidation, swedenForm] = await Promise.all([
    definition("catalog", "catalog_nemsis-3.5.1"), definition("forms", "form_nemsis-full"),
    definition("validation", "validation_nemsis-full"), definition("forms", "form_sweden"),
  ]);
  const catalogIds = new Set(catalog.elements.map(({ id }) => id));
  assert.equal(catalogIds.size, 453);
  assert.equal(fullForm.default, true);
  assert.equal(swedenForm.default, undefined);
  assert.equal(fullForm.catalogKey, "nemsis-3.5.1");
  assert.equal(swedenForm.catalogKey, fullForm.catalogKey);
  assert.equal(fullValidation.catalogKey, fullForm.catalogKey);
  assert.equal(fullValidation.formKey, fullForm.key);
  for (const form of [fullForm, swedenForm]) {
    const fields = form.definition.sections.flatMap(({ fields }) => fields);
    const formIds = new Set(fields.map(({ source }) => source?.elementId));
    assert.equal(formIds.size, fields.length);
    assert.ok([...formIds].every((id) => catalogIds.has(id)));
  }
  assert.ok(fullValidation.rules.every(({ primaryTargetElementId }) =>
    primaryTargetElementId === "*" || catalogIds.has(primaryTargetElementId)));
  assert.equal(fullForm.definition.sections.flatMap(({ fields }) => fields).length, 453);
  assert.equal(fullValidation.schemaVersion, 2);
  assert.equal(fullValidation.rules.length, 712);
  assert.equal(fullValidation.metrics.length, 6);
  assert.equal(fullValidation.rules.filter(({ enabled, primaryTargetElementId, source }) => enabled
    && (/^d[A-Za-z]+\./.test(primaryTargetElementId) || /"d[A-Za-z]+\./.test(source))).length, 0);
  assert.equal(swedenForm.definition.sections.flatMap(({ fields }) => fields).length, 215);
  const definitions = await readInstallDefinitions(definitionsRoot);
  assert.deepEqual(definitions.pairs.map(({ key }) => key), ["nemsis-full"]);
  assert.equal(definitions.defaultPair.key, fullForm.key);
});

test("installation discovery still requires validation for the default form", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "install-definitions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(["catalog", "forms", "validation"].map((directory) => mkdir(path.join(root, directory))));
  await Promise.all(["catalog/catalog_nemsis-3.5.1.json", "forms/form_nemsis-full.json"].map((file) =>
    cp(path.join(definitionsRoot, file), path.join(root, file))));
  await assert.rejects(readInstallDefinitions(root), {
    code: "ENOENT", path: path.join(root, "validation", "validation_nemsis-full.json"),
  });
});

test("fresh install definitions leave all wording to the catalog", async () => {
  const localization = await definition("localization", "localization_sv");
  assert.equal(localization.catalog.groups.eResponseSection.name, "Uppdrag");
  assert.equal(localization.catalog.elements["eVitals.14"].label, "Andningsfrekvens");
  assert.equal(Object.hasOwn(localization, "formPresentation"), false);
  for (const key of ["form_nemsis-full", "form_sweden"]) {
    const form = (await definition("forms", key)).definition;
    assert.equal(Object.hasOwn(form, "locales"), false);
    assert.ok(form.sections.every((section) => !Object.hasOwn(section, "presentation")));
    assert.ok(form.sections.flatMap(({ fields }) => fields).every((field) => !Object.hasOwn(field, "configuration")));
  }
});
