import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { RolePackageService } from "../dist/admin/role-package.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const roleId = "30000000-0000-4000-8000-000000000001";
const version1 = "40000000-0000-4000-8000-000000000001";
const version2 = "40000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-11T12:10:00.000Z");
const session = { user: { id: userId }, organization: { id: organizationId },
  startedAt: "2026-09-11T12:00:00.000Z", expiresAt: "2026-09-11T20:00:00.000Z",
  capabilities: ["roles:read", "roles:write", "users:read", "users:write"] };

const first = { id: version1, version: 1, displayName: "Dispatch", description: null,
  capabilityKeys: ["users:read"] };
const second = { id: version2, version: 2, displayName: "Dispatch Lead", description: "Coordinates dispatch",
  capabilityKeys: ["users:read", "users:write"] };
const portable = (versions = [first, second]) => ({ schema: "open-triage.custom-roles", schemaVersion: "1.0.0",
  roles: [{ id: roleId, currentVersionId: versions.at(-1).id, versions }] });

function sessions(expected) {
  return { requireCapability: async (token, capability) => {
    assert.equal(token, "opaque-session");
    assert.equal(capability, expected);
    return session;
  }, requireRecentReauthentication: async () => {} };
}

function managerFor({ existing = [], histories = [], capabilities = [], assignments = [], owners = [{ owner: true }] } = {}) {
  const calls = [];
  return { calls, query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("select id, protected, active, current_version_id")) return existing;
    if (sql.includes("from app_identity.role_version version") && sql.includes("version.role_id = any")) return histories;
    if (sql.includes("select id, role_id from app_identity.role_version")) {
      return histories.map(({ id, role_id }) => ({ id, role_id }));
    }
    if (sql.includes("from app_identity.capability capability")) return capabilities;
    if (sql.includes("from app_identity.installation_owner")) return owners;
    if (sql.includes("count(distinct user_id)")) return assignments;
    if (sql.includes("lower(display_name)")) return [];
    if (sql.includes("select count(*) count from app_identity.role_version")) return [{ count: histories.length }];
    if (sql.includes("update app_identity.role")) return [{ id: roleId }];
    return [];
  } };
}

test("export requires Roles read and contains immutable custom role history without personnel or credentials", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("select role.id role_id")) return [
      { role_id: roleId, ...first, display_name: first.displayName, description: null, capability_keys: first.capabilityKeys },
      { role_id: roleId, ...second, display_name: second.displayName,
        description: second.description, capability_keys: second.capabilityKeys }
    ];
    if (sql.includes("select id, current_version_id")) return [{ id: roleId, current_version_id: version2 }];
    return [];
  } };
  const service = new RolePackageService({ transaction: async (isolation, work) => {
    assert.equal(isolation, "REPEATABLE READ"); return work(manager);
  } }, sessions("roles:read"));
  const result = await service.export("opaque-session");
  assert.deepEqual(result, portable());
  const keys = [];
  JSON.stringify(result, (key, value) => { if (key) keys.push(key); return value; });
  assert.equal(keys.some((key) => /^(users?|credentials?|owners?|sessions?|assignments?|createdBy|note)$/i.test(key)), false);
  assert.ok(calls.some(({ sql }) => sql.includes("not role.protected") && sql.includes("role.system_key is null")));
  const audit = calls.find(({ sql }) => sql.includes("role_package"));
  assert.deepEqual(Object.keys(JSON.parse(audit.parameters[4])).sort(), ["packageDigest", "roleCount", "versionCount"]);
});

test("preview reports capability effects and aggregate assignee count without leaking assignee identities", async () => {
  const manager = managerFor({
    existing: [{ id: roleId, protected: false, active: true, current_version_id: version1 }],
    histories: [{ role_id: roleId, id: version1, version: 1, display_name: "Dispatch",
      description: null, capability_keys: ["users:read"] }],
    capabilities: [
      { key: "users:read", system_only: false, prerequisite_key: null },
      { key: "users:write", system_only: false, prerequisite_key: "users:read" }
    ], assignments: [{ role_id: roleId, count: "3" }]
  });
  const service = new RolePackageService({ transaction: async (_isolation, work) => work(manager) }, sessions("roles:read"));
  const result = await service.preview("opaque-session", portable());
  assert.deepEqual(result.capabilityChanges, [{ roleId, added: ["users:write"], removed: [], affectedAssigneeCount: 3 }]);
  assert.equal(result.affectedAssigneeCount, 3);
  assert.equal(result.updatedRoleCount, 1);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(userId));
  const audit = manager.calls.find(({ parameters }) => parameters[2] === "role.package_preview");
  assert.doesNotMatch(audit.parameters[4], /Dispatch|users:|userId|assigneeId/i);
});

