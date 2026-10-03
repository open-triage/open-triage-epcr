import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Resolve server dependencies from their owning workspace, including unhoisted installs.
const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { parse } = requireApi("dotenv");
const { Client } = requireApi("pg");
const executeFile = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const transientDatabaseErrors = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P03", "08001", "08006"]);

export function developmentEnvironment(fileContents, inherited = process.env) {
  const local = parse(fileContents);
  const api = { ...local, ...inherited };
  const port = Number(api.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3000) {
    throw new Error("API PORT must be between 1 and 65535 and different from the web port 3000.");
  }
  api.PORT = String(port);
  const web = { ...inherited };
  for (const [key, value] of Object.entries(local)) {
    if (key.startsWith("NEXT_PUBLIC_")) web[key] = inherited[key] ?? value;
    else delete web[key];
  }
  delete web.PORT;
  delete web.DATABASE_URL;
  web.NEXT_PUBLIC_API_URL ||= `http://localhost:${port}`;
  return { api, web, port };
}

export function databaseTarget(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error("Set a valid PostgreSQL DATABASE_URL in .env.local."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL with a database name.");
  }
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    localSupabase: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "54322",
  };
}

export async function assertPortAvailable(port, host = "::") {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ port, host }, resolve);
    });
    await new Promise((resolve) => server.close(resolve));
  } catch (error) {
    if (host === "::" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) return assertPortAvailable(port, "0.0.0.0");
    if (error.code === "EADDRINUSE") throw new Error(`Port ${port} is already in use. Stop the existing local server before running npm run dev.`);
    throw new Error(`Cannot check port ${port} (${error.code ?? "socket error"}).`);
  }
}

async function runCommand(command, args, { timeoutMs = 10_000 } = {}) {
  try {
    const { stdout } = await executeFile(command, args, { timeout: timeoutMs, maxBuffer: 256 * 1024 });
    return { ok: true, stdout };
  } catch {
    // Docker and connection errors can contain credentials or configuration. Keep diagnostics controlled.
    return { ok: false, stdout: "" };
  }
}

export async function startExistingDatabase({ projectId, run = runCommand, sleep = delay, log = console,
  now = Date.now, timeoutMs = 60_000 } = {}) {
  const deadline = now() + timeoutMs;
  const invoke = (command, args) => run(command, args, { timeoutMs: Math.max(1, Math.min(10_000, deadline - now())) });
  let docker;
  for (const command of ["docker", "docker.exe"]) {
    if (now() >= deadline) break;
    if ((await invoke(command, ["info", "--format", "{{.ServerVersion}}"])).ok) {
      docker = command;
      break;
    }
  }
  if (!docker) {
    for (const command of ["docker", "docker.exe"]) {
      if (now() >= deadline) break;
      if (!(await invoke(command, ["--version"])).ok) continue;
      log.info(`Starting Docker Desktop with ${command}…`);
      if (!(await invoke(command, ["desktop", "start", "--detach"])).ok) continue;
      for (let attempt = 0; attempt < 30 && now() < deadline; attempt++) {
        if ((await invoke(command, ["info", "--format", "{{.ServerVersion}}"])).ok) { docker = command; break; }
        await sleep(1000);
      }
      if (docker) break;
    }
  }
  if (!docker) throw new Error("Start Docker Desktop (or your Docker engine), then retry npm run dev. On WSL, enable Docker Desktop integration for this distribution or make docker.exe available on PATH.");
  const container = `supabase_db_${projectId}`;
  const inspected = await invoke(docker, ["inspect", "--type", "container", "--format", "{{json .HostConfig.PortBindings}}", container]);
  if (!inspected.ok) throw new Error(`The local Supabase database container ${container} is missing. Install the Supabase CLI and run supabase start from the repository root, then retry npm run dev.`);
  // Only resume the existing project database with the configured default port.
  let ports;
  try { ports = JSON.parse(inspected.stdout); } catch { throw new Error(`Cannot inspect database ports for ${container}. Start Supabase manually and retry.`); }
  if (!ports?.["5432/tcp"]?.some(({ HostPort }) => HostPort === "54322")) {
    throw new Error(`The database container ${container} does not publish port 54322. Check DATABASE_URL and start Supabase manually.`);
  }
  log.info(`Starting existing database container ${container}…`);
  if (!(await invoke(docker, ["start", container])).ok) throw new Error(`Cannot start ${container}. Check Docker Desktop and run supabase start, then retry.`);
}

async function probeDatabase(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 1500, query_timeout: 1500 });
  try { await client.connect(); await client.query("select 1"); }
  finally { await client.end(); }
}

