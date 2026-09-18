import assert from "node:assert/strict";
import test from "node:test";
import {
  provisionWorkloadLogins,
  workloadCredentials,
} from "../scripts/provision-workload-logins.mjs";

const password = "a".repeat(32);
const environment = {
  API_DATABASE_LOGIN: "open_triage_demo_api_012345abcdef",
  API_DATABASE_PASSWORD: password,
  ANALYTICS_PROJECTOR_DATABASE_LOGIN: "open_triage_demo_analytics_projector_012345abcdef",
  ANALYTICS_PROJECTOR_DATABASE_PASSWORD: password,
  ANALYTICS_HEALTH_DATABASE_LOGIN: "open_triage_demo_analytics_health_012345abcdef",
  ANALYTICS_HEALTH_DATABASE_PASSWORD: password,
  RETENTION_DATABASE_LOGIN: "open_triage_demo_retention_012345abcdef",
  RETENTION_DATABASE_PASSWORD: password,
  OPERATIONAL_AUDIT_DATABASE_LOGIN: "open_triage_demo_operational_audit_012345abcdef",
  OPERATIONAL_AUDIT_DATABASE_PASSWORD: password,
};

class FakeClient {
  static queries = [];
  async connect() {}
  async end() {}
  async query(sql, parameters = []) {
    FakeClient.queries.push({ sql, parameters });
    if (/from pg_roles where rolname/.test(sql)) {
      if (parameters[0]?.startsWith("open_triage_demo_")) return { rows: [] };
      return { rows: [{
        rolcanlogin: false, rolsuper: false, rolcreaterole: false,
        rolcreatedb: false, rolbypassrls: false,
      }] };
    }
    return { rows: [] };
  }
}

test("accepts only isolated installation logins with strong passwords", () => {
  assert.equal(workloadCredentials(environment).length, 5);
  assert.throws(() => workloadCredentials({ ...environment, API_DATABASE_LOGIN: "postgres" }),
    /installation-specific login/);
  assert.throws(() => workloadCredentials({ ...environment, API_DATABASE_PASSWORD: "short" }),
    /at least 32 characters/);
});

test("creates constrained logins and grants exactly one portable contract", async () => {
  FakeClient.queries = [];
  const messages = [];
  await provisionWorkloadLogins({
    databaseUrl: "postgresql://owner:secret@database/open_triage",
    credentials: workloadCredentials(environment),
    Client: FakeClient,
    log: { info(message) { messages.push(message); } },
  });

  const ddl = FakeClient.queries.map(({ sql }) => sql)
    .filter((sql) => /^\s*(?:create role|grant )/i.test(sql)).join("\n");
  assert.equal((ddl.match(/create role/g) ?? []).length, 5);
  assert.equal((ddl.match(/nosuperuser nocreatedb nocreaterole/g) ?? []).length, 5);
  assert.equal((ddl.match(/^\s*grant /gm) ?? []).length, 5);
  assert.match(ddl, /nobypassrls/);
  assert.doesNotMatch(ddl, /grant all|\ssuperuser|\sbypassrls/i);
  assert.equal(messages.length, 5);
  assert.ok(messages.every((message) => !message.includes(password)));
});
