import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { normalizeRoleName, RoleAuthoringService } from "../dist/admin/role-authoring.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const roleId = "30000000-0000-4000-8000-000000000001";
const versionId = "40000000-0000-4000-8000-000000000001";
const session = { user: { id: userId }, organization: { id: organizationId },
  capabilities: ["roles:read", "roles:write", "users:read", "users:write"] };
const sessions = { requireCapability: async (token, capability) => {
  assert.equal(token, "opaque-session");
  assert.equal(capability, "roles:write");
  return session;
} };

test("custom role creation normalizes input and atomically installs an immutable first version", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("from app_identity.capability capability")) return [
      { key: "users:read", description: "View users", administrative: true, system_only: false, prerequisite_key: null },
      { key: "users:write", description: "Change users", administrative: true, system_only: false, prerequisite_key: "users:read" }
    ];
    if (sql.includes("from app_identity.installation_owner")) return [{ owner: true }];
    return [];
  } };
  const service = new RoleAuthoringService({ transaction: async (isolation, work) => {
    assert.equal(isolation, "SERIALIZABLE");
    return work(manager);
  } }, sessions);
  const created = await service.create("opaque-session", { displayName: "  Dispatch\u0301   Lead  ",
    description: "  Coordinates care  ", capabilityKeys: ["users:write", "users:read"], note: " Initial policy " });
  assert.equal(created.displayName, normalizeRoleName("Dispatch\u0301 Lead"));
  assert.equal(created.description, "Coordinates care");
  assert.equal(created.version, 1);
  assert.deepEqual(created.capabilities.map(({ key }) => key), ["users:read", "users:write"]);
  assert.ok(calls.some(({ sql }) => sql.includes("insert into app_identity.role_version")));
  assert.ok(calls.some(({ sql }) => sql.includes("insert into app_identity.role_version_capability")));
  assert.equal(calls.some(({ sql }) => /update app_identity\.role_version/.test(sql)), false);
});

test("custom roles reject missing prerequisites and system-only or unknown registry entries", async () => {
  let inserts = 0;
  const service = new RoleAuthoringService({ transaction: async (_isolation, work) => work({ query: async (sql, parameters) => {
    if (sql.includes("insert into")) inserts += 1;
    if (sql.includes("from app_identity.capability capability")) return parameters[0].includes("users:write")
      ? [{ key: "users:write", description: "Change users", administrative: true, system_only: false,
        prerequisite_key: "users:read" }] : [];
    return [];
  } }) }, sessions);
  await assert.rejects(service.create("opaque-session", { displayName: "Dispatch lead", description: null,
    capabilityKeys: ["users:write"] }), (error) => error instanceof UnprocessableEntityException &&
      error.getResponse().findings.includes("users:write requires users:read"));
  await assert.rejects(service.create("opaque-session", { displayName: "Demo shadow", description: null,
    capabilityKeys: ["clinical:demo"] }), /unavailable for custom roles/);
  assert.equal(inserts, 0);
});

test("editing enforces optimistic concurrency and refuses protected or self-assigned roles", async () => {
  const role = { id: roleId, organization_id: organizationId, display_name: "Dispatch", description: null,
    active: true, protected: false, current_version_id: versionId, version: 3 };
  const make = (first, assigned = false) => new RoleAuthoringService({ transaction: async (_isolation, work) => work({
    query: async (sql) => {
      if (sql.includes("for update of role, version")) return [{ ...role, ...first }];
      if (sql.includes("select exists") && sql.includes("user_role_assignment")) return [{ assigned }];
      return [];
    }
  }) }, sessions);
  const command = { displayName: "Dispatch", description: null, capabilityKeys: ["users:read"], expectedVersion: 2 };
  await assert.rejects(make({}).update("opaque-session", roleId, command), (error) =>
    error instanceof ConflictException && error.getResponse().actualVersion === 3);
  await assert.rejects(make({ protected: true }).update("opaque-session", roleId, { ...command, expectedVersion: 3 }),
    ForbiddenException);
  await assert.rejects(make({}, true).update("opaque-session", roleId, { ...command, expectedVersion: 3 }),
    /assigned to your own account/);
});

