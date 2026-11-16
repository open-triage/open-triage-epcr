import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";
import { runInNewContext } from "node:vm";

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
    "installation-config": { result: "failure" },
  };

  assert.deepEqual(unsuccessfulValidationJobs(results), [
    "database-validation",
    "helm-validation",
    "installation-config",
    "web-deployment-validation",
  ]);
  assert.throws(
    () => requireSuccessfulValidations(results),
    /database-validation, helm-validation, installation-config, web-deployment-validation/,
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
    "api-runtime-image-validation",
    "helm-validation",
    "installation-config",
  ]) {
    assert.match(gate, new RegExp(`^      - ${job}$`, "m"));
  }

  for (const command of [
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm run build",
    "npm run test:deployment -w @open-triage/web",
    "docker build -f deploy/docker/api.Dockerfile",
    "helm lint",
    "helm template",
  ]) {
    assert.ok(workflow.includes(command), `missing required workflow command: ${command}`);
  }

  assert.match(workflow, /^    uses: \.\/\.github\/workflows\/database-postgresql\.yml$/m);
  for (const command of [
    "npm run check:database",
    "npm run test:integration -w @open-triage/database",
    "npm run test:integration -w @open-triage/api",
    "npm run scale:test:ci -w @open-triage/database",
  ]) {
    assert.ok(databaseWorkflow.includes(command), `missing required database workflow command: ${command}`);
  }
});

test("database validation is reused once across non-overlapping event coverage", async () => {
  const [demoWorkflow, databaseWorkflow] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(databaseWorkflowPath, "utf8"),
  ]);

  const general = yaml.load(demoWorkflow), database = yaml.load(databaseWorkflow);
  assert.deepEqual(general.on.push, { branches: ["**"] }, "All branch pushes, including nested feature names, receive general validation; tags do not");
  assert.equal(general.on.pull_request, null, "All PR targets receive general validation");
  assert.equal(database.on.push, undefined, "Database checks run through the general workflow without duplicate push runs");
  assert.equal(database.on.pull_request, undefined, "Database checks run through the general workflow without duplicate PR runs");
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

test("the Kubernetes web artifact is built for root hosting", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const webValidation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  helm-validation:"),
  );

  assert.match(webValidation, /name: Test the root-hosted web artifact/);
  assert.doesNotMatch(webValidation, /NEXT_PUBLIC_BASE_PATH|open-triage-epcr-demo/);
});

// Configuration syntax and chart compatibility are read-only checks that must
// fail on PRs, before the main-only publishing/deployment stages.
test("operator configuration is validated on PRs and blocks publication", async () => {
  const { load } = await import("js-yaml");
  const { jobs } = load(await readFile(workflowPath, "utf8"));
  assert.equal(jobs["installation-config"].if, undefined);
  assert.equal(jobs["installation-config"].needs, "validate-deployment-revision");
  assert.ok(jobs["validation-gate"].needs.includes("installation-config"));
  assert.ok(jobs["publish-images"].needs.includes("validation-gate"));
});

// Exercise the actual YAML conditions so broadening triggers cannot accidentally
// publish feature images, deploy a PR, or serialize feature checks with releases.
test("publication and deployment stay on main while feature validation runs independently", async () => {
  const workflow = yaml.load(await readFile(workflowPath, "utf8"));
  const jobs = ["publish-images", "publish-image-manifest", "deploy-demo"];
  const needs = Object.fromEntries(["validation-gate", "publish-images", "publish-image-manifest"].map(name => [name, { result: "success" }]));
  const evaluate = (expression, github, results = needs) => runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.([\w-]+)/g, 'needs["$1"]'), {
    github, needs: results, format: (pattern, ref) => pattern.replace("{0}", ref),
  });
  for (const [event, ref, deploy] of [
    ["push", "refs/heads/main", true],
    ["workflow_dispatch", "refs/heads/main", true],
    ["push", "refs/heads/feature/android_app", false],
    ["push", "refs/heads/feature/future/nested", false],
    ["push", "refs/heads/fix/future", false],
    ["push", "refs/tags/android-v10-0.1.0", false],
    ["workflow_dispatch", "refs/heads/feature/future", false],
    ["pull_request", "refs/pull/123/merge", false],
    ["pull_request", "refs/heads/main", false],
  ]) {
    const github = { event_name: event, ref };
    for (const job of jobs) assert.equal(evaluate(workflow.jobs[job].if, github), deploy, `${job}: ${event} ${ref}`);
    assert.equal(evaluate(workflow.concurrency.group, github), deploy ? "demo-deployment" : `demo-validation-${ref}`);
  }
  for (const job of jobs) {
    const failed = Object.fromEntries(Object.keys(needs).map(name => [name, { result: "failure" }]));
    assert.equal(evaluate(workflow.jobs[job].if, { event_name: "push", ref: "refs/heads/main" }, failed), false);
  }
  assert.equal(workflow.concurrency["cancel-in-progress"], false, "Never cancel an active deployment");
  for (const job of workflow.jobs["validation-gate"].needs) assert.equal(workflow.jobs[job].if, undefined, `${job}: validate every triggering branch and PR`);
});
