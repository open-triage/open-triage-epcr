import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";
import { applyFormValidationLocalization } from "../scripts/lib/form-validation-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "defines");

test("both installed profiles carry localized validation wording and no form wording", async () => {
  const definitions = await readInstallDefinitions(root);
  for (const profile of definitions.pairs) {
    assert.equal(Object.hasOwn(profile.form.definition, "locales"), false);
    assert.ok(profile.form.definition.sections.every((section) => !Object.hasOwn(section, "presentation")));
    assert.ok(profile.form.definition.sections.flatMap(({ fields }) => fields)
      .every((field) => !Object.hasOwn(field, "configuration")));
    assert.ok(profile.validation.rules.every((rule) => rule.localization?.sv?.name && rule.localization.sv.message));
    assert.ok(profile.validation.rules.some((rule) => rule.executionTargets.includes("live")));
    assert.ok(profile.validation.rules.some((rule) => rule.executionTargets.includes("sign")));
    const count = profile.validation.rules.find((rule) => rule.sourceKind === "catalog");
    assert.equal(count.localization.sv.reviewedSource?.message, count.message);
    assert.equal(count.source, profile.validation.rules.find((rule) => rule.id === count.id).source);
  }
  const sweden = definitions.pairs.find(({ key }) => key === "sweden");
  assert.match(sweden.validation.rules[0].localization.sv.message, /hjärtstopp minst en gång/);
});

test("stale validation source wording rejects seed activation", async () => {
  const definitions = await readInstallDefinitions(root);
  const profile = definitions.pairs.find(({ key }) => key === "sweden");
  const form = structuredClone(profile.form);
  const validation = structuredClone(profile.validation);
  validation.rules[0].name = "Changed source";
  await assert.rejects(applyFormValidationLocalization(root, form, validation), /Stale Swedish validation text/);
  const seed = JSON.parse(await readFile(path.join(root, "localization/localization_sv.json"), "utf8"));
  assert.ok(Object.values(seed.validationRules).every((rule) => !Object.hasOwn(rule, "reviewPending")));
  assert.ok(Object.values(seed.validationRules).every((rule) => !rule.message.includes("NEMSIS-källregel")));


});

test("one maximal validation seed coexists with definitive catalog wording", async () => {
  const seed = JSON.parse(await readFile(path.join(root, "localization/localization_sv.json"), "utf8"));
  const catalog = JSON.parse(await readFile(path.join(root, "localization/localization_sv.json"), "utf8"));
  assert.equal(Object.keys(seed.validationRules).length, 706);
  assert.deepEqual(Object.keys(seed).sort(), ["catalog", "language", "schemaVersion", "validationRules"]);
  assert.equal(Object.hasOwn(catalog, "formPresentation"), false);
  assert.equal(catalog.catalog.groups.eResponseSection.name, "Uppdrag");
  assert.equal(catalog.catalog.groups.eNarrativeSection.name, "Anteckning");
  assert.equal(catalog.catalog.elements["eVitals.14"].label, "Andningsfrekvens");
  for (const rule of Object.values(seed.validationRules)) {
    assert.ok(!Object.hasOwn(rule, "reviewPending"));
    assert.doesNotMatch(rule.message, /NEMSIS-källregel/);
    if (/\b(?:should|must|cannot|unless|when)\b/i.test(rule.sourceName))
      assert.doesNotMatch(rule.message, /^Kontrollera /, rule.sourceName);
  }
});

test("an installed count rule renders Swedish live and sign findings without changing identity or outcome", async () => {
  const { compileValidationRule, evaluateValidationBundleSafely, validationRuleText } = await import("@open-triage/contracts");
  const definitions = await readInstallDefinitions(root);
  const document = JSON.parse(await readFile(new URL("../../../apps/web/app/data/synthetic-encounter-document.json", import.meta.url), "utf8"));
  for (const profile of definitions.pairs) {
    const rule = profile.validation.rules.find((candidate) => candidate.primaryTargetElementId === "eArrest.01"
      && candidate.source === 'for each("PatientCareReportGroup")\nrequire minimum("eArrest.01", 1)');
    assert.ok(rule, profile.key);
    const compiled = compileValidationRule(rule, "00000000-0000-4000-8000-000000000000", new Set(["eArrest.01"])).compiled;
    assert.ok(compiled, profile.key);
    const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: compiled.validationVersionId,
      catalogReleaseId: "catalog", rules: [compiled] };
    for (const target of ["live", "sign"]) {
      const english = evaluateValidationBundleSafely(bundle, document, target, { timestamp: "2026-09-28T00:00:00Z", language: "en" });
      const swedish = evaluateValidationBundleSafely(bundle, document, target, { timestamp: "2026-09-28T00:00:00Z", language: "sv" });
      assert.equal(english.failures.length, 0);
      assert.equal(swedish.failures.length, 0);
      assert.ok(english.findings.length > 0, profile.key);
      assert.match(swedish.findings[0].message, /hjärtstopp minst en gång/);
      assert.deepEqual(english.findings.map(({ message, ...finding }) => finding),
        swedish.findings.map(({ message, ...finding }) => finding));
    }
    assert.equal(validationRuleText({ ...rule, localization: undefined }, "sv", "message"), rule.message);
  }
});
