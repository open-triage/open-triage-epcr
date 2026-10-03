import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const chart = fileURLToPath(new URL("../deploy/helm/open-triage", import.meta.url));
const usage = "node scripts/deploy-kubernetes.mjs --context <workload-context> --values <installation.yaml> [--namespace open-triage] [--release open-triage] [--apply]";

export function deploymentOptions(argv) {
  const options = { namespace: "open-triage", release: "open-triage", apply: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === "--apply") { options.apply = true; continue; }
    if (!["--context", "--values", "--namespace", "--release"].includes(key) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(usage);
    options[key.slice(2)] = argv[++index];
  }
  if (!options.context || !options.values) throw new Error(usage);
  for (const key of ["namespace", "release"]) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(options[key]) || options[key].length > 53) throw new Error(`${key} must be a Kubernetes DNS label of at most 53 characters.`);
  }
  options.values = path.resolve(options.values);
  return options;
}

export function podSpec(object) {
  if (object.kind === "Pod") return object.spec;
  if (object.kind === "CronJob") return object.spec?.jobTemplate?.spec?.template?.spec;
  return object.spec?.template?.spec;
}

function placeholder(value) {
  return /REPLACE|(?:^|[/.])example\.(?:com|net|org)(?:[/:]|$)|localhost|\.invalid(?:[/:]|$)/i.test(value ?? "");
}

export function deploymentContract(objects) {
  if (objects.some(({ kind }) => kind === "Secret")) throw new Error("Production values must reference cluster-owned existingSecret names. Do not pass credentials through Helm values.");
  const deployments = objects.filter(({ kind }) => kind === "Deployment");
  for (const component of ["api", "web"]) {
    const deployment = deployments.find((object) => object.spec?.template?.metadata?.labels?.["app.kubernetes.io/component"] === component);
    if (!deployment || !(deployment.spec.replicas >= 2)) throw new Error(`Set ${component}.replicas to at least 2 in production values.`);
  }
  const migration = objects.find((object) => object.kind === "Job" && object.metadata?.annotations?.["helm.sh/hook"]?.includes("pre-install"));
  if (!migration) throw new Error("Enable the chart's migration gate before installing production workloads.");
  const secrets = new Map(), images = new Set(), databaseSecrets = new Map();
  const addSecret = (name, key) => {
    if (!name) throw new Error("A workload references an unnamed Secret.");
    if (!secrets.has(name)) secrets.set(name, new Set());
    if (key) secrets.get(name).add(key);
  };
  for (const object of objects) {
    const pod = podSpec(object);
    if (!pod) continue;
    if (pod.automountServiceAccountToken !== false || pod.securityContext?.runAsNonRoot !== true || pod.securityContext?.seccompProfile?.type !== "RuntimeDefault") throw new Error(`${object.metadata.name} must disable token mounting and use non-root / RuntimeDefault pod security.`);
    for (const pull of pod.imagePullSecrets ?? []) addSecret(pull.name, ".dockerconfigjson");
    for (const container of [...(pod.initContainers ?? []), ...(pod.containers ?? [])]) {
      const security = container.securityContext;
      if (security?.allowPrivilegeEscalation !== false || !security?.capabilities?.drop?.includes("ALL") || !(security?.runAsUser > 0)) throw new Error(`${object.metadata.name} must use restricted container security and an explicit non-root UID.`);
      if (placeholder(container.image) || (!/@sha256:[a-f0-9]{64}$/.test(container.image) && !/:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(container.image)) || /:latest$/.test(container.image)) throw new Error("Set real image repositories and immutable release tags or sha256 digests before deployment.");
      images.add(container.image);
      if ([...(container.command ?? []), ...(container.args ?? [])].some((arg) => /synthetic/.test(arg)) && container.name !== "synthetic-expiry") throw new Error("Disable migration.bootstrapSynthetic for production installation.");
      if (container.envFrom?.length) throw new Error("Use explicit workload Secret key references rather than envFrom.");
      for (const variable of container.env ?? []) {
        const reference = variable.valueFrom?.secretKeyRef;
        if (reference && !reference.optional) addSecret(reference.name, reference.key);
        if (variable.name === "DATABASE_URL") {
          if (!reference) throw new Error("Database URLs must come from workload Secrets.");
          const component = object.spec?.template?.metadata?.labels?.["app.kubernetes.io/component"] ?? container.name;
          const role = component === "review-worker" ? "api" : component;
          const previous = databaseSecrets.get(reference.name);
          if (previous && previous !== role) throw new Error("Use a distinct database Secret for each workload contract.");
          databaseSecrets.set(reference.name, role);
        }
      }
    }
  }
  const hosts = new Set(), classes = new Set();
  for (const object of objects.filter(({ kind }) => kind === "Ingress")) {
    if (!object.spec?.ingressClassName) throw new Error("Set ingress.className to an installed IngressClass.");
    classes.add(object.spec.ingressClassName);
    const annotations = object.metadata.annotations ?? {};
    if (annotations["nginx.ingress.kubernetes.io/force-ssl-redirect"] !== "true" && annotations["ingress.kubernetes.io/force-ssl-redirect"] !== "true") throw new Error("Ingress must redirect HTTP to HTTPS.");
    for (const { host } of object.spec.rules ?? []) {
      if (!host || placeholder(host)) throw new Error("Replace example hosts with your real web and API DNS names.");
      hosts.add(host);
      const tls = object.spec.tls?.find((entry) => entry.hosts?.includes(host));
      if (!tls?.secretName) throw new Error(`Configure ingress.tls with a certificate Secret covering ${host}.`);
      addSecret(tls.secretName, "tls.crt");
      addSecret(tls.secretName, "tls.key");
    }
  }
  if (hosts.size !== 2) throw new Error("Configure two distinct web and API hosts covered by ingress TLS.");
  return { secrets, images, classes, deployments: deployments.map(({ metadata }) => metadata.name) };
}

