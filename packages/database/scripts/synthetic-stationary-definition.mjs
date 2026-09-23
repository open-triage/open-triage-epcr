import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Reads the default published form from the installation definitions. */
export async function syntheticStationaryDefinition() {
  return (await syntheticStationaryInstallDefinition()).definition;
}

export async function syntheticStationaryInstallDefinition() {
  const selected = (await readInstallDefinitions(path.join(repository, "defines"))).defaultPair;
  return { definition: selected.form.definition, displayName: selected.name,
    catalogKey: selected.catalogKey, catalog: selected.catalog };
}
