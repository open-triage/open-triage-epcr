import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DispatchValidationCatalog } from "../../api/src/dispatch/dispatch-assignment.validation.js";
import { buildDemoFixtures } from "./demo-fixture-core.js";

async function main(): Promise<void> {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repositoryRoot = resolve(webRoot, "../..");
  const sourcePath = resolve(repositoryRoot, "packages/contracts/examples/dispatch/synthetic-assignment.json");
  const sourceBytes = await readFile(sourcePath);
  const sample: unknown = JSON.parse(sourceBytes.toString("utf8"));
  const catalog = JSON.parse(await readFile(resolve(webRoot, "app/data/nemsis-data-model-3.5.1.json"), "utf8")) as DispatchValidationCatalog;
  const fixtures = buildDemoFixtures(sample, catalog, sourceBytes);
  const outputs = new Map<string, unknown>([
    [resolve(webRoot, "public/demo-assigned-calls.json"), fixtures.assignedCalls],
    [resolve(webRoot, "public/demo-open-calls.json"), fixtures.openCalls],
    [resolve(webRoot, "public/demo-open-assignment.json"), fixtures.openAssignment],
    [resolve(webRoot, "app/data/synthetic-encounter-document.json"), fixtures.encounterDocument],
  ]);

  for (const [path, value] of outputs) {
    const expected = `${JSON.stringify(value, null, 2)}\n`;
    if (process.argv.includes("--check")) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current !== expected) throw new Error(`${path} is stale; run npm run generate:demo-fixtures -w @open-triage/web`);
    } else await writeFile(path, expected);
  }
}

void main();
