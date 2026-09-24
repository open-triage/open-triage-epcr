import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) resolve();
      else reject(new Error(`${command} ${signal ? `received ${signal}` : `exited ${exitCode}`}`));
    });
  });
}

// The API suite owns its complete foundation. This avoids both depending on a database suite that
// happened to run first and racing partial, per-test migration checks inside Node's test runner.
await run(process.execPath, [path.join(repoRoot, "packages/database/scripts/migrate.mjs")]);
await run(process.execPath, ["--test", "tests/postgres.integration.test.mjs"]);
