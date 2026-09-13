import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { UserLifecycleService } from "../dist/admin/user-lifecycle.service.js";
import { validateUpdateAdminUser } from "../dist/admin/user-lifecycle.validation.js";

const roleId = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000001";
const actorId = "30000000-0000-4000-8000-000000000001";
const organizationId = "40000000-0000-4000-8000-000000000001";
const command = (overrides = {}) => ({ expectedRevision: 4, username: "renamed.user", displayName: "Renamed User",
  active: false, note: "Planned leave", ...overrides });

function setup({ target = {}, actor = {}, targetOnly = [], currentRoleIds = [roleId], sessionsRevoked = 2,
  failCredential } = {}) {
  const events = [];
  const selectedTarget = { id: targetId, display_name: "Original User", username: "original.user",
    active: true, revision: "4", owner: false, ...target };
  const selectedActor = { user: { id: actorId }, organization: { id: organizationId },
    capabilities: ["users:read", "users:write", "roles:read", "roles:assign"], ...actor };
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    events.push({ sql: normalized, parameters });
    if (normalized.startsWith("select u.id, u.display_name")) return [selectedTarget];
    if (normalized.startsWith("select distinct capability.capability_key")) return targetOnly;
    if (normalized.startsWith("select role.id, role.display_name")) {
      return currentRoleIds.map((id) => ({ id, display_name: "Clinician", active: true, protected: true }));
    }
    if (normalized.startsWith("select id, display_name")) return [{ id: roleId, display_name: "Clinician",
      active: true, protected: true, assignable: true }];
    if (normalized.startsWith("update app_identity.local_credential") && failCredential) throw failCredential;
    if (normalized.startsWith("update app_identity.app_session")) {
      return Array.from({ length: sessionsRevoked }, (_, index) => ({ id: `session-${index}` }));
    }
    return [];
  } };
  const dataSource = { transaction: async (work) => {
    events.push({ sql: "begin", parameters: [] });
    try {
      const result = await work(manager);
      events.push({ sql: "commit", parameters: [] });
      return result;
    } catch (error) {
      events.push({ sql: "rollback", parameters: [] });
      throw error;
    }
  } };
  const sessions = { requireCapability: async (token, capability, selectedManager, now) => {
    events.push({ sql: "authorize", parameters: [token, capability, selectedManager, now] });
    return selectedActor;
  } };
  return { events, service: new UserLifecycleService(dataSource, sessions) };
}

test("lifecycle validation normalizes a revisioned identity-state command and rejects role changes on the partial endpoint", () => {
  assert.deepEqual(validateUpdateAdminUser({ expectedRevision: 4, username: " RENAMED.User ",
    displayName: " A\u030Ake Medic ", active: false, note: " Planned leave " }),
  { expectedRevision: 4, username: "renamed.user", displayName: "Åke Medic",
    active: false, note: "Planned leave" });
  for (const invalid of [
    {}, command({ expectedRevision: 0 }), command({ username: "bad user" }), command({ displayName: "" }),
    command({ roleIds: [roleId] }), command({ active: "false" }), command({ organizationId }),
    command({ note: "line\nbreak" })
  ]) assert.throws(() => validateUpdateAdminUser(invalid), BadRequestException);
});

test("disablement atomically renames durable identity, retains roles, revokes sessions, and writes a safe audit", async () => {
  const { service, events } = setup();
  const now = new Date("2026-09-11T12:00:00.000Z");
  const result = await service.update("opaque-session", targetId, command(), now);
  assert.deepEqual(result, { id: targetId, username: "renamed.user", displayName: "Renamed User", active: false,
    revision: 5, roles: [{ id: roleId, displayName: "Clinician", active: true, protected: true }],
    restoredRoles: [], sessionsRevoked: 2, freshLoginRequired: true });
  assert.equal(events[0].sql, "begin");
  assert.equal(events.at(-1).sql, "commit");
  assert.match(events.find(({ sql }) => sql.startsWith("select u.id"))?.sql ?? "", /for update of u, credential/);
  assert.equal(events.some(({ sql }) => sql.startsWith("update app_identity.user_role_assignment")), false);
  assert.match(events.find(({ sql }) => sql.startsWith("update app_identity.app_session"))?.sql ?? "", /account_disabled/);
  const credential = events.find(({ sql }) => sql.startsWith("update app_identity.local_credential"));
  assert.doesNotMatch(credential.sql, /password|credential_version/);
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.equal(audit.parameters[2], "account.disable");
  assert.match(audit.parameters[5], /original\.user/);
  assert.doesNotMatch(JSON.stringify(audit), /password_verifier|token_sha256|csrf_sha256/);
});

test("reactivation reports effective retained roles, requires fresh login, and never changes credentials", async () => {
  const { service, events } = setup({ target: { active: false } });
  const result = await service.update("opaque-session", targetId, command({ active: true, note: "Return to duty" }));
  assert.deepEqual(result.restoredRoles, [{ id: roleId, displayName: "Clinician", active: true, protected: true }]);
  assert.equal(result.sessionsRevoked, 0);
  assert.equal(result.freshLoginRequired, true);
  assert.equal(events.some(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment")), false);
  assert.equal(events.some(({ sql }) => /password_verifier|credential_version/.test(sql)), false);
});

test("self, owner, stale-revision, and more-capable target mutations are rejected before writes", async () => {
  for (const [configured, expected] of [
    [{ target: { id: actorId } }, /own account/],
    [{ target: { owner: true } }, /installation owner/],
    [{ target: { revision: "5" } }, /changed after/],
    [{ targetOnly: [{ capability_key: "forms:publish" }] }, /more-capable/]
  ]) {
    const { service, events } = setup(configured);
    await assert.rejects(service.update("opaque-session", configured.target?.id ?? targetId, command()), expected);
    assert.equal(events.at(-1).sql, "rollback");
    assert.equal(events.some(({ sql }) => sql.startsWith("update app_identity.app_user")), false);
  }
});

test("a permanently reserved username conflict is exposed without committing a partial lifecycle change", async () => {
  const databaseError = Object.assign(new Error("reserved"), { code: "23505" });
  const { service, events } = setup({ failCredential: databaseError });
  await assert.rejects(service.update("opaque-session", targetId, command()), ConflictException);
  assert.equal(events.at(-1).sql, "rollback");
});
