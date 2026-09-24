import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requireSuccessfulValidations,
  unsuccessfulValidationJobs,
} from "../scripts/require-demo-validation.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const databaseWorkflowPath = new URL("../.github/workflows/database-postgresql.yml", import.meta.url);

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
  const [workflow, databaseWorkflow] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(databaseWorkflowPath, "utf8"),
  ]);
  const gate = workflow.slice(workflow.indexOf("  validation-gate:"));

  for (const job of [
    "application-validation",
    "database-validation",
    "web-deployment-validation",
    "browser-critical-validation",
    "api-runtime-image-validation",
    "helm-validation",
    "ephemeral-kubernetes-validation",
  ]) {
    assert.match(gate, new RegExp(`^      - ${job}$`, "m"));
  }

  for (const command of [
    "npm run typecheck",
    "npm run lint",
    "npm run test:unit",
    "npm run test:workflow",
    "npm run build",
    "npm run test:deployment -w @open-triage/web",
    "npm run test:e2e:critical -w @open-triage/web",
    "npm run test:helm",
    "--file deploy/docker/api.Dockerfile",
    "helm lint",
    "helm template",
  ]) {
    assert.ok(workflow.includes(command), `missing required workflow command: ${command}`);
  }

  assert.match(workflow, /^    uses: \.\/\.github\/workflows\/database-postgresql\.yml$/m);
  for (const command of [
    "npm run check:database",
    "npm run migrate -w @open-triage/database",
    "npm run test:integration -w @open-triage/database",
    "npm run test:integration -w @open-triage/api",
    "npm run load:catalog -w @open-triage/database",
    "npm run bootstrap:synthetic:runtime -w @open-triage/database",
    "npm run scale:test:ci -w @open-triage/database",
  ]) {
    assert.ok(databaseWorkflow.includes(command), `missing required database workflow command: ${command}`);
  }
  assert.match(databaseWorkflow, /image: postgres:15\.14-bookworm/);
  assert.match(databaseWorkflow, /fixture: plain/);
  assert.match(databaseWorkflow, /fixture: managed/);
  assert.match(databaseWorkflow, /packages\/database\/fixtures\/ci-postgresql\.sql/);
  assert.match(databaseWorkflow, /Start the API through its least-privileged runtime login/);
});

test("database validation is reused once across non-overlapping event coverage", async () => {
  const [demoWorkflow, databaseWorkflow] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(databaseWorkflowPath, "utf8"),
  ]);

  assert.match(demoWorkflow, /^  push:\n    branches: \[main\]$/m);
  assert.match(demoWorkflow, /^  pull_request:$/m);
  assert.match(databaseWorkflow, /^  push:\n    branches: \[feature\/database-foundation\]$/m);
  assert.doesNotMatch(databaseWorkflow, /^  pull_request:/m);
  assert.match(databaseWorkflow, /^  workflow_dispatch:$/m);
  assert.match(databaseWorkflow, /^  workflow_call:$/m);
  assert.doesNotMatch(databaseWorkflow, /branches: \[[^\]]*main/);
  assert.match(demoWorkflow, /checkout_ref: \$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/);

  for (const command of [
    "npm run check:database",
    "npm run test:integration -w @open-triage/database",
    "npm run test:integration -w @open-triage/api",
    "npm run scale:test:ci -w @open-triage/database",
  ]) {
    assert.equal(
      [demoWorkflow, databaseWorkflow].reduce((count, source) => count + (source.split(command).length - 1), 0),
      1,
      `${command} must have exactly one workflow definition`,
    );
  }
});

test("pull requests run the critical artifact journey and main runs the complete browser suite", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const critical = workflow.slice(
    workflow.indexOf("  browser-critical-validation:"),
    workflow.indexOf("  browser-e2e-validation:"),
  );
  const complete = workflow.slice(
    workflow.indexOf("  browser-e2e-validation:"),
    workflow.indexOf("  api-runtime-image-validation:"),
  );

  assert.match(critical, /Build the production-style web artifact/);
  assert.match(critical, /npm run test:e2e:critical -w @open-triage\/web/);
  assert.match(critical, /apps\/web\/playwright-results\/critical/);
  assert.match(critical, /apps\/web\/playwright-artifacts\/critical-server\.log/);
  assert.match(complete, /^    if: github\.event_name != 'pull_request'$/m);
  assert.match(complete, /npm run test:e2e -w @open-triage\/web/);
  assert.match(complete, /apps\/web\/playwright-results\/e2e/);
  assert.match(workflow, /needs\.browser-e2e-validation\.result == 'success'/);
});

test("Helm validation pins its CLI and runs every maintained behavior test", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const helm = workflow.slice(
    workflow.indexOf("  helm-validation:"),
    workflow.indexOf("  validation-gate:"),
  );

  assert.match(helm, /uses: azure\/setup-helm@v4/);
  assert.match(helm, /version: v3\.19\.0/);
  assert.match(helm, /npm run test:helm/);
});

test("the Kubernetes web artifact is built for root hosting", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const webValidation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  helm-validation:"),
  );

  assert.match(webValidation, /name: Test the root-hosted Nginx container/);
  assert.doesNotMatch(webValidation, /NEXT_PUBLIC_BASE_PATH|open-triage-epcr-demo/);
});