test("preview round-trips an unchanged export and rejects incompatible, protected, divergent, and unsafe packages", async () => {
  const history = [
    { role_id: roleId, id: version1, version: 1, display_name: first.displayName,
      description: first.description, capability_keys: first.capabilityKeys },
    { role_id: roleId, id: version2, version: 2, display_name: second.displayName,
      description: second.description, capability_keys: second.capabilityKeys }
  ];
  const base = { existing: [{ id: roleId, protected: false, active: true, current_version_id: version2 }],
    histories: history, capabilities: [
      { key: "users:read", system_only: false, prerequisite_key: null },
      { key: "users:write", system_only: false, prerequisite_key: "users:read" }
    ] };
  const manager = managerFor(base);
  const service = new RolePackageService({ transaction: async (_isolation, work) => work(manager) }, sessions("roles:read"));
  assert.equal((await service.preview("opaque-session", portable())).unchangedRoleCount, 1);
  await assert.rejects(service.preview("opaque-session", { ...portable(), schemaVersion: "2.0.0" }),
    UnprocessableEntityException);

  const protectedService = new RolePackageService({ transaction: async (_isolation, work) => work(managerFor({
    ...base, existing: [{ ...base.existing[0], protected: true }]
  })) }, sessions("roles:read"));
  await assert.rejects(protectedService.preview("opaque-session", portable()), ForbiddenException);

  const divergent = portable([{ ...first, displayName: "Rewritten history" }, second]);
  await assert.rejects(service.preview("opaque-session", divergent), ConflictException);

  const unsafeManager = managerFor({ capabilities: [
    { key: "users:write", system_only: false, prerequisite_key: "users:read" }
  ] });
  const unsafeService = new RolePackageService({ transaction: async (_isolation, work) => work(unsafeManager) }, sessions("roles:read"));
  await assert.rejects(unsafeService.preview("opaque-session", portable([{ ...first,
    capabilityKeys: ["users:write"] }])), (error) => error instanceof UnprocessableEntityException &&
      error.getResponse().findings.includes("users:write requires users:read"));
  await assert.rejects(unsafeService.preview("opaque-session", portable([{ ...first,
    capabilityKeys: ["clinical:demo"] }])), /system-only or unregistered/);
});

test("import requires Roles write and recent reauthentication, validates the ceiling, and atomically activates updates", async () => {
  const staleService = new RolePackageService({ transaction: async (_isolation, work) => work(managerFor()) }, {
    requireCapability: async () => session,
    requireRecentReauthentication: async () => { throw new ForbiddenException("Recent password reauthentication is required"); }
  });
  await assert.rejects(staleService.import("opaque-session", portable(), now), ForbiddenException);

  const manager = managerFor({
    existing: [{ id: roleId, protected: false, active: true, current_version_id: version1 }],
    histories: [{ role_id: roleId, id: version1, version: 1, display_name: first.displayName,
      description: first.description, capability_keys: first.capabilityKeys }],
    capabilities: [
      { key: "users:read", system_only: false, prerequisite_key: null },
      { key: "users:write", system_only: false, prerequisite_key: "users:read" }
    ], assignments: [{ role_id: roleId, count: 2 }], owners: [{ owner: false }]
  });
  const service = new RolePackageService({ transaction: async (isolation, work) => {
    assert.equal(isolation, "SERIALIZABLE"); return work(manager);
  } }, sessions("roles:write"));
  const result = await service.import("opaque-session", portable(), now);
  assert.equal(result.importedAt, now.toISOString());
  assert.ok(manager.calls.some(({ sql }) => sql.includes("pg_advisory_xact_lock")));
  assert.ok(manager.calls.some(({ sql }) => sql.includes("insert into app_identity.role_version")));
  assert.ok(manager.calls.some(({ sql }) => sql.includes("current_version_id = $5") && sql.includes("active = true")));
  assert.equal(manager.calls.some(({ sql }) => /update app_identity\.user_role_assignment|delete from app_identity\.user_role_assignment/i.test(sql)), false);
  const audit = manager.calls.find(({ parameters }) => parameters[2] === "role.package_import");
  assert.doesNotMatch(audit.parameters[4], /Dispatch|users:|userId|assigneeId/i);

  const limitedService = new RolePackageService({ transaction: async (_isolation, work) => work(managerFor({
    capabilities: [{ key: "catalog:read", system_only: false, prerequisite_key: null }], owners: [{ owner: false }]
  })) }, { requireCapability: async () => ({ ...session, capabilities: ["roles:read", "roles:write"] }),
    requireRecentReauthentication: async () => {} });
  await assert.rejects(limitedService.import("opaque-session", portable([{ ...first,
    capabilityKeys: ["catalog:read"] }]), now), (error) => error instanceof ForbiddenException &&
      /capability ceiling/.test(error.message));
});

test("serialization conflicts become safe concurrent-import conflicts", async () => {
  const error = Object.assign(new Error("serialization failure"), { code: "40001" });
  const service = new RolePackageService({ transaction: async () => { throw error; } }, sessions("roles:write"));
  await assert.rejects(service.import("opaque-session", portable(), now), ConflictException);
});
