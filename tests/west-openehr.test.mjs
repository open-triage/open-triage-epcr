import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the published WEST-A template matches the current definition and adult picker", () => {
  const generator = fileURLToPath(new URL("../scripts/generate-west-openehr.mjs", import.meta.url));
  execFileSync(process.execPath, [generator, "--check"], { stdio: "inherit" });
});
