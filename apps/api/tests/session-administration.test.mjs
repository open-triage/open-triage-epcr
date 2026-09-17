import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { SessionAdministrationService } from "../dist/admin/session-administration.service.js";
import { validateResetAdminCredential, validateRevokeAdminSession } from "../dist/admin/session-administration.validation.js";
import { verifyPassword } from "../dist/identity/password.js";

const organizationId = "40000000-0000-4000-8000-000000000001";
const actorId = "30000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-11T12:00:00.000Z");

function setup({ capabilities = ["users:read", "sessions:read", "sessions:revoke", "credentials:reset"],
  target = {}, targetOnly = [], session = {}, failAudit = false } = {}) {
  const events = [];
  const actor = { user: { id: actorId }, organization: { id: organizationId }, capabilities };
  const manager = { query: async (sql, parameters = []) => {
    const event = { sql: sql.replace(/\s+/g, " ").trim(), parameters };
    events.push(event);
    if (event.sql.startsWith("select session.id, session.revoked_at")) return [{ id: sessionId,
      revoked_at: null, current: false, owner: false, ...session }];
    if (event.sql.startsWith("select app_user.id, app_user.active")) return [{ id: targetId,
      active: false, revision: "7", owner: false, actor_owner: false, ...target }];
    if (event.sql.startsWith("select distinct capability.capability_key")) return targetOnly;
    if (event.sql.startsWith("select id from app_identity.app_user")) return [{ id: targetId }];
    if (event.sql.startsWith("select count(*) as revoked")) return [{ revoked: "3" }];
    if (event.sql.includes("purge_user_recovery_as_administrator")) return [{ purged: "2" }];
    if (event.sql.startsWith("update app_identity.app_session") && event.sql.includes("returning id")) {
      return [{ id: sessionId }, { id: "50000000-0000-4000-8000-000000000001" }];
    }
    if (event.sql.startsWith("insert into app_identity.authentication_event") && failAudit) throw new Error("audit failed");
    return [];
  } };
  const dataSource = {
    manager,
    query: async (sql, parameters = []) => {
      const event = { sql: sql.replace(/\s+/g, " ").trim(), parameters };
      events.push(event);
      if (event.sql.startsWith("select id from app_identity.app_user")) return [{ id: targetId }];
      if (event.sql.startsWith("select session.id, session.created_at")) return [{ id: sessionId,
        created_at: "2026-09-11T08:00:00.000Z", last_activity_at: "2026-09-11T11:59:00.000Z",
        expires_at: "2026-09-11T20:00:00.000Z", device_label: "Firefox on Linux", current: true, owner: false }];
      return [];
    },
    transaction: async (work) => {
      events.push({ sql: "begin", parameters: [] });
      try {
        const result = await work(manager);
        events.push({ sql: "commit", parameters: [] });
        return result;
      } catch (error) {
        events.push({ sql: "rollback", parameters: [] });
        throw error;
      }
    }
  };
  const sessions = { requireCapability: async (_token, capability) => {
    events.push({ sql: "authorize", parameters: [capability] });
    return actor;
  }, requireRecentReauthentication: async () => {
    events.push({ sql: "recent-reauthentication", parameters: [] });
  } };
  return { service: new SessionAdministrationService(dataSource, sessions), events };
}

test("session listing requires combined read authority and exposes only bounded active-session context", async () => {
  const { service, events } = setup();
  const result = await service.list("opaque-token", targetId, now);
  assert.deepEqual(result.items, [{ id: sessionId, startedAt: "2026-09-11T08:00:00.000Z",
    lastActivityAt: "2026-09-11T11:59:00.000Z", expiresAt: "2026-09-11T20:00:00.000Z",
    deviceLabel: "Firefox on Linux", current: true, owner: false }]);
  assert.doesNotMatch(JSON.stringify(result), /ip|geo|token/i);
  const query = events.find(({ sql }) => sql.startsWith("select session.id, session.created_at"));
  assert.match(query.sql, /revoked_at is null/);
  assert.match(query.sql, /session\.credential_version = credential\.credential_version/);
  await assert.rejects(setup({ capabilities: ["sessions:read"] }).service.list("token", targetId), UnauthorizedException);
});

test("individual revocation is idempotent, permits more-capable targets, and records no bearer material", async () => {
  const first = setup({ targetOnly: [{ capability_key: "forms:publish" }] });
  const result = await first.service.revoke("opaque-token", targetId, sessionId, {}, now);
  assert.deepEqual(result, { sessionId, revoked: true, alreadyRevoked: false, currentSessionRevoked: false });
  assert.equal(first.events.some(({ sql }) => sql.startsWith("select distinct capability")), false,
    "containment must not enforce the target privilege ceiling");
  const audit = first.events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.deepEqual(audit.parameters.slice(0, 4), [organizationId, actorId, targetId, sessionId]);
  assert.doesNotMatch(JSON.stringify(audit), /opaque-token|password|patient|source.?ip/i);

  const replay = setup({ session: { revoked_at: now } });
  assert.equal((await replay.service.revoke("opaque-token", targetId, sessionId, {}, now)).alreadyRevoked, true);
  assert.equal(replay.events.some(({ sql }) => sql.startsWith("insert into app_identity.authentication_event")), false);
});

