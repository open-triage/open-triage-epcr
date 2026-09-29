import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const string = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Resolves one language-level localization definition against a catalog by stable
 * element, group, list, code-system/code, and special-choice identities. Entries
 * that belong only to another catalog release remain valid and are ignored.
 */
export async function readCatalogLocalizationSeed(file, catalog) {
  const source = await readFile(file, "utf8");
  const seed = JSON.parse(source);
  if (!record(seed) || seed.schemaVersion !== 1 || seed.language !== "sv" ||
      !record(seed.catalog) || !record(seed.validationRules) ||
      !keysOnly(seed, ["schemaVersion", "language", "catalog", "validationRules"]) ||
      !keysOnly(seed.catalog, ["elements", "groups", "codeLists", "specialChoices"]) ||
      !record(seed.catalog.elements) || !record(seed.catalog.groups) ||
      !record(seed.catalog.codeLists) || !record(seed.catalog.specialChoices))
    throw new Error("Invalid Swedish localization definition header");

  const elements = new Map(catalog.elements.map((item) => [item.id, item]));
  const groups = new Map(catalog.groups.map((item) => [item.id, item]));
  const sourceLists = new Map([
    ...catalog.bundledLists.map((item) => [item.id, item]),
    ...catalog.elements.filter((item) => item.valueSource.kind === "inline-enumerated")
      .map((item) => [`inline:${item.id}`, { name: item.name, values: item.valueSource.values }]),
  ]);
  const elementLocalization = {}, groupLocalization = {}, codeListLocalization = {}, specialChoiceLocalization = {};
  const seen = { elements: new Set(), groups: new Set(), lists: new Set(), choices: new Set(), specialChoices: new Set() };
  const available = { elements: new Set(), groups: new Set(), lists: new Set(), choices: new Set(), specialChoices: new Set() };
  const reviewPending = [];
  const sourceChanges = [];
  const mark = (kind, id, entry) => {
    if (entry.reviewPending !== undefined) {
      if (!string(entry.reviewPending)) throw new Error(`Malformed localization review marker ${id}`);
      reviewPending.push({ kind, id, reason: entry.reviewPending });
    }
  };
  const localizedText = (entry, fields, sourceFields, id) => {
    if (!record(entry) || !keysOnly(entry, [...sourceFields, ...fields, "reviewPending"]) ||
        [...sourceFields, ...fields].some((field) => !string(entry[field])))
      throw new Error(`Malformed catalog localization text ${id}`);
  };
  const compareSource = (kind, id, entry, current) => {
    const changedFields = Object.keys(current).filter((field) => entry[field] !== current[field]);
    if (changedFields.length) sourceChanges.push({ kind, id, changedFields });
  };

  for (const [id, entry] of Object.entries(seed.catalog.elements)) {
    localizedText(entry, ["label", "description"], ["sourceLabel", "sourceDescription"], id);
    available.elements.add(id);
    mark("element", id, entry);
    const original = elements.get(id);
    if (!original) continue;
    seen.elements.add(id);
    compareSource("element", id, entry, { sourceLabel: original.name ?? "", sourceDescription: original.definition ?? "" });
    elementLocalization[id] = { schemaVersion: 1, sv: { label: entry.label, description: entry.description,
      reviewedSource: { label: entry.sourceLabel, description: entry.sourceDescription } } };
  }

  for (const [id, entry] of Object.entries(seed.catalog.groups)) {
    localizedText(entry, ["name"], ["sourceName"], id);
    available.groups.add(id);
    mark("group", id, entry);
    const original = groups.get(id);
    if (!original) continue;
    seen.groups.add(id);
    compareSource("group", id, entry, { sourceName: original.name });
    groupLocalization[id] = { schemaVersion: 1, sv: { name: entry.name,
      reviewedSource: { name: entry.sourceName } } };
  }

  for (const [listId, entry] of Object.entries(seed.catalog.codeLists)) {
    if (!record(entry) || !keysOnly(entry, ["sourceName", "name", "choices", "reviewPending"]) ||
        !string(entry.sourceName) || !string(entry.name) || !record(entry.choices))
      throw new Error(`Malformed catalog list localization ${listId}`);
    available.lists.add(listId);
    mark("list", listId, entry);
    const original = sourceLists.get(listId);
    if (original) {
      seen.lists.add(listId);
      compareSource("list", listId, entry, { sourceName: original.name });
      codeListLocalization[listId] = { localization: { schemaVersion: 1,
        sv: { name: entry.name, reviewedSource: { name: entry.sourceName } } } };
    }
    for (const [codeSystem, choices] of Object.entries(entry.choices)) {
      if (!record(choices)) throw new Error(`Malformed catalog choices ${listId}/${codeSystem}`);
      for (const [code, choice] of Object.entries(choices)) {
        const id = `${listId}/${codeSystem}/${code}`;
        if (!string(code)) throw new Error(`Malformed catalog choice identity ${id}`);
        localizedText(choice, ["label"], ["sourceLabel"], id);
        available.choices.add(id);
        mark("choice", id, choice);
        const sourceValue = original?.values.find((value) =>
          value.code === code && (value.codeSystem ?? "") === codeSystem);
        if (!sourceValue) continue;
        seen.choices.add(id);
        compareSource("choice", id, choice, { sourceLabel: sourceValue.label });
        codeListLocalization[listId] = { ...codeListLocalization[listId], values: {
          ...codeListLocalization[listId]?.values,
          [codeSystem]: { ...codeListLocalization[listId]?.values?.[codeSystem],
            [code]: { schemaVersion: 1, sv: { label: choice.label,
              reviewedSource: { label: choice.sourceLabel } } } },
        } };
      }
    }
  }

  for (const [elementId, kinds] of Object.entries(seed.catalog.specialChoices)) {
    if (!record(kinds) || !keysOnly(kinds, ["not-value", "pertinent-negative"]))
      throw new Error(`Malformed special choice localization ${elementId}`);
    for (const [kind, choices] of Object.entries(kinds)) {
      if (!record(choices)) throw new Error(`Malformed special choice localization ${elementId}/${kind}`);
      for (const [code, choice] of Object.entries(choices)) {
        const id = `${elementId}/${kind}/${code}`;
        if (!string(code)) throw new Error(`Malformed special choice identity ${id}`);
        localizedText(choice, ["label"], ["sourceLabel"], id);
        available.specialChoices.add(id);
        mark("specialChoice", id, choice);
        const element = elements.get(elementId);
        const sourceValue = element && (kind === "not-value" ? element.permittedNotValues :
          element.permittedPertinentNegatives).find((value) => value.code === code);
        if (!sourceValue) continue;
        seen.specialChoices.add(id);
        compareSource("specialChoice", id, choice, { sourceLabel: sourceValue.label });
        specialChoiceLocalization[elementId] = { ...specialChoiceLocalization[elementId],
          [kind]: { ...specialChoiceLocalization[elementId]?.[kind],
            [code]: { schemaVersion: 1, sv: { label: choice.label,
              reviewedSource: { label: choice.sourceLabel } } } } };
      }
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
  const coverage = {
    expected: Object.fromEntries(Object.entries(expected).map(([kind, ids]) => [kind, ids.length])),
    supplied: Object.fromEntries(Object.entries(seen).map(([kind, ids]) => [kind, ids.size])),
    available: Object.fromEntries(Object.entries(available).map(([kind, ids]) => [kind, ids.size])),
    text: { descriptions: { expected: catalog.elements.length, supplied: Object.keys(elementLocalization).length },
      unitChoices: { expected: unitChoiceIds.length, supplied: unitChoiceIds.filter((id) => seen.choices.has(id)).length },
      inlineChoices: { expected: catalog.statistics.inlineEnumerationValues,
        supplied: [...seen.choices].filter((id) => id.startsWith("inline:")).length },
      bundledChoices: { expected: catalog.statistics.bundledListValues,
        supplied: [...seen.choices].filter((id) => !id.startsWith("inline:")).length } },
    missing,
    reviewPending,
    sourceChanges,
  };
  return { elementLocalization, groupLocalization, codeListLocalization, specialChoiceLocalization,
    coverage, seedSha256: createHash("sha256").update(JSON.stringify(seed.catalog)).digest("hex") };
}
