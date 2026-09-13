import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "../dist/identity/account.service.js";
import { runIdentityAccountCli } from "../dist/identity/identity-account.cli.js";
import { verifyPassword } from "../dist/identity/password.js";

const operator = { operatorId: "ops-ticket-42", osAccount: "deploy", host: "ops-01" };

function instrumentedDataSource(respond = ({ sql }) =>
  sql.startsWith("insert into app_identity.user_role_assignment") ? [{ id: "assignment-id" }] : []) {
  const events = [];
  const manager = { query: async (sql, parameters = []) => {
    const statement = { connection: "transaction-connection", sql: sql.replace(/\s+/g, " ").trim(), parameters };
    events.push(statement);
    return respond(statement);
  } };
  return {
    events,
    dataSource: {
      query: async () => { throw new Error("pooled DataSource.query must not be used inside an account operation"); },
      transaction: async (work) => {
        events.push({ connection: "transaction-connection", sql: "begin", parameters: [] });
        try {
          const result = await work(manager);
          events.push({ connection: "transaction-connection", sql: "commit", parameters: [] });
          return result;
        } catch (error) {
          events.push({ connection: "transaction-connection", sql: "rollback", parameters: [] });
          throw error;
        }
      }
    }
  };
}

function defaultResponse({ sql }) {
  if (sql.startsWith("select id from app_identity.organization")) return [{ id: "organization-id" }];
  if (sql.startsWith("insert into app_identity.user_role_assignment")) return [{ id: "assignment-id" }];
  return [];
}

test("ordinary account provisioning grants only its explicit protected role", async () => {
  const { dataSource, events } = instrumentedDataSource();
  const result = await new AccountService(dataSource).provision({
    organizationId: "organization-id", username: "  Shift.Admin  ", displayName: "  Shift Admin  ",
    role: "administrator", temporaryPassword: "Temporary password 42!"
  });
  assert.equal(result.username, "shift.admin");
  assert.equal(result.role, "administrator");
  assert.deepEqual(events.filter(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment"))
    .map(({ parameters }) => parameters[2]), ["administrator"]);
  assert.equal(events.at(-1).sql, "commit");
});

test("owner bootstrap atomically creates an Administrator and Clinician owner", async () => {
  const { dataSource, events } = instrumentedDataSource(defaultResponse);
  const result = await new AccountService(dataSource).bootstrapOwner({
    organizationId: "organization-id", username: "  First.Owner  ", displayName: " First Owner ",
    temporaryPassword: "Temporary password 42!", clinician: false, operator
  });
  assert.equal(result.username, "first.owner");
  assert.equal(result.clinician, true);
  assert.match(result.userId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(events.filter(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment"))
    .map(({ parameters }) => parameters[2]), ["administrator", "clinician"]);
  assert.ok(events.some(({ sql }) => sql.startsWith("insert into app_identity.installation_owner")));
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.operator_identity_event"));
  assert.deepEqual(audit.parameters.slice(0, 2), ["owner.bootstrap", "organization-id"]);
  assert.deepEqual(audit.parameters.slice(3), ["ops-ticket-42", "deploy", "ops-01", "succeeded"]);
  assert.equal(events[0].sql, "begin");
  assert.equal(events.at(-1).sql, "commit");
});

test("owner bootstrap retains the compatibility option while always granting Clinician", async () => {
  const { dataSource, events } = instrumentedDataSource(defaultResponse);
  await new AccountService(dataSource).bootstrapOwner({
    organizationId: "organization-id", username: "clinical.owner", displayName: "Clinical Owner",
    temporaryPassword: "Temporary password 42!", clinician: true, operator
  });
  assert.deepEqual(events.filter(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment"))
    .map(({ parameters }) => parameters[2]), ["administrator", "clinician"]);
});

test("owner bootstrap replay creates nothing and records the failed immutable target", async () => {
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select id from app_identity.organization")) return [{ id: "organization-id" }];
    if (sql.startsWith("select user_id from app_identity.installation_owner")) return [{ user_id: "existing-owner" }];
    return [];
  });
  await assert.rejects(new AccountService(dataSource).bootstrapOwner({
    organizationId: "organization-id", username: "other.owner", displayName: "Other Owner",
    temporaryPassword: "Temporary password 42!", clinician: false, operator
  }), /already has/);
  assert.equal(events.some(({ sql }) => sql.startsWith("insert into app_identity.app_user")), false);
  assert.ok(events.some(({ sql, parameters }) => sql.startsWith("insert into app_identity.operator_identity_event")
    && parameters[0] === "owner.bootstrap" && parameters.at(-1) === "failed"));
});

test("immutable-user and organization-owner recovery rotate credentials, revoke sessions, and audit operator identity", async () => {
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select credential.user_id")) return [{ user_id: "user-id", organization_id: "organization-id" }];
    if (sql.startsWith("select owner_record.user_id")) return [{ user_id: "owner-id" }];
    return [];
  });
  const accounts = new AccountService(dataSource);
  assert.deepEqual(await accounts.resetUserPassword("user-id", "Replacement password 84!", operator),
    { organizationId: "organization-id", userId: "user-id" });
  assert.deepEqual(await accounts.resetOwnerPassword("organization-id", "Owner replacement 84!", operator),
    { organizationId: "organization-id", userId: "owner-id" });
  const updates = events.filter(({ sql }) => sql.startsWith("update app_identity.local_credential"));
  assert.equal(await verifyPassword("Replacement password 84!", updates[0].parameters[1]), true);
  assert.equal(await verifyPassword("Owner replacement 84!", updates[1].parameters[1]), true);
  assert.equal(events.filter(({ sql }) => sql.includes("revocation_reason = 'password_reset'")).length, 2);
  const audits = events.filter(({ sql }) => sql.startsWith("insert into app_identity.operator_identity_event"));
  assert.deepEqual(audits.map(({ parameters }) => [parameters[0], parameters[1], parameters[2], parameters.at(-1)]), [
    ["user.reset_password", "organization-id", "user-id", "succeeded"],
    ["owner.reset_password", "organization-id", "owner-id", "succeeded"]
  ]);
  assert.equal(JSON.stringify(audits).includes("Replacement password"), false);
});

