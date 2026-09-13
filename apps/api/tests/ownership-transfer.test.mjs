import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { OwnershipTransferService } from "../dist/admin/ownership-transfer.service.js";
import { validateCancelOwnershipTransfer, validateInitiateOwnershipTransfer } from "../dist/admin/ownership-transfer.validation.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";
const nomineeId = "30000000-0000-4000-8000-000000000001";
const transferId = "40000000-0000-4000-8000-000000000001";

function setup({ actorId = ownerId, recent = true, pending = null } = {}) {
  const events = [];
  let activeOwnerId = ownerId;
  let activeTransfer = pending;
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    events.push({ sql: normalized, parameters });
    if (normalized.startsWith("select owner_record.user_id")) return [{ user_id: activeOwnerId,
      display_name: activeOwnerId === ownerId ? "Current Owner" : "Nominee" }];
    if (normalized.includes("where transfer.organization_id = $1 and transfer.status = 'pending'")) {
      return activeTransfer?.status === "pending" ? [activeTransfer] : [];
    }
    if (normalized.startsWith("select u.id user_id") && normalized.includes("u.id = $2")) {
      return parameters[1] === nomineeId ? [{ user_id: nomineeId, display_name: "Nominee" }] : [];
    }
    if (normalized.startsWith("select distinct u.id user_id")) return [{ user_id: nomineeId, display_name: "Nominee" }];
    if (normalized.startsWith("insert into app_identity.ownership_transfer ")) {
      activeTransfer = { id: transferId, status: "pending", initiated_at: parameters[3], expires_at: parameters[4],
        resolved_at: null, resolution_reason: null, nominated_by: ownerId, nominated_by_name: "Current Owner",
        nominee_user_id: nomineeId, nominee_name: "Nominee" };
      return [{ id: transferId }];
    }
    if (normalized.startsWith("update app_identity.installation_owner")) { activeOwnerId = parameters[1]; return []; }
    if (normalized.includes("set status = 'accepted'")) { activeTransfer = { ...activeTransfer, status: "accepted",
      resolved_at: parameters[1], resolution_reason: "nominee_accepted" }; return []; }
    if (normalized.includes("set status = 'cancelled'")) { activeTransfer = { ...activeTransfer, status: "cancelled",
      resolved_at: parameters[1], resolution_reason: "cancelled_by_party" }; return []; }
    if (normalized.includes("set status = 'expired'")) { activeTransfer = { ...activeTransfer, status: "expired",
      resolved_at: parameters[1], resolution_reason: "seventy_two_hours_elapsed" }; return []; }
    if (normalized.includes("order by transfer.initiated_at desc")) return activeTransfer ? [activeTransfer] : [];
    return [];
  } };
  const dataSource = { transaction: async (work) => {
    events.push({ sql: "begin", parameters: [] });
    const result = await work(manager);
    events.push({ sql: "commit", parameters: [] });
    return result;
  } };
  const sessions = {
    requireCapability: async () => ({ user: { id: actorId }, organization: { id: organizationId }, capabilities: ["users:read"] }),
    requireRecentReauthentication: async () => { if (!recent) throw new ForbiddenException("stale"); }
  };
  return { events, service: new OwnershipTransferService(dataSource, sessions), transfer: () => activeTransfer,
    setActor(value) { actorId = value; } };
}

test("ownership commands validate UUIDs and bounded notes", () => {
  assert.deepEqual(validateInitiateOwnershipTransfer({ nomineeUserId: nomineeId, note: "  planned  " }),
    { nomineeUserId: nomineeId, note: "planned" });
  assert.deepEqual(validateCancelOwnershipTransfer(null), {});
  assert.throws(() => validateInitiateOwnershipTransfer({ nomineeUserId: "wrong" }), BadRequestException);
  assert.throws(() => validateCancelOwnershipTransfer({ unexpected: true }), BadRequestException);
});

test("owner nomination and independently reauthenticated acceptance move the single owner atomically", async () => {
  const fixture = setup();
  const initiated = await fixture.service.initiate("owner-session", { nomineeUserId: nomineeId }, new Date("2026-09-11T10:00:00Z"));
  assert.equal(initiated.transfer.status, "pending");
  assert.equal(initiated.transfer.expiresAt, "2026-09-14T10:00:00.000Z");
  fixture.setActor(nomineeId);
  const accepted = await fixture.service.accept("nominee-session", new Date("2026-09-11T11:00:00Z"));
  assert.equal(accepted.owner.id, nomineeId);
  assert.equal(accepted.transfer.status, "accepted");
  const ownerUpdate = fixture.events.findIndex(({ sql }) => sql.startsWith("update app_identity.installation_owner"));
  const transferUpdate = fixture.events.findIndex(({ sql }) => sql.includes("set status = 'accepted'"));
  assert.ok(ownerUpdate > -1 && transferUpdate > ownerUpdate);
  const retiredRoles = fixture.events.find(({ sql }) => sql.startsWith("update app_identity.user_role_assignment"));
  assert.equal(retiredRoles.parameters[1], nomineeId, "the new owner no longer relies on role assignments");
});

test("stale assurance is audited and committed before initiation is refused", async () => {
  const fixture = setup({ recent: false });
  await assert.rejects(fixture.service.initiate("owner-session", { nomineeUserId: nomineeId }), /Recent password reauthentication/);
  const audit = fixture.events.find(({ sql, parameters }) => sql.startsWith("insert into app_identity.ownership_transfer_event") &&
    parameters[3] === "owner.transfer.stale_assurance");
  assert.ok(audit);
  assert.equal(fixture.events.at(-1).sql, "commit");
});

test("reading state expires a stale transfer and releases the pending slot", async () => {
  const fixture = setup({ pending: { id: transferId, status: "pending", initiated_at: "2026-09-08T09:00:00Z",
    expires_at: "2026-09-11T09:00:00Z", resolved_at: null, resolution_reason: null,
    nominated_by: ownerId, nominated_by_name: "Current Owner", nominee_user_id: nomineeId, nominee_name: "Nominee" } });
  const state = await fixture.service.state("owner-session", new Date("2026-09-11T10:00:00Z"));
  assert.equal(state.transfer.status, "expired");
  assert.ok(fixture.events.some(({ parameters }) => parameters[3] === "owner.transfer.expire"));
});
