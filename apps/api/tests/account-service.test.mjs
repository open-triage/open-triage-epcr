import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "../dist/identity/account.service.js";
import { verifyPassword } from "../dist/identity/password.js";

function instrumentedDataSource(respond = () => []) {
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
        events.push({ connection: "transaction-connection", sql: "begin" });
        try {
          const result = await work(manager);
          events.push({ connection: "transaction-connection", sql: "commit" });
          return result;
        } catch (error) {
          events.push({ connection: "transaction-connection", sql: "rollback" });
          throw error;
        }
      }
    }
  };
}

test("account provisioning uses one transaction connection and commits all writes", async () => {
  const { dataSource, events } = instrumentedDataSource();
  const result = await new AccountService(dataSource).provision({
    organizationId: "organization-id",
    username: "  Shift.Owner  ",
    displayName: "  Shift Owner  ",
    role: "owner",
    temporaryPassword: "Temporary password 42!",
  });

  assert.equal(result.username, "shift.owner");
  assert.equal(result.role, "owner");
  assert.match(result.userId, /^[0-9a-f-]{36}$/);
  assert.equal(events[0].sql, "begin");
  assert.equal(events.at(-1).sql, "commit");
  assert.deepEqual(new Set(events.map(({ connection }) => connection)), new Set(["transaction-connection"]));
  const userInsert = events.find(({ sql }) => sql.startsWith("insert into app_identity.app_user"));
  assert.deepEqual(userInsert.parameters.slice(1), ["organization-id", "Shift Owner"]);
  const credentialInsert = events.find(({ sql }) => sql.startsWith("insert into app_identity.local_credential"));
  assert.equal(credentialInsert.parameters[1], "shift.owner");
  assert.equal(await verifyPassword("Temporary password 42!", credentialInsert.parameters[2]), true);
  assert.deepEqual(events.filter(({ sql }) => sql.startsWith("insert into app_identity.user_capability"))
    .map(({ parameters }) => parameters[1]), ["installation:administer", "clinical:document"]);
});

test("account provisioning rolls back every write when a capability assignment fails", async () => {
  const failure = new Error("capability write failed");
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("insert into app_identity.user_capability")) throw failure;
    return [];
  });

  await assert.rejects(new AccountService(dataSource).provision({
    organizationId: "organization-id",
    username: "clinician",
    displayName: "Clinician",
    role: "clinician",
    temporaryPassword: "Temporary password 42!",
  }), (error) => error === failure);
  assert.equal(events.at(-1).sql, "rollback");
  assert.equal(events.some(({ sql }) => sql === "commit"), false);
  assert.deepEqual(new Set(events.map(({ connection }) => connection)), new Set(["transaction-connection"]));
});

test("password reset rotates credentials, revokes sessions, audits, and commits on one connection", async () => {
  const account = { user_id: "user-id", organization_id: "organization-id" };
  const { dataSource, events } = instrumentedDataSource(({ sql }) => sql.startsWith("select c.user_id") ? [account] : []);
  const result = await new AccountService(dataSource).resetPassword("  Clinician.One ", "Replacement password 84!");

  assert.deepEqual(result, { userId: "user-id", username: "clinician.one" });
  assert.equal(await verifyPassword("Replacement password 84!",
    events.find(({ sql }) => sql.startsWith("update app_identity.local_credential")).parameters[1]), true);
  assert.ok(events.some(({ sql }) => sql.includes("revocation_reason = 'password_reset'")));
  assert.ok(events.some(({ sql }) => sql.includes("'account.reset_password'")));
  assert.equal(events.at(-1).sql, "commit");
  assert.deepEqual(new Set(events.map(({ connection }) => connection)), new Set(["transaction-connection"]));
});

test("password reset rolls back credential and session writes when its audit fails", async () => {
  const failure = new Error("audit write failed");
  const account = { user_id: "user-id", organization_id: "organization-id" };
  const { dataSource, events } = instrumentedDataSource(({ sql }) => {
    if (sql.startsWith("select c.user_id")) return [account];
    if (sql.startsWith("insert into app_identity.authentication_event")) throw failure;
    return [];
  });

  await assert.rejects(
    new AccountService(dataSource).resetPassword("clinician", "Replacement password 84!"),
    (error) => error === failure,
  );
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.local_credential")));
  assert.ok(events.some(({ sql }) => sql.includes("revocation_reason = 'password_reset'")));
  assert.equal(events.at(-1).sql, "rollback");
  assert.equal(events.some(({ sql }) => sql === "commit"), false);
});

test("password reset rolls back when the account does not exist", async () => {
  const { dataSource, events } = instrumentedDataSource();
  await assert.rejects(
    new AccountService(dataSource).resetPassword("missing", "Replacement password 84!"),
    /No local account/,
  );
  assert.equal(events.at(-1).sql, "rollback");
});
