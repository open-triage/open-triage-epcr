import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogLocalizationSeed } from "./lib/catalog-localization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8"));
const { coverage } = await readCatalogLocalizationSeed(path.join(root,
  "defines/localization/localization_sv.json"), catalog);
const report = { language: "sv", catalogKey: "nemsis-3.5.1", ...coverage };
console.log(JSON.stringify(report, null, 2));
if (Object.values(coverage.missing).some((ids) => ids.length)) process.exitCode = 1;
