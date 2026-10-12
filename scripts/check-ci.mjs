import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function run(command, args, env = process.env) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
const npm = (args, env) => run("npm", args, env);
const docker = process.env.DOCKER_COMMAND || "docker";
const container = `open-triage-check-${randomUUID()}`;
let started = false;
try {
  // Match clean CI jobs; developer database/private settings must not affect units.
  const env = { ...process.env };
  delete env.DATABASE_URL;
  for (const key of Object.keys(env)) if (key.startsWith("NEXT_PUBLIC_")) delete env[key];
  npm(["run", "typecheck"], env);
  npm(["run", "lint"], env);
  npm(["test"], env);
  npm(["run", "build"], { ...env, NEXT_PUBLIC_API_URL: "same-origin" });
  npm(["run", "test:deployment", "-w", "@open-triage/web"], { ...env, NEXT_PUBLIC_API_URL: "same-origin" });
  run(docker, ["run", "--detach", "--name", container, "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=open_triage_test",
    "--health-cmd", "pg_isready -U postgres -d open_triage_test", "--health-interval", "1s", "postgres:15"]);
  started = true;
  const portResult = spawnSync(docker, ["port", container, "5432/tcp"], { encoding: "utf8" });
  if (portResult.status !== 0) throw new Error("Cannot resolve disposable database port");
  const port = portResult.stdout.trim().split(":").at(-1);
  // pg retries during startup; all integration commands fail closed without a DB.
  const { default: pg } = await import("pg");
  const databaseEnv = { ...env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/open_triage_test` };
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const client = new pg.Client({ connectionString: databaseEnv.DATABASE_URL, connectionTimeoutMillis: 1000 });
    try { await client.connect(); ready = true; } catch { /* startup */ }
    finally { await client.end(); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  npm(["run", "test:integration", "-w", "@open-triage/database"], databaseEnv);
  npm(["run", "test:integration", "-w", "@open-triage/api"], databaseEnv);
  npm(["run", "scale:test:ci", "-w", "@open-triage/database"], databaseEnv);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) run(docker, ["rm", "--force", container]);
}
