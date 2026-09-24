import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_SECRETS = [
  {
    name: "open-triage-database",
    keys: [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "PATIENT_KEY_INSTALLATION_ID",
      "PATIENT_KEY_SECRET_BASE64",
    ],
  },
  { name: "ghcr-pull", keys: [".dockerconfigjson"] },
  { name: "open-triage-tls", keys: ["tls.crt", "tls.key"] },
];

const REQUIRED_PERMISSIONS = [
  ["get", "namespaces", "cluster"],
  ["get", "nodes", "cluster"],
  ["list", "nodes", "cluster"],
  ["list", "pods", "cluster"],
  ["get", "pods"], ["list", "pods"], ["watch", "pods"],
  ["get", "pods/log"],
  ...["secrets", "configmaps", "services"].flatMap((resource) =>
    ["get", "list", "create", "update", "patch", "delete"].map((verb) => [verb, resource])),
  ...["deployments.apps", "jobs.batch", "cronjobs.batch", "ingresses.networking.k8s.io"].flatMap(
    (resource) =>
      ["get", "list", "create", "update", "patch", "delete"].map((verb) => [verb, resource]),
  ),
];

function parseArguments(values) {
  const args = { registryImages: [], requiredSecrets: [] };
  for (let index = 0; index < values.length;) {
    const key = values[index]?.replace(/^--/, "");
    if (!key) throw new Error(`Invalid argument: ${values[index]}`);
    if (key === "registry-image" || key === "required-secret") {
      args[key === "registry-image" ? "registryImages" : "requiredSecrets"].push(values[index + 1]);
    } else {
      args[key] = values[index + 1];
    }
    index += 2;
  }
  return args;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch {
    throw new Error(`${command} command failed`);
  }
}

function kubectlArgs(args) {
  const as = process.env.PREFLIGHT_KUBECTL_AS;
  return as ? ["--as", as, ...args] : args;
}

function kubectl(args) {
  return run("kubectl", kubectlArgs(args));
}

function json(command, args) {
  return JSON.parse(command(args));
}

export function cpuMillis(value = "0") {
  if (String(value).endsWith("m")) return Number.parseFloat(value);
  if (String(value).endsWith("u")) return Number.parseFloat(value) / 1000;
  if (String(value).endsWith("n")) return Number.parseFloat(value) / 1_000_000;
  return Number.parseFloat(value) * 1000;
}

export function memoryBytes(value = "0") {
  const units = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, K: 1000, M: 1e6, G: 1e9 };
  const match = String(value).match(/^([0-9.]+)([A-Za-z]+)?$/);
  if (!match) throw new Error(`Invalid memory quantity: ${value}`);
  return Number.parseFloat(match[1]) * (units[match[2]] ?? 1);
}

function addRequests(left, right) {
  return { cpu: left.cpu + right.cpu, memory: left.memory + right.memory };
}

function maxRequests(left, right) {
  return { cpu: Math.max(left.cpu, right.cpu), memory: Math.max(left.memory, right.memory) };
}

function containerRequests(container) {
  return {
    cpu: cpuMillis(container.resources?.requests?.cpu),
    memory: memoryBytes(container.resources?.requests?.memory),
  };
}

/** Mirrors Kubernetes scheduling: app containers run together; ordinary init
 * containers run sequentially; restartable init sidecars remain active. */
export function podRequests(pod) {
  const regular = (pod.spec?.containers ?? []).reduce(
    (total, container) => addRequests(total, containerRequests(container)),
    { cpu: 0, memory: 0 },
  );
  let restartableInit = { cpu: 0, memory: 0 };
  let initPeak = { cpu: 0, memory: 0 };
  for (const container of pod.spec?.initContainers ?? []) {
    const request = containerRequests(container);
    if (container.restartPolicy === "Always") {
      restartableInit = addRequests(restartableInit, request);
      initPeak = maxRequests(initPeak, restartableInit);
    } else {
      initPeak = maxRequests(initPeak, addRequests(restartableInit, request));
    }
  }
  const scheduled = maxRequests(addRequests(regular, restartableInit), initPeak);
  return addRequests(scheduled, {
    cpu: cpuMillis(pod.spec?.overhead?.cpu),
    memory: memoryBytes(pod.spec?.overhead?.memory),
  });
}

function labelsMatch(selector = {}, labels = {}) {
  return Object.entries(selector).every(([name, value]) => labels[name] === value);
}

/**
 * Recreate deployments terminate their selected pods before scheduling replacements.
 * Those requests are therefore available to the rollout, unlike requests owned by
 * RollingUpdate deployments or unrelated workloads.
 */
