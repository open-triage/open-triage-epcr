import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { assertPortAvailable, databaseTarget, developmentEnvironment, ensureDatabase,
  runDevelopment, startExistingDatabase, waitForHttp } from "../scripts/dev-local.mjs";

const quiet = { info() {} };
const localUrl = "postgresql://postgres:do-not-log-this@127.0.0.1:54322/postgres";
const databaseError = (code) => Object.assign(new Error(`secret ${localUrl}`), { code });

test("root configuration keeps API ports and secrets out of the web process, including previously sourced values", () => {
  const contents = `DATABASE_URL=${localUrl}\nPORT=3001\nPATIENT_KEY_SECRET_BASE64=private\nNEXT_PUBLIC_API_URL=http://localhost:3001\n`;
  const { api, web, port } = developmentEnvironment(contents, { PATH: "/bin", PORT: "3001", DATABASE_URL: localUrl, PATIENT_KEY_SECRET_BASE64: "private" });
  assert.equal(api.DATABASE_URL, localUrl);
  assert.equal(api.PATIENT_KEY_SECRET_BASE64, "private");
  assert.equal(port, 3001);
  assert.equal(web.PORT, undefined);
  assert.equal(web.DATABASE_URL, undefined);
  assert.equal(web.PATIENT_KEY_SECRET_BASE64, undefined);
  assert.equal(web.PATH, "/bin");
  assert.equal(web.NEXT_PUBLIC_API_URL, "http://localhost:3001");
  assert.throws(() => developmentEnvironment("PORT=3000", {}), /different from the web port/);
});

test("rejects invalid connection URLs without echoing their contents and only recovers default local Supabase", () => {
  for (const url of [undefined, "secret", "https://secret@example.org/db", "postgres://localhost"]) {
    assert.throws(() => databaseTarget(url), (error) => !error.message.includes("secret"));
  }
  assert.equal(databaseTarget(localUrl).localSupabase, true);
  assert.equal(databaseTarget("postgres://postgres@localhost:5432/postgres").localSupabase, false);
  assert.equal(databaseTarget("postgres://postgres@example.org:54322/postgres").localSupabase, false);
});

test("occupied ports are detected without lsof", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(assertPortAvailable(server.address().port), /already in use/);
});

test("WSL uses docker.exe when Linux Docker integration is unavailable and starts the existing database", async () => {
  const calls = [];
  await startExistingDatabase({ projectId: "open-triage", log: quiet, run: async (command, args) => {
    calls.push([command, ...args]);
    if (command === "docker") return { ok: false };
    return { ok: true, stdout: args[0] === "inspect" ? '{"5432/tcp":[{"HostPort":"54322"}]}' : "" };
  } });
  assert.deepEqual(calls.at(-1), ["docker.exe", "start", "supabase_db_open-triage"]);
  assert.equal(calls.some((call) => call.includes("desktop")), false);
});

test("stopped Docker Desktop is started before inspecting the database and database credentials never enter commands", async () => {
  const calls = [];
  let starting = false;
  let polls = 0;
  await startExistingDatabase({ projectId: "open-triage", log: quiet, sleep: async () => {}, run: async (command, args) => {
    calls.push([command, ...args]);
    if (command === "docker") return { ok: false };
    if (args[0] === "desktop") { starting = true; return { ok: true }; }
    if (args[0] === "info") return { ok: starting && ++polls > 1 };
    return { ok: true, stdout: args[0] === "inspect" ? '{"5432/tcp":[{"HostPort":"54322"}]}' : "" };
  } });
  assert.ok(calls.some((call) => call.join(" ") === "docker.exe desktop start --detach"));
  assert.equal(calls.at(-1)[1], "start");
  assert.equal(JSON.stringify(calls).includes("do-not-log-this"), false);
});

test("missing or differently mapped databases produce setup instructions without creating containers", async () => {
  for (const inspected of [{ ok: false }, { ok: true, stdout: '{"5432/tcp":[{"HostPort":"54399"}]}' }]) {
    const calls = [];
    await assert.rejects(startExistingDatabase({ projectId: "open-triage", log: quiet, run: async (_, args) => {
      calls.push(args);
      return args[0] === "inspect" ? inspected : { ok: true };
    } }), /start Supabase manually|supabase start/);
    assert.equal(calls.some(([command]) => command === "start" || command === "run"), false);
  }
});

