import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url), "utf8"));
const form = JSON.parse(await readFile(new URL("../../../defines/forms/form_sweden.json", import.meta.url), "utf8"));
const validation = JSON.parse(await readFile(new URL("../../../defines/validation/validation_nemsis-full.json", import.meta.url), "utf8"));
const script = await readFile(new URL("../scripts/seed-install-definitions.mjs", import.meta.url), "utf8");
const migrate = await readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("Sweden remains a NEMSIS-compatible form without payment fields", () => {
  assert.equal(form.schemaVersion, 1);
  assert.equal(form.key, "sweden");
  assert.equal(form.catalogKey, "nemsis-3.5.1");
  assert.equal(validation.catalogKey, form.catalogKey);
  assert.equal(catalog.release, "3.5.1");
  const catalogIds = new Set(catalog.elements.map(({ id }) => id));
  assert.ok([...catalogIds].some((id) => id.startsWith("ePayment.")));
  const fields = form.definition.sections.flatMap((section) => section.fields);
  const fieldIds = new Set(fields.map((field) => field.source?.elementId).filter(Boolean));
  assert.equal(catalog.groups.find(({ id }) => id === "eResponseSection")?.name, "Response");
  assert.ok(form.definition.sections.every((section) => !Object.hasOwn(section, "presentation")));
  assert.ok(fields.every((field) => !Object.hasOwn(field, "configuration")));
  assert.equal(Object.hasOwn(form.definition, "locales"), false);
  assert.equal(fields.length, 215);
  assert.equal(fieldIds.size, 215);
  assert.ok(fields.every((field) => field.source?.kind === "nemsis" && !field.source.elementId.startsWith("ePayment.")));
  assert.ok([...fieldIds].every((id) => catalogIds.has(id)));
});

test("the full NEMSIS validation retains catalog references and imported rule wording", () => {
  const catalogIds = new Set(catalog.elements.map(({ id }) => id));
  assert.equal(validation.key, "nemsis-full");
  assert.equal(validation.rules.length, 712);
  for (const rule of validation.rules) {
    assert.ok(rule.primaryTargetElementId === "*" || catalogIds.has(rule.primaryTargetElementId),
      `${rule.name} targets an absent catalog element`);
    for (const reference of rule.source.matchAll(/"([de][A-Za-z]+\.\d+)"/g)) {
      assert.ok(catalogIds.has(reference[1]), `${rule.name} references absent ${reference[1]}`);
    }
  }
  for (const id of ["eMedications.05", "eMedications.06"]) {
    const minimum = validation.rules.find((rule) => rule.primaryTargetElementId === id && rule.source.includes("minimum("));
    assert.match(minimum?.source ?? "", /^for each\("eMedications\.MedicationGroup"\)/);
  }
  const multiplePatients = validation.rules.find((rule) => rule.provenance?.some(({ sourceIdentity }) => sourceIdentity === "nemSch_e068"));
  assert.match(multiplePatients?.source ?? "", /^when not\(undocumented\("eScene\.06"\)\)\nrequire any\(/);
  assert.equal(multiplePatients?.message,
    'Number of Patients at Scene should be "Multiple" when Mass Casualty Incident is "Yes".');
  assert.equal(validation.rules.filter((rule) => rule.sourceKind === "nemsis"
    && (/^should\b/i.test(rule.message) || /\bwhen is\b/i.test(rule.message))).length, 0,
  "seeded NEMSIS messages retain all referenced element names");
});

test("explicit fixture seeding publishes options without activation; migrations never import definitions", () => {
  assert.match(script, /"already-available" : "existing-version-preserved"/);
  assert.match(script, /status: "draft-in-progress"/);
  assert.match(script, /activated: false/);
  assert.doesNotMatch(script, /insert into app_identity\.active_configuration_bundle/);
  assert.doesNotMatch(script, /insert into forms\.agency_stationary_default/);
  assert.doesNotMatch(script, /CatalogAuthoringService|catalog\.authoring_draft/);
  assert.match(script, /readInstallDefinitions\(root\)/);
  assert.doesNotMatch(migrate, /seedInitialValidationVersions|seedInstallDefinitions|load-nemsis-catalog/);
  assert.match(packageJson.scripts["bootstrap:synthetic"], /seed:validation && npm run seed:install-definitions/);
});
