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
  assert.match(deploy, /^    needs: \[publish-image-manifest, prepare-demo-database\]$/m);
  assert.match(deploy, /^    environment: demo$/m);
  assert.match(deploy, /^    permissions:\n      contents: read$/m);
  assert.match(deploy, /token: \$\{\{ secrets\.DIGITALOCEAN_ACCESS_TOKEN \}\}/);
  assert.match(deploy, /kubeconfig save .*--expiry-seconds 1800/);
  assert.match(deploy, /needs\.prepare-demo-database\.result == 'success'/);
  assert.doesNotMatch(deploy, /scripts\/provision-demo-workload-secrets\.sh/);
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
  assert.match(deploy, /helm_status=\$\?/);
  assert.match(deploy, /exit "\$helm_status"/);
});

test("database preparation is independently observable and gates application rollout", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const prepare = workflow.slice(
    workflow.indexOf("  prepare-demo-database:"),
    workflow.indexOf("  deploy-demo:"),
  );
  const deploy = workflow.slice(workflow.indexOf("  deploy-demo:"));

  assert.match(prepare, /name: Prepare \/ Disposable demo database/);
  assert.match(prepare, /^    needs: publish-image-manifest$/m);
  assert.match(prepare, /node scripts\/demo-deployment-values\.mjs/);
  assert.match(prepare, /bash scripts\/prepare-demo-database\.sh/);
  assert.match(prepare, /Provision isolated demo workload credentials/);
  assert.match(prepare, /DEMO_DATABASE_EXPECTED_HOST: \$\{\{ vars\.DEMO_DATABASE_EXPECTED_HOST \}\}/);
  assert.match(prepare, /DEMO_DATABASE_PROJECT_REF: \$\{\{ vars\.DEMO_DATABASE_PROJECT_REF \}\}/);
  assert.match(prepare, /name: database-preparation-\$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/);
  assert.match(prepare, /--tail=300 --limit-bytes=262144/);
  assert.match(prepare, /\[REDACTED\]/);
  assert.match(prepare, /retention-days: 14/);
  assert.ok(deploy.indexOf("helm upgrade --install") > deploy.indexOf("needs: [publish-image-manifest, prepare-demo-database]"));
});

test("Helm validation uses the same committed values as the demo deployment", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(
    workflow.match(/--values deploy\/helm\/open-triage\/demo-reference\.values\.yaml/g)?.length,
    4,
    "lint, template, ephemeral validation, and deployment must share the demo values",
  );
  assert.doesNotMatch(workflow, /--reuse-values/);
});

test("manual redeploy accepts only the full current main revision", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^      deployment_revision:$/m);
  assert.match(workflow, /\[\[ "\$DEPLOYMENT_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /git merge-base --is-ancestor "\$DEPLOYMENT_REVISION" origin\/main/);
  assert.ok(workflow.includes('test "$DEPLOYMENT_REVISION" = "$(git rev-parse origin/main)"'));
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
  assert.match(deploy,
    /uses: actions\/setup-node@[0-9a-f]{40} # v4\.4\.0[\s\S]*node-version: 22\.23\.3/);
  assert.match(deploy, /DEMO_WEB_URL: https:\/\/demo\.opentriage\.org/);
  assert.match(deploy, /DEMO_API_URL: https:\/\/api\.demo\.opentriage\.org/);
  assert.doesNotMatch(deploy, /continue-on-error/);
});

test("the demo web image is built with only its public API location", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /NEXT_PUBLIC_API_URL: https:\/\/api\.demo\.opentriage\.org/);
  assert.match(workflow, /--build-arg NEXT_PUBLIC_API_URL="\$NEXT_PUBLIC_API_URL"/);
  assert.doesNotMatch(workflow, /INSTALLATION_SETTINGS_BASELINE/);
});
