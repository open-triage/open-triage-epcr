import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

/** Builds the demo's complete Stationary form without widening the focused mobile profile. */
export async function syntheticStationaryDefinition() {
  const [catalog, mobileProfile] = await Promise.all([
    readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8").then(JSON.parse),
    readFile(path.join(repoRoot, "apps/web/app/data/standard-encounter-form.json"), "utf8").then(JSON.parse),
  ]);
  const report = catalog.groups.find(({ id }) => id === "PatientCareReportGroup");
  const header = catalog.groups.find(({ id }) => id === "HeaderGroup");
  if (!report || !header) throw new Error("The NEMSIS catalog is missing its Header or PatientCareReport boundary");
  const sectionRoots = catalog.groups.filter(({ parentId }) => parentId === report.id || parentId === header.id)
    .filter(({ id }) => id !== report.id);
  const sections = sectionRoots.map((group) => ({
    key: group.id,
    presentation: { title: group.name },
    fields: catalog.elements.filter((element) => element.groupPath.includes(group.id)).map((element) => ({
      key: element.id,
      source: { kind: "nemsis", elementId: element.id },
      configuration: {
        ...(mobileProfile.labels?.[element.id] ? { label: mobileProfile.labels[element.id] } : {}),
        ...(mobileProfile.helpText?.[element.id] ? { helpText: mobileProfile.helpText[element.id] } : {}),
      },
    })),
  }));
  const placed = sections.flatMap(({ fields }) => fields.map(({ source }) => source.elementId));
  if (placed.length !== catalog.elements.length || new Set(placed).size !== catalog.elements.length) {
    throw new Error(`The Stationary definition accounts for ${placed.length} of ${catalog.elements.length} NEMSIS elements`);
  }
  return { schemaVersion: 1, sections };
}
