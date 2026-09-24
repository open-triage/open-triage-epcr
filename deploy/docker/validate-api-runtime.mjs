import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function checkedNodeFile(filename, timeoutMilliseconds = 5_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filename], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let standardError = "";
    child.stderr.on("data", (chunk) => { standardError += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out validating ${filename}`));
    }, timeoutMilliseconds);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Invalid runtime entrypoint ${filename}: ${standardError.trim()}`));
    });
  });
}

export async function validateApiRuntime(runtimeRoot) {
  const manifestPath = path.join(runtimeRoot, "runtime/api-runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const databasePackage = JSON.parse(await readFile(
    path.join(runtimeRoot, "packages/database/package.json"),
    "utf8",
  ));
  const entrypoints = [manifest.application.entrypoint];
  for (const operation of manifest.operations) {
    const expected = `node ${path.relative("packages/database", operation.entrypoint)}`;
    if (databasePackage.scripts?.[operation.name] !== expected) {
      throw new Error(`Runtime command ${operation.name} does not select ${operation.entrypoint}`);
    }
    entrypoints.push(operation.entrypoint);
  }
  for (const entrypoint of entrypoints) {
    const absolute = path.join(runtimeRoot, entrypoint);
    await stat(absolute);
    await checkedNodeFile(absolute);
  }
  for (const module of manifest.moduleClosure) await stat(path.join(runtimeRoot, module));
  for (const asset of manifest.assets) await stat(path.join(runtimeRoot, asset));
  console.log(JSON.stringify({
    status: "valid",
    operationCount: manifest.operations.length,
    moduleCount: manifest.moduleClosure.length,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateApiRuntime(process.cwd()).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
