import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.env.DOCKER_COMMAND || "docker", [
  "run", "--rm", "--volume", `${root}:/repo:ro`, "--workdir", "/repo",
  "rhysd/actionlint:1.7.12", "-color", "-shellcheck=", "-pyflakes=",
], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
