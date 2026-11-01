import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseFilesystem(output) {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 2) throw new Error("Expected one filesystem from df");
  const columns = lines[1].trim().split(/\s+/);
  if (columns.length !== 6) throw new Error("Invalid filesystem row from df");
  const [filesystem, total, used, available, percent, mount] = columns;
  const values = [total, used, available].map(Number);
  if (!mount || !/^\d+%$/.test(percent ?? "") ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0) || values[0] === 0 || values[2] > values[0]) {
    throw new Error("Invalid filesystem capacity from df");
  }
  return { filesystem, mount, total: values[0], available: values[2], usedPercent: 100 * (1 - values[2] / values[0]) };
}

function kubectl(args) {
  const result = spawnSync("kubectl", ["--request-timeout=15s", ...args], {
    encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("kubectl probe failed or timed out");
  return result.stdout;
}

export function checkNodeRuntime({ run = kubectl, log = console.log, thresholdPercent = 70, minimumFreeBytes = 32 * 1024 * 1024 } = {}) {
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent >= 100 ||
      !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) throw new Error("Invalid runtime-space thresholds");
  const nodes = JSON.parse(run(["get", "nodes", "--output=json"])).items;
  const pods = JSON.parse(run(["get", "pods", "--namespace=kube-system", "--selector=k8s-app=cilium", "--output=json"])).items;
  if (!Array.isArray(nodes) || nodes.length === 0 || !Array.isArray(pods)) throw new Error("No node/network-agent inventory available");
  const failures = [];
  const reports = [];
  for (const node of nodes) {
    const name = node.metadata.name;
    try {
      if (node.status.nodeInfo?.operatingSystem !== "linux" ||
          !node.status.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")) {
        throw new Error("Node is not a ready Linux worker");
      }
      const pod = pods.find((candidate) => candidate.spec.nodeName === name && !candidate.metadata.deletionTimestamp &&
        candidate.status.phase === "Running" && candidate.status.containerStatuses?.some((container) => container.name === "cilium-agent" && container.ready));
      if (!pod) throw new Error("No running Cilium agent available to inspect host runtime storage");
      const volume = pod.spec.volumes?.find((candidate) => ["/var/run/cilium", "/run/cilium"].includes(candidate.hostPath?.path));
      const container = pod.spec.containers.find((candidate) => candidate.name === "cilium-agent");
      const mount = volume && container?.volumeMounts?.find((candidate) => candidate.name === volume.name);
      if (!mount) throw new Error("Cilium agent does not expose the host runtime filesystem");
      const probe = (flag) => parseFilesystem(run(["exec", "--namespace=kube-system", pod.metadata.name,
        "--container=cilium-agent", "--", "env", "LC_ALL=C", "df", flag, mount.mountPath]));
      const bytes = probe("-Pk");
      const inodes = probe("-Pi");
      if (bytes.filesystem !== inodes.filesystem || bytes.mount !== inodes.mount) throw new Error("Filesystem probes do not agree");
      const freeBytes = bytes.available * 1024;
      const healthy = bytes.usedPercent < thresholdPercent && inodes.usedPercent < thresholdPercent && freeBytes >= minimumFreeBytes;
      const report = { event: "node_runtime_health", node: name, mount: bytes.mount, freeBytes,
        bytesUsedPercent: Number(bytes.usedPercent.toFixed(2)), inodesUsedPercent: Number(inodes.usedPercent.toFixed(2)), healthy };
      reports.push(report);
      log(JSON.stringify(report));
      if (!healthy) throw new Error(`Runtime storage exceeds ${thresholdPercent}% usage or has less than ${minimumFreeBytes} bytes free`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
  return reports;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { checkNodeRuntime(); }
  catch (error) { console.error(`Node runtime check failed: ${error.message}`); process.exitCode = 1; }
}
