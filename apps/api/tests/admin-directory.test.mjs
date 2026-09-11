import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { UserRoleReadService } from "../dist/admin/user-role-read.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const roleId = "20000000-0000-4000-8000-000000000001";
const user = (number, name = `User ${number}`) => ({
  id: `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  display_name: name, username: `user.${number}`, active: true, revision: "3",
  roles: [{ id: roleId, displayName: "Clinician", active: true, protected: true }]
});
const sessions = (capability) => ({ requireCapability: async (token, requested) => {
  assert.equal(token, "opaque-session");
  assert.equal(requested, capability);
  return { organization: { id: organizationId } };
} });

test("users default active, remain bounded, and return an opaque stable cursor", async () => {
  const calls = [];
  const rows = Array.from({ length: 51 }, (_, index) => user(index + 1));
  const service = new UserRoleReadService({ query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return rows;
  } }, sessions("users:read"));

  const page = await service.users("opaque-session", {});
  assert.equal(page.items.length, 50);
  assert.equal(page.pageSize, 50);
  assert.ok(page.nextCursor);
  assert.deepEqual(calls[0].parameters.slice(0, 5), [organizationId, "active", "", "%%", null]);
  assert.equal(calls[0].parameters[8], 51);
  assert.match(calls[0].sql, /order by not u\.active, lower\(u\.display_name\), u\.id/);
  assert.match(calls[0].sql, /role_filter\.ended_at is null/);
  assert.equal("capabilities" in page.items[0].roles[0], false);
  assert.equal(page.items[0].revision, 3);

  await service.users("opaque-session", { cursor: page.nextCursor });
  assert.equal(calls[1].parameters[5], true);
  assert.equal(calls[1].parameters[6], "user 50");
  assert.equal(calls[1].parameters[7], rows[49].id);
});

test("user search, state, role, cursor scope, and maximum page size are server controlled", async () => {
  const calls = [];
  const service = new UserRoleReadService({ query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return [user(1, "Åsa % Medic")];
  } }, sessions("users:read"));
  const page = await service.users("opaque-session", {
    search: " ÅSA % ", state: "all", roleId, limit: "999"
  });
  assert.equal(page.pageSize, 100);
  assert.equal(calls[0].parameters[2], "åsa %");
  assert.equal(calls[0].parameters[3], "%åsa \\%%");
  assert.equal(calls[0].parameters[4], roleId);
  assert.equal(calls[0].parameters[8], 101);
  await assert.rejects(service.users("opaque-session", { cursor: "not-a-cursor" }), /cursor is invalid/);
});

test("role readers receive definitions and aggregate counts but no personnel identity", async () => {
  const service = new UserRoleReadService({ query: async (sql, parameters) => {
    assert.match(sql, /count\(distinct assignment\.user_id\) as assignee_count/);
    assert.doesNotMatch(sql, /display_name.*assignment/);
    assert.deepEqual(parameters, [organizationId, "active"]);
    return [{ id: roleId, display_name: "Administrator", description: "Administer access",
      active: true, protected: true, version: "3", assignee_count: "12",
      capabilities: [{ key: "users:read", description: "View users", administrative: true, systemOnly: false }] }];
  } }, sessions("roles:read"));
  const result = await service.roles("opaque-session", {});
  assert.deepEqual(result.items[0], { id: roleId, displayName: "Administrator", description: "Administer access",
    active: true, protected: true, version: 3, assigneeCount: 12,
    capabilities: [{ key: "users:read", description: "View users", administrative: true, systemOnly: false }] });
  assert.equal(JSON.stringify(result).includes("username"), false);
});

test("role options identify owner-only assignments and actor-safe mutable roles", async () => {
  const service = new UserRoleReadService({ query: async (sql, parameters) => {
    assert.match(sql, /administrator.*clinical-demo/);
    assert.match(sql, /role_version_capability/);
    assert.deepEqual(parameters, [organizationId, "actor-id", ["roles:assign", "users:read"]]);
    return [{ id: roleId, display_name: "Administrator", active: true, protected: true,
      assignment_restricted: true, assignment_mutable: false }];
  } }, { requireCapability: async () => ({ organization: { id: organizationId }, user: { id: "actor-id" },
    capabilities: ["roles:assign", "users:read"] }) });
  assert.deepEqual(await service.userRoleOptions("opaque-session"), { items: [{ id: roleId,
    displayName: "Administrator", active: true, protected: true,
    assignmentRestricted: true, assignmentMutable: false }] });
});

test("authorization failure prevents all directory queries", async () => {
  let queried = false;
  const service = new UserRoleReadService({ query: async () => { queried = true; return []; } }, {
    requireCapability: async () => { throw new UnauthorizedException("required"); }
  });
  await assert.rejects(service.users("opaque-session", {}), UnauthorizedException);
  await assert.rejects(service.roles("opaque-session", {}), UnauthorizedException);
  assert.equal(queried, false);
});
