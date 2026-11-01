import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const dockerfilePath = new URL("../deploy/docker/web.Dockerfile", import.meta.url);

async function missingWebBuildInputs(dockerfile) {
  const buildStage = dockerfile.split(/^FROM /m)[1];
  const copied = [...buildStage.matchAll(/^COPY (.+)$/gm)]
    .flatMap((match) => match[1].trim().split(/\s+/).slice(0, -1));
  const configurationPath = resolve(root, "apps/web/tsconfig.json");
  const configuration = ts.readConfigFile(configurationPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(configuration.config, ts.sys, dirname(configurationPath));
  const missing = new Set();
  for (const fileName of fileNames) {
    if (relative(root, fileName).split("/").some((part) => part.startsWith(".next"))) continue;
    const source = await readFile(fileName, "utf8");
    for (const imported of ts.preProcessFile(source).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const resolved = ts.resolveModuleName(imported.fileName, fileName, options, ts.sys).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const input = relative(root, resolved.resolvedFileName);
      if (!copied.some((path) => input === path || input.startsWith(`${path}/`))) missing.add(input);
    }
  }
  return [...missing].sort();
}

test("the web Docker build includes relative imports from application and test sources", async () => {
  assert.deepEqual(await missingWebBuildInputs(await readFile(dockerfilePath, "utf8")), []);
});

test("the build-input guard catches shared fixtures absent from the Docker context", async () => {
  const dockerfile = (await readFile(dockerfilePath, "utf8"))
    .replace(/^COPY tests\/fixtures tests\/fixtures\n/m, "");
  assert.ok((await missingWebBuildInputs(dockerfile)).includes("tests/fixtures/repeated-phone-dispatch.json"));
});
