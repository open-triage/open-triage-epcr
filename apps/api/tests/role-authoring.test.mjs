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
