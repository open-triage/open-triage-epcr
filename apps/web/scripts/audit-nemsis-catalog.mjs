import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCatalog } from "./generate-nemsis-data-model.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(webRoot, "app/data");

function rows(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const parse = (line) => {
    if (!line.startsWith("'") || !line.endsWith("'|")) throw new Error(`Malformed official export row: ${line.slice(0, 80)}`);
    return line.slice(1, -2).split("'|'");
  };
  const headers = parse(lines.shift());
  return { index: Object.fromEntries(headers.map((header, index) => [header, index])), values: lines.map(parse) };
}

function compare(label, expected, actual) {
  const counts = (values) => { const result = new Map(); values.forEach((value) => result.set(value, (result.get(value) ?? 0) + 1)); return result; };
  const expectedCounts = counts(expected); const actualCounts = counts(actual);
  const missing = [...expectedCounts].filter(([value, count]) => (actualCounts.get(value) ?? 0) !== count);
  const additions = [...actualCounts].filter(([value, count]) => (expectedCounts.get(value) ?? 0) !== count);
  if (missing.length || additions.length) throw new Error(`${label} coverage drift; omissions: ${missing.map(([v]) => v).join(", ") || "none"}; unexplained additions: ${additions.map(([v]) => v).join(", ") || "none"}`);
}

export async function auditCatalog() {
  const [committedText, dictionaryText, enumerationText] = await Promise.all([
    readFile(path.join(webRoot, "../../defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"),
    readFile(path.join(dataRoot, "nemsis-3.5.1-sources/Combined_ElementDetails_Full.txt"), "utf8"),
    readFile(path.join(dataRoot, "nemsis-3.5.1-sources/Combined_ElementEnumerations.txt"), "utf8"),
  ]);
  const generatedText = await generateCatalog();
  if (committedText !== generatedText) throw new Error("Catalog regeneration is not byte-for-byte identical; run npm run generate:nemsis-data-model");
  const catalog = JSON.parse(committedText);
  const dictionary = rows(dictionaryText);
  const officialElements = dictionary.values.filter((row) => row[dictionary.index.DatasetName] === "EMSDataSet" && row[dictionary.index.DatasetType] === "element").map((row) => row[dictionary.index.ElementNumber]);
  compare("element", officialElements, catalog.elements.map(({ id }) => id));
  const enumerations = rows(enumerationText);
  const officialValues = enumerations.values.filter((row) => row[enumerations.index.DatasetName] === "EMSDataSet").map((row) => `${row[enumerations.index.ElementNumber]}\u0000${row[enumerations.index.Code]}\u0000${row[enumerations.index.CodeDescription]}`);
  const catalogValues = catalog.elements.flatMap((element) => (element.valueSource.values ?? []).map(({ code, label }) => `${element.id}\u0000${code}\u0000${label}`));
  compare("enumeration", officialValues, catalogValues);
  return { elements: officialElements.length, enumerations: officialValues.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) auditCatalog().then(({ elements, enumerations }) => {
  console.log(`Catalog exactly covers ${elements} official elements and ${enumerations} official enumerations; deterministic regeneration passed.`);
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
