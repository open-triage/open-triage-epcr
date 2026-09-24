import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePattern = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']([^"']+)["']/g;

function safeRepositoryPath(repositoryRoot, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty repository-relative path`);
  }
  const resolved = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the repository: ${relativePath}`);
  }
  return resolved;
}

async function copyRepositoryPath(repositoryRoot, outputRoot, relativePath) {
  const source = safeRepositoryPath(repositoryRoot, relativePath, "Runtime source");
  await stat(source);
  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

function localModuleSpecifiers(source) {
  return [...source.matchAll(modulePattern)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}

async function copyModuleClosure(repositoryRoot, outputRoot, entrypoint, included) {
  const absoluteEntrypoint = safeRepositoryPath(repositoryRoot, entrypoint, "Runtime entrypoint");
  await stat(absoluteEntrypoint);
  const relativeEntrypoint = path.relative(repositoryRoot, absoluteEntrypoint);
  if (included.has(relativeEntrypoint)) return;
  included.add(relativeEntrypoint);
  await copyRepositoryPath(repositoryRoot, outputRoot, relativeEntrypoint);

  const extension = path.extname(absoluteEntrypoint);
  if (![".js", ".mjs", ".cjs"].includes(extension)) return;
  const source = await readFile(absoluteEntrypoint, "utf8");
  for (const specifier of localModuleSpecifiers(source)) {
    const dependency = path.relative(repositoryRoot, path.resolve(path.dirname(absoluteEntrypoint), specifier));
    await copyModuleClosure(repositoryRoot, outputRoot, dependency, included);
  }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.application?.entrypoint !== "string") {
    throw new Error("API runtime manifest must define schemaVersion 1 and an application entrypoint");
  }
  if (!Array.isArray(manifest.operations) || manifest.operations.length === 0) {
    throw new Error("API runtime manifest must declare at least one operation");
  }
  const names = new Set();
  for (const operation of manifest.operations) {
    if (typeof operation?.name !== "string" || typeof operation?.entrypoint !== "string") {
      throw new Error("Every API runtime operation must define a name and entrypoint");
    }
    if (names.has(operation.name)) throw new Error(`Duplicate API runtime operation: ${operation.name}`);
    names.add(operation.name);
  }
  if (!Array.isArray(manifest.assets)) throw new Error("API runtime manifest assets must be an array");
  return manifest;
}

export async function generateApiRuntime({ repositoryRoot, manifestPath, outputRoot }) {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const asset of manifest.assets) await copyRepositoryPath(repositoryRoot, outputRoot, asset);

  const includedModules = new Set();
  await copyModuleClosure(repositoryRoot, outputRoot, manifest.application.entrypoint, includedModules);
  for (const operation of manifest.operations) {
    await copyModuleClosure(repositoryRoot, outputRoot, operation.entrypoint, includedModules);
  }

  const databasePackagePath = path.join(repositoryRoot, "packages/database/package.json");
  const databasePackage = JSON.parse(await readFile(databasePackagePath, "utf8"));
  const runtimePackage = {
    name: databasePackage.name,
    version: databasePackage.version,
    license: databasePackage.license,
    private: true,
    type: databasePackage.type,
    scripts: Object.fromEntries(manifest.operations.map(({ name, entrypoint }) => [
      name,
      `node ${path.relative("packages/database", entrypoint)}`,
    ])),
    dependencies: databasePackage.dependencies,
  };
  await mkdir(path.join(outputRoot, "packages/database"), { recursive: true });
  await writeFile(
    path.join(outputRoot, "packages/database/package.json"),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
  );

  const runtimeManifest = {
    schemaVersion: manifest.schemaVersion,
    application: manifest.application,
    operations: manifest.operations,
    assets: manifest.assets,
    moduleClosure: [...includedModules].sort(),
  };
  await mkdir(path.join(outputRoot, "runtime"), { recursive: true });
  await writeFile(
    path.join(outputRoot, "runtime/api-runtime-manifest.json"),
    `${JSON.stringify(runtimeManifest, null, 2)}\n`,
  );
  return runtimeManifest;
}

async function main() {
  const [manifestArgument, outputArgument] = process.argv.slice(2);
  if (!manifestArgument || !outputArgument) {
    throw new Error("Usage: generate-api-runtime.mjs MANIFEST OUTPUT_DIRECTORY");
  }
  const repositoryRoot = process.cwd();
  await generateApiRuntime({
    repositoryRoot,
    manifestPath: path.resolve(repositoryRoot, manifestArgument),
    outputRoot: path.resolve(repositoryRoot, outputArgument),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
