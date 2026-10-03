import { randomBytes, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { databaseUrlForLogin } from "./workload-database-url.mjs";

const usage = "node scripts/prepare-kubernetes-secrets.mjs --migration-env <private/migration.env> --output-dir <private/new-directory>";
const workloads = [
  ["API", "api", "open_triage_api_runtime"],
  ["ANALYTICS_PROJECTOR", "analytics_projector", "open_triage_analytics_projector"],
  ["ANALYTICS_HEALTH", "analytics_health", "open_triage_analytics_health"],
  ["RETENTION", "retention", "open_triage_retention"],
  ["OPERATIONAL_AUDIT", "operational_audit", "open_triage_operational_audit_writer"],
];

export function secretBundle(migrationFile) {
  const lines = migrationFile.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length !== 1 || !/^DATABASE_URL=\S+$/.test(lines[0])) throw new Error("The migration input must contain exactly DATABASE_URL=<percent-encoded-postgresql-url>, without quotes or shell expressions.");
  const migrationUrl = lines[0].slice("DATABASE_URL=".length);
  let parsed;
  try { parsed = new URL(migrationUrl); } catch { throw new Error("The migration input must contain a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error("The migration input must contain a valid PostgreSQL URL.");
  if (/\brole\s*=/.test(parsed.searchParams.get("options") ?? "")) throw new Error("Remove any startup role override from the migration URL before generating workload URLs.");
  const files = { "open-triage-migration.env": `DATABASE_URL=${migrationUrl}\n` };
  const bootstrap = [];
  const suffix = randomBytes(6).toString("hex");
  for (const [key, name, role] of workloads) {
    const login = `open_triage_prod_${name}_${suffix}`;
    const password = randomBytes(36).toString("base64");
    bootstrap.push(`${key}_DATABASE_LOGIN=${login}`, `${key}_DATABASE_PASSWORD=${password}`);
    const runtimeUrl = new URL(databaseUrlForLogin(migrationUrl, login, password));
    runtimeUrl.searchParams.set("options", `${parsed.searchParams.get("options") ?? ""} -c role=${role}`.trim());
    const values = [`DATABASE_URL=${runtimeUrl.href}`];
    if (key === "API") values.push(
      `PATIENT_KEY_INSTALLATION_ID=${randomUUID()}`, "PATIENT_KEY_VERSION=1",
      `PATIENT_KEY_SECRET_BASE64=${randomBytes(32).toString("base64")}`,
      `AUTH_RATE_LIMIT_SECRET_BASE64=${randomBytes(32).toString("base64")}`,
      "OFFLINE_RECOVERY_KEY_VERSION=1",
      `OFFLINE_RECOVERY_SECRET_BASE64=${randomBytes(32).toString("base64")}`,
    );
    files[`open-triage-${name.replaceAll("_", "-")}.env`] = `${values.join("\n")}\n`;
  }
  files["open-triage-workload-bootstrap.env"] = `${bootstrap.join("\n")}\n`;
  return files;
}

export async function prepareSecrets({ migrationEnv, outputDir }, { log = console } = {}) {
  const files = secretBundle(await readFile(migrationEnv, "utf8"));
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const directory = await lstat(outputDir);
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error("Output must be a private directory (chmod 700) rather than a symlink.");
  for (const name of Object.keys(files)) {
    try { await access(path.join(outputDir, name)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error(`Refusing to overwrite ${name}. Reuse existing installation keys and credentials; follow the rotation runbooks to rotate them.`);
  }
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(outputDir, name), contents, { flag: "wx", mode: 0o600 });
  log.info(`Created ${Object.keys(files).length} private files in ${outputDir}. Import them into your secret manager before installation. No credentials were printed.`);
}

export function preparationOptions(argv) {
  if (argv.length !== 4) throw new Error(usage);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!["--migration-env", "--output-dir"].includes(key) || options[key] || !value || value.startsWith("--")) throw new Error(usage);
    options[key] = path.resolve(value);
  }
  if (!options["--migration-env"] || !options["--output-dir"]) throw new Error(usage);
  return { migrationEnv: options["--migration-env"], outputDir: options["--output-dir"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--help")) console.log(usage);
  else { try { await prepareSecrets(preparationOptions(process.argv.slice(2))); } catch { console.error("Secret preparation stopped. Verify the input file, a private output directory, and that no output files already exist. Existing keys are never overwritten."); process.exitCode = 1; } }
}
