import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "../dist/identity/account.service.js";
import { verifyPassword } from "../dist/identity/password.js";

test("account provisioning normalizes identity, assigns the selected role, and commits atomically", async () => {
  const queries = [];
  const database = { query: async (sql, parameters = []) => {
    queries.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    return [];
  } };

  const result = await new AccountService(database).provision({
    organizationId: "organization-id",
    username: "  Shift.Owner  ",
    displayName: "  Shift Owner  ",
    role: "owner",
    temporaryPassword: "Temporary password 42!",
  });

  assert.equal(result.username, "shift.owner");
  assert.equal(result.role, "owner");
  assert.match(result.userId, /^[0-9a-f-]{36}$/);
  assert.equal(queries[0].sql, "begin");
  assert.equal(queries.at(-1).sql, "commit");
  assert.equal(queries.some(({ sql }) => sql === "rollback"), false);
  const userInsert = queries.find(({ sql }) => sql.startsWith("insert into app_identity.app_user"));
  assert.deepEqual(userInsert.parameters.slice(1), ["organization-id", "Shift Owner"]);
  const credentialInsert = queries.find(({ sql }) => sql.startsWith("insert into app_identity.local_credential"));
  assert.equal(credentialInsert.parameters[1], "shift.owner");
  assert.equal(await verifyPassword("Temporary password 42!", credentialInsert.parameters[2]), true);
  assert.deepEqual(queries.filter(({ sql }) => sql.startsWith("insert into app_identity.user_capability"))
    .map(({ parameters }) => parameters[1]), ["installation:administer", "clinical:document"]);
});

test("account provisioning rolls back every write when a capability assignment fails", async () => {
  const statements = [];
  const failure = new Error("capability write failed");
  const database = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    statements.push(normalized);
    if (normalized.startsWith("insert into app_identity.user_capability")) throw failure;
    return [];
  } };

  await assert.rejects(new AccountService(database).provision({
    organizationId: "organization-id",
    username: "clinician",
    displayName: "Clinician",
    role: "clinician",
    temporaryPassword: "Temporary password 42!",
  }), (error) => error === failure);
  assert.equal(statements.at(-1), "rollback");
  assert.equal(statements.includes("commit"), false);
});

test("password reset rotates credentials, revokes sessions, audits, and handles unknown accounts atomically", async () => {
  const statements = [];
  const account = { user_id: "user-id", organization_id: "organization-id" };
  const database = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    statements.push({ sql: normalized, parameters });
    if (normalized.startsWith("select c.user_id")) return [account];
    return [];
  } };
  const result = await new AccountService(database).resetPassword("  Clinician.One ", "Replacement password 84!");
  assert.deepEqual(result, { userId: "user-id", username: "clinician.one" });
  assert.equal(await verifyPassword("Replacement password 84!",
    statements.find(({ sql }) => sql.startsWith("update app_identity.local_credential")).parameters[1]), true);
  assert.ok(statements.some(({ sql }) => sql.includes("revocation_reason = 'password_reset'")));
  assert.ok(statements.some(({ sql }) => sql.includes("'account.reset_password'")));
  assert.equal(statements.at(-1).sql, "commit");

  const missingStatements = [];
  const missing = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    missingStatements.push(normalized);
    return [];
  } };
  await assert.rejects(
    new AccountService(missing).resetPassword("missing", "Replacement password 84!"),
    /No local account/,
  );
  assert.equal(missingStatements.at(-1), "rollback");
});
