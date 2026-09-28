import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Validate a readable seed against stable catalog identities before installing a new release. */
export async function readCatalogLocalizationSeed(file, catalogKey, catalog) {
  const source = await readFile(file, "utf8");
  const seed = JSON.parse(source);
  if (seed.schemaVersion !== 1 || seed.catalogKey !== catalogKey ||
      !seed.elements || typeof seed.elements !== "object" || Array.isArray(seed.elements) ||
      Object.keys(seed).some((key) => !["schemaVersion", "catalogKey", "elements"].includes(key)))
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
  return { elementLocalization, seedSha256: createHash("sha256").update(source).digest("hex") };
}
