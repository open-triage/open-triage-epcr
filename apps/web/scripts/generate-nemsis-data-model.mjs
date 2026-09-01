import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(webRoot, "app/data/nemsis-3.5.1-sources");
const xsdRoot = path.join(sourceRoot, "xsd");
const listRoot = path.join(sourceRoot, "lists");
const dictionaryPath = path.join(sourceRoot, "Combined_ElementDetails_Full.txt");
const enumerationsPath = path.join(sourceRoot, "Combined_ElementEnumerations.txt");
const outputPath = path.join(webRoot, "app/data/nemsis-data-model-3.5.1.json");
const releaseBaseUrl = "https://nemsis.org/media/nemsis_v3/release-3.5.1";
const masterBaseUrl = "https://nemsis.org/media/nemsis_v3/master";
const retrievalDate = "2026-09-01";

const listSpecifications = [
  { id: "cause-of-injury", name: "Cause of Injury", classification: "defined", filename: "CauseOfInjury.json", remotePath: "DefinedLists/CauseOfInjury/CauseOfInjury.json" },
  { id: "impression", name: "Impression", classification: "defined", filename: "Impression.json", remotePath: "DefinedLists/Impression/Impression.json" },
  { id: "incident-location-type", name: "Incident Location Type", classification: "defined", filename: "IncidentLocationType.json", remotePath: "DefinedLists/IncidentLocationType/IncidentLocationType.json" },
  { id: "symptoms", name: "Symptoms", classification: "defined", filename: "Symptom.json", remotePath: "DefinedLists/Symptom/Symptom.json" },
  { id: "medications-given", name: "Medications Given", classification: "defined", filename: "Medication.json", remotePath: "DefinedLists/Medication/Medication.json" },
  { id: "procedures", name: "Procedures", classification: "defined", filename: "Procedure.json", remotePath: "DefinedLists/Procedure/Procedure.json" },
  { id: "patient-activity", name: "Patient Activity", classification: "suggested", filename: "PatientActivity.json", remotePath: "SuggestedLists/PatientActivity/PatientActivity.json" },
  { id: "environmental-food-allergies", name: "Environmental/Food Allergies", classification: "suggested", filename: "EnvironmentalFoodAllergy.json", remotePath: "SuggestedLists/EnvironmentalFoodAllergy/EnvironmentalFoodAllergy.json" },
  { id: "medical-surgical-history", name: "Medical/Surgical History", classification: "suggested", filename: "MedicalSurgicalHistory.json", remotePath: "SuggestedLists/MedicalSurgicalHistory/MedicalSurgicalHistory.json" },
  { id: "medication-allergy", name: "Medication Allergy", classification: "suggested", filename: "MedicationAllergy.json", remotePath: "SuggestedLists/MedicationAllergy/MedicationAllergy.json" },
];

const codeSystems = {
  "ICD-10-CM": { id: "ICD-10-CM", label: "ICD-10-CM", url: "https://www.cdc.gov/nchs/icd/icd-10-cm/" },
  "ICD-10-PCS": { id: "ICD-10-PCS", label: "ICD-10-PCS", url: "https://www.cms.gov/medicare/coding-billing/icd-10-codes" },
  RxNorm: { id: "RxNorm", label: "RxNorm", url: "https://www.nlm.nih.gov/research/umls/rxnorm/" },
  "SNOMED CT": { id: "SNOMED-CT", label: "SNOMED CT", url: "https://www.nlm.nih.gov/healthit/snomedct/" },
  "ANSI Country Codes": { id: "ANSI-COUNTRY", label: "ANSI Country Codes", url: "https://www.census.gov/library/reference/code-lists/ansi.html" },
  "ANSI County Codes": { id: "ANSI-COUNTY", label: "ANSI County Codes", url: "https://www.census.gov/library/reference/code-lists/ansi.html" },
  "ANSI State Codes": { id: "ANSI-STATE", label: "ANSI State Codes", url: "https://www.census.gov/library/reference/code-lists/ansi.html" },
  "Census Tracts": { id: "CENSUS-TRACT", label: "US Census Tract GEOID", url: "https://www.census.gov/programs-surveys/geography/guidance/geo-identifiers.html" },
  GNIS: { id: "GNIS", label: "Geographic Names Information System", url: "https://www.usgs.gov/us-board-on-geographic-names/download-gnis-data" },
};

