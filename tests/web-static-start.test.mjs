import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(nextConfig, /output: "export"/);
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
