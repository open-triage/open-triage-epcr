import assert from "node:assert/strict";
import test from "node:test";
import { createPasswordVerifier } from "../dist/identity/password.js";
import { beginAuthenticationAttempt, finishAuthenticationAttempt } from "../dist/sessions/authentication-throttle.js";
import { ClinicianSessionService } from "../dist/sessions/clinician-session.service.js";

function throttleDatabase() {
  const state = new Map();
  const statements = [];
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    statements.push({ sql: normalized, parameters });
    if (normalized.startsWith("insert into app_identity.authentication_throttle")) {
      const now = parameters.at(-2);
      const rows = [];
      for (let offset = 0; offset < parameters.length - 2; offset += 4) {
        const [scope, keyDigest, windowSeconds, maxAttempts] = parameters.slice(offset, offset + 4);
        const key = `${scope}:${keyDigest}`;
        let bucket = state.get(key);
        if (!bucket || bucket.windowStartedAt.getTime() + windowSeconds * 1_000 <= now.getTime()) {
          bucket = { scope, keyDigest, windowSeconds, maxAttempts, windowStartedAt: now,
            attemptCount: 0, failureCount: 0, blockedUntil: null };
          state.set(key, bucket);
        }
        bucket.attemptCount += 1;
        rows.push({ scope, attempt_count: bucket.attemptCount, max_attempts: maxAttempts,
          blocked_until: bucket.blockedUntil });
      }
      return [rows, rows.length];
    }
    if (normalized.startsWith("update app_identity.authentication_throttle throttle")) {
      const now = parameters.at(-1);
      for (let offset = 0; offset < parameters.length - 1; offset += 2) {
        const [scope, keyDigest] = parameters.slice(offset, offset + 2);
        const bucket = state.get(`${scope}:${keyDigest}`);
        if (!bucket) continue;
        if (normalized.includes("last_success_at")) {
          bucket.lastSuccessAt = now;
          continue;
        }
        bucket.failureCount += 1;
        bucket.lastFailureAt = now;
        const delay = scope === "account" && bucket.failureCount >= 3
          ? Math.min(300, 2 ** (bucket.failureCount - 3)) * 1_000
          : scope === "network" && bucket.failureCount >= 25 ? 30_000
            : scope === "installation" && bucket.failureCount >= 200 ? 60_000 : 0;
        if (delay) bucket.blockedUntil = new Date(Math.max(bucket.blockedUntil?.getTime() ?? 0, now.getTime() + delay));
      }
      return [];
    }
    return [];
  } };
  return { manager, state, statements };
}

test("repeated failures throttle normalized known and unknown account keys without storing their values", async () => {
  const database = throttleDatabase();
  const now = new Date("2026-09-17T10:00:00.000Z");
  for (let failure = 0; failure < 3; failure += 1) {
    const attempt = await beginAuthenticationAttempt(database.manager, " Unknown.User ", "203.0.113.41", now);
    assert.ok(attempt);
    await finishAuthenticationAttempt(database.manager, attempt, false, now);
  }
  assert.equal(await beginAuthenticationAttempt(database.manager, "unknown.user", "203.0.113.41", now), undefined);
  const serialized = JSON.stringify([...database.state.entries()]);
  assert.doesNotMatch(serialized, /unknown\.user|203\.0\.113\.41/);
  assert.match(serialized, /account:[a-f0-9]{64}/);
});

test("a success after the progressive delay preserves failure evidence", async () => {
  const database = throttleDatabase();
  const now = new Date("2026-09-17T10:00:00.000Z");
  for (let failure = 0; failure < 3; failure += 1) {
    const attempt = await beginAuthenticationAttempt(database.manager, "clinician", undefined, now);
    await finishAuthenticationAttempt(database.manager, attempt, false, now);
  }
  const afterDelay = new Date(now.getTime() + 1_001);
  const successful = await beginAuthenticationAttempt(database.manager, "clinician", undefined, afterDelay);
  assert.ok(successful);
  await finishAuthenticationAttempt(database.manager, successful, true, afterDelay);
  const account = [...database.state.values()].find(({ scope }) => scope === "account");
  assert.equal(account.failureCount, 3);
  assert.equal(account.lastSuccessAt, afterDelay);

  const next = await beginAuthenticationAttempt(database.manager, "clinician", undefined, afterDelay);
  await finishAuthenticationAttempt(database.manager, next, false, afterDelay);
  assert.equal(account.failureCount, 4);
  assert.equal(account.blockedUntil.toISOString(), "2026-09-17T10:00:03.001Z");
});

test("atomic account buckets cap concurrent attempts and recover after the bounded window", async () => {
  const database = throttleDatabase();
  const now = new Date("2026-09-17T10:00:00.000Z");
  const concurrent = await Promise.all(Array.from({ length: 25 }, () =>
    beginAuthenticationAttempt(database.manager, "burst.user", undefined, now)));
  assert.equal(concurrent.filter(Boolean).length, 20);
  assert.equal(concurrent.filter((attempt) => !attempt).length, 5);

  const recovered = await beginAuthenticationAttempt(database.manager, "burst.user", undefined,
    new Date(now.getTime() + 15 * 60 * 1_000));
  assert.ok(recovered);
});

test("sign-in failures remain generic for existing and unknown usernames", async () => {
  const verifier = await createPasswordVerifier("Correct password 42!");
  async function failureFor(account) {
    const database = throttleDatabase();
    const dataSource = {
      manager: database.manager,
      query: async (sql) => sql.replace(/\s+/g, " ").trim().startsWith("select u.id as user_id")
        ? account ? [{ user_id: "user-id", username: "clinician", display_name: "Clinician", active: true,
          organization_id: "organization-id", organization_name: "Organization", shift_session_duration_hours: 12,
          password_verifier: verifier, must_change_password: false, temporary_password_expires_at: null,
          credential_version: "1" }] : []
        : []
    };
    try {
      await new ClinicianSessionService(dataSource).create({ username: account ? "clinician" : "unknown", password: "wrong" },
        new Date("2026-09-17T10:00:00.000Z"));
    } catch (error) {
      return { status: error.getStatus(), message: error.message };
    }
    assert.fail("sign-in should fail");
  }
  assert.deepEqual(await failureFor(true), await failureFor(false));
});