test("non-owners may preserve but cannot add or remove a capability they do not possess", async () => {
  const nonOwnerSession = { ...session, capabilities: ["roles:read", "roles:write", "users:read"] };
  const service = new RoleAuthoringService({ transaction: async (_isolation, work) => work({ query: async (sql) => {
    if (sql.includes("for update of role, version")) return [{ id: roleId, organization_id: organizationId,
      display_name: "Dispatch", description: null, active: true, protected: false,
      current_version_id: versionId, version: 1 }];
    if (sql.includes("user_role_assignment")) return [{ assigned: false }];
    if (sql.includes("lower(display_name)")) return [];
    if (sql.includes("role_version_capability") && sql.includes("select capability_key")) {
      return [{ capability_key: "users:read" }, { capability_key: "users:write" }];
    }
    if (sql.includes("from app_identity.capability capability")) return [
      { key: "users:read", description: "View users", administrative: true, system_only: false, prerequisite_key: null }
    ];
    if (sql.includes("installation_owner")) return [{ owner: false }];
    return [];
  } }) }, { requireCapability: async () => nonOwnerSession });
  await assert.rejects(service.update("opaque-session", roleId, { displayName: "Dispatch", description: null,
    capabilityKeys: ["users:read"], expectedVersion: 1 }), /only capabilities currently granted/);
});

test("deactivation atomically closes every assignment and records only stable redacted references", async () => {
  const calls = [];
  const endedAt = "2026-09-11T12:00:00.000Z";
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("for update of role, version")) return [{ id: roleId, organization_id: organizationId,
      display_name: "Dispatch", description: "Coordinates dispatch", active: true, protected: false,
      current_version_id: versionId, version: 3 }];
    if (sql.includes("user_role_assignment") && sql.includes("select exists")) return [{ assigned: false }];
    if (sql.includes("select definition.capability_key")) return [
      { capability_key: "users:read", description: "View users", administrative: true, system_only: false }
    ];
    if (sql.includes("installation_owner")) return [{ owner: true }];
    if (sql.includes("update app_identity.user_role_assignment")) return [[
      { id: "50000000-0000-4000-8000-000000000001", ended_at: endedAt }
    ], 1];
    if (sql.includes("update app_identity.role set active")) return [[{ id: roleId }], 1];
    return [];
  } };
  const service = new RoleAuthoringService({ transaction: async (isolation, work) => {
    assert.equal(isolation, "SERIALIZABLE");
    return work(manager);
  } }, sessions);
  const retired = await service.deactivate("opaque-session", roleId, { expectedVersion: 3, note: " Duty retired " });
  assert.equal(retired.active, false);
  assert.equal(retired.assigneeCount, 0);
  const closure = calls.find(({ sql }) => sql.includes("update app_identity.user_role_assignment"));
  assert.match(closure.sql, /ended_at = now\(\), ended_by = \$3/);
  const event = calls.find(({ sql }) => sql.includes("'role.deactivate'"));
  const details = JSON.parse(event.parameters[4]);
  assert.equal(details.endedAssignmentCount, 1);
  assert.equal(details.endedAt, endedAt);
  assert.equal(JSON.stringify(details).includes("Dispatch"), false);
});

test("deactivation enforces self-assignment and the actor capability ceiling before mutation", async () => {
  const role = { id: roleId, organization_id: organizationId, display_name: "Dispatch", description: null,
    active: true, protected: false, current_version_id: versionId, version: 1 };
  let mutations = 0;
  const make = (assigned, owner) => new RoleAuthoringService({ transaction: async (_isolation, work) => work({
    query: async (sql) => {
      if (/^\s*update|^\s*insert/m.test(sql)) mutations += 1;
      if (sql.includes("for update of role, version")) return [role];
      if (sql.includes("user_role_assignment") && sql.includes("select exists")) return [{ assigned }];
      if (sql.includes("select definition.capability_key")) return [
        { capability_key: "catalog:publish", description: "Publish catalog", administrative: true, system_only: false }
      ];
      if (sql.includes("installation_owner")) return [{ owner }];
      return [];
    }
  }) }, sessions);
  await assert.rejects(make(true, true).deactivate("opaque-session", roleId, { expectedVersion: 1 }),
    /assigned to your own account/);
  await assert.rejects(make(false, false).deactivate("opaque-session", roleId, { expectedVersion: 1 }),
    /only capabilities currently granted/);
  assert.equal(mutations, 0);
});