test("waits through database recovery and never launches recovery twice", async () => {
  let attempts = 0;
  let recoveries = 0;
  await ensureDatabase({ connectionString: localUrl, projectId: "open-triage", log: quiet,
    sleep: async () => {}, recover: async () => { recoveries++; }, probe: async () => {
      attempts++;
      if (attempts <= 2) throw databaseError("ECONNREFUSED");
      if (attempts === 3) throw databaseError("57P03");
    } });
  assert.equal(attempts, 4);
  assert.equal(recoveries, 1);
});

test("ready and starting databases do not require Docker", async () => {
  for (const firstError of [undefined, "57P03"]) {
    let attempts = 0;
    await ensureDatabase({ connectionString: localUrl, log: quiet, sleep: async () => {},
      recover: async () => assert.fail("must not invoke Docker"), probe: async () => {
        if (++attempts === 1 && firstError) throw databaseError(firstError);
      } });
  }
});

test("pg timeout errors without socket codes are retried", async () => {
  let attempts = 0;
  await ensureDatabase({ connectionString: localUrl, log: quiet, sleep: async () => {},
    recover: async () => assert.fail("timeouts must not start Docker"), probe: async () => {
      if (++attempts === 1) throw new Error("timeout expired");
      if (attempts === 2) throw new Error("Query read timeout");
    } });
  assert.equal(attempts, 3);
});

test("authentication errors fail immediately with redacted diagnostics; remote database retries are bounded", async () => {
  await assert.rejects(ensureDatabase({ connectionString: localUrl, log: quiet,
    recover: async () => assert.fail("must not invoke Docker"), probe: async () => { throw databaseError("28P01"); },
  }), (error) => error.message.includes("28P01") && !error.message.includes("do-not-log-this"));
  let time = 0;
  await assert.rejects(ensureDatabase({ connectionString: "postgres://user@example.org:54322/postgres", log: quiet,
    now: () => time, timeoutMs: 10, sleep: async () => { time += 10; },
    recover: async () => assert.fail("must not invoke Docker for remote database"),
    probe: async () => { throw databaseError("ECONNREFUSED"); },
  }), /not ready within/);
});

test("HTTP readiness waits for an actual healthy API response", async (t) => {
  let requests = 0;
  const server = httpServer((_, response) => {
    requests++;
    response.writeHead(requests === 1 ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: requests < 3 ? "starting" : "ok" }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  await waitForHttp(`http://127.0.0.1:${server.address().port}/api/health`, { api: true, timeoutMs: 5000 });
  assert.equal(requests, 3);
});

test("failed API process stops the web process and its watcher descendants", { skip: process.platform === "win32" }, async () => {
  let web;
  let descendant;
  await assert.rejects(runDevelopment({ api: {}, web: {}, port: 1 }, { log: quiet, start: (workspace) => {
    if (workspace === "@open-triage/api") return spawn(process.execPath, ["-e", "setTimeout(()=>process.exit(2), 500)"], { detached: true });
    web = spawn(process.execPath, ["-e", `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      console.log(child.pid);
      setInterval(()=>{},1000);
    `], { detached: true });
    web.stdout.once("data", (data) => { descendant = Number(String(data).trim()); });
    return web;
  } }), /API exited \(2\)/);
  assert.ok(web.signalCode);
  assert.ok(descendant);
  // Descendants can briefly be zombies until the OS reaps them; they cannot keep serving.
  try {
    const { readFile } = await import("node:fs/promises");
    const status = await readFile(`/proc/${descendant}/stat`, "utf8");
    assert.match(status, /\) Z /);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
});

test("failed process spawning exits promptly instead of hanging cleanup", async () => {
  await assert.rejects(runDevelopment({ api: {}, web: {}, port: 1 }, { log: quiet,
    start: () => spawn("/nonexistent/open-triage-command", [], { detached: true }),
  }), /exited \(1\)/);
});

test("an API stuck in its watcher after a startup failure is stopped when HTTP readiness times out", async () => {
  const children = [];
  await assert.rejects(runDevelopment({ api: {}, web: {}, port: 1 }, { log: quiet,
    start: () => {
      const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true });
      children.push(child);
      return child;
    },
    readiness: async () => { await delay(50); throw new Error("Startup timed out waiting for API health"); },
  }), /Startup timed out/);
  assert.equal(children.length, 2);
  assert.ok(children.every((child) => child.signalCode));
});
