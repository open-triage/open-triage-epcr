import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { applyFormValidationLocalization } from "./form-validation-localization.mjs";

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function catalogStandard(catalogKey) {
  const separator = catalogKey.indexOf("-");
  if (separator < 1) throw new Error(`Catalog key ${catalogKey} must start with its standard name`);
  return catalogKey.slice(0, separator).toUpperCase();
}

export async function readInstallDefinitions(root) {
  const catalogFiles = (await readdir(path.join(root, "catalog")))
    .filter((file) => /^catalog_.+\.json$/.test(file)).sort();
  const catalogs = new Map();
  for (const file of catalogFiles) {
    const key = file.slice("catalog_".length, -".json".length);
    const definition = await json(path.join(root, "catalog", file));
    if (definition.schemaVersion !== "1.0.0" || !definition.release || !definition.dataset
        || !Array.isArray(definition.groups) || !Array.isArray(definition.elements)) {
      throw new Error(`Invalid catalog installation definition: ${file}`);
    }
    catalogs.set(key, { key, standard: catalogStandard(key), definition, file });
  }
  if (!catalogs.size) throw new Error("At least one catalog_*.json installation definition is required");

  const formFiles = (await readdir(path.join(root, "forms")))
    .filter((file) => /^form_.+\.json$/.test(file)).sort();
  const pairs = [];
  for (const file of formFiles) {
    const key = file.slice("form_".length, -".json".length);
    const form = await json(path.join(root, "forms", file));
    const validationFile = `validation_${key}.json`;
    const validation = await json(path.join(root, "validation", validationFile));
    if (form.schemaVersion !== 1 || validation.schemaVersion !== 1 || form.key !== key
        || validation.key !== key || validation.formKey !== form.key
        || validation.catalogKey !== form.catalogKey || !catalogs.has(form.catalogKey)
        || !form.name || !Array.isArray(form.definition?.sections) || !Array.isArray(validation.rules)) {
      throw new Error(`Invalid installation definition pair: ${file} and ${validationFile}`);
    }
    await applyFormValidationLocalization(root, form, validation);
    pairs.push({ key, name: form.name, catalogKey: form.catalogKey,
      catalog: catalogs.get(form.catalogKey), form, validation });
  }
  if (!pairs.length) throw new Error("At least one form/validation installation definition pair is required");
  const defaults = pairs.filter(({ form }) => form.default === true);
  if (defaults.length !== 1) throw new Error("Exactly one form definition must set default: true");
  if (pairs.some(({ catalogKey }) => catalogKey !== defaults[0].catalogKey)) {
    throw new Error("Every installable form/validation pair must use the default catalog");
  }
  return { catalogs, pairs, defaultPair: defaults[0] };
}
