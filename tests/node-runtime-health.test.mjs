import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";
import { checkNodeRuntime, parseFilesystem } from "../scripts/check-node-runtime.mjs";

const filesystem = (total, available, mount = "/run/cilium") =>
  `Filesystem Blocks Used Available Capacity Mounted on\ntmpfs ${total} ${total - available} ${available} 3% ${mount}\n`;

function fixture({ freeBlocks = 196760, freeInodes = 251201, totalBlocks = 202124 } = {}) {
  const nodes = [{ metadata: { name: "worker-a" }, status: { nodeInfo: { operatingSystem: "linux" }, conditions: [{ type: "Ready", status: "True" }] } }];
  const pods = [{ metadata: { name: "cilium-fixture" }, spec: {
    nodeName: "worker-a", volumes: [{ name: "runtime", hostPath: { path: "/var/run/cilium" } }],
    containers: [{ name: "cilium-agent", volumeMounts: [{ name: "runtime", mountPath: "/var/run/cilium" }] }],
  }, status: { phase: "Running", containerStatuses: [{ name: "cilium-agent", ready: true }] } }];
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "get") return JSON.stringify({ items: args[1] === "nodes" ? nodes : pods });
    assert.deepEqual(args.slice(args.indexOf("--")), ["--", "env", "LC_ALL=C", "df", args.includes("-Pk") ? "-Pk" : "-Pi", "/var/run/cilium"]);
    return args.includes("-Pk") ? filesystem(totalBlocks, freeBlocks) : filesystem(252652, freeInodes);
  };
  return { nodes, pods, calls, run, log() {} };
}

test("runtime health measures the host mount in both bytes and inodes without changing the cluster", () => {
  const probe = fixture();
  const [report] = checkNodeRuntime(probe);
  assert.equal(report.healthy, true);
  assert.equal(report.freeBytes, 196760 * 1024);
  assert.equal(probe.calls.filter((args) => args[0] === "exec").length, 2);
  assert.ok(probe.calls.every((args) => ["get", "exec"].includes(args[0])));
});

test("low runtime bytes fail even when df reports an incorrect percentage", () => {
  assert.throws(() => checkNodeRuntime(fixture({ freeBlocks: 50000 })), /Runtime storage exceeds/);
});

test("inode exhaustion and low absolute headroom also fail", () => {
  assert.throws(() => checkNodeRuntime(fixture({ freeInodes: 40000 })), /Runtime storage exceeds/);
  assert.throws(() => checkNodeRuntime(fixture({ totalBlocks: 40000, freeBlocks: 30000 })), /Runtime storage exceeds/);
});

test("the warning threshold fails at its boundary and invalid configuration is rejected", () => {
  const probe = fixture({ totalBlocks: 200000, freeBlocks: 60000 });
  assert.throws(() => checkNodeRuntime(probe), /Runtime storage exceeds/);
  assert.equal(checkNodeRuntime({ ...probe, thresholdPercent: 71 })[0].healthy, true);
  assert.throws(() => checkNodeRuntime({ ...probe, thresholdPercent: 100 }), /Invalid runtime-space thresholds/);
});

test("every node must be ready and covered by a running agent with the host mount", () => {
  for (const mutate of [
    (probe) => { probe.nodes[0].status.conditions[0].status = "False"; },
    (probe) => { probe.pods[0].status.containerStatuses[0].ready = false; },
    (probe) => { probe.pods[0].spec.volumes[0].hostPath.path = "/somewhere-else"; },
    (probe) => { probe.nodes.push({ ...probe.nodes[0], metadata: { name: "worker-b" } }); },
  ]) {
    const probe = fixture(); mutate(probe);
    assert.throws(() => checkNodeRuntime(probe), /worker-[ab]:/);
  }
  const probe = fixture(); probe.nodes.length = 0;
  assert.throws(() => checkNodeRuntime(probe), /No node\/network-agent inventory/);
});

test("missing probes, malformed capacity and inconsistent mounts fail closed", () => {
  for (const output of ["", "Filesystem only", filesystem(0, 0), filesystem(100, 101), filesystem(100, -1), filesystem(100, 90) + filesystem(100, 90)]) {
    assert.throws(() => parseFilesystem(output));
  }
  assert.throws(() => checkNodeRuntime({ run() { throw new Error("timeout"); } }), /timeout/);
  const probe = fixture();
  assert.throws(() => checkNodeRuntime({ ...probe, run(args) {
    return args.includes("-Pi") ? filesystem(252652, 251201, "/different") : probe.run(args);
  } }), /Filesystem probes do not agree/);
});

test("deployment and scheduled monitoring share the same read-only runtime check", async () => {
  const deployment = load(await readFile(new URL("../.github/workflows/demo-validation.yml", import.meta.url), "utf8"));
  const health = load(await readFile(new URL("../.github/workflows/demo-node-health.yml", import.meta.url), "utf8"));
  const steps = deployment.jobs["deploy-demo"].steps;
  const check = steps.findIndex((step) => step.run === "node scripts/check-node-runtime.mjs");
  const rollout = steps.findIndex((step) => step.name === "Atomically deploy tested images");
  assert.ok(check > steps.findIndex((step) => step.name === "Obtain an expiring DOKS kubeconfig") && check < rollout);
  assert.match(steps[check].env.KUBECONFIG, /runner.temp/);
  assert.equal(health.on.schedule[0].cron, "17,47 * * * *");
  assert.equal(health.jobs["runtime-health"].environment, "demo");
  assert.equal(health.jobs["runtime-health"]["timeout-minutes"], 5);
  assert.deepEqual(health.permissions, { contents: "read" });
  assert.ok(health.jobs["runtime-health"].steps.some((step) => step.run === steps[check].run));
});
