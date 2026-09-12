import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { UserRoleAssignmentService } from "../dist/admin/user-role-assignment.service.js";
import { validateReplaceAdminUserRoles } from "../dist/admin/user-role-assignment.validation.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000001";
const targetId = "30000000-0000-4000-8000-000000000001";
const roleA = "40000000-0000-4000-8000-000000000001";
const roleB = "50000000-0000-4000-8000-000000000001";

function setup({ target = {}, currentRoleIds = [roleA], roleRows, actorCapabilities = ["roles:assign", "users:read"],
  actorOwner = false, recent = true } = {}) {
  const events = [];
  const roles = roleRows ?? [
    { id: roleA, display_name: "User reader", active: true, protected: false, assignable: true,
      system_key: null, capability_key: "users:read" },
    { id: roleB, display_name: "Role assigner", active: true, protected: false, assignable: true,
      system_key: null, capability_key: "roles:assign" }
  ];
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    events.push({ sql: normalized, parameters });
    if (normalized.startsWith("select u.id, u.display_name")) return [{ id: targetId, display_name: "Target",
      username: "target.user", active: false, revision: "7", owner: false, ...target }];
    if (normalized.startsWith("select assignment.role_id")) return currentRoleIds.map((role_id) => ({ role_id }));
    if (normalized.startsWith("select role.id, role.display_name")) return roles;
    if (normalized.startsWith("select exists") && normalized.includes("installation_owner")) return [{ owner: actorOwner }];
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
  const sessions = {
    requireCapability: async () => ({ user: { id: actorId }, organization: { id: organizationId },
      capabilities: actorCapabilities }),
    requireRecentReauthentication: async () => {
      events.push({ sql: "require recent reauthentication", parameters: [] });
      if (!recent) throw new ForbiddenException("Recent password reauthentication is required");
    }
  };
  return { events, service: new UserRoleAssignmentService(dataSource, sessions) };
}

test("full-set validation rejects partial, stale-shaped, duplicate, and forged commands", () => {
  assert.deepEqual(validateReplaceAdminUserRoles({ expectedRevision: 7, roleIds: [roleA], note: " Prepared " }),
    { expectedRevision: 7, roleIds: [roleA], note: "Prepared" });
  for (const value of [{}, { expectedRevision: 7 }, { expectedRevision: 0, roleIds: [] },
    { expectedRevision: 7, roleIds: [roleA, roleA] }, { expectedRevision: 7, roleIds: ["invalid"] },
    { expectedRevision: 7, roleIds: [], addRoleIds: [roleA] }]) {
    assert.throws(() => validateReplaceAdminUserRoles(value), BadRequestException);
  }
});

test("a disabled user's complete role set is replaced atomically with one independent audit diff", async () => {
  const { service, events } = setup();
  const result = await service.replace("opaque-session", targetId,
    { expectedRevision: 7, roleIds: [roleB] }, new Date("2026-09-11T12:00:00.000Z"));
  assert.equal(result.active, false);
  assert.equal(result.revision, 8);
  assert.deepEqual(result.roles.map(({ id }) => id), [roleB]);
  assert.deepEqual(result.addedRoles.map(({ id }) => id), [roleB]);
  assert.deepEqual(result.removedRoles.map(({ id }) => id), [roleA]);
  assert.equal(events[0].sql, "begin");
  assert.equal(events.at(-1).sql, "commit");
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.user_role_assignment")));
  assert.ok(events.some(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment")));
  assert.equal(events.filter(({ sql }) => sql.startsWith("insert into app_identity.authentication_event")).length, 1);
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.deepEqual(JSON.parse(audit.parameters[4]), [roleA]);
  assert.deepEqual(JSON.parse(audit.parameters[5]), [roleB]);
});

test("non-owners need every capability affected by additions and removals", async () => {
  const removing = setup({ actorCapabilities: ["roles:assign"] });
  await assert.rejects(removing.service.replace("opaque-session", targetId,
    { expectedRevision: 7, roleIds: [roleB] }), /add or remove only roles/);
  assert.equal(removing.events.at(-1).sql, "rollback");
  assert.equal(removing.events.some(({ sql }) => sql.startsWith("update app_identity.app_user")), false);

  const adding = setup({ currentRoleIds: [], actorCapabilities: ["roles:assign"] });
  await assert.rejects(adding.service.replace("opaque-session", targetId,
    { expectedRevision: 7, roleIds: [roleA] }), /add or remove only roles/);
});

test("Administrator and Demo changes require the owner and recent reauthentication", async () => {
  const administrator = { id: roleB, display_name: "Administrator", active: true, protected: true,
    assignable: true, system_key: "administrator", capability_key: "roles:assign" };
  const delegate = setup({ currentRoleIds: [], roleRows: [administrator], actorCapabilities: ["roles:assign"] });
  await assert.rejects(delegate.service.replace("opaque-session", targetId,
    { expectedRevision: 7, roleIds: [roleB] }), /Only the installation owner/);

  const staleOwner = setup({ currentRoleIds: [], roleRows: [administrator], actorOwner: true, recent: false });
  await assert.rejects(staleOwner.service.replace("opaque-session", targetId,
    { expectedRevision: 7, roleIds: [roleB] }), /Recent password reauthentication/);

  const owner = setup({ currentRoleIds: [], roleRows: [administrator], actorOwner: true });
  await owner.service.replace("opaque-session", targetId, { expectedRevision: 7, roleIds: [roleB] });
  assert.equal(owner.events.filter(({ sql }) => sql === "require recent reauthentication").length, 1);
});

test("self-service, owner targets, stale revisions, and inactive desired roles fail before writes", async () => {
  for (const [configured, command, expected] of [
    [{ target: { id: actorId } }, { expectedRevision: 7, roleIds: [roleA] }, ForbiddenException],
    [{ target: { owner: true } }, { expectedRevision: 7, roleIds: [roleA] }, ForbiddenException],
    [{ target: { revision: "8" } }, { expectedRevision: 7, roleIds: [roleA] }, ConflictException],
    [{ roleRows: [{ id: roleA, display_name: "Inactive", active: false, protected: false,
      assignable: false, system_key: null, capability_key: "users:read" }] },
    { expectedRevision: 7, roleIds: [roleA] }, UnprocessableEntityException]
  ]) {
    const attempt = setup(configured);
    await assert.rejects(attempt.service.replace("opaque-session", configured.target?.id ?? targetId, command), expected);
    assert.equal(attempt.events.at(-1).sql, "rollback");
    assert.equal(attempt.events.some(({ sql }) => sql.startsWith("update app_identity.app_user")), false);
  }
});
