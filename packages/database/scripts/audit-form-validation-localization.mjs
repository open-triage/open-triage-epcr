import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";
import { applyFormValidationLocalization } from "./lib/form-validation-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../defines");
const definitions = await readInstallDefinitions(root);
const profiles = [];
for (const pair of definitions.pairs) {
  const coverage = await applyFormValidationLocalization(root, pair.form, pair.validation);
  profiles.push({ key: pair.key, ...coverage });
}
process.stdout.write(`${JSON.stringify({ language: "sv", profiles }, null, 2)}\n`);
