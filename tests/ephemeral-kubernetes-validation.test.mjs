import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const validatorPath = new URL("../scripts/validate-ephemeral-kubernetes.sh", import.meta.url);
const diagnosticsPath = new URL("../scripts/capture-kubernetes-diagnostics.sh", import.meta.url);
const postgresPath = new URL(
  "../deploy/kubernetes/validation/postgres.yaml",
  import.meta.url,
);
const negativeFixturesPath = new URL(
  "../deploy/kubernetes/validation/negative-fixtures.yaml",
  import.meta.url,
);

test("CI validates Kubernetes schemas and installs the exact candidate images in kind", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const validation = workflow.slice(
    workflow.indexOf("  ephemeral-kubernetes-validation:"),
    workflow.indexOf("  validation-gate:"),
  );

  assert.match(workflow,
    /ghcr\.io\/yannh\/kubeconform:v0\.8\.0-alpine@sha256:[0-9a-f]{64}/);
  assert.match(workflow, /-strict -summary -kubernetes-version 1\.35\.0/);
  assert.match(validation, /uses: helm\/kind-action@[0-9a-f]{40} # v1\.14\.0/);
  assert.match(validation, /version: v0\.31\.0/);
  assert.match(validation, /kubectl_version: v1\.35\.0/);
  assert.match(validation, /node_image: kindest\/node:v1\.35\.0@sha256:[0-9a-f]{64}/);
  assert.match(validation, /name: validated-api-image-/);
  assert.match(validation, /name: validated-web-image-/);
  assert.match(validation, /kind load docker-image --name open-triage-validation/);
  assert.match(validation, /kubectl apply --dry-run=server --filename=-/);
  assert.match(validation, /bash scripts\/validate-ephemeral-kubernetes\.sh/);
  assert.doesNotMatch(validation, /docker build/);

  const gate = workflow.slice(workflow.indexOf("  validation-gate:"));
  assert.match(gate, /^      - ephemeral-kubernetes-validation$/m);
});

test("candidate image artifacts are retained for pull-request cluster validation", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  for (const [component, label] of [["api", "API"], ["web", "web"]]) {
    const retain = workflow.indexOf(`      - name: Retain the exact validated ${label} image`);
    const upload = workflow.indexOf(`      - name: Upload the exact validated ${label} image`, retain);
    const nextJob = workflow.indexOf("\n\n  ", upload);
    const section = workflow.slice(retain, nextJob);

    assert.ok(retain >= 0, `missing ${component} image retention`);
    assert.doesNotMatch(section, /^        if: /m);
    assert.match(section, new RegExp(`validated-${component}-image-`));
  }
});

test("the ephemeral cluster exercises migration, probes, images, and bounded jobs", async () => {
  const validator = await readFile(validatorPath, "utf8");

  assert.match(validator, /deployment\/postgres/);
  assert.match(validator, /job\/open-triage-migration/);
  assert.match(validator, /deployment\/open-triage-api/);
  assert.match(validator, /deployment\/open-triage-web/);
  assert.match(validator, /\.status\.containerStatuses\[0\]\.ready/);
  assert.match(validator, /curl --fail --silent http:\/\/127\.0\.0\.1:3101\/api\/health/);
  assert.match(validator, /--from="cronjob\/open-triage-\$workload"/);
  assert.match(validator, /--for=condition=complete/);
  assert.match(validator, /imagePullPolicy=Never|image\.pullPolicy=Never/);
  await access(postgresPath);
});

test("negative fixtures cover secret keys, commands, scheduling, and probes", async () => {
  const [validator, fixtures] = await Promise.all([
    readFile(validatorPath, "utf8"),
    readFile(negativeFixturesPath, "utf8"),
  ]);

  for (const fixture of [
    "missing-secret-key",
    "invalid-command",
    "unschedulable",
    "failed-probe",
  ]) {
    assert.match(fixtures, new RegExp(`open-triage\\.dev/negative-fixture: ${fixture}`));
  }
  assert.match(validator, /CreateContainerConfigError/);
  assert.match(validator, /condition=failed/);
  assert.match(validator, /FailedScheduling.*Insufficient cpu/);
  assert.match(validator, /Unhealthy.*Readiness probe failed/);
});

test("failure artifacts contain cluster events, pod descriptions, and redacted logs", async () => {
  const [workflow, diagnostics] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(diagnosticsPath, "utf8"),
  ]);

  assert.match(workflow, /name: Capture redacted Kubernetes failure diagnostics/);
  assert.match(workflow, /name: Upload Kubernetes failure diagnostics/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(diagnostics, /kubectl get events --all-namespaces/);
  assert.match(diagnostics, /kubectl describe pod/);
  assert.match(diagnostics, /kubectl logs/);
  assert.match(diagnostics, /\[REDACTED\]/);
});
