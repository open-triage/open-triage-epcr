import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionRoots = [path.join(webRoot, "app"), path.join(webRoot, "components")];
const metadataProperties = /\b(?:sourceDatatype|xsdBase|typeChain|groupPath|nillable|permittedNotValues|permittedPertinentNegatives|valueSource)\s*:/;
const hardcodedConstraints = /\bboundaries\s*:\s*\{[^}]*\b(?:min|max)\s*:\s*-?\d/s;
const hardcodedNullChoices = /\babsenceStates\s*:\s*\[\s*\{\s*code\s*:/s;
const hardcodedStandardCode = /["'](?:39|77|88|99)\d{5,}["']/;
const duplicateCatalogImport = /from\s+["'][^"']*(?:medications\.nemsis|nemsis-procedures)[^"']*["']/;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

export function catalogGuardrailViolations(source, relativePath) {
  if (!/\.(?:ts|tsx)$/.test(relativePath)) return [];
  const violations = [];
  if (metadataProperties.test(source)) violations.push("duplicates generated element metadata");
  if (duplicateCatalogImport.test(source)) violations.push("imports a duplicate NEMSIS value catalog");
  if (/(?:definition|profile)\.(?:ts|tsx)$/.test(relativePath)) {
    if (hardcodedConstraints.test(source)) violations.push("hardcodes structural boundaries in a form profile");
    if (hardcodedNullChoices.test(source)) violations.push("hardcodes NV/PN choices in a form profile");
    if (hardcodedStandardCode.test(source)) violations.push("hardcodes a NEMSIS code/value in a form profile");
  }
  return violations;
}

export async function checkCatalogGuardrails() {
  const violations = [];
  for (const filename of (await Promise.all(productionRoots.map(filesUnder))).flat()) {
    const relativePath = path.relative(webRoot, filename).replaceAll(path.sep, "/");
    if (relativePath === "app/nemsis-data-model.ts") continue;
    const source = await readFile(filename, "utf8");
    for (const message of catalogGuardrailViolations(source, relativePath)) violations.push(`${relativePath}: ${message}`);
  }
  if (violations.length) throw new Error(`NEMSIS catalog-only guardrail failed:\n${violations.join("\n")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkCatalogGuardrails().then(() => {
  console.log("NEMSIS production metadata is catalog-only.");
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