export function recreateDeploymentCapacity(pods, deployments, namespace) {
  const recreateSelectors = deployments.items
    .filter((deployment) => deployment.metadata?.namespace === namespace
      && deployment.spec?.strategy?.type === "Recreate")
    .map((deployment) => deployment.spec?.selector?.matchLabels ?? {})
    .filter((selector) => Object.keys(selector).length > 0);
  return pods.items
    .filter((pod) => pod.metadata?.namespace === namespace
      && pod.spec?.nodeName
      && !["Succeeded", "Failed"].includes(pod.status?.phase)
      && recreateSelectors.some((selector) => labelsMatch(selector, pod.metadata?.labels)))
    .reduce((total, pod) => {
      const request = podRequests(pod);
      return { cpu: total.cpu + request.cpu, memory: total.memory + request.memory };
    }, { cpu: 0, memory: 0 });
}

export function availableCapacity(nodes, pods, { deployments = { items: [] }, namespace } = {}) {
  const allocatable = nodes.items
    .filter((node) => !node.spec?.unschedulable)
    .reduce(
      (total, node) => ({
        cpu: total.cpu + cpuMillis(node.status?.allocatable?.cpu),
        memory: total.memory + memoryBytes(node.status?.allocatable?.memory),
      }),
      { cpu: 0, memory: 0 },
    );
  const requested = pods.items
    .filter((pod) => pod.spec?.nodeName && !["Succeeded", "Failed"].includes(pod.status?.phase))
    .reduce((total, pod) => {
      const request = podRequests(pod);
      return { cpu: total.cpu + request.cpu, memory: total.memory + request.memory };
    }, { cpu: 0, memory: 0 });
  const reclaimable = namespace
    ? recreateDeploymentCapacity(pods, deployments, namespace)
    : { cpu: 0, memory: 0 };
  return {
    cpu: allocatable.cpu - requested.cpu + reclaimable.cpu,
    memory: allocatable.memory - requested.memory + reclaimable.memory,
  };
}

export function rolloutConflicts(jobs, cronJobs, now = Date.now()) {
  const relevant = (item) =>
    item.metadata?.labels?.["app.kubernetes.io/instance"] === "open-triage" ||
    item.metadata?.name?.startsWith("open-triage-");
  const conflicts = [];
  for (const job of jobs.items.filter(relevant)) {
    const age = now - Date.parse(job.metadata?.creationTimestamp ?? new Date(now).toISOString());
    if ((job.status?.active ?? 0) > 0 || ((job.status?.failed ?? 0) > 0 && !job.status?.completionTime)) {
      conflicts.push(`job/${job.metadata.name}${age > 10 * 60_000 ? ":stuck" : ":active-or-failed"}`);
    }
  }
  for (const cronJob of cronJobs.items.filter(relevant)) {
    if ((cronJob.status?.active ?? []).length > 0) conflicts.push(`cronjob/${cronJob.metadata.name}:active`);
  }
  return conflicts.sort();
}

export function validateSummary(summary, { sha, namespaceUid, maxAgeSeconds, now = Date.now() }) {
  if (summary.schemaVersion !== 1 || summary.status !== "pass") throw new Error("Preflight did not pass");
  if (summary.sourceCommit !== sha) throw new Error(`Preflight does not describe source commit ${sha}`);
  if (namespaceUid && summary.cluster?.namespaceUid !== namespaceUid) {
    throw new Error("Preflight describes a different cluster namespace");
  }
  const age = now - Date.parse(summary.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds * 1000) {
    throw new Error("Preflight summary is stale");
  }
  return summary;
}

function check(name, action) {
  try {
    const detail = action();
    return { name, status: "pass", ...(detail ? { detail } : {}) };
  } catch (error) {
    return { name, status: "fail", detail: String(error.message).split("\n")[0].slice(0, 240) };
  }
}

function secretRequirements(args) {
  const requirements = args.requirements
    ? JSON.parse(readFileSync(args.requirements, "utf8"))
    : [...DEFAULT_SECRETS];
  for (const value of args.requiredSecrets) {
    const [name, keys = ""] = value.split(":", 2);
    requirements.push({ name, keys: keys.split(",").filter(Boolean) });
  }
  return requirements;
}

