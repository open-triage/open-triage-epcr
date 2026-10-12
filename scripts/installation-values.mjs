import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const workloads = ["api", "migration", "analyticsProjector", "analyticsHealth", "retention", "operationalAudit"];
const keys = new Set(["web", "api", "migration", "analytics", "reviewWorker", "syntheticExpiry", "imagePullSecrets", "nodeSelector", "publicSite", "podSecurityContext", "ingress", "secrets"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function hostname(value, field) {
  if (typeof value !== "string" || value.length > 253 || !value.includes(".") ||
      !value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)example\.(?:com|org|net)$/.test(value)) {
    throw new Error(`${field} must be an installation DNS hostname, not an example`);
  }
  return value;
}

// The automated demo accepts non-secret installation settings. Image identity is
// supplied separately by the verified build manifest, never by this file.
export function installationValues(source) {
  let values;
  try { values = load(source); } catch { throw new Error("Installation values must be valid YAML"); }
  if (!object(values) || Object.keys(values).some((key) => !keys.has(key))) {
    throw new Error("Installation values must contain only supported Helm settings");
  }
  const web = hostname(values.web?.host, "web.host");
  const api = hostname(values.api?.host, "api.host");
  if (web === api) throw new Error("web.host and api.host must differ");
  if (values.web.image !== undefined || values.api.image !== undefined) {
    throw new Error("Installation values cannot override verified image identities");
  }
  if (values.migration?.enabled === false) throw new Error("The deployment migration gate must remain enabled");
  if (!object(values.secrets) || Object.keys(values.secrets).some((key) => !workloads.includes(key))) {
    throw new Error("Installation values must reference existing workload Secrets");
  }
  for (const workload of workloads) {
    const config = values.secrets[workload];
    if (!object(config) || Object.keys(config).some((key) => key !== "existingSecret") ||
        typeof config.existingSecret !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(config.existingSecret)) {
      throw new Error(`secrets.${workload} must contain only an existingSecret reference`);
    }
  }
  const publicHost = values.publicSite?.enabled ? hostname(values.publicSite.host, "publicSite.host") : "";
  if ([web, api].includes(publicHost)) throw new Error("publicSite.host must differ from application hosts");
  const tls = values.ingress?.tls;
  if (!Array.isArray(tls) || [web, api, ...(publicHost ? [publicHost] : [])].some((host) =>
    !tls.some((entry) => typeof entry?.secretName === "string" && entry.secretName.length && entry.hosts?.includes(host)))) {
    throw new Error("ingress.tls must reference a certificate for every installation host");
  }
  if (values.nodeSelector !== undefined && (!object(values.nodeSelector) ||
      Object.values(values.nodeSelector).some((value) => typeof value !== "string" || value === "example-pool"))) {
    throw new Error("nodeSelector must contain installation label strings or be empty");
  }
  return { values, outputs: { "web-url": `https://${web}`, "api-url": `https://${api}`, "public-site-host": publicHost } };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  const source = args.includes("--input") ? await readFile(option("--input"), "utf8") : process.env.INSTALLATION_VALUES;
  if (!source?.trim()) throw new Error("Set the demo environment variable DEMO_INSTALLATION_VALUES before deployment");
  const { values, outputs } = installationValues(source);
  if (!args.includes("--output")) throw new Error("--output is required");
  await writeFile(option("--output"), `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
