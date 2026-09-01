import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(webRoot, "app/data/nemsis-3.5.1-sources");
const xsdRoot = path.join(sourceRoot, "xsd");
const dictionaryPath = path.join(sourceRoot, "Combined_ElementDetails_Full.txt");
const outputPath = path.join(webRoot, "app/data/nemsis-data-model-3.5.1.json");
const releaseBaseUrl = "https://nemsis.org/media/nemsis_v3/release-3.5.1";
const retrievalDate = "2026-09-01";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseDelimitedLine(line) {
  if (!line.startsWith("'") || !line.endsWith("'|")) throw new Error(`Unsupported data-dictionary row: ${line.slice(0, 80)}`);
  return line.slice(1, -2).split("'|'");
}

function decodeXml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
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
      const documentedNumber = tag(block, "number");
      const id = documentedNumber.match(/^[de][A-Za-z]+\.\d{2}/)?.[0] ?? "";
      if (!id) continue;
      if (documentation.has(id)) throw new Error(`Duplicate XSD documentation for ${id}`);
      documentation.set(id, {
        id,
        name: tag(block, "name"),
        definition: tag(block, "definition"),
        national: tag(block, "national") === "Yes",
        state: tag(block, "state") === "Yes",
        usage: tag(block, "usage"),
      });
    }
  }
  return documentation;
}

function compareElementIds(left, right, leftName, rightName) {
  const missing = [...left].filter((id) => !right.has(id));
  const extra = [...right].filter((id) => !left.has(id));
  if (missing.length || extra.length) {
    throw new Error(`${leftName}/${rightName} element mismatch; missing from ${rightName}: ${missing.join(", ") || "none"}; missing from ${leftName}: ${extra.join(", ") || "none"}`);
  }
}

function elementOrder(left, right) {
  const [leftSection, leftNumber] = left.id.split(".");
  const [rightSection, rightNumber] = right.id.split(".");
  if (leftSection < rightSection) return -1;
  if (leftSection > rightSection) return 1;
  return Number(leftNumber) - Number(rightNumber);
}

async function readSources() {
  const rootXsd = await readFile(path.join(xsdRoot, "EMSDataSet_v3.xsd"));
  const includes = [...rootXsd.toString("utf8").matchAll(/<xs:include schemaLocation="([^"]+)"\s*\/>/g)].map((match) => match[1]);
  const pinnedXsdNames = (await readdir(xsdRoot)).filter((name) => name.endsWith(".xsd")).sort();
  const expectedXsdNames = ["EMSDataSet_v3.xsd", ...includes].sort();
  if (JSON.stringify(pinnedXsdNames) !== JSON.stringify(expectedXsdNames)) {
    throw new Error("Pinned XSD files must exactly match EMSDataSet_v3.xsd and its declared includes");
  }

  const xsdFiles = await Promise.all(pinnedXsdNames.map(async (name) => ({
    relativePath: `xsd/${name}`,
    content: await readFile(path.join(xsdRoot, name)),
  })));
  return { xsdFiles, dictionary: await readFile(dictionaryPath) };
}

export async function generateCatalog() {
  const { xsdFiles, dictionary } = await readSources();
  const lines = dictionary.toString("utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseDelimitedLine(lines.shift());
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const requiredHeaders = ["DatasetName", "DatasetType", "ElementNumber", "ElementName", "National", "State", "Definition", "Usage", "MinOccurs", "MaxOccurs", "DataType"];
  for (const header of requiredHeaders) if (index[header] === undefined) throw new Error(`Data dictionary is missing ${header}`);

  const rows = lines.map(parseDelimitedLine).filter((row) => row[index.DatasetName] === "EMSDataSet" && row[index.DatasetType] === "element");
  const dictionaryIds = new Set(rows.map((row) => row[index.ElementNumber]));
  if (dictionaryIds.size !== rows.length) throw new Error("Data dictionary contains duplicate EMSDataSet element identifiers");

  const xsdDocumentation = parseXsdDocumentation(xsdFiles);
  compareElementIds(dictionaryIds, new Set(xsdDocumentation.keys()), "data dictionary", "XSD");

  const elements = rows.map((row) => {
    const id = row[index.ElementNumber];
    const xsd = xsdDocumentation.get(id);
    const dictionaryMetadata = {
      name: row[index.ElementName],
      definition: row[index.Definition],
      national: row[index.National] === "National",
      state: row[index.State] === "State",
      usage: row[index.Usage],
    };
    for (const field of ["name", "national", "state", "usage"]) {
      if (xsd[field] !== dictionaryMetadata[field]) throw new Error(`${id} ${field} differs between the XSD and data dictionary`);
    }
    if (!dictionaryMetadata.definition || !row[index.DataType]) throw new Error(`${id} is missing required catalog metadata`);
    const minimum = Number(row[index.MinOccurs]);
    const rawMaximum = row[index.MaxOccurs];
    const maximum = rawMaximum === "M" ? "unbounded" : Number(rawMaximum);
    if (!Number.isInteger(minimum) || !(maximum === "unbounded" || Number.isInteger(maximum))) throw new Error(`${id} has invalid occurrence metadata`);

    return {
      id,
      section: id.split(".")[0],
      name: dictionaryMetadata.name,
      definition: dictionaryMetadata.definition,
      national: dictionaryMetadata.national,
      state: dictionaryMetadata.state,
      usage: dictionaryMetadata.usage,
      sourceDatatype: row[index.DataType],
      occurrence: { min: minimum, max: maximum },
    };
  }).sort(elementOrder);

  const sourceEntries = [
    {
      role: "data-dictionary",
      path: "nemsis-3.5.1-sources/Combined_ElementDetails_Full.txt",
      url: `${releaseBaseUrl}/DataDictionary/Ancillary/DEMEMS/Combined_ElementDetails_Full.txt`,
      content: dictionary,
    },
    ...xsdFiles.map((source) => ({
      role: "xsd",
      path: `nemsis-3.5.1-sources/${source.relativePath}`,
      url: `${releaseBaseUrl}/XSDs/NEMSIS_XSDs.zip#NEMSIS_XSDs/${path.basename(source.relativePath)}`,
      content: source.content,
    })),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  const catalog = {
    catalog: "nemsis-ems-data-model",
    release: "3.5.1",
    dataset: "EMSDataSet",
    elementCount: elements.length,
    provenance: {
      publisher: "National Emergency Medical Services Information System (NEMSIS)",
      release: "NEMSIS 3.5.1",
      retrievedAt: retrievalDate,
      retrievalMethod: "HTTPS download of the official versioned XSD archive and data-dictionary export",
      generator: "apps/web/scripts/generate-nemsis-data-model.mjs",
      sources: sourceEntries.map(({ role, path: sourcePath, url, content }) => ({
        role,
        path: sourcePath,
        url,
        sha256: sha256(content),
      })),
    },
    elements,
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function main() {
  const output = await generateCatalog();
  if (process.argv.includes("--stdout")) {
    process.stdout.write(output);
    return;
  }
  if (process.argv.includes("--check")) {
    let committed = "";
    try { committed = await readFile(outputPath, "utf8"); } catch { /* reported as drift below */ }
    if (committed !== output) {
      console.error("nemsis-data-model-3.5.1.json is stale. Run: npm run generate:nemsis-data-model");
      process.exitCode = 1;
      return;
    }
    console.log("NEMSIS data model is current.");
    return;
  }
  await writeFile(outputPath, output);
  console.log(`Generated ${path.relative(webRoot, outputPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
