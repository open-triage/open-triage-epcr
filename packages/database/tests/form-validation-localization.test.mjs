import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";
import { applyFormValidationLocalization } from "../scripts/lib/form-validation-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "defines");

test("both installed profiles carry Swedish form wording and live/sign validation wording", async () => {
  const definitions = await readInstallDefinitions(root);
  for (const profile of definitions.pairs) {
    const locale = profile.form.definition.locales.find(({ locale }) => locale === "sv");
    assert.ok(locale);
    assert.equal(Object.keys(locale.translations.sections).length, profile.form.definition.sections.length);
    assert.ok(Object.keys(locale.translations.fields).length > 10);
    assert.ok(profile.validation.rules.every((rule) => rule.localization?.sv?.name && rule.localization.sv.message));
    assert.ok(profile.validation.rules.some((rule) => rule.executionTargets.includes("live")));
    assert.ok(profile.validation.rules.some((rule) => rule.executionTargets.includes("sign")));
    const count = profile.validation.rules.find((rule) => rule.sourceKind === "catalog");
    assert.equal(count.localization.sv.reviewedSource.message, count.message);
    assert.equal(count.source, profile.validation.rules.find((rule) => rule.id === count.id).source);
  }
  const sweden = definitions.pairs.find(({ key }) => key === "sweden");
  assert.equal(sweden.form.definition.locales[0].translations.fields["eVitals.06"].label, "Systoliskt blodtryck");
  assert.match(sweden.validation.rules[0].localization.sv.message, /Dokumentera minst 1 förekomst/);
});

test("stale identities, source wording, and undefined message parameters reject seed activation", async () => {
  const definitions = await readInstallDefinitions(root);
  const profile = definitions.pairs.find(({ key }) => key === "sweden");
  const form = structuredClone(profile.form);
  const validation = structuredClone(profile.validation);
  validation.rules[0].name = "Changed source";
  await assert.rejects(applyFormValidationLocalization(root, form, validation), /Stale Swedish validation text/);
  const seed = JSON.parse(await readFile(path.join(root, "localization/sv/form-validation_sweden.json"), "utf8"));
  assert.ok(Object.values(seed.rules).some((rule) => rule.reviewPending));
  assert.ok(Object.values(seed.rules).every((rule) => !rule.message.match(/\{([^{}]+)\}/g) ||
    Object.keys(validation.rules.find((original) => original.name === rule.sourceName)?.messageParameters ?? {})
      .every((key) => typeof key === "string")));
});
