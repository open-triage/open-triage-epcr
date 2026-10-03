import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAll } from "js-yaml";
import { deployKubernetes, deploymentContract, deploymentOptions, podSpec } from "../../../../scripts/deploy-kubernetes.mjs";

const chart = fileURLToPath(new URL("..", import.meta.url));
const values = fileURLToPath(new URL("../production-reference.values.yaml", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;
function render(...extra) {
  return loadAll(execFileSync("helm", ["template", "open-triage", chart, "--values", values,
    "--set", "web.host=epcr.agency.test,api.host=api.epcr.agency.test,web.image.repository=registry.agency.test/web,api.image.repository=registry.agency.test/api,web.image.tag=release123,api.image.tag=release123,ingress.tls[0].hosts[0]=epcr.agency.test,ingress.tls[0].hosts[1]=api.epcr.agency.test", ...extra], { encoding: "utf8" })).filter(Boolean);
}

test("production render passes restricted workload, database, image and Contour contracts", () => {
  const objects = render(), contract = deploymentContract(objects);
  assert.deepEqual([...contract.classes], ["contour"]);
  assert.equal(contract.secrets.size, 7);
  const pods = objects.map(podSpec).filter(Boolean);
  assert.equal(pods.length, 7);
  for (const pod of pods) assert.deepEqual(pod.imagePullSecrets, [{ name: "registry-pull" }]);
  const web = objects.find((object) => object.kind === "Deployment" && object.metadata.name.endsWith("-web"));
  assert.equal(web.spec.template.spec.containers[0].ports[0].containerPort, 8080);
  const api = objects.find((object) => object.kind === "Deployment" && object.metadata.name.endsWith("-api"));
  assert.equal(api.spec.template.spec.containers[0].startupProbe.failureThreshold, 24);
  for (const variable of api.spec.template.spec.containers[0].env.filter(({ name }) => name.startsWith("SUPABASE"))) assert.equal(variable.valueFrom.secretKeyRef.optional, true);
  const ingress = objects.filter(({ kind }) => kind === "Ingress");
  assert.equal(ingress.length, 1);
  assert.equal(ingress[0].metadata.annotations["ingress.kubernetes.io/force-ssl-redirect"], "true");
  assert.ok(Object.keys(ingress[0].metadata.annotations).every((key) => !key.startsWith("nginx.")));
});

test("digest pinning applies to the API and every operational workload", () => {
  const objects = render("--set", `api.image.digest=${digest},web.image.digest=${digest}`);
  const contract = deploymentContract(objects);
  assert.equal(contract.images.size, 2);
  for (const image of contract.images) assert.ok(image.endsWith(`@${digest}`));
});

test("preflight blocks demo/managed secrets, unsafe pods and synthetic bootstrap", () => {
  assert.throws(() => deploymentContract(render("--set", "web.image.tag=latest")), /immutable/);
  assert.throws(() => deploymentContract(render("--set", "web.replicas=1")), /at least 2/);
  assert.throws(() => deploymentContract(render("--set", "migration.bootstrapSynthetic=true")), /bootstrapSynthetic/);
  assert.throws(() => deploymentContract(render("--set", "podSecurityContext.runAsNonRoot=false")), /non-root/);
  assert.throws(() => deploymentContract([...render(), { kind: "Secret" }]), /cluster-owned/);
});

function runner(objects, { missingKey = false } = {}) {
  const calls = [];
  return { calls, execute: async (command, args, settings = {}) => {
    calls.push({ command, args, settings });
    if (command === "kubectl" && args.includes("create")) return JSON.stringify({ kind: "List", items: objects });
    if (command === "kubectl" && args.includes("secret")) {
      const name = args[args.indexOf("secret") + 1];
      if (name === "registry-pull") return "kubernetes.io/dockerconfigjson\n.dockerconfigjson\n";
      if (name === "open-triage-tls") return "kubernetes.io/tls\ntls.crt\ntls.key\n";
      return "Opaque\nDATABASE_URL\nPATIENT_KEY_INSTALLATION_ID\nPATIENT_KEY_VERSION\nPATIENT_KEY_SECRET_BASE64\nAUTH_RATE_LIMIT_SECRET_BASE64\nOFFLINE_RECOVERY_KEY_VERSION\n" + (missingKey ? "" : "OFFLINE_RECOVERY_SECRET_BASE64\n");
    }
    return "";
  }, log: { info() {} } };
}

test("default preflight uses explicit context everywhere and performs no rollout", async () => {
  const objects = render(), mock = runner(objects);
  await deployKubernetes(deploymentOptions(["--context", "workload", "--values", values]), mock);
  assert.ok(mock.calls.every(({ command, args }) => command !== "helm" || !args.includes("upgrade")));
  for (const { args } of mock.calls.filter(({ command }) => command === "kubectl")) assert.deepEqual(args.slice(0, 4), ["--context", "workload", "--namespace", "open-triage"]);
  const admission = JSON.parse(mock.calls.find(({ args }) => args.includes("--dry-run=server")).settings.input);
  const original = objects.find(({ kind }) => kind === "Job");
  assert.notEqual(admission.items.find(({ kind }) => kind === "Job").metadata.name, original.metadata.name);
  assert.ok(admission.items.find(({ kind }) => kind === "Job").metadata.name.length <= 63);
});

test("apply waits for jobs and rollout, while missing required keys stop deployment", async () => {
  const options = deploymentOptions(["--context", "workload", "--values", values, "--apply"]);
  const good = runner(render());
  await deployKubernetes(options, good);
  const upgrade = good.calls.find(({ args }) => args.includes("upgrade"));
  for (const flag of ["--install", "--wait", "--wait-for-jobs", "--kube-context"]) assert.ok(upgrade.args.includes(flag));
  assert.ok(!upgrade.args.includes("--atomic"));
  const bad = runner(render(), { missingKey: true });
  await assert.rejects(deployKubernetes(options, bad), /nonempty OFFLINE_RECOVERY_SECRET_BASE64/);
  assert.ok(!bad.calls.some(({ args }) => args.includes("upgrade")));
  assert.throws(() => deploymentOptions(["--values", values]), /--context/);
});