export async function ensureDatabase({ connectionString, projectId, probe = probeDatabase,
  recover = startExistingDatabase, sleep = delay, now = Date.now, timeoutMs = 90_000, log = console } = {}) {
  const target = databaseTarget(connectionString);
  const deadline = now() + timeoutMs;
  let recovered = false;
  let lastCode;
  log.info(`Checking PostgreSQL at ${target.host}:${target.port}…`);
  do {
    try { await probe(connectionString); log.info("PostgreSQL is ready."); return; }
    catch (error) {
      // pg's own timeout errors have messages but no error code.
      if (!error.code && ["timeout expired", "Query read timeout"].includes(error.message)) error.code = "ETIMEDOUT";
      lastCode = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "connection error";
      if (!transientDatabaseErrors.has(error.code)) {
        throw new Error(`PostgreSQL connection failed (${lastCode}). Check DATABASE_URL and database permissions; see docs/runbooks/local-development.md.`);
      }
      if (target.localSupabase && error.code === "ECONNREFUSED" && !recovered) {
        recovered = true;
        await recover({ projectId, log, timeoutMs: Math.max(1, Math.min(60_000, deadline - now())) });
      }
    }
    if (now() >= deadline) break;
    await sleep(1000);
  } while (now() < deadline);
  throw new Error(`PostgreSQL was not ready within ${timeoutMs / 1000}s (${lastCode}). Check the database logs, then retry npm run dev.`);
}

export async function waitForHttp(url, { api = false, timeoutMs = 120_000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]) });
      if (response.ok && (!api || (await response.json()).status === "ok")) return;
      if (!response.bodyUsed) await response.body?.cancel();
    } catch { signal?.throwIfAborted(); }
    await delay(500, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error(`Startup timed out waiting for ${url}. Check the process output above and docs/runbooks/local-development.md.`);
}

function launch(workspace, environment, extra = []) {
  return spawn("npm", ["run", "dev", "-w", workspace, ...extra], {
    cwd: repository, env: environment, stdio: "inherit", detached: process.platform !== "win32", shell: process.platform === "win32",
  });
}

export async function stopChildren(children) {
  async function kill(child, signal) {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") await runCommand("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  await Promise.all(children.map((child) => kill(child, "SIGTERM")));
  const force = setTimeout(() => { void Promise.all(children.map((child) => kill(child, "SIGKILL"))); }, 5000);
  try {
    await Promise.all(children.map((child) => !child.pid || child.exitCode !== null || child.signalCode !== null
      ? undefined : new Promise((resolve) => child.once("exit", resolve))));
  } finally {
    clearTimeout(force);
    // npm/watch parents may exit before their descendants. Also close the remaining groups.
    await Promise.all(children.map((child) => kill(child, "SIGKILL")));
  }
}

export async function runDevelopment({ api, web, port }, { start = launch, readiness = waitForHttp, log = console } = {}) {
  const children = [];
  const controller = new AbortController();
  let stop;
  const interrupted = new Promise((resolve) => { stop = (signal) => resolve({ interrupted: signal }); });
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    const exits = [
      ["API", "@open-triage/api", api, []],
      ["Web", "@open-triage/web", web, ["--", "--port", "3000"]],
    ].map(([name, workspace, environment, extra]) => {
      const child = start(workspace, environment, extra);
      children.push(child);
      return new Promise((resolve) => {
        child.once("error", () => resolve({ name, code: 1 }));
        child.once("exit", (code, signal) => resolve({ name, code, signal }));
      });
    });
    const ended = Promise.race([interrupted, ...exits]);
    const ready = Promise.all([
      readiness(`http://localhost:${port}/api/health`, { api: true, signal: controller.signal }),
      readiness("http://localhost:3000", { signal: controller.signal }),
    ]).then(() => null);
    let result = await Promise.race([ready, ended]);
    if (!result) {
      log.info(`OpenTriage is ready: http://localhost:3000 (API: http://localhost:${port}). Press Ctrl+C to stop.`);
      result = await ended;
    }
    if (result.interrupted) return result.interrupted === "SIGINT" ? 130 : 143;
    throw new Error(`${result.name} exited (${result.signal ?? result.code}). Stopping the other development processes.`);
  } finally {
    controller.abort();
    await stopChildren(children);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some((arg) => arg !== "--check") || argv.length > 1) throw new Error("Usage: npm run dev -- [--check]");
  let contents;
  try { contents = await readFile(path.join(repository, ".env.local"), "utf8"); }
  catch { throw new Error("Missing .env.local. Copy .env.example to .env.local and follow docs/runbooks/local-development.md."); }
  const environment = developmentEnvironment(contents);
  databaseTarget(environment.api.DATABASE_URL);
  await Promise.all([assertPortAvailable(3000), assertPortAvailable(environment.port)]);
  const config = await readFile(path.join(repository, "supabase/config.toml"), "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m)?.[1];
  if (!projectId) throw new Error("Set project_id in supabase/config.toml before starting local development.");
  await ensureDatabase({ connectionString: environment.api.DATABASE_URL, projectId });
  if (argv.includes("--check")) return 0;
  const revision = await executeFile("git", ["rev-parse", "--short", "HEAD"], { cwd: repository, timeout: 5000 }).catch(() => ({ stdout: "unknown" }));
  environment.api.OPEN_TRIAGE_BUILD_SHA ||= revision.stdout.trim();
  environment.web.OPEN_TRIAGE_BUILD_SHA = environment.api.OPEN_TRIAGE_BUILD_SHA;
  return runDevelopment(environment);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`Local startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
