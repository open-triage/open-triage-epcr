import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const definition = async (type, key) => JSON.parse(await readFile(
  new URL(`../../../defines/${type}/${key}.json`, import.meta.url), "utf8"));

test("installation definitions provide one full default and an inactive Sweden option", async () => {
  const [catalog, fullForm, fullValidation, swedenForm, swedenValidation] = await Promise.all([
    definition("catalog", "catalog_nemsis-3.5.1"), definition("forms", "form_nemsis-full"),
    definition("validation", "validation_nemsis-full"), definition("forms", "form_sweden"), definition("validation", "validation_sweden"),
  ]);
  const catalogIds = new Set(catalog.elements.map(({ id }) => id));
  assert.equal(catalogIds.size, 453);
  assert.equal(fullForm.default, true);
  assert.equal(swedenForm.default, undefined);
  assert.equal(fullForm.catalogKey, "nemsis-3.5.1");
  assert.equal(swedenForm.catalogKey, fullForm.catalogKey);
  assert.equal(fullValidation.catalogKey, fullForm.catalogKey);
  assert.equal(fullValidation.formKey, fullForm.key);
  assert.equal(swedenValidation.catalogKey, swedenForm.catalogKey);
  assert.equal(swedenValidation.formKey, swedenForm.key);
  for (const [form, validation] of [[fullForm, fullValidation], [swedenForm, swedenValidation]]) {
    const fields = form.definition.sections.flatMap(({ fields }) => fields);
    const formIds = new Set(fields.map(({ source }) => source?.elementId));
    assert.equal(formIds.size, fields.length);
    assert.ok([...formIds].every((id) => catalogIds.has(id)));
    assert.ok(validation.rules.length > 0);
    assert.ok(validation.rules.every(({ primaryTargetElementId }) =>
      primaryTargetElementId === "*" || catalogIds.has(primaryTargetElementId)));
  }
  assert.equal(fullForm.definition.sections.flatMap(({ fields }) => fields).length, 453);
  assert.equal(fullValidation.rules.length, 706);
  assert.equal(fullValidation.rules.filter(({ enabled, primaryTargetElementId, source }) => enabled
    && (/^d[A-Za-z]+\./.test(primaryTargetElementId) || /"d[A-Za-z]+\./.test(source))).length, 0);
  assert.equal(swedenForm.definition.sections.flatMap(({ fields }) => fields).length, 215);
  assert.equal(swedenValidation.rules.length, 426);
  assert.equal(swedenValidation.rules.filter(({ primaryTargetElementId, enabled }) =>
    primaryTargetElementId.startsWith("ePayment.") && !enabled).length, 52);
});

test("fresh install definitions carry Swedish headings and field wording for all shipped fields", async () => {
  for (const key of ["form_nemsis-full", "form_sweden"]) {
    const form = (await definition("forms", key)).definition;
    const swedish = form.locales?.find(({ locale }) => locale === "sv");
    assert.ok(swedish, `${key} must publish Swedish wording`);
    for (const section of form.sections) {
      assert.ok(swedish.translations.sections?.[section.key]?.title?.trim(), `${key}/${section.key} heading`);
      for (const field of section.fields) {
        assert.ok(swedish.translations.fields?.[field.key]?.label?.trim(), `${key}/${field.key} label`);
        if (field.configuration?.helpText) assert.ok(swedish.translations.fields?.[field.key]?.helpText?.trim(),
          `${key}/${field.key} help text`);
      }
    }
  }
});
