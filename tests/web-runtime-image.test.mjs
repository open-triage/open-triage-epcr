import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const dockerfilePath = new URL("../deploy/docker/web.Dockerfile", import.meta.url);

function ignoredBuildInput(input, dockerignore) {
  const prefixes = input.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  let ignored = false;
  for (const raw of dockerignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const pattern = (negate ? line.slice(1) : line).replace(/^\.\//, "").replace(/^\/|\/$/g, "");
    if (prefixes.some((prefix) => matchesGlob(prefix, pattern) || !pattern.includes("/") && matchesGlob(prefix.split("/").at(-1), pattern))) ignored = !negate;
  }
  return ignored;
}

async function missingWebBuildInputs(dockerfile, dockerignore) {
  dockerignore ??= await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  const buildStage = dockerfile.split(/^FROM /m)[1];
  const copied = [...buildStage.matchAll(/^COPY (.+)$/gm)]
    .flatMap((match) => match[1].trim().split(/\s+/).slice(0, -1));
  const configurationPath = resolve(root, "apps/web/tsconfig.json");
  const configuration = ts.readConfigFile(configurationPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(configuration.config, ts.sys, dirname(configurationPath));
  const missing = new Set();
  const pending = [...fileNames], visited = new Set();
  while (pending.length) {
    const fileName = pending.pop();
    if (visited.has(fileName)) continue;
    visited.add(fileName);
    if (relative(root, fileName).split("/").some((part) => part.startsWith(".next"))) continue;
    const source = await readFile(fileName, "utf8");
    for (const imported of ts.preProcessFile(source).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const resolved = ts.resolveModuleName(imported.fileName, fileName, options, ts.sys).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const inputs = new Set([resolved.resolvedFileName]);
      // TypeScript resolves an explicit .mjs import to its .d.mts companion.
      // Both the runtime helper and its declarations must survive the context.
      const explicit = resolve(dirname(fileName), imported.fileName);
      if (ts.sys.fileExists(explicit)) inputs.add(explicit);
      for (const dependency of inputs) {
        const input = relative(root, dependency);
        // Next generates these declarations inside the build; they are not context inputs.
        if (input.split("/").some((part) => part.startsWith(".next"))) continue;
        if (!copied.some((path) => input === path || input.startsWith(`${path}/`)) || ignoredBuildInput(input, dockerignore)) missing.add(input);
        pending.push(dependency);
      }
    }
  }
  return [...missing].sort();
}

test("the web Docker build includes relative imports from application and test sources", async () => {
  assert.deepEqual(await missingWebBuildInputs(await readFile(dockerfilePath, "utf8")), []);
});

test("shared runtime helpers and type declarations remain in the actual Docker context", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");
  const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  for (const [pattern, required] of [
    ["tests/helpers", "tests/helpers/android-release-fixtures.mjs"],
    ["**/*.d.mts", "tests/helpers/android-release-fixtures.d.mts"],
    ["**/*.mjs", "tests/helpers/android-release-fixtures.mjs"],
  ]) assert.ok((await missingWebBuildInputs(dockerfile, `${dockerignore}\n${pattern}\n`)).includes(required));
  for (const suffix of ["d.ts", "d.mts", "mjs"]) {
    const input = `tests/helpers/example.${suffix}`;
    assert.equal(ignoredBuildInput(input, dockerignore), false);
    assert.equal(ignoredBuildInput(input, `${dockerignore}\n**/*.${suffix}\n`), true);
  }
});

test("the build-input guard catches shared fixtures and declaration-only helpers absent from the Docker context", async () => {
  const original = await readFile(dockerfilePath, "utf8");
  for (const [directory, required] of [
    ["tests/fixtures", "tests/fixtures/repeated-phone-dispatch.json"],
    ["tests/helpers", "tests/helpers/android-release-fixtures.d.mts"],
  ]) {
    const dockerfile = original.replace(`COPY ${directory} ${directory}\n`, "");
    assert.ok((await missingWebBuildInputs(dockerfile)).includes(required));
  }
});
