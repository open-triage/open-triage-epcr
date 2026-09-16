import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = createHash("sha256").update(repoRoot).digest("hex").slice(0, 12);
const statePath = path.join(os.tmpdir(), `open-triage-feedback-validation-${identity}.json`);
const webLockPath = path.join(repoRoot, "apps/web/.next/dev/lock");
const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:3001";

export class ValidationAppError extends Error {}

export function parseValidationArguments(arguments_) {
  if (arguments_.length !== 1 || !["start", "status", "stop"].includes(arguments_[0])) {
    throw new ValidationAppError("usage: feedback-validation.mjs <start|status|stop>");
  }
  return arguments_[0];
}

export function launchPlan(inspection) {
  for (const [name, service] of Object.entries(inspection)) {
    if (service.portOpen && !service.matching) {
      throw new ValidationAppError(`${name} port is occupied by an unknown or incompatible process`);
    }
  }
  return { startApi: !inspection.api.matching, startWeb: !inspection.web.matching };
}

export function managedProcessMatches(pid, marker, {
  signal = process.kill,
  readlink = readlinkSync,
  read = readFileSync,
  root = repoRoot,
} = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    signal(pid, 0);
    if (readlink(`/proc/${pid}/cwd`) !== root) return false;
    return read(`/proc/${pid}/environ`, "utf8")
      .split("\0")
      .includes(`OPEN_TRIAGE_FEEDBACK_VALIDATION_ID=${marker}`);
  } catch {
    return false;
  }
}

function processMatches(pid, commandMarker, root) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return readlinkSync(`/proc/${pid}/cwd`) === root
      && readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").includes(commandMarker);
  } catch {
    return false;
  }
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    return state?.version === 1 && Array.isArray(state.started) ? state : null;
  } catch {
    return null;
  }
}

function writeState(started) {
  writeFileSync(statePath, `${JSON.stringify({ version: 1, repoRoot, started }, null, 2)}\n`, { mode: 0o600 });
}

async function portOpen(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function response(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(1_500) });
  } catch {
    return null;
  }
}

function matchingWebLock() {
  try {
    const lock = JSON.parse(readFileSync(webLockPath, "utf8"));
    return lock.port === 3000
      && processMatches(Number(lock.pid), "next-server", path.join(repoRoot, "apps/web"));
  } catch {
    return false;
  }
}

async function inspectServices() {
  const [apiPortOpen, webPortOpen] = await Promise.all([portOpen(3001), portOpen(3000)]);
  let apiMatching = false;
  let webMatching = false;
  if (apiPortOpen) {
    const health = await response(`${API_URL}/api/health`, { headers: { Origin: WEB_URL } });
    if (health?.ok && health.headers.get("access-control-allow-origin") === WEB_URL) {
      try { apiMatching = (await health.json()).service === "open-triage-api"; } catch {}
    }
  }
  if (webPortOpen && matchingWebLock()) {
    const root = await response(`${WEB_URL}/`);
    webMatching = root?.ok === true;
  }
  return {
    api: { port: 3001, portOpen: apiPortOpen, matching: apiMatching },
    web: { port: 3000, portOpen: webPortOpen, matching: webMatching },
  };
}

function removeStaleWebLock() {
  if (!existsSync(webLockPath) || matchingWebLock()) return;
  try {
    const lock = JSON.parse(readFileSync(webLockPath, "utf8"));
    try { process.kill(Number(lock.pid), 0); return; } catch {}
    unlinkSync(webLockPath);
  } catch {}
}

function startService(service) {
  const api = service === "api";
  const marker = `${identity}:${service}`;
  const logPath = path.join(os.tmpdir(), `open-triage-feedback-validation-${identity}-${service}.log`);
  const log = openSync(logPath, "a", 0o600);
  const command = api
    ? "set -a\nsource ./.env.local\nset +a\nexec npm run dev -w @open-triage/api"
    : "exec env -u PORT npm run dev -w @open-triage/web";
  const child = spawn("bash", ["-c", command], {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, OPEN_TRIAGE_FEEDBACK_VALIDATION_ID: marker },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  if (!child.pid) throw new ValidationAppError(`${service} process did not start`);
  return { service, pid: child.pid, marker, logPath };
}

async function terminateManaged(entries) {
  const stopped = [];
  for (const entry of entries) {
    if (!managedProcessMatches(entry.pid, entry.marker)) continue;
    try {
      process.kill(-entry.pid, "SIGTERM");
      stopped.push({ service: entry.service, pid: entry.pid });
    } catch {}
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && entries.some(({ pid, marker }) => managedProcessMatches(pid, marker))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return stopped;
}

async function waitForReady(started) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const inspection = await inspectServices();
    if (inspection.api.matching && inspection.web.matching) return inspection;
    if (started.some(({ pid, marker }) => !managedProcessMatches(pid, marker))) {
      throw new ValidationAppError("A validation process exited before becoming ready; inspect its log");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new ValidationAppError("Validation app did not become ready within 60 seconds");
}

async function startValidation() {
  const inspection = await inspectServices();
  const plan = launchPlan(inspection);
  const prior = readState()?.started.filter(({ pid, marker }) => managedProcessMatches(pid, marker)) ?? [];
  const started = [...prior];
  const newlyStarted = [];
  try {
    if (plan.startApi) newlyStarted.push(startService("api"));
    if (plan.startWeb) {
      removeStaleWebLock();
      newlyStarted.push(startService("web"));
    }
    started.push(...newlyStarted);
    writeState(started);
    const ready = await waitForReady(started);
    return { running: true, webUrl: WEB_URL, apiUrl: API_URL, services: ready, managed: started };
  } catch (error) {
    await terminateManaged(newlyStarted);
    writeState(prior);
    throw error;
  }
}

async function stopValidation() {
  const state = readState();
  if (!state) return { stopped: [], message: "No managed validation processes were recorded" };
  const stopped = await terminateManaged(state.started);
  try { unlinkSync(statePath); } catch {}
  return { stopped };
}

async function statusValidation() {
  const state = readState();
  return {
    webUrl: WEB_URL,
    apiUrl: API_URL,
    services: await inspectServices(),
    managed: state?.started.filter(({ pid, marker }) => managedProcessMatches(pid, marker)) ?? [],
  };
}

export async function runValidation(arguments_) {
  const command = parseValidationArguments(arguments_);
  if (command === "start") return await startValidation();
  if (command === "status") return await statusValidation();
  return await stopValidation();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runValidation(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof ValidationAppError ? error.message : "Feedback validation command failed"}\n`);
    process.exitCode = 1;
  }
}
