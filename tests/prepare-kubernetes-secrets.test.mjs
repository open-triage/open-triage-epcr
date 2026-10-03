import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { preparationOptions, prepareSecrets, secretBundle } from "../scripts/prepare-kubernetes-secrets.mjs";
import { workloadCredentials } from "../packages/database/scripts/provision-workload-logins.mjs";

const input = "DATABASE_URL=postgresql://owner:private@db.agency.test:5432/postgres?sslmode=verify-full\n";
const environment = (text) => Object.fromEntries(text.trim().split("\n").map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));

test("production credentials preserve routing and assign five distinct restricted contracts", () => {
  const files = secretBundle(input);
  assert.equal(Object.keys(files).length, 7);
  assert.equal(files["open-triage-migration.env"], input);
  const credentials = workloadCredentials(environment(files["open-triage-workload-bootstrap.env"]));
  assert.equal(new Set(credentials.map(({ login }) => login)).size, 5);
  assert.equal(new Set(credentials.map(({ password }) => password)).size, 5);
  for (const credential of credentials) {
    const filename = `open-triage-${credential.key.toLowerCase().replaceAll("_", "-")}.env`;
    const url = new URL(environment(files[filename]).DATABASE_URL);
    assert.equal(decodeURIComponent(url.username), credential.login);
    assert.equal(decodeURIComponent(url.password), credential.password);
    assert.equal(url.hostname, "db.agency.test");
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.searchParams.get("options"), `-c role=${credential.portableRole}`);
  }
  const api = environment(files["open-triage-api.env"]);
  const keys = [api.PATIENT_KEY_SECRET_BASE64, api.AUTH_RATE_LIMIT_SECRET_BASE64, api.OFFLINE_RECOVERY_SECRET_BASE64];
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.equal(Buffer.from(key, "base64").length, 32);
  assert.match(api.PATIENT_KEY_INSTALLATION_ID, /^[a-f0-9-]{36}$/);
});

test("shared Supabase pooler retains project routing and existing startup settings", () => {
  const files = secretBundle("DATABASE_URL=postgresql://postgres.project:private@aws-0.pooler.supabase.com:5432/postgres?options=-c%20statement_timeout%3D45s\n");
  const url = new URL(environment(files["open-triage-api.env"]).DATABASE_URL);
  assert.match(decodeURIComponent(url.username), /^open_triage_prod_api_[a-f0-9]{12}\.project$/);
  assert.equal(url.searchParams.get("options"), "-c statement_timeout=45s -c role=open_triage_api_runtime");
});

test("reject malformed or role-overridden migration input without disclosing it", () => {
  for (const text of ["DATABASE_URL=secret-not-a-url", input + "ANOTHER=private\n", "DATABASE_URL=mysql://owner:private@db/postgres", input.replace("sslmode=verify-full", "options=-c%20role%3Downer")]) {
    assert.throws(() => secretBundle(text), (error) => !error.message.includes("private") && !error.message.includes("secret-not-a-url"));
  }
  assert.throws(() => preparationOptions(["--migration-env", "one", "--migration-env", "two"]));
});

test("writes private files and refuses to replace existing installation secrets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-production-secrets-"));
  try {
    const migrationEnv = path.join(directory, "input.env"), outputDir = path.join(directory, "generated");
    await writeFile(migrationEnv, input, { mode: 0o600 });
    const messages = [];
    await prepareSecrets({ migrationEnv, outputDir }, { log: { info: (message) => messages.push(message) } });
    assert.equal((await stat(outputDir)).mode & 0o777, 0o700);
    const before = await readFile(path.join(outputDir, "open-triage-api.env"), "utf8");
    for (const name of Object.keys(secretBundle(input))) assert.equal((await stat(path.join(outputDir, name))).mode & 0o777, 0o600);
    assert.ok(messages.every((message) => !message.includes("DATABASE_URL") && !message.includes("private@")));
    await assert.rejects(prepareSecrets({ migrationEnv, outputDir }), /Refusing to overwrite/);
    assert.equal(await readFile(path.join(outputDir, "open-triage-api.env"), "utf8"), before);
    const publicDir = path.join(directory, "public");
    await mkdir(publicDir, { mode: 0o755 });
    await assert.rejects(prepareSecrets({ migrationEnv, outputDir: publicDir }), /private directory/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
