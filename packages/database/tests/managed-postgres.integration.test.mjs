import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const fixture = process.env.POSTGRES_FIXTURE;

if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for the managed PostgreSQL integration suite");
}

const integrationTest = databaseUrl ? test : test.skip;

async function rejectedWithPrivilegeError(client, sql) {
  await client.query("savepoint expected_privilege_failure");
  try {
    await assert.rejects(client.query(sql), (error) => error.code === "42501");
  } finally {
    await client.query("rollback to savepoint expected_privilege_failure");
  }
}

integrationTest("clean migrations use a constrained migration identity", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());

  const identity = (await client.query(`select current_user,
      rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    from pg_roles where rolname = current_user`)).rows[0];
  assert.deepEqual(identity, {
    current_user: "open_triage_ci_migration",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: true,
    rolbypassrls: false,
  });

  const extension = (await client.query(`select namespace.nspname schema_name
    from pg_extension extension
    join pg_namespace namespace on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'`)).rows[0];
  assert.equal(extension.schema_name, fixture === "managed" ? "extensions" : "public");
});

integrationTest("runtime roles receive only required pgcrypto access", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());

  const schema = fixture === "managed" ? "extensions" : "public";
  const privileges = (await client.query(`select
      has_schema_privilege('open_triage_api_runtime', $1, 'usage') schema_usage,
      has_function_privilege('open_triage_api_runtime', $2, 'execute') digest_text,
      has_function_privilege('open_triage_api_runtime', $3, 'execute') digest_bytes,
      has_function_privilege('open_triage_api_runtime', $4, 'execute') crypt,
      has_function_privilege('open_triage_api_runtime', $5, 'execute') random_bytes`, [
    schema,
    `${schema}.digest(text,text)`,
    `${schema}.digest(bytea,text)`,
    `${schema}.crypt(text,text)`,
    `${schema}.gen_random_bytes(integer)`,
  ])).rows[0];
  assert.deepEqual(privileges, {
    schema_usage: true,
    digest_text: true,
    digest_bytes: true,
    crypt: false,
    random_bytes: false,
  });

  await client.query("begin");
  try {
    await client.query("set local role open_triage_api_runtime");
    const hash = (await client.query(
      `select encode(${schema}.digest('managed-semantics', 'sha256'), 'hex') hash`,
    )).rows[0].hash;
    assert.match(hash, /^[a-f0-9]{64}$/);
    await rejectedWithPrivilegeError(client, `select ${schema}.crypt('secret', 'salt')`);
    await rejectedWithPrivilegeError(client, "create schema runtime_escape");
  } finally {
    await client.query("rollback");
  }
});

integrationTest("managed-compatible platform roles stay conditional and unprivileged", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());

  const roles = (await client.query(`select rolname, rolcanlogin, rolsuper,
      rolcreatedb, rolcreaterole, rolbypassrls
    from pg_roles
    where rolname = any(array['anon', 'authenticated', 'service_role', 'authenticator'])
    order by rolname`)).rows;

  if (fixture !== "managed") {
    assert.deepEqual(roles, []);
    return;
  }

  assert.deepEqual(roles, [
    { rolname: "anon", rolcanlogin: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false },
    { rolname: "authenticated", rolcanlogin: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false },
    { rolname: "authenticator", rolcanlogin: true, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false },
    { rolname: "service_role", rolcanlogin: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: true },
  ]);
  const leaked = (await client.query(`select
      has_schema_privilege('anon', 'extensions', 'usage') anon_schema,
      has_function_privilege('authenticated', 'extensions.digest(text,text)', 'execute') authenticated_digest,
      has_function_privilege('service_role', 'extensions.crypt(text,text)', 'execute') service_crypt`)).rows[0];
  assert.deepEqual(leaked, {
    anon_schema: false,
    authenticated_digest: false,
    service_crypt: false,
  });
});