const externalDatatypeSystems = {
  icd10Code: ["ICD-10-CM"], icd10CodeInjury: ["ICD-10-CM"], AssociatedSymptoms: ["ICD-10-CM"],
  ProvidersImpression: ["ICD-10-CM"], IncidentLocationType: ["ICD-10-CM"], icd10Activity: ["ICD-10-CM"],
  icd10MedSurge: ["ICD-10-CM", "ICD-10-PCS"], icd10CodeOutcomeProcedures: ["ICD-10-PCS"],
  Medication: ["RxNorm"], MedicationAllergies: ["ICD-10-CM", "RxNorm"], snomed: ["SNOMED CT"],
  ANSICountryCode: ["ANSI Country Codes"], ANSICountyCode: ["ANSI County Codes"], ANSIStateCode: ["ANSI State Codes"],
  CensusTracts: ["Census Tracts"], CityGnisCode: ["GNIS"], CityGnisCodePayment: ["GNIS"],
};
const listCodeTypeSystems = { "9924001": "ICD-10-CM", "9924003": "RxNorm", "9924005": "SNOMED-CT" };

function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
function parseDelimitedLine(line) {
  if (!line.startsWith("'") || !line.endsWith("'|")) throw new Error(`Unsupported official export row: ${line.slice(0, 80)}`);
  return line.slice(1, -2).split("'|'");
}
function parseDelimited(content) {
  const lines = content.toString("utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseDelimitedLine(lines.shift());
  return { index: Object.fromEntries(headers.map((header, position) => [header, position])), rows: lines.map(parseDelimitedLine) };
}
function decodeXml(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]) : "";
}

function parseXsdDocumentation(xsdFiles) {
  const documentation = new Map();
  for (const { relativePath, content } of xsdFiles) {
    const filename = path.basename(relativePath);
    if (filename !== "EMSDataSet_v3.xsd" && !filename.startsWith("e")) continue;
    for (const match of content.toString("utf8").matchAll(/<nemsisTacDoc>([\s\S]*?)<\/nemsisTacDoc>/g)) {
      const block = match[1];
      const id = tag(block, "number").match(/^[de][A-Za-z]+\.\d{2}/)?.[0] ?? "";
      if (!id) continue;
      if (documentation.has(id)) throw new Error(`Duplicate XSD documentation for ${id}`);
      documentation.set(id, { name: tag(block, "name"), national: tag(block, "national") === "Yes", state: tag(block, "state") === "Yes", usage: tag(block, "usage") });
    }
  }
  return documentation;
}

function parseSimpleTypes(xsdFiles) {
  const types = new Map();
  for (const { content } of xsdFiles) {
    for (const match of content.toString("utf8").matchAll(/<xs:simpleType name="([^"]+)">([\s\S]*?)<\/xs:simpleType>/g)) {
      const restriction = match[2].match(/<xs:restriction base="([^"]+)"[^>]*>([\s\S]*?)<\/xs:restriction>/)
        ?? match[2].match(/<xs:restriction base="([^"]+)"\s*\/>/);
      if (!restriction) continue;
      const restrictionBody = restriction[2] ?? "";
      const values = [...restrictionBody.matchAll(/<xs:enumeration value="([^"]+)">([\s\S]*?)<\/xs:enumeration>/g)]
        .map((entry) => ({ code: decodeXml(entry[1]), label: tag(entry[2], "xs:documentation") }));
      const facets = {};
      for (const facet of ["length", "minLength", "maxLength", "minInclusive", "maxInclusive", "minExclusive", "maxExclusive", "totalDigits", "fractionDigits", "pattern"]) {
        const facetMatch = restrictionBody.match(new RegExp(`<xs:${facet} value="([^"]*)"\\s*/>`));
        if (facetMatch) facets[facet] = decodeXml(facetMatch[1]);
      }
      const parsed = { base: restriction[1], facets, values };
      const existing = types.get(match[1]);
      if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) throw new Error(`Conflicting XSD simple type ${match[1]}`);
      types.set(match[1], parsed);
    }
  }
  return types;
}

