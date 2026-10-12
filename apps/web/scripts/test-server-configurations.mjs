import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Run every browser unit test under each supported server routing configuration.
// Do not let a developer's shell hide assumptions that fail in a clean CI job.
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter(name => name.endsWith(".test.ts")).map(name => `tests/${name}`);
for (const apiUrl of [undefined, "same-origin", "https://api.example.test/"]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXT_PUBLIC_")) delete env[key];
  }
  if (apiUrl !== undefined) env.NEXT_PUBLIC_API_URL = apiUrl;
  console.log(`Browser unit tests: API=${apiUrl ?? "unset"}`);
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