test("owner-session revocation requires explicit confirmation and current-session containment is reported", async () => {
  const rejected = setup({ session: { owner: true, current: true } });
  await assert.rejects(rejected.service.revoke("token", targetId, sessionId, {}, now), ConflictException);
  assert.equal(rejected.events.at(-1).sql, "rollback");
  const confirmed = setup({ session: { owner: true, current: true } });
  const result = await confirmed.service.revoke("token", targetId, sessionId, { confirmOwner: true }, now);
  assert.equal(result.currentSessionRevoked, true);
});

test("credential reset validates revision and privilege, retains disabled state, and atomically revokes every session", async () => {
  const { service, events } = setup();
  const result = await service.resetCredential("actor-token", targetId, {
    expectedRevision: 7, temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 24, note: "Lost device"
  }, now);
  assert.deepEqual(result, { userId: targetId, revision: 8, active: false,
    temporaryPasswordExpiresAt: "2026-09-14T12:00:00.000Z", sessionsRevoked: 2 });
  const credential = events.find(({ sql }) => sql.startsWith("update app_identity.local_credential"));
  assert.equal(await verifyPassword("Replacement password 84!", credential.parameters[1]), true);
  assert.match(credential.sql, /must_change_password = true/);
  assert.match(events.find(({ sql }) => sql.startsWith("update app_identity.app_session"))?.sql ?? "", /password_reset/);
  assert.equal(events.some(({ sql }) => /set active/.test(sql)), false, "reset must remain separate from reactivation");
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.doesNotMatch(JSON.stringify(audit), /Replacement password|password_verifier|token|patient|source.?ip/i);
  assert.equal(events.at(-1).sql, "commit");
});

test("credential reset rejects stale, owner, self, and more-capable targets before credential writes", async () => {
  for (const [configuration, pattern] of [
    [{ target: { revision: "8" } }, /changed after/],
    [{ target: { owner: true } }, /owner credential/],
    [{ target: { id: actorId } }, /own credential/],
    [{ targetOnly: [{ capability_key: "roles:write" }] }, /more-capable/]
  ]) {
    const { service, events } = setup(configuration);
    await assert.rejects(service.resetCredential("token", targetId, {
      expectedRevision: 7, temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 72
    }, now), pattern);
    assert.equal(events.some(({ sql }) => sql.startsWith("update app_identity.local_credential")), false);
    assert.equal(events.at(-1).sql, "rollback");
  }
});

test("credential reset rolls back credential, revision, and revocations when safe audit insertion fails", async () => {
  const { service, events } = setup({ failAudit: true });
  await assert.rejects(service.resetCredential("token", targetId, {
    expectedRevision: 7, temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 72
  }, now), /audit failed/);
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.local_credential")));
  assert.ok(events.some(({ sql }) => sql.startsWith("update app_identity.app_session")));
  assert.equal(events.at(-1).sql, "rollback");
});

test("administrative recovery purge is recent-authenticated, user-wide, audited, and content blind", async () => {
  const { service, events } = setup();
  const result = await service.purgeOfflineRecovery("actor-token", targetId,
    { reason: "Confirmed lost browser" }, now);
  assert.deepEqual(result, { userId: targetId, purgedEnvelopeCount: 2,
    revokedGrantCount: 3, appliesToAllBrowsers: true });
  assert.ok(events.some(({ sql }) => sql === "recent-reauthentication"));
  const purge = events.find(({ sql }) => sql.includes("purge_user_recovery_as_administrator"));
  assert.deepEqual(purge.parameters, [organizationId, targetId, actorId, "Confirmed lost browser"]);
  const audit = events.find(({ sql }) => sql.startsWith("insert into app_identity.authentication_event"));
  assert.match(audit.sql, /all_browsers/);
  assert.doesNotMatch(JSON.stringify(events), /patient|ciphertext|wrapped_data_key|report_id/i);
});

test("security command validation accepts only bounded, credential-safe inputs", () => {
  assert.deepEqual(validateRevokeAdminSession({ confirmOwner: true }), { confirmOwner: true });
  assert.deepEqual(validateResetAdminCredential({ expectedRevision: 2, temporaryPassword: "Replacement password 84!",
    note: "Lost device" }), { expectedRevision: 2,
    temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 72, note: "Lost device" });
  assert.throws(() => validateRevokeAdminSession({ confirmOwner: "yes" }));
  assert.throws(() => validateResetAdminCredential({ expectedRevision: 0, temporaryPassword: "short",
    temporaryPasswordHours: 24 }));
  assert.throws(() => validateResetAdminCredential({ expectedRevision: 2, temporaryPassword: "Replacement password 84!",
    temporaryPasswordHours: 72, note: "Replacement password 84!" }));
});
