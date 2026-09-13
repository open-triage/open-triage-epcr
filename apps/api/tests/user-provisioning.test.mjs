import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { verifyPassword } from "../dist/identity/password.js";
import { UserProvisioningService } from "../dist/admin/user-provisioning.service.js";
import { validateProvisionAdminUser } from "../dist/admin/user-provisioning.validation.js";

const roleId = "10000000-0000-4000-8000-000000000001";
const actor = {
  user: { id: "actor-id", displayName: "Administrator" },
  organization: { id: "organization-id", name: "Example EMS" },
  capabilities: ["users:read", "users:write", "roles:read", "roles:assign"]
};

function setup({ availableRoles = [roleId], capabilities = actor.capabilities, owner = false,
  systemKey = null, roleCapability = null, onReauthenticate = () => undefined } = {}) {
  const events = [];
  const manager = { query: async (sql, parameters = []) => {
    const event = { sql: sql.replace(/\s+/g, " ").trim(), parameters };
    events.push(event);
    if (event.sql.startsWith("select role.id, role.system_key")) {
      return availableRoles.map((id) => ({ id, system_key: systemKey, capability_key: roleCapability }));
    }
    if (event.sql.startsWith("select exists") && event.sql.includes("installation_owner")) return [{ owner }];
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
    return { ...actor, capabilities };
  }, requireRecentReauthentication: onReauthenticate };
  return { events, service: new UserProvisioningService(dataSource, sessions), manager };
}

test("creation normalizes and validates its entire write-only command", () => {
  assert.deepEqual(validateProvisionAdminUser({
    username: "  Shift.Admin  ", displayName: "  A\u030Ake Medic  ",
    temporaryPassword: "Temporary password 42!", roleIds: [roleId], note: "  On-call hire  "
  }), {
    username: "shift.admin", displayName: "Åke Medic", temporaryPassword: "Temporary password 42!",
    temporaryPasswordHours: 72, roleIds: [roleId], note: "On-call hire"
  });
  for (const invalid of [
    { username: "bad user", displayName: "Medic", temporaryPassword: "Temporary password 42!", roleIds: [] },
    { username: "medic", displayName: "", temporaryPassword: "Temporary password 42!", roleIds: [] },
    { username: "medic", displayName: "Medic", temporaryPassword: "short", roleIds: [] },
    { username: "medic", displayName: "Medic", temporaryPassword: "Temporary password 42!", roleIds: [], temporaryPasswordHours: 24 },
    { username: "medic", displayName: "Medic", temporaryPassword: "Temporary password 42!", roleIds: ["not-a-uuid"] },
    { username: "medic", displayName: "Medic", temporaryPassword: "Temporary password 42!", roleIds: [], note: "Temporary password 42!" },
    { organizationId: "forged", username: "medic", displayName: "Medic", temporaryPassword: "Temporary password 42!", roleIds: [] }
  ]) assert.throws(() => validateProvisionAdminUser(invalid), BadRequestException);
  assert.equal(validateProvisionAdminUser({ username: "medic", displayName: "Medic",
    temporaryPassword: "Temporary password 42!", roleIds: [] }).temporaryPasswordHours, 72);
});

test("the owner may assign Administrator during creation without recent reauthentication", async () => {
  let reauthentications = 0;
  const { service } = setup({ owner: true, systemKey: "administrator",
    onReauthenticate: async () => { reauthentications += 1; } });
  await service.provision("session-token", validateProvisionAdminUser({
    username: "new.admin", displayName: "New Administrator", temporaryPassword: "Temporary password 42!",
    roleIds: [roleId]
  }), new Date("2026-09-11T10:00:00.000Z"));
  assert.equal(reauthentications, 0);
});

test("an administrator may assign the built-in Clinician role without clinical permissions", async () => {
  const { service } = setup({ systemKey: "clinician", roleCapability: "clinical:document" });
  const result = await service.provision("session-token", validateProvisionAdminUser({
    username: "new.clinician", displayName: "New Clinician", temporaryPassword: "Temporary password 42!",
    roleIds: [roleId]
  }));
  assert.deepEqual(result.roleIds, [roleId]);
});

test("an administrator cannot use a custom role to exceed their capability ceiling", async () => {
  const { service } = setup({ roleCapability: "clinical:document" });
  await assert.rejects(service.provision("session-token", validateProvisionAdminUser({
    username: "custom.user", displayName: "Custom User", temporaryPassword: "Temporary password 42!",
    roleIds: [roleId]
  })), /custom roles only/);
});

test("authorized creation validates roles and persists identity, complete roles, credential, and safe audit atomically", async () => {
  const { service, events, manager } = setup();
  const now = new Date("2026-09-11T10:00:00.000Z");
  const result = await service.provision("session-token", validateProvisionAdminUser({
    username: "medic.one", displayName: "Medic One", temporaryPassword: "Temporary password 42!",
    temporaryPasswordHours: 72, roleIds: [roleId], note: "New starter"
  }), now);
  assert.equal(result.temporaryPasswordExpiresAt, "2026-09-14T10:00:00.000Z");
  assert.equal("temporaryPassword" in result, false);
  assert.equal(events[0].sql, "begin");
  assert.deepEqual(events[1].parameters, ["session-token", "users:write", manager, now]);
  assert.equal(events.at(-1).sql, "commit");
  const credential = events.find(({ sql }) => sql.startsWith("insert into app_identity.local_credential"));
  assert.equal(await verifyPassword("Temporary password 42!", credential.parameters[2]), true);
  const assignment = events.find(({ sql }) => sql.startsWith("insert into app_identity.user_role_assignment"));
  assert.deepEqual(assignment.parameters.slice(0, 4), ["organization-id", result.userId, "actor-id", [roleId]]);
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.equal(JSON.stringify(audit).includes("Temporary password 42!"), false);
  assert.deepEqual(audit.parameters.slice(0, 4), ["organization-id", "actor-id", result.userId, "New starter"]);
  assert.deepEqual(audit.parameters[4], [roleId]);
});

test("authorization and organization role validation fail before any user write and roll back", async () => {
  const command = validateProvisionAdminUser({ username: "medic.one", displayName: "Medic One",
    temporaryPassword: "Temporary password 42!", roleIds: [roleId] });
  const forbidden = setup({ capabilities: ["users:read", "users:write"] });
  await assert.rejects(forbidden.service.provision("token", command), ForbiddenException);
  assert.equal(forbidden.events.some(({ sql }) => sql.startsWith("insert into app_identity.app_user")), false);
  assert.equal(forbidden.events.at(-1).sql, "rollback");

  const wrongOrganization = setup({ availableRoles: [] });
  await assert.rejects(wrongOrganization.service.provision("token", command), UnprocessableEntityException);
  assert.equal(wrongOrganization.events.some(({ sql }) => sql.startsWith("insert into app_identity.app_user")), false);
  assert.equal(wrongOrganization.events.at(-1).sql, "rollback");
});
