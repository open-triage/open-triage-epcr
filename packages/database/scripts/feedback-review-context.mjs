import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEMO_CONTEXT = "do-ams3-k8s-open-triage-demo";
const DEMO_NAMESPACE = "open-triage";
const DEMO_SECRET = "open-triage-feedback-reviewer";
const REVIEW_URL_KEY = "FEEDBACK_REVIEW_DATABASE_URL";
const SUPPORTED_COMMANDS = new Set([
  "list", "list-open", "show", "propose", "dry-run", "apply", "bulk-dry-run", "bulk-apply",
]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const reviewCli = path.join(repoRoot, "packages/database/scripts/feedback-review.mjs");

export class ReviewContextError extends Error {}

export function parseContextArguments(arguments_) {
  const index = arguments_.indexOf("--instance");
  if (index === -1 || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")) {
    throw new ReviewContextError("--instance local|public-demo is required");
  }
  const instance = arguments_[index + 1];
  if (instance !== "local" && instance !== "public-demo") {
    throw new ReviewContextError("--instance must be local or public-demo");
  }
  const reviewArguments = arguments_.filter((_value, candidate) => candidate !== index && candidate !== index + 1);
  if (!SUPPORTED_COMMANDS.has(reviewArguments[0])) {
    throw new ReviewContextError("A supported feedback review command is required");
  }
  return { instance, reviewArguments };
}

function validateTarget(connection, instance) {
  let url;
  try { url = new URL(connection); } catch { throw new ReviewContextError("Feedback review connection is invalid"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (instance === "local" && !local) throw new ReviewContextError("Local review connection does not target localhost");
  if (instance === "public-demo" && (local || !url.hostname.endsWith(".supabase.com"))) {
    throw new ReviewContextError("Public demo review connection does not target the hosted Supabase database");
  }
  return connection;
}

function envFileValue(contents, name) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] !== name) continue;
    const value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

export function resolveReviewConnection(instance, {
  env = process.env,
  exec = execFileSync,
  read = readFileSync,
  root = repoRoot,
} = {}) {
  if (instance === "local") {
    if (env.FEEDBACK_REVIEW_DATABASE_URL) {
      return validateTarget(env.FEEDBACK_REVIEW_DATABASE_URL, instance);
    }
    let contents;
    try { contents = read(path.join(root, ".env.local"), "utf8"); } catch {
      throw new ReviewContextError("Local database configuration is unavailable");
    }
    const connection = envFileValue(contents, "DATABASE_URL");
    if (!connection) throw new ReviewContextError("Local database configuration has no DATABASE_URL");
    return validateTarget(connection, instance);
  }

  let context;
  try { context = exec("kubectl", ["config", "current-context"], { encoding: "utf8" }).trim(); } catch {
    throw new ReviewContextError("Kubernetes context is unavailable");
  }
  if (context !== DEMO_CONTEXT) throw new ReviewContextError("Kubernetes context does not target the public demo cluster");
  let encoded;
  try {
    encoded = exec("kubectl", [
      "get", "secret", DEMO_SECRET, "--namespace", DEMO_NAMESPACE,
      "-o", `jsonpath={.data.${REVIEW_URL_KEY}}`,
    ], { encoding: "utf8" }).trim();
  } catch {
    throw new ReviewContextError("Public demo feedback reviewer Secret is unavailable");
  }
  if (!encoded) throw new ReviewContextError("Public demo feedback reviewer Secret has no review connection");
  return validateTarget(Buffer.from(encoded, "base64").toString("utf8"), instance);
}

export function runWithContext(arguments_, dependencies = {}) {
  const { instance, reviewArguments } = parseContextArguments(arguments_);
  const connection = resolveReviewConnection(instance, dependencies);
  const spawn = dependencies.spawn ?? spawnSync;
  const result = spawn(process.execPath, [reviewCli, ...reviewArguments], {
    cwd: repoRoot,
    env: { ...(dependencies.env ?? process.env), FEEDBACK_REVIEW_DATABASE_URL: connection },
    stdio: "inherit",
  });
  if (result.error) throw new ReviewContextError("Feedback review command could not start");
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = runWithContext(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof ReviewContextError ? error.message : "Feedback review context command failed"}\n`);
    process.exitCode = 1;
  }
}