test("reactivation creates a new definition version and never restores assignments", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("for update of role, version")) return [{ id: roleId, organization_id: organizationId,
      display_name: "Dispatch", description: null, active: false, protected: false,
      current_version_id: versionId, version: 2 }];
    if (sql.includes("user_role_assignment") && sql.includes("select exists")) return [{ assigned: false }];
    if (sql.includes("lower(display_name)")) return [];
    if (sql.includes("from app_identity.capability capability")) return [
      { key: "users:read", description: "View users", administrative: true, system_only: false, prerequisite_key: null }
    ];
    if (sql.includes("installation_owner")) return [{ owner: true }];
    if (sql.includes("update app_identity.role")) return [{ id: roleId }];
    return [];
  } };
  const service = new RoleAuthoringService({ transaction: async (_isolation, work) => work(manager) }, sessions);
  const active = await service.reactivate("opaque-session", roleId, { displayName: "Dispatch v2", description: null,
    capabilityKeys: ["users:read"], expectedVersion: 2, note: "New duty model" });
  assert.equal(active.version, 3);
  assert.equal(active.active, true);
  assert.equal(active.assigneeCount, 0);
  assert.ok(calls.some(({ sql }) => sql.includes("insert into app_identity.role_version")));
  assert.ok(calls.some(({ sql }) => sql.includes("'role.reactivate'")));
  assert.equal(calls.some(({ sql }) => sql.includes("insert into app_identity.user_role_assignment")), false);
});

test("reactivation enforces self-assignment and capability-ceiling protections before creating a version", async () => {
  const inactive = { id: roleId, organization_id: organizationId, display_name: "Dispatch", description: null,
    active: false, protected: false, current_version_id: versionId, version: 2 };
  let inserts = 0;
  const make = (assigned) => new RoleAuthoringService({ transaction: async (_isolation, work) => work({
    query: async (sql) => {
      if (sql.includes("insert into")) inserts += 1;
      if (sql.includes("for update of role, version")) return [inactive];
      if (sql.includes("user_role_assignment") && sql.includes("select exists")) return [{ assigned }];
      if (sql.includes("lower(display_name)")) return [];
      if (sql.includes("from app_identity.capability capability")) return [{ key: "catalog:publish",
        description: "Publish catalog", administrative: true, system_only: false, prerequisite_key: null }];
      if (sql.includes("installation_owner")) return [{ owner: false }];
      return [];
    }
  }) }, sessions);
  const command = { displayName: "Dispatch", description: null,
    capabilityKeys: ["catalog:publish"], expectedVersion: 2 };
  await assert.rejects(make(true).reactivate("opaque-session", roleId, command), /assigned to your own account/);
  await assert.rejects(make(false).reactivate("opaque-session", roleId, command), /only capabilities currently granted/);
  assert.equal(inserts, 0);
});

test("history reconstructs immutable versions and assignment intervals while allow-listing audit details", async () => {
  const readSessions = { requireCapability: async (_token, capability) => {
    assert.equal(capability, "roles:read");
    return session;
  } };
  const manager = { query: async (sql) => {
    if (sql.startsWith("select id from app_identity.role")) return [{ id: roleId }];
    if (sql.includes("from app_identity.role_version version")) return [{ id: versionId, version: "1",
      display_name: "Dispatch", description: null, created_at: "2026-09-11T10:00:00.000Z", created_by: userId,
      note: null, capability_keys: ["users:read"] }];
    if (sql.includes("from app_identity.user_role_assignment")) return [{ id: "assignment-id", user_id: userId,
      assigned_at: "2026-09-11T10:05:00.000Z", assigned_by: userId,
      ended_at: "2026-09-11T11:00:00.000Z", ended_by: userId, note: null }];
    if (sql.includes("from app_identity.authorization_event")) return [{ id: "7", action: "role.deactivate",
      occurred_at: "2026-09-11T11:00:00.000Z", note: null,
      details: { roleId, version: 1, endedAssignmentCount: 1, password: "redacted" } }];
    return [];
  } };
  const service = new RoleAuthoringService({ transaction: async (isolation, work) => {
    assert.equal(isolation, "REPEATABLE READ");
    return work(manager);
  } }, readSessions);
  const history = await service.history("opaque-session", roleId);
  assert.equal(history.versions[0].displayName, "Dispatch");
  assert.equal(history.assignments[0].endedAt, "2026-09-11T11:00:00.000Z");
  assert.deepEqual(history.events[0].details, { roleId, version: 1, endedAssignmentCount: 1 });
  assert.equal(JSON.stringify(history).includes("password"), false);
});