async function runPreflight(args) {
  const namespace = args.namespace ?? "open-triage";
  const output = args.output ?? "live-demo-preflight.json";
  const sha = args.sha;
  if (!sha) throw new Error("--sha is required");
  const checks = [];
  let namespaceUid = "unavailable";
  let migrationDatabaseUrl;

  checks.push(check("cluster", () => {
    kubectl(["version", "--request-timeout=10s"]);
    const namespaceObject = json(kubectl, ["get", "namespace", namespace, "--output=json"]);
    namespaceUid = namespaceObject.metadata.uid;
    return "reachable";
  }));

  checks.push(check("permissions", () => {
    const denied = REQUIRED_PERMISSIONS.filter(([verb, resource, scope]) => {
      const command = ["auth", "can-i", verb, resource];
      if (scope !== "cluster") command.push("--namespace", namespace);
      try { return kubectl(command) !== "yes"; } catch { return true; }
    });
    if (denied.length) throw new Error(`denied ${denied.length} required Kubernetes permission(s)`);
    return `${REQUIRED_PERMISSIONS.length} allowed`;
  }));

  checks.push(check("secrets", () => {
    const requirements = secretRequirements(args);
    for (const requirement of requirements) {
      let secret;
      try {
        secret = json(kubectl, ["get", "secret", requirement.name, "--namespace", namespace, "--output=json"]);
      } catch {
        throw new Error(`${requirement.name} is missing or unreadable`);
      }
      const missing = requirement.keys.filter((key) => !secret.data?.[key]);
      if (missing.length) throw new Error(`${requirement.name} is missing ${missing.join(",")}`);
      if (requirement.name === (args["database-secret"] ?? "open-triage-database")) {
        migrationDatabaseUrl = Buffer.from(secret.data.DATABASE_URL, "base64").toString("utf8");
      }
    }
    return `${requirements.length} Secret(s) have required keys`;
  }));

  checks.push(check("database", () => {
    const databaseUrl = process.env.PREFLIGHT_DATABASE_URL || migrationDatabaseUrl;
    if (!databaseUrl) throw new Error("database credential was not available");
    run("psql", [databaseUrl, "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-Atqc", "select 1"], {
      env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
    });
    return "read-only query succeeded";
  }));

  checks.push(check("registry", () => {
    let registryImages = args.registryImages;
    if (!registryImages.length) {
      const deployments = json(kubectl, [
        "get", "deployments", "open-triage-api", "open-triage-web",
        "--namespace", namespace, "--output=json",
      ]);
      registryImages = deployments.items.flatMap((deployment) =>
        (deployment.spec?.template?.spec?.containers ?? []).map((container) => container.image),
      );
    }
    if (!registryImages.length) throw new Error("no deployed registry image was found");
    for (const image of registryImages) {
      if (args["registry-mode"] === "local") run("docker", ["image", "inspect", image]);
      else run("docker", ["manifest", "inspect", image]);
    }
    return `${registryImages.length} image(s) readable`;
  }));

  checks.push(check("capacity", () => {
    const nodes = json(kubectl, ["get", "nodes", "--output=json"]);
    const pods = json(kubectl, ["get", "pods", "--all-namespaces", "--output=json"]);
    const deployments = json(kubectl, ["get", "deployments", "--namespace", namespace, "--output=json"]);
    const available = availableCapacity(nodes, pods, { deployments, namespace });
    const requiredCpu = Number(process.env.PREFLIGHT_REQUIRED_CPU_M ?? 210);
    const requiredMemory = Number(process.env.PREFLIGHT_REQUIRED_MEMORY_BYTES ?? 608 * 2 ** 20);
    if (available.cpu < requiredCpu || available.memory < requiredMemory) {
      throw new Error("insufficient allocatable capacity for demo workload requests");
    }
    return `at least ${Math.floor(available.cpu)}m CPU and ${Math.floor(available.memory / 2 ** 20)}Mi available`;
  }));

  checks.push(check("rollout-conflicts", () => {
    const jobs = json(kubectl, ["get", "jobs", "--namespace", namespace, "--output=json"]);
    const cronJobs = json(kubectl, ["get", "cronjobs", "--namespace", namespace, "--output=json"]);
    const conflicts = rolloutConflicts(jobs, cronJobs);
    if (conflicts.length) throw new Error(`${conflicts.length} conflicting or stuck batch workload(s)`);
    return "none";
  }));

  const summary = {
    schemaVersion: 1,
    status: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    sourceCommit: sha,
    checkedAt: new Date().toISOString(),
    cluster: { namespace, namespaceUid },
    checks,
  };
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: summary.status, checks: Object.fromEntries(checks.map((entry) => [entry.name, entry.status])) }));
  if (summary.status !== "pass") process.exitCode = 1;
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArguments(values);
  if (command === "run") return runPreflight(args);
  if (command === "verify") {
    const summary = JSON.parse(await readFile(args.summary, "utf8"));
    validateSummary(summary, {
      sha: args.sha,
      namespaceUid: args["namespace-uid"],
      maxAgeSeconds: Number(args["max-age-seconds"] ?? 3600),
    });
    console.log("Live demo preflight summary accepted");
    return;
  }
  throw new Error("usage: live-demo-preflight.mjs <run|verify> [options]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
