import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  demo: new URL("../.github/workflows/demo-validation.yml", import.meta.url),
  database: new URL("../.github/workflows/database-postgresql.yml", import.meta.url),
  apiDockerfile: new URL("../deploy/docker/api.Dockerfile", import.meta.url),
  webDockerfile: new URL("../deploy/docker/web.Dockerfile", import.meta.url),
  kubernetesPostgres: new URL("../deploy/kubernetes/validation/postgres.yaml", import.meta.url),
  webPackage: new URL("../apps/web/package.json", import.meta.url),
  lockfile: new URL("../package-lock.json", import.meta.url),
  dependabot: new URL("../.github/dependabot.yml", import.meta.url),
  policy: new URL("../docs/ci-toolchain-pins.md", import.meta.url),
};

const contents = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, url]) =>
  [name, await readFile(url, "utf8")])),
);
const workflows = `${contents.demo}\n${contents.database}`;

test("external Actions use immutable reviewed commits with readable release comments", () => {
  const externalUses = [...workflows.matchAll(/^\s*uses:\s+([^./\s][^@\s]+)@([^\s#]+)(?:\s+#\s+([^\s]+))?$/gm)];
  assert.ok(externalUses.length > 20);
  for (const [, action, revision, release] of externalUses) {
    assert.match(revision, /^[0-9a-f]{40}$/, `${action} must use a full commit SHA`);
    assert.match(release ?? "", /^v\d+\.\d+\.\d+$/, `${action} must retain a readable version comment`);
  }
  assert.doesNotMatch(workflows, /uses:\s+[^\n]+@(main|master|latest|v\d+)(?:\s|$)/);
});

test("runner, executable, browser, service, and runtime image versions are exact", () => {
  assert.doesNotMatch(workflows, /ubuntu-latest|node-version:\s*["']?22["']?\s*$/m);
  assert.match(workflows, /runs-on: ubuntu-24\.04/);
  assert.match(workflows, /node-version: 22\.23\.3/);
  assert.match(workflows, /version: v3\.19\.0/);
  assert.match(workflows, /version: 1\.173\.0/);
  assert.match(workflows, /uses: helm\/kind-action@[0-9a-f]{40} # v1\.14\.0/);
  assert.match(workflows,
    /node_image: kindest\/node:v1\.35\.0@sha256:[0-9a-f]{64}/);
  assert.match(workflows,
    /ghcr\.io\/yannh\/kubeconform:v0\.8\.0-alpine@sha256:[0-9a-f]{64}/);
  assert.match(workflows,
    /image: postgres:15\.19-bookworm@sha256:[0-9a-f]{64}/);
  assert.match(contents.kubernetesPostgres,
    /image: postgres:15\.19-bookworm@sha256:[0-9a-f]{64}/);

  for (const dockerfile of [contents.apiDockerfile, contents.webDockerfile]) {
    for (const line of dockerfile.match(/^FROM .+$/gm) ?? []) {
      assert.match(line, /^FROM [^\s:]+:[^\s@]+@sha256:[0-9a-f]{64}(?: AS \w+)?$/);
    }
  }
  assert.equal(JSON.parse(contents.webPackage).devDependencies["@playwright/test"], "1.62.1");
  assert.equal(JSON.parse(contents.lockfile).packages["apps/web"].devDependencies["@playwright/test"], "1.62.1");
  assert.match(workflows, /npx --no-install playwright install --with-deps chromium/);
});

test("failure artifacts identify the source and lane with bounded retention", () => {
  const uploadSteps = workflows.split(/\n(?=\s*- name:|\s*- uses:)/)
    .filter((step) => step.includes("actions/upload-artifact@"));
  assert.ok(uploadSteps.length >= 12);
  for (const step of uploadSteps) {
    assert.match(step, /name: .*(inputs\.(deployment_revision|checkout_ref) \|\| github\.sha)/);
    assert.match(step, /retention-days: (1|14)/);
  }
  for (const evidence of [
    "unit-tests.tap", "database-lanes", "playwright-results", "container.log",
    "image-identity.json", "job-results.json", "deployment-diagnostics",
  ]) assert.ok(workflows.includes(evidence), `missing retained evidence: ${evidence}`);
  assert.doesNotMatch(workflows, /kubectl get secrets|kubectl describe secrets/);
});

test("pin updates are proposed and must prove themselves through the complete gate", () => {
  for (const ecosystem of ["github-actions", "docker", "npm"]) {
    assert.match(contents.dependabot, new RegExp(`package-ecosystem: ${ecosystem}`));
  }
  assert.match(contents.policy, /git ls-remote/);
  assert.match(contents.policy, /registry manifest digest/);
  assert.match(contents.policy, /required gate covers application unit\/workflow tests/i);
  assert.match(contents.policy, /Do not merge the update if any lane is skipped\s+unexpectedly or fails/i);
  assert.match(contents.policy, /never contain credentials or clinical content/i);
});
