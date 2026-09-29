import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(webRoot, "app/data/nemsis-3.5.1-sources");
const xsdRoot = path.join(sourceRoot, "xsd");
const listRoot = path.join(sourceRoot, "lists");
const dictionaryPath = path.join(sourceRoot, "Combined_ElementDetails_Full.txt");
const enumerationsPath = path.join(sourceRoot, "Combined_ElementEnumerations.txt");
const catalogPath = path.join(webRoot, "../../defines/catalog/catalog_nemsis-3.5.1.json");
const schemaPath = path.join(webRoot, "../../defines/catalog/schema_nemsis-3.5.1.json");
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

function parseXml(content, sourceName) {
  const document = { name: "#document", attributes: {}, children: [] };
  const stack = [document];
  const tokens = content.toString("utf8").match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (!token.startsWith("<") || token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      const closed = stack.pop();
      if (!closed || closed.name !== name) throw new Error(`${sourceName}: unexpected closing tag ${name}`);
      continue;
    }
    const selfClosing = token.endsWith("/>");
    const body = token.slice(1, selfClosing ? -2 : -1).trim();
    const name = body.match(/^\S+/)?.[0];
    if (!name) throw new Error(`${sourceName}: malformed XML tag`);
    const attributes = {};
    const attributeBody = body.slice(name.length);
    let consumed = "";
    for (const match of attributeBody.matchAll(/\s+([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      attributes[match[1]] = decodeXml(match[3]);
      consumed += match[0];
    }
    if (consumed.replace(/\s/g, "") !== attributeBody.replace(/\s/g, "")) throw new Error(`${sourceName}: unsupported attributes on ${name}`);
    const node = { name, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`${sourceName}: unclosed XML tag ${stack.at(-1).name}`);
  return document;
}
function children(node, name) { return node.children.filter((child) => child.name === name); }
function child(node, name) { return children(node, name)[0]; }
function descendants(node, name) { return node.children.flatMap((candidate) => [candidate, ...descendants(candidate, name)]).filter((candidate) => candidate.name === name); }
function occurrence(attributes) {
  const min = attributes.minOccurs === undefined ? 1 : Number(attributes.minOccurs);
  const max = attributes.maxOccurs === "unbounded" ? "unbounded" : attributes.maxOccurs === undefined ? 1 : Number(attributes.maxOccurs);
  if (!Number.isInteger(min) || !(max === "unbounded" || Number.isInteger(max))) throw new Error(`Invalid XSD occurrence ${attributes.minOccurs ?? "1"}..${attributes.maxOccurs ?? "1"}`);
  return { min, max };
}

export function parseXsdStructure(xsdFiles) {
  const documents = xsdFiles.map(({ relativePath, content }) => ({ relativePath, root: parseXml(content, relativePath) }));
  const complexTypes = new Map();
  for (const { relativePath, root } of documents) {
    const schema = child(root, "xs:schema");
    for (const type of children(schema, "xs:complexType")) {
      const name = type.attributes.name;
      if (complexTypes.has(name)) throw new Error(`Duplicate XSD complex type ${name} in ${relativePath}`);
      complexTypes.set(name, type);
    }
  }
  const emsDocument = documents.find(({ relativePath }) => path.basename(relativePath) === "EMSDataSet_v3.xsd");
  const schema = child(emsDocument.root, "xs:schema");
  const rootElement = children(schema, "xs:element").find((node) => node.attributes.name === "EMSDataSet");
  if (!rootElement) throw new Error("EMSDataSet root element is absent from the pinned XSD");
  const groups = new Map();
  const elements = new Map();
  const elementPattern = /^(?:dAgency|e[A-Za-z]+)\.\d{2}$/;
  function particleElements(container) {
    const sequence = child(container, "xs:sequence") ?? child(child(container, "xs:complexType") ?? { children: [] }, "xs:sequence");
    return sequence ? children(sequence, "xs:element") : [];
  }
  function walk(node, groupPath) {
    const name = node.attributes.name;
    if (elementPattern.test(name)) {
      if (elements.has(name)) throw new Error(`Element ${name} occurs more than once in the EMS dataset structure`);
      const attributeNames = new Set(descendants(node, "xs:attribute").map((attribute) => attribute.attributes.name));
      elements.set(name, {
        xsdId: node.attributes.id,
        groupPath,
        occurrence: occurrence(node.attributes),
        nillable: node.attributes.nillable === "true",
        attributes: { NV: attributeNames.has("NV"), PN: attributeNames.has("PN") },
      });
      return;
    }
    const id = node.attributes.id ?? name;
    if (!id) throw new Error("Structural XSD element has neither id nor name");
    const structuralOccurrence = occurrence(node.attributes);
    const nextPath = [...groupPath, id];
    const structural = { id, name, parentId: groupPath.at(-1) ?? null, path: nextPath, occurrence: structuralOccurrence, repeating: structuralOccurrence.max === "unbounded" };
    const previous = groups.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(structural)) throw new Error(`Conflicting structural group identity ${id}`);
    groups.set(id, structural);
    const inlineType = child(node, "xs:complexType");
    const namedType = node.attributes.type ? complexTypes.get(node.attributes.type) : undefined;
    const content = inlineType ?? namedType;
    if (node.attributes.type && !content && (name === "EMSDataSet" || name.startsWith("e") || name === "PatientCareReport")) throw new Error(`Could not resolve structural type ${node.attributes.type} for ${name}`);
    for (const nested of content ? particleElements(content) : []) walk(nested, nextPath);
  }
  walk(rootElement, []);
  return { groups: [...groups.values()], elements };
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

function resolveXsdType(sourceDatatype, simpleTypes) {
  let current = sourceDatatype;
  const visited = new Set();
  const chain = [];
  const facets = {};
  while (!current.startsWith("xs:")) {
    if (visited.has(current)) throw new Error(`Circular XSD datatype definition for ${sourceDatatype}`);
    visited.add(current);
    const definition = simpleTypes.get(current);
    if (!definition) throw new Error(`Could not resolve XSD datatype ${sourceDatatype} (stopped at ${current})`);
    chain.push(current);
    for (const [facet, value] of Object.entries(definition.facets)) if (facets[facet] === undefined) facets[facet] = value;
    current = definition.base;
  }
  return { xsdBase: current, typeChain: chain, facets };
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
function groupDisplayName(identifier) {
  const segment = identifier.includes(".") ? identifier.split(".").at(-1) : identifier;
  return segment
    .replace(/^e(?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
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
  const structure = parseXsdStructure(xsdFiles);
  compareElementIds(dictionaryIds, new Set(xsdDocumentation.keys()), "data dictionary", "XSD");
  compareElementIds(dictionaryIds, new Set(structure.elements.keys()), "data dictionary", "XSD structure");

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
    const resolvedType = resolveXsdType(sourceDatatype, simpleTypes);
    const xsdBase = resolvedType.xsdBase;
    const base = usableBase(xsdBase);
    const constraints = {};
    for (const facet of facets) {
      const xsdValue = parseConstraint(resolvedType.facets[facet], facet, base);
      const dictionaryValue = parseConstraint(row[index[facet]], facet, base);
      if (xsdValue !== dictionaryValue) throw new Error(`${id} ${facet} differs between resolved XSD type ${sourceDatatype} and data dictionary (${String(xsdValue)} != ${String(dictionaryValue)})`);
      const value = xsdValue;
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
    const structural = structure.elements.get(id);
    const dictionaryNillable = row[index.IsNillable] === "Nillable";
    const dictionaryNV = row[index.NV] === "NV";
    const dictionaryPN = row[index.PN] === "PN";
    if (structural.nillable !== dictionaryNillable || structural.attributes.NV !== dictionaryNV || structural.attributes.PN !== dictionaryPN) throw new Error(`${id} nillability or NV/PN attributes differ between XSD and data dictionary`);
    if (JSON.stringify(structural.occurrence) !== JSON.stringify({ min: minimum, max: maximum })) throw new Error(`${id} occurrence differs between XSD and data dictionary`);
    return {
      id, section: id.split(".")[0], name: metadata.name, definition: metadata.definition,
      national: metadata.national, state: metadata.state, usage: metadata.usage, sourceDatatype,
      datatype: { base, xsdBase, typeChain: resolvedType.typeChain, constraints }, occurrence: structural.occurrence,
      xsdId: structural.xsdId, groupPath: structural.groupPath, nillable: structural.nillable, attributes: structural.attributes,
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
    $schema: "./schema_nemsis-3.5.1.json", schemaVersion: "1.0.0",
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
    groups: structure.groups.map((group) => ({ ...group, name: groupDisplayName(group.name) })), bundledLists, elements,
  };
  await validateCatalog(catalog);
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export async function validateCatalog(catalog) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(catalog)) throw new Error(`Catalog schema validation failed:\n${validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n")}`);
}

async function main() {
  const upstreamComparison = await generateCatalog();
  if (process.argv.includes("--stdout")) { process.stdout.write(upstreamComparison); return; }
  const canonical = await readFile(catalogPath, "utf8");
  if (canonical !== upstreamComparison) {
    console.error("The canonical catalog differs from the pinned NEMSIS source audit. Review and edit defines/catalog/catalog_nemsis-3.5.1.json directly.");
    process.exitCode = 1;
    return;
  }
  console.log("Canonical NEMSIS catalog matches the pinned upstream source audit.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
});