test("recovery rollback is followed by a credential-free failed audit", async () => {
  const failure = new Error("credential write failed");
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select credential.user_id")) return [{ user_id: "user-id", organization_id: "organization-id" }];
    if (sql.startsWith("update app_identity.local_credential")) throw failure;
    return [];
  });
  await assert.rejects(new AccountService(dataSource).resetUserPassword(
    "user-id", "Replacement password 84!", operator), (error) => error === failure);
  assert.ok(events.some(({ sql }) => sql === "rollback"));
  const failedAudit = events.find(({ sql, parameters }) =>
    sql.startsWith("insert into app_identity.operator_identity_event") && parameters.at(-1) === "failed");
  assert.deepEqual(failedAudit.parameters.slice(0, 3), ["user.reset_password", null, "user-id"]);
  assert.equal(JSON.stringify(events).includes("Replacement password 84!"), false);
});

test("CLI accepts passwords only through its reader and exposes immutable reset targets", async () => {
  let reads = 0;
  const dependencies = { readPassword: async () => { reads += 1; return "Temporary password 42!"; },
    osAccount: "deploy", host: "ops-01" };
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select credential.user_id")) return [{ user_id: "user-id", organization_id: "organization-id" }];
    return [];
  });
  await runIdentityAccountCli(dataSource,
    ["reset-user", "--user-id", "user-id", "--operator-id", "ops-ticket-42"], dependencies);
  assert.equal(reads, 1);
  assert.equal(events.some(({ parameters }) => parameters.includes("Temporary password 42!")), false);
  await assert.rejects(runIdentityAccountCli(dataSource,
    ["reset-user", "--username", "mutable-name", "--operator-id", "ops-ticket-42"], dependencies), /Unknown option/);
});
