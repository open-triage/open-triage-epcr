import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requireSuccessfulValidations,
  unsuccessfulValidationJobs,
} from "../scripts/require-demo-validation.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);

test("the required gate fails closed when any validation is unsuccessful", () => {
  const results = {
    "application-validation": { result: "success" },
    "database-validation": { result: "failure" },
    "web-deployment-validation": { result: "cancelled" },
    "helm-validation": { result: "skipped" },
  };

  assert.deepEqual(unsuccessfulValidationJobs(results), [
    "database-validation",
    "helm-validation",
    "web-deployment-validation",
  ]);
  assert.throws(
    () => requireSuccessfulValidations(results),
    /database-validation, helm-validation, web-deployment-validation/,
  );
});

test("the required gate accepts only an all-success result", () => {
  assert.doesNotThrow(() =>
    requireSuccessfulValidations({
      "application-validation": { result: "success" },
      "database-validation": { result: "success" },
      "web-deployment-validation": { result: "success" },
      "helm-validation": { result: "success" },
    }),
  );
});

test("the workflow exposes a least-privilege, stable required check", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const workflowPermissions = workflow.slice(
    workflow.indexOf("permissions:"),
    workflow.indexOf("jobs:"),
  );

  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflowPermissions, /^\s+[\w-]+: write$/m);
  assert.match(workflow, /^  validation-gate:\n    name: Required \/ Demo validation gate$/m);
  assert.match(workflow, /^    if: always\(\)$/m);
});

test("the gate depends on every application, database, web, and Helm validation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const gate = workflow.slice(workflow.indexOf("  validation-gate:"));

  for (const job of [
    "application-validation",
    "database-validation",
    "web-deployment-validation",
    "api-runtime-image-validation",
    "helm-validation",
  ]) {
    assert.match(gate, new RegExp(`^      - ${job}$`, "m"));
  }

  for (const command of [
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm run build",
    "npm run check:database",
    "npm run test:integration -w @open-triage/database",
    "npm run test:integration -w @open-triage/api",
    "npm run scale:test:ci -w @open-triage/database",
    "npm run test:deployment -w @open-triage/web",
    "docker build -f deploy/docker/api.Dockerfile",
    "helm lint",
    "helm template",
  ]) {
    assert.ok(workflow.includes(command), `missing required workflow command: ${command}`);
  }
});

test("the Kubernetes web artifact is built for root hosting", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const webValidation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  helm-validation:"),
  );

  assert.match(webValidation, /name: Test the root-hosted web artifact/);
  assert.doesNotMatch(webValidation, /NEXT_PUBLIC_BASE_PATH|open-triage-epcr-demo/);
});