function resolveXsdBase(sourceDatatype, simpleTypes) {
  let current = sourceDatatype;
  const visited = new Set();
  while (!current.startsWith("xs:")) {
    if (visited.has(current)) throw new Error(`Circular XSD datatype definition for ${sourceDatatype}`);
    visited.add(current);
    const definition = simpleTypes.get(current);
    if (!definition) throw new Error(`Could not resolve XSD datatype ${sourceDatatype} (stopped at ${current})`);
    current = definition.base;
  }
  return current;
}
function usableBase(xsdBase) {
  const primitive = xsdBase.replace(/^xs:/, "");
  if (["integer", "nonNegativeInteger", "positiveInteger", "negativeInteger", "nonPositiveInteger", "long", "int", "short", "byte", "unsignedLong", "unsignedInt", "unsignedShort", "unsignedByte"].includes(primitive)) return "integer";
  if (["decimal", "double", "float"].includes(primitive)) return "decimal";
  if (["base64Binary", "hexBinary"].includes(primitive)) return "binary";
  return primitive;
}
function parseConstraint(value, facet, base) {
  if (!value) return undefined;
  if (["length", "minLength", "maxLength", "totalDigits", "fractionDigits"].includes(facet)) return Number(value);
  if (["integer", "decimal"].includes(base) && ["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"].includes(facet)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) || (!Number.isInteger(numeric) && Number.isFinite(numeric))) return numeric;
  }
  return value;
}
function parseNamedChoices(raw, simpleTypes, id, kind) {
  if (!raw) return [];
  return raw.split(";").map((value) => value.trim()).filter(Boolean).map((typeName) => {
    const values = simpleTypes.get(typeName)?.values ?? [];
    if (values.length !== 1 || !values[0].code || !values[0].label) throw new Error(`${id} ${kind} type ${typeName} does not resolve to one labeled value`);
    return values[0];
  });
}
function compareElementIds(left, right, leftName, rightName) {
  const missing = [...left].filter((id) => !right.has(id));
  const extra = [...right].filter((id) => !left.has(id));
  if (missing.length || extra.length) throw new Error(`${leftName}/${rightName} mismatch; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
}
function elementOrder(left, right) {
  const [leftSection, leftNumber] = left.id.split(".");
  const [rightSection, rightNumber] = right.id.split(".");
  return leftSection === rightSection ? Number(leftNumber) - Number(rightNumber) : leftSection < rightSection ? -1 : 1;
}
function normalizeVocabulary(value) { return value === "ICD-10" ? "ICD-10-CM" : value === "SNOMED-CT" ? "SNOMED CT" : value; }
function parseBundledList(specification, content) {
  const parsed = JSON.parse(content.toString("utf8")).DefinedList;
  const systems = parsed.Header.SourceVocabularies.SourceVocabulary.map((entry) => normalizeVocabulary(entry.Value))
    .map((name) => codeSystems[name] ?? { id: name, label: name, url: "" });
  const values = parsed.Codes.Code.map((entry) => {
    const result = { code: String(entry.Value.Value), label: entry.SuggestedLabel || entry.SourceLabel, sourceLabel: entry.SourceLabel };
    if (entry.Value.CodeType) result.codeSystem = listCodeTypeSystems[entry.Value.CodeType] ?? entry.Value.CodeType;
    else if (systems.length === 1) result.codeSystem = systems[0].id;
    if (entry.Category) result.category = entry.Category;
    return result;
  });
  if (!values.length || values.some((value) => !value.code || !value.label)) throw new Error(`${specification.filename} contains an incomplete code`);
  return {
    id: specification.id, name: specification.name, classification: specification.classification,
    publishedAt: parsed.date, exhaustive: false,
    applicableElements: parsed.Header.NemsisElements.NemsisElement.filter((id) => id.startsWith("e")).sort(),
    applicableDatatypes: [...parsed.Header.NemsisTypes.NemsisType].sort(), systems,
    valueCount: values.length, values,
  };
}

async function readSources() {
  const rootXsd = await readFile(path.join(xsdRoot, "EMSDataSet_v3.xsd"));
  const includes = [...rootXsd.toString("utf8").matchAll(/<xs:include schemaLocation="([^"]+)"\s*\/>/g)].map((match) => match[1]);
  const pinnedXsdNames = (await readdir(xsdRoot)).filter((name) => name.endsWith(".xsd")).sort();
  if (JSON.stringify(pinnedXsdNames) !== JSON.stringify(["EMSDataSet_v3.xsd", ...includes].sort())) throw new Error("Pinned XSD files must exactly match EMSDataSet_v3.xsd and its declared includes");
  const pinnedListNames = (await readdir(listRoot)).filter((name) => name.endsWith(".json")).sort();
  if (JSON.stringify(pinnedListNames) !== JSON.stringify(listSpecifications.map((specification) => specification.filename).sort())) throw new Error("Pinned list files must exactly match the configured official lists");
  const xsdFiles = await Promise.all(pinnedXsdNames.map(async (name) => ({ relativePath: `xsd/${name}`, content: await readFile(path.join(xsdRoot, name)) })));
  const listFiles = await Promise.all(listSpecifications.map(async (specification) => ({ specification, content: await readFile(path.join(listRoot, specification.filename)) })));
  return { xsdFiles, listFiles, dictionary: await readFile(dictionaryPath), enumerations: await readFile(enumerationsPath) };
}

export async function generateCatalog() {
  const { xsdFiles, listFiles, dictionary, enumerations } = await readSources();
  const { index, rows: allRows } = parseDelimited(dictionary);
  for (const header of ["DatasetName", "DatasetType", "ElementNumber", "ElementName", "National", "State", "Definition", "Usage", "MinOccurs", "MaxOccurs", "DataType", "NVList", "PNList"])
    if (index[header] === undefined) throw new Error(`Data dictionary is missing ${header}`);
  const rows = allRows.filter((row) => row[index.DatasetName] === "EMSDataSet" && row[index.DatasetType] === "element");
  const dictionaryIds = new Set(rows.map((row) => row[index.ElementNumber]));
  if (dictionaryIds.size !== rows.length) throw new Error("Data dictionary contains duplicate EMSDataSet element identifiers");
  const xsdDocumentation = parseXsdDocumentation(xsdFiles);
  const simpleTypes = parseSimpleTypes(xsdFiles);
  compareElementIds(dictionaryIds, new Set(xsdDocumentation.keys()), "data dictionary", "XSD");

  const enumerationExport = parseDelimited(enumerations);
  const inlineValues = new Map();
  for (const row of enumerationExport.rows.filter((row) => row[enumerationExport.index.DatasetName] === "EMSDataSet")) {
    const id = row[enumerationExport.index.ElementNumber];
    if (!dictionaryIds.has(id)) throw new Error(`Enumeration export references unknown EMSDataSet element ${id}`);
    const values = inlineValues.get(id) ?? [];
    values.push({ code: row[enumerationExport.index.Code], label: row[enumerationExport.index.CodeDescription] });
    inlineValues.set(id, values);
  }
  const bundledLists = listFiles.map(({ specification, content }) => parseBundledList(specification, content));
  const listsByElement = new Map();
  for (const list of bundledLists) for (const id of list.applicableElements) {
    if (!dictionaryIds.has(id)) continue;
    const ids = listsByElement.get(id) ?? [];
    ids.push(list.id);
    listsByElement.set(id, ids);
  }

  const facets = ["length", "minLength", "maxLength", "minInclusive", "maxInclusive", "minExclusive", "maxExclusive", "totalDigits", "fractionDigits", "pattern"];
  const elements = rows.map((row) => {
    const id = row[index.ElementNumber];
    const xsd = xsdDocumentation.get(id);
    const metadata = { name: row[index.ElementName], definition: row[index.Definition], national: row[index.National] === "National", state: row[index.State] === "State", usage: row[index.Usage] };
    for (const field of ["name", "national", "state", "usage"]) if (xsd[field] !== metadata[field]) throw new Error(`${id} ${field} differs between the XSD and data dictionary`);
    const sourceDatatype = row[index.DataType];
    if (!metadata.definition || !sourceDatatype) throw new Error(`${id} is missing required catalog metadata`);
    const minimum = Number(row[index.MinOccurs]);
    const maximum = row[index.MaxOccurs] === "M" ? "unbounded" : Number(row[index.MaxOccurs]);
    if (!Number.isInteger(minimum) || !(maximum === "unbounded" || Number.isInteger(maximum))) throw new Error(`${id} has invalid occurrence metadata`);
    const xsdBase = resolveXsdBase(sourceDatatype, simpleTypes);
    const base = usableBase(xsdBase);
    const constraints = {};
    for (const facet of facets) {
      const value = parseConstraint(row[index[facet]], facet, base);
      if (value !== undefined) constraints[facet] = value;
    }
    const notValues = parseNamedChoices(row[index.NVList], simpleTypes, id, "NV");
    const pertinentNegatives = parseNamedChoices(row[index.PNList], simpleTypes, id, "PN");
    const elementInlineValues = inlineValues.get(id) ?? [];
    const bundledListIds = listsByElement.get(id) ?? [];
    const externalSystemNames = new Set(externalDatatypeSystems[sourceDatatype] ?? []);
    for (const listId of bundledListIds) for (const system of bundledLists.find((list) => list.id === listId).systems) externalSystemNames.add(system.label);
    let valueSource;
    if (externalSystemNames.size) valueSource = { kind: "external-code-system", exhaustive: false, systems: [...externalSystemNames].map((name) => codeSystems[name] ?? { id: name, label: name, url: "" }), bundledListIds };
    else if (bundledListIds.length) valueSource = { kind: "bundled-list", exhaustive: false, bundledListIds };
    else if (elementInlineValues.length) valueSource = { kind: "inline-enumerated", exhaustive: true, values: elementInlineValues };
    else valueSource = { kind: "scalar" };
    return {
      id, section: id.split(".")[0], name: metadata.name, definition: metadata.definition,
      national: metadata.national, state: metadata.state, usage: metadata.usage, sourceDatatype,
      datatype: { base, xsdBase, constraints }, occurrence: { min: minimum, max: maximum },
      permittedNotValues: notValues, permittedPertinentNegatives: pertinentNegatives, valueSource,
    };
  }).sort(elementOrder);

  const sourceEntries = [
    { role: "data-dictionary", path: "nemsis-3.5.1-sources/Combined_ElementDetails_Full.txt", url: `${releaseBaseUrl}/DataDictionary/Ancillary/DEMEMS/Combined_ElementDetails_Full.txt`, content: dictionary },
    { role: "element-enumerations", path: "nemsis-3.5.1-sources/Combined_ElementEnumerations.txt", url: `${releaseBaseUrl}/DataDictionary/Ancillary/DEMEMS/Combined_ElementEnumerations.txt`, content: enumerations },
    ...xsdFiles.map((source) => ({ role: "xsd", path: `nemsis-3.5.1-sources/${source.relativePath}`, url: `${releaseBaseUrl}/XSDs/NEMSIS_XSDs.zip#NEMSIS_XSDs/${path.basename(source.relativePath)}`, content: source.content })),
    ...listFiles.map(({ specification, content }) => ({ role: `${specification.classification}-list`, path: `nemsis-3.5.1-sources/lists/${specification.filename}`, url: `${masterBaseUrl}/${specification.remotePath}`, content })),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const catalog = {
    catalog: "nemsis-ems-data-model", release: "3.5.1", dataset: "EMSDataSet", elementCount: elements.length,
    statistics: {
      inlineEnumerationElements: inlineValues.size,
      inlineEnumerationValues: [...inlineValues.values()].reduce((total, values) => total + values.length, 0),
      bundledLists: bundledLists.length, bundledListValues: bundledLists.reduce((total, list) => total + list.valueCount, 0),
      elementsWithNotValues: elements.filter((element) => element.permittedNotValues.length).length,
      notValues: elements.reduce((total, element) => total + element.permittedNotValues.length, 0),
      elementsWithPertinentNegatives: elements.filter((element) => element.permittedPertinentNegatives.length).length,
      pertinentNegatives: elements.reduce((total, element) => total + element.permittedPertinentNegatives.length, 0),
    },
    provenance: {
      publisher: "National Emergency Medical Services Information System (NEMSIS)", release: "NEMSIS 3.5.1", retrievedAt: retrievalDate,
      retrievalMethod: "HTTPS download of official versioned XSD/data-dictionary exports and official public defined/suggested JSON lists",
      generator: "apps/web/scripts/generate-nemsis-data-model.mjs",
      sources: sourceEntries.map(({ role, path: sourcePath, url, content }) => ({ role, path: sourcePath, url, sha256: sha256(content) })),
    },
    bundledLists, elements,
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function main() {
  const output = await generateCatalog();
  if (process.argv.includes("--stdout")) { process.stdout.write(output); return; }
  if (process.argv.includes("--check")) {
    let committed = "";
    try { committed = await readFile(outputPath, "utf8"); } catch { /* reported as drift below */ }
    if (committed !== output) { console.error("nemsis-data-model-3.5.1.json is stale. Run: npm run generate:nemsis-data-model"); process.exitCode = 1; return; }
    console.log("NEMSIS data model is current."); return;
  }
  await writeFile(outputPath, output);
  console.log(`Generated ${path.relative(webRoot, outputPath)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
});
