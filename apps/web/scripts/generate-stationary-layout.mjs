import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(webRoot, "../../defines/catalog/catalog_nemsis-3.5.1.json");
const outputPath = path.join(webRoot, "app/data/stationary-layout-1.0.0.json");

function groupPresentation(group, elements) {
  const descendants = elements.filter((element) => element.groupPath.includes(group.id));
  const columns = descendants.slice(0, 4).map(({ id }) => ({ elementId: id }));
  if (group.repeating) return { kind: "table", columns };
  return { kind: "inline" };
}

export async function generateStationaryLayout() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const patientCareGroups = new Set(catalog.groups.filter((group) => group.path.includes("PatientCareReportGroup")).map(({ id }) => id));
  const layout = {
    $schema: "./stationary-layout.schema-1.0.0.json",
    schemaVersion: "1.0.0",
    profileId: "open-triage.stationary.full-record",
    catalog: { release: catalog.release, dataset: catalog.dataset, elementCount: catalog.elements.length, groupCount: catalog.groups.length },
    customNamespaces: [],
    groups: catalog.groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      mode: group.path.includes("eCustomResultsSection") ? "enhanced" : patientCareGroups.has(group.id) ? "editable" : "read-only",
      presentation: groupPresentation(group, catalog.elements),
    })),
    elements: catalog.elements.map((element) => ({
      id: element.id,
      groupId: element.groupPath.at(-1),
      mode: element.section === "eCustomResults" ? "enhanced" : element.groupPath.includes("PatientCareReportGroup") ? "editable" : "read-only",
    })),
  };
  return `${JSON.stringify(layout, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const generated = await generateStationaryLayout();
  if (process.argv.includes("--check")) {
    const committed = await readFile(outputPath, "utf8").catch(() => "");
    if (committed !== generated) {
      console.error("stationary-layout-1.0.0.json is stale; run npm run generate:stationary-layout");
      process.exitCode = 1;
    }
  } else await writeFile(outputPath, generated);
}
