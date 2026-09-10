import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deploymentValues } from "../scripts/demo-deployment-values.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const valuesPath = new URL("../deploy/helm/open-triage/values.yaml", import.meta.url);
const apiTemplatePath = new URL("../deploy/helm/open-triage/templates/api.yaml", import.meta.url);
const webTemplatePath = new URL("../deploy/helm/open-triage/templates/web.yaml", import.meta.url);
const sha = "0123456789abcdef0123456789abcdef01234567";

function identity(component) {
  return {
    component,
    tag: `ghcr.io/open-triage/open-triage-${component}:${sha}`,
    digest: `sha256:${(component === "api" ? "a" : "b").repeat(64)}`,
    architecture: "linux/amd64",
    sourceCommit: sha,
  };
}

test("deployment values come only from a verified image manifest", () => {
  const manifest = {
    schemaVersion: 1,
    sourceCommit: sha,
    images: { api: identity("api"), web: identity("web") },
  };

  assert.deepEqual(deploymentValues(manifest, { owner: "open-triage", sha }), {
    "api-repository": "ghcr.io/open-triage/open-triage-api",
    "api-tag": sha,
    "web-repository": "ghcr.io/open-triage/open-triage-web",
    "web-tag": sha,
  });
  assert.throws(
    () => deploymentValues({ ...manifest, sourceCommit: "f".repeat(40) }, { owner: "open-triage", sha }),
    /source commit/,
  );
});

test("deployment follows image publication and uses serialized, scoped DOKS access", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const deploy = workflow.slice(workflow.indexOf("  deploy-demo:"));

  assert.match(workflow, /^concurrency:\n  group: .*'demo-deployment'/m);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
  assert.match(deploy, /^    needs: publish-image-manifest$/m);
  assert.match(deploy, /^    environment: demo$/m);
  assert.match(deploy, /^    permissions:\n      contents: read$/m);
  assert.match(deploy, /token: \$\{\{ secrets\.DIGITALOCEAN_ACCESS_TOKEN \}\}/);
  assert.match(deploy, /kubeconfig save .*--expiry-seconds 600/);
  assert.doesNotMatch(deploy, /KUBE_CONFIG|KUBECONFIG_DATA/);
});

test("deployment verifies the run manifest and uses a bounded atomic Helm rollout", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const deploy = workflow.slice(workflow.indexOf("  deploy-demo:"));

  assert.match(deploy, /name: demo-deployment-images-\$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/);
  assert.match(deploy, /node scripts\/demo-deployment-values\.mjs/);
  for (const safeguard of ["--atomic", "--cleanup-on-fail", "--wait", "--timeout 10m"]) {
    assert.ok(deploy.includes(safeguard), `missing Helm safeguard: ${safeguard}`);
  }
  assert.match(deploy, /--values deploy\/helm\/open-triage\/demo-reference\.values\.yaml/);
  assert.match(deploy, /api\.image\.tag="\$\{\{ steps\.images\.outputs\.api-tag \}\}"/);
  assert.match(deploy, /web\.image\.tag="\$\{\{ steps\.images\.outputs\.web-tag \}\}"/);
});

test("Helm validation uses the same committed values as the demo deployment", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(
    workflow.match(/--values deploy\/helm\/open-triage\/demo-reference\.values\.yaml/g)?.length,
    3,
    "lint, template, and deployment must share the demo values",
  );
  assert.doesNotMatch(workflow, /--reuse-values/);
});

test("manual redeploy accepts only a full revision reachable from main", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^      deployment_revision:$/m);
  assert.match(workflow, /\[\[ "\$DEPLOYMENT_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /git merge-base --is-ancestor "\$DEPLOYMENT_REVISION" origin\/main/);
});

test("one-replica demo deployments explicitly allow replacement downtime", async () => {
  const [values, apiTemplate, webTemplate] = await Promise.all([
    readFile(valuesPath, "utf8"),
    readFile(apiTemplatePath, "utf8"),
    readFile(webTemplatePath, "utf8"),
  ]);

  assert.equal((values.match(/strategy: Recreate/g) ?? []).length, 2);
  assert.match(apiTemplate, /strategy:\n    type: \{\{ \.Values\.api\.strategy \}\}/);
  assert.match(webTemplate, /strategy:\n    type: \{\{ \.Values\.web\.strategy \}\}/);
});

test("deployment fails unless the public HTTPS smoke verification passes", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const deploy = workflow.slice(workflow.indexOf("  deploy-demo:"));
  const rollout = deploy.indexOf("helm upgrade --install");
  const smoke = deploy.indexOf("node scripts/demo-smoke-test.mjs");

  assert.ok(rollout >= 0 && smoke > rollout, "public smoke verification must follow the rollout");
  assert.match(deploy, /uses: actions\/setup-node@v4[\s\S]*node-version: 22/);
  assert.match(deploy, /DEMO_WEB_URL: https:\/\/demo\.opentriage\.org/);
  assert.match(deploy, /DEMO_API_URL: https:\/\/api\.demo\.opentriage\.org/);
  assert.doesNotMatch(deploy, /continue-on-error/);
});

test("the demo web image is built with the synthetic installation profile", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /NEXT_PUBLIC_API_URL=https:\/\/api\.demo\.opentriage\.org[\s\S]*NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE=synthetic-demo/);
});