async function run(command, args, { input, message, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", size = 0;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 8 * 1024 * 1024) child.kill("SIGTERM"); else output += chunk; });
    // Never echo rendered values, Secret data, or command errors containing them.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new Error(message ?? `Install ${command} and make it available on PATH.`)); });
    child.once("close", (code) => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(message ?? `${command} failed. See docs/runbooks/kubernetes-production.md.`)); });
    child.stdin.end(input);
  });
}

export async function deployKubernetes(options, { execute = run, log = console } = {}) {
  const kube = (args, settings = {}) => execute("kubectl", ["--context", options.context, "--namespace", options.namespace, "--request-timeout=30s", ...args], settings);
  log.info(`Checking context ${options.context}, namespace ${options.namespace}, release ${options.release}…`);
  await execute("helm", ["lint", chart, "--values", options.values], { message: "Helm lint failed. Check the installation values and run helm lint manually for details." });
  await kube(["get", "namespace", options.namespace, "--output", "name"], { message: "Cannot access the target namespace. Create it on the workload cluster and verify your context/RBAC." });
  const rendered = await execute("helm", ["template", options.release, chart, "--namespace", options.namespace, "--values", options.values], { message: "Cannot render the chart. Check your values; production uses existing Secrets and migration.bootstrapSynthetic=false." });
  const converted = await kube(["create", "--dry-run=client", "--validate=false", "--filename", "-", "--output", "json"], { input: rendered, message: "Cannot parse chart resources with kubectl. Check chart rendering and Kubernetes access." });
  let object;
  try { object = JSON.parse(converted); } catch { throw new Error("kubectl returned invalid resource JSON."); }
  const objects = object.kind === "List" ? object.items : [object];
  const contract = deploymentContract(objects);
  for (const name of contract.classes) await kube(["get", "ingressclass", name, "--output", "name"], { message: `IngressClass ${name} is unavailable. Install or select your platform ingress controller.` });
  for (const [name, keys] of contract.secrets) {
    const result = await kube(["get", "secret", name, "--output", 'go-template={{.type}}{{"\\n"}}{{range $k,$v := .data}}{{if $v}}{{$k}}{{"\\n"}}{{end}}{{end}}'], { message: `Secret ${name} is missing or inaccessible. Create it in the target namespace using the production runbook.` });
    const [type, ...available] = result.trim().split("\n");
    for (const key of keys) if (!available.includes(key)) throw new Error(`Secret ${name} needs a nonempty ${key} key.`);
    if (keys.has("tls.crt") && type !== "kubernetes.io/tls") throw new Error(`Secret ${name} must have type kubernetes.io/tls.`);
    if (keys.has(".dockerconfigjson") && type !== "kubernetes.io/dockerconfigjson") throw new Error(`Image pull Secret ${name} must have type kubernetes.io/dockerconfigjson.`);
  }
  const permissions = [
    ["create", "jobs.batch"], ["delete", "jobs.batch"], ["get", "jobs.batch"], ["watch", "jobs.batch"],
    ["create", "secrets"], ["get", "secrets"], ["list", "secrets"], ["update", "secrets"],
    ["create", "deployments.apps"], ["patch", "deployments.apps"], ["get", "deployments.apps"], ["watch", "deployments.apps"],
    ["create", "services"], ["patch", "services"], ["create", "ingresses.networking.k8s.io"], ["patch", "ingresses.networking.k8s.io"],
    ["create", "cronjobs.batch"], ["patch", "cronjobs.batch"], ["get", "pods"], ["list", "pods"], ["watch", "pods"],
  ];
  for (const [verb, resource] of permissions) await kube(["auth", "can-i", verb, resource, "--quiet"], { message: `RBAC must allow ${verb} ${resource} in ${options.namespace} for this release.` });
  // Helm deletes/recreates its retained migration hook on upgrades. Check admission
  // with a fresh name so an existing immutable Job does not reject a valid upgrade.
  const admission = structuredClone(objects);
  for (const resource of admission) if (resource.metadata?.annotations?.["helm.sh/hook"]) resource.metadata.name = `${resource.metadata.name.slice(0, 48).replace(/-$/, "")}-check-${randomUUID().slice(0, 8)}`;
  await kube(["apply", "--dry-run=server", "--filename", "-", "--output", "name"], { input: JSON.stringify({ apiVersion: "v1", kind: "List", items: admission }), message: "Server admission rejected the chart. Inspect a protected rendered file with kubectl apply --dry-run=server for RBAC, quota, or policy errors." });
  log.info(`Preflight passed: ${contract.deployments.length} Deployments, ${contract.images.size} pinned images, ${contract.secrets.size} existing Secrets.`);
  if (!options.apply) { log.info("No resources changed. Rerun with --apply to run migrations and install or upgrade the release."); return; }
  log.info("Running the migration hook and waiting for rollout (up to 15 minutes)…");
  await execute("helm", ["upgrade", "--install", options.release, chart, "--kube-context", options.context, "--namespace", options.namespace, "--values", options.values, "--wait", "--wait-for-jobs", "--timeout", "15m"], { timeoutMs: 930_000, message: "Helm deployment failed. Inspect the migration Job, helm status, and pod events using the production runbook. Committed database migrations are not rolled back." });
  log.info("Helm rollout completed. Verify HTTPS/API health and complete installation owner/configuration commissioning using docs/runbooks/kubernetes-production.md.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--help")) console.log(usage);
  else { try { await deployKubernetes(deploymentOptions(process.argv.slice(2))); } catch (error) { console.error(`Deployment stopped: ${error.message}`); process.exitCode = 1; } }
}
