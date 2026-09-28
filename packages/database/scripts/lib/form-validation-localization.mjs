import { readFile } from "node:fs/promises";
import path from "node:path";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && !!value.trim();
const tokens = (value) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);

/** Resolve seed identities against the owning install definitions before publishing anything. */
export async function applyFormValidationLocalization(root, form, validation) {
  const file = path.join(root, "localization", "sv", `form-validation_${form.key}.json`);
  const seed = JSON.parse(await readFile(file, "utf8"));
  if (seed.schemaVersion !== 1 || seed.formKey !== form.key || seed.validationKey !== validation.key ||
      !record(seed.sections) || !record(seed.fields) || !record(seed.rules))
    throw new Error(`Malformed form/validation localization seed for ${form.key}`);
  const sections = new Map(form.definition.sections.map((section) => [section.key, section]));
  const fields = new Map(form.definition.sections.flatMap((section) => section.fields.map((field) => [field.key, field])));
  const rules = new Map(validation.rules.map((rule) => [rule.id, rule]));
  const sourceReview = {};
  const translations = { sections: {}, fields: {} };
  for (const [key, entry] of Object.entries(seed.sections)) {
    const section = sections.get(key);
    if (!section || !nonempty(entry.title) || entry.sourceTitle !== section.presentation?.title ||
        (entry.reviewPending !== undefined && !nonempty(entry.reviewPending)))
      throw new Error(`Stale Swedish section text ${form.key}/${key}`);
    translations.sections[key] = { title: entry.title };
    sourceReview[`sections.${key}.title`] = !entry.reviewPending;
  }
  for (const [key, entry] of Object.entries(seed.fields)) {
    const field = fields.get(key);
    if (!field || !record(entry) || (entry.label === undefined && entry.helpText === undefined) ||
        (entry.label !== undefined && (!nonempty(entry.label) || entry.sourceLabel !== field.configuration?.label)) ||
        (entry.helpText !== undefined && (!nonempty(entry.helpText) || entry.sourceHelpText !== field.configuration?.helpText)) ||
        (entry.reviewPending !== undefined && !nonempty(entry.reviewPending)))
      throw new Error(`Stale Swedish field text ${form.key}/${key}`);
    translations.fields[key] = { ...(entry.label ? { label: entry.label } : {}),
      ...(entry.helpText ? { helpText: entry.helpText } : {}) };
    if (entry.label) sourceReview[`fields.${key}.label`] = !entry.reviewPending;
    if (entry.helpText) sourceReview[`fields.${key}.helpText`] = !entry.reviewPending;
  }
  for (const [id, entry] of Object.entries(seed.rules)) {
    const rule = rules.get(id);
    if (!rule || !nonempty(entry.name) || !nonempty(entry.message) ||
        entry.sourceName !== rule.name || entry.sourceMessage !== rule.message ||
        (entry.reviewPending !== undefined && !nonempty(entry.reviewPending)) ||
        tokens(entry.message).some((token) => rule.messageParameters?.[token] === undefined))
      throw new Error(`Stale Swedish validation text ${form.key}/${id}`);
    rule.localization = { schemaVersion: 1, sv: { name: entry.name, message: entry.message,
      ...(!entry.reviewPending ? { reviewedSource: { name: rule.name, message: rule.message } } : {}) } };
  }
  const expectedSections = form.definition.sections.filter((section) => nonempty(section.presentation?.title));
  const expectedFields = form.definition.sections.flatMap((section) => section.fields)
    .filter((field) => nonempty(field.configuration?.label) || nonempty(field.configuration?.helpText));
  if (expectedSections.length !== Object.keys(seed.sections).length ||
      expectedFields.length !== Object.keys(seed.fields).length ||
      rules.size !== Object.keys(seed.rules).length)
    throw new Error(`Incomplete Swedish form/validation seed for ${form.key}`);
  form.definition.locales = [{ locale: "sv", translations, sourceReview }];
  return { sections: expectedSections.length, fields: expectedFields.length, rules: rules.size,
    reviewPending: ["sections", "fields", "rules"].flatMap((kind) => Object.entries(seed[kind])
      .filter(([, entry]) => entry.reviewPending).map(([id, entry]) => ({ kind, id, reason: entry.reviewPending }))) };
}
