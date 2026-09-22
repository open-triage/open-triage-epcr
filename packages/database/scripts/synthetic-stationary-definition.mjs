import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Reads the default published form from the installation definitions. */
export async function syntheticStationaryDefinition() {
  const form = JSON.parse(await readFile(path.join(repository, "defines/forms/form_nemsis-full.json"), "utf8"));
  if (form.schemaVersion !== 1 || form.key !== "nemsis-full" || !form.default) {
    throw new Error("The default NEMSIS full form definition is invalid");
  }
  return form.definition;
}
