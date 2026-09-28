import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Validate a readable seed against stable catalog identities before installing a new release. */
export async function readCatalogLocalizationSeed(file, catalogKey, catalog) {
  const source = await readFile(file, "utf8");
  const seed = JSON.parse(source);
  if (seed.schemaVersion !== 1 || seed.catalogKey !== catalogKey ||
      !seed.elements || typeof seed.elements !== "object" || Array.isArray(seed.elements) ||
      Object.keys(seed).some((key) => !["schemaVersion", "catalogKey", "elements", "choices", "lists", "specialChoices"].includes(key)))
    throw new Error("Invalid catalog localization seed header");
  const elements = new Map(catalog.elements.map((element) => [element.id, element]));
  const elementLocalization = {};
  for (const [elementId, translation] of Object.entries(seed.elements)) {
    if (!elements.has(elementId) || !translation || typeof translation !== "object" || Array.isArray(translation) ||
        Object.keys(translation).some((key) => !["label", "description"].includes(key)) ||
        Object.values(translation).some((value) => typeof value !== "string"))
      throw new Error(`Invalid catalog localization seed reference ${elementId}`);
    const english = elements.get(elementId);
    elementLocalization[elementId] = { schemaVersion: 1, sv: {
      ...translation, reviewedSource: { label: english.name ?? "", description: english.definition ?? "" }
    } };
  }
  const codeListLocalization = {};
  const sourceLists = new Map([
    ...catalog.bundledLists.map((list) => [list.id, { name: list.name, values: list.values }]),
    ...catalog.elements.filter((element) => element.valueSource.kind === "inline-enumerated")
      .map((element) => [`inline:${element.id}`, { name: element.name, values: element.valueSource.values }]),
  ]);
  if (seed.lists !== undefined && (!Array.isArray(seed.lists) || seed.lists.some((item) =>
    !item || typeof item.listId !== "string" || typeof item.name !== "string")))
    throw new Error("Invalid catalog list localization seed");
  if (seed.choices !== undefined && (!Array.isArray(seed.choices) || seed.choices.some((item) =>
    !item || typeof item.listId !== "string" || typeof item.codeSystem !== "string" ||
    typeof item.code !== "string" || typeof item.label !== "string")))
    throw new Error("Invalid catalog choice localization seed");
  for (const entry of seed.lists ?? []) {
    const source = sourceLists.get(entry.listId);
    if (!source || codeListLocalization[entry.listId]?.localization)
      throw new Error(`Unknown or duplicate list localization ${entry.listId}`);
    codeListLocalization[entry.listId] = { ...codeListLocalization[entry.listId],
      localization: { schemaVersion: 1, sv: { name: entry.name, reviewedSource: { name: source.name } } } };
  }
  for (const entry of seed.choices ?? []) {
    const source = sourceLists.get(entry.listId);
    const sourceValue = source?.values.find((value) => value.code === entry.code &&
      (value.codeSystem ?? "") === entry.codeSystem);
    const key = `${entry.codeSystem}\u0000${entry.code}`;
    if (!sourceValue || codeListLocalization[entry.listId]?.values?.[key])
      throw new Error(`Unknown or duplicate choice localization ${entry.listId}/${entry.codeSystem}/${entry.code}`);
    codeListLocalization[entry.listId] = { ...codeListLocalization[entry.listId], values: {
      ...codeListLocalization[entry.listId]?.values,
      [key]: { schemaVersion: 1, sv: { label: entry.label,
        reviewedSource: { label: sourceValue.label } } },
    } };
  }
  const specialChoiceLocalization = {};
  const seenSpecial = new Set();
  for (const entry of seed.specialChoices ?? []) {
    const element = elements.get(entry.elementId);
    const source = entry.kind === "not-value" ? element?.permittedNotValues
      : entry.kind === "pertinent-negative" ? element?.permittedPertinentNegatives : undefined;
    const sourceValue = source?.find((value) => value.code === entry.code);
    const key = `${entry.kind}\u0000${entry.code}`;
    if (!sourceValue || typeof entry.label !== "string" || seenSpecial.has(`${entry.elementId}\u0000${key}`))
      throw new Error(`Unknown or duplicate special choice localization ${entry.elementId}/${key}`);
    seenSpecial.add(`${entry.elementId}\u0000${key}`);
    specialChoiceLocalization[entry.elementId] = { ...specialChoiceLocalization[entry.elementId],
      [key]: { schemaVersion: 1, sv: { label: entry.label,
        reviewedSource: { label: sourceValue.label } } } };
  }
  return { elementLocalization, codeListLocalization, specialChoiceLocalization, seedSha256: createHash("sha256").update(source).digest("hex") };
}
