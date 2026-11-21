import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packagePath = new URL("../apps/web/package.json", import.meta.url);
const nextConfigPath = new URL("../apps/web/next.config.ts", import.meta.url);
const deploymentConfigPath = new URL("../apps/web/playwright.deployment.config.ts", import.meta.url);
const deploymentSpecPath = new URL("../apps/web/e2e/deployment.spec.ts", import.meta.url);
const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);

test("web start serves the static export instead of launching a Next server", async () => {
  const [packageText, nextConfig, deploymentConfig] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(nextConfigPath, "utf8"),
    readFile(deploymentConfigPath, "utf8"),
  ]);
  const webPackage = JSON.parse(packageText);

  assert.equal(webPackage.scripts.start, "npm run serve:static");
  assert.equal(webPackage.scripts["serve:static"], "node scripts/serve-static.mjs");
  assert.doesNotMatch(webPackage.scripts.start, /next start/);
  assert.match(nextConfig, /output: process.env.NODE_ENV === "development" \? undefined : "export"/);
  assert.match(deploymentConfig, /command: "npm start"/);
});

test("deployment validation builds, starts, and fetches the exported application", async () => {
  const [workflow, deploymentSpec] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(deploymentSpecPath, "utf8"),
  ]);
  const validation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  helm-validation:"),
  );

  assert.match(validation, /npm run build -w @open-triage\/web/);
  assert.match(validation, /npm run test:deployment -w @open-triage\/web/);
  assert.match(deploymentSpec, /request\.get\("\/"\)/);
  assert.match(deploymentSpec, /expect\(response\.status\(\)\)\.toBe\(200\)/);
});

test("browser suites that load local API fixtures build them before discovery", async () => {
  const { scripts } = JSON.parse(await readFile(packagePath, "utf8"));
  const browserCommands = Object.keys(scripts).filter(name =>
    name !== "test:public-demo" && scripts[name].includes("playwright test"));
  assert.ok(browserCommands.length > 0);
  for (const command of browserCommands) {
    assert.equal(scripts[`pre${command}`], "npm run build -w @open-triage/api",
      `${command} must prepare renderer and other API-backed fixtures before Playwright loads tests`);
  }
});

test("the public demo suite discovers its deployed browser workflows without an API prebuild", async () => {
  const { scripts } = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(scripts["pretest:public-demo"], undefined);
  const output = execFileSync("npm", ["run", "test:public-demo", "--", "--list"], {
    cwd: fileURLToPath(new URL("../apps/web/", import.meta.url)),
    env: { ...process.env, DEMO_WEB_URL: "https://demo.invalid" },
    encoding: "utf8",
  });
  assert.match(output, /demo-workflows\.spec\.ts/);
  assert.match(output, /Total: [1-9]\d* tests? in [1-9]\d* files?/);
});
