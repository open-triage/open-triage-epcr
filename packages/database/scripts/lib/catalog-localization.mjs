import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const string = (value) => typeof value === "string" && value.trim().length > 0;

/** The seed is grouped by clinical domain; identities always remain the NEMSIS owner/code tuple. */
export async function readCatalogLocalizationSeed(file, catalogKey, catalog) {
  const source = await readFile(file, "utf8");
  const seed = JSON.parse(source);
  if (!record(seed) || seed.schemaVersion !== 2 || seed.catalogKey !== catalogKey ||
      !record(seed.domains) || !keysOnly(seed, ["schemaVersion", "catalogKey", "domains"]))
    throw new Error("Invalid catalog localization seed header");
  const elements = new Map(catalog.elements.map((item) => [item.id, item]));
  const groups = new Map(catalog.groups.map((item) => [item.id, item]));
  const sourceLists = new Map([
    ...catalog.bundledLists.map((item) => [item.id, item]),
    ...catalog.elements.filter((item) => item.valueSource.kind === "inline-enumerated")
      .map((item) => [`inline:${item.id}`, { name: item.name, values: item.valueSource.values }]),
  ]);
  const elementLocalization = {}, groupLocalization = {}, codeListLocalization = {}, specialChoiceLocalization = {};
  const seen = { elements: new Set(), groups: new Set(), lists: new Set(), choices: new Set(), specialChoices: new Set() };
  const reviewPending = [];
  const mark = (kind, id, entry) => { if (entry.reviewPending) reviewPending.push({ kind, id, reason: entry.reviewPending }); };
  const localizedText = (entry, fields, id) => {
    if (!record(entry) || !keysOnly(entry, [...fields, "reviewPending"]) ||
        fields.some((field) => !string(entry[field])) ||
        (entry.reviewPending !== undefined && !string(entry.reviewPending)))
      throw new Error(`Malformed catalog localization text ${id}`);
  };
  const unique = (kind, id) => {
    if (seen[kind].has(id)) throw new Error(`Duplicate catalog localization ${kind} ${id}`);
    seen[kind].add(id);
  };
  for (const [domain, content] of Object.entries(seed.domains)) {
    if (!record(content) || !keysOnly(content, ["elements", "groups", "lists", "choices", "specialChoices"]) ||
        !record(content.elements) || !record(content.groups) || !Array.isArray(content.lists) ||
        !Array.isArray(content.choices) || !Array.isArray(content.specialChoices))
      throw new Error(`Malformed catalog localization domain ${domain}`);
    for (const [id, entry] of Object.entries(content.elements)) {
      const original = elements.get(id);
      if (!original || original.section !== domain) throw new Error(`Invalid catalog localization seed reference ${id}`);
      unique("elements", id);
      localizedText(entry, ["label", "description"], id);
      elementLocalization[id] = { schemaVersion: 1, sv: { label: entry.label, description: entry.description,
        reviewedSource: { label: original.name ?? "", description: original.definition ?? "" } } };
      mark("element", id, entry);
    }
    for (const [id, entry] of Object.entries(content.groups)) {
      const original = groups.get(id);
      if (!original || !(id.startsWith(domain) || domain === "shared"))
        throw new Error(`Unknown catalog group localization ${id}`);
      unique("groups", id);
      localizedText(entry, ["name"], id);
      groupLocalization[id] = { schemaVersion: 1, sv: { name: entry.name,
        reviewedSource: { name: original.name } } };
      mark("group", id, entry);
    }
    for (const entry of content.lists) {
      if (!record(entry) || !string(entry.listId)) throw new Error(`Malformed catalog list localization in ${domain}`);
      const original = sourceLists.get(entry.listId);
      if (!original) throw new Error(`Unknown catalog list localization ${entry.listId}`);
      unique("lists", entry.listId);
      localizedText(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "listId")), ["name"], entry.listId);
      codeListLocalization[entry.listId] = { ...codeListLocalization[entry.listId], localization: { schemaVersion: 1,
        sv: { name: entry.name, reviewedSource: { name: original.name } } } };
      mark("list", entry.listId, entry);
    }
    for (const entry of content.choices) {
      if (!record(entry) || !string(entry.listId) || typeof entry.codeSystem !== "string" ||
          !string(entry.code)) throw new Error(`Malformed catalog choice identity in ${domain}`);
      const id = `${entry.listId}/${entry.codeSystem}/${entry.code}`;
      const original = sourceLists.get(entry.listId)?.values.find((value) =>
        value.code === entry.code && (value.codeSystem ?? "") === entry.codeSystem);
      if (!original) throw new Error(`Unknown catalog choice localization ${id}`);
      unique("choices", id);
      localizedText(Object.fromEntries(Object.entries(entry).filter(([key]) =>
        !["listId", "codeSystem", "code"].includes(key))), ["label"], id);
      codeListLocalization[entry.listId] = { ...codeListLocalization[entry.listId], values: {
        ...codeListLocalization[entry.listId]?.values,
        [entry.codeSystem]: { ...codeListLocalization[entry.listId]?.values?.[entry.codeSystem],
          [entry.code]: { schemaVersion: 1, sv: { label: entry.label,
            reviewedSource: { label: original.label } } } },
      } };
      mark("choice", id, entry);
    }
    for (const entry of content.specialChoices) {
      if (!record(entry) || !string(entry.elementId) || !["not-value", "pertinent-negative"].includes(entry.kind) ||
          !string(entry.code)) throw new Error(`Malformed special choice identity in ${domain}`);
      const id = `${entry.elementId}/${entry.kind}/${entry.code}`;
      const element = elements.get(entry.elementId);
      if (!element || element.section !== domain) throw new Error(`Unknown special choice element ${id}`);
      const sourceValue = (entry.kind === "not-value" ? element.permittedNotValues :
        element.permittedPertinentNegatives).find((value) => value.code === entry.code);
      if (!sourceValue) throw new Error(`Unknown special choice localization ${id}`);
      unique("specialChoices", id);
      localizedText(Object.fromEntries(Object.entries(entry).filter(([key]) =>
        !["elementId", "kind", "code"].includes(key))), ["label"], id);
      specialChoiceLocalization[entry.elementId] = { ...specialChoiceLocalization[entry.elementId],
        [entry.kind]: { ...specialChoiceLocalization[entry.elementId]?.[entry.kind],
          [entry.code]: { schemaVersion: 1, sv: { label: entry.label,
            reviewedSource: { label: sourceValue.label } } } } };
      mark("specialChoice", id, entry);
    }
  }
  const expected = {
    elements: catalog.elements.map((item) => item.id),
    groups: catalog.groups.map((item) => item.id),
    lists: [...sourceLists.keys()],
    choices: [...sourceLists].flatMap(([id, list]) => list.values.map((value) => `${id}/${value.codeSystem ?? ""}/${value.code}`)),
    specialChoices: catalog.elements.flatMap((item) => [
      ...item.permittedNotValues.map((value) => `${item.id}/not-value/${value.code}`),
      ...item.permittedPertinentNegatives.map((value) => `${item.id}/pertinent-negative/${value.code}`),
    ]),
  };
  const missing = Object.fromEntries(Object.entries(expected).map(([kind, ids]) =>
    [kind, ids.filter((id) => !seen[kind].has(id))]));
  const unitListIds = ["inline:eHistory.14", "inline:eMedications.06", "inline:ePatient.16", "inline:eSituation.06"];
  const unitChoiceIds = expected.choices.filter((id) => unitListIds.some((listId) => id.startsWith(`${listId}/`)));
  const coverage = { expected: Object.fromEntries(Object.entries(expected).map(([kind, ids]) => [kind, ids.length])),
    supplied: Object.fromEntries(Object.entries(seen).map(([kind, ids]) => [kind, ids.size])),
    text: { descriptions: { expected: catalog.elements.length,
      supplied: Object.keys(elementLocalization).length },
      unitChoices: { expected: unitChoiceIds.length,
        supplied: unitChoiceIds.filter((id) => seen.choices.has(id)).length },
      inlineChoices: { expected: catalog.statistics.inlineEnumerationValues,
        supplied: [...seen.choices].filter((id) => id.startsWith("inline:")).length },
      bundledChoices: { expected: catalog.statistics.bundledListValues,
        supplied: [...seen.choices].filter((id) => !id.startsWith("inline:")).length } },
    missing, reviewPending };
  return { elementLocalization, groupLocalization, codeListLocalization, specialChoiceLocalization,
    coverage, seedSha256: createHash("sha256").update(source).digest("hex") };
}
