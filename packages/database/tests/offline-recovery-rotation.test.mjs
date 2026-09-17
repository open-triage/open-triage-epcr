import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseKeyring, rewrap, rotateOfflineRecoveryKeys } from "../scripts/rotate-offline-recovery-keys.mjs";

const migration = await readFile(new URL("../../../supabase/migrations/20260917113000_rotate_recovery_secrets_and_audit_key_release_operations.sql", import.meta.url), "utf8");
const runbook = await readFile(new URL("../../../docs/runbooks/database-operations.md", import.meta.url), "utf8");

test("the keyring requires separate exact-length versioned secrets", () => {
  const keys = parseKeyring({ OFFLINE_RECOVERY_WRAPPING_KEYS_JSON: JSON.stringify({
    4: randomBytes(32).toString("base64"), 5: randomBytes(32).toString("base64"),
  }) });
  assert.deepEqual([...keys.keys()], [4, 5]);
  assert.throws(() => parseKeyring({ OFFLINE_RECOVERY_WRAPPING_KEYS_JSON: JSON.stringify({ 1: Buffer.alloc(31).toString("base64") }) }), /32 bytes/);
  assert.throws(() => parseKeyring({ OFFLINE_RECOVERY_WRAPPING_KEYS_JSON: "[]" }), /JSON object/);
});

function associatedData(identity, version) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1, organizationId: identity.organization_id,
    reportId: identity.report_id, ownerUserId: identity.owner_user_id,
    recoveryHandle: identity.recovery_handle, wrappingKeyVersion: version,
  }));
}

test("rewrapping authenticates identity and version and preserves the report key", () => {
  const oldSecret = randomBytes(32);
  const newSecret = randomBytes(32);
  const reportKey = randomBytes(32);
  const identity = { report_id: randomUUID(), organization_id: randomUUID(), owner_user_id: randomUUID(), recovery_handle: randomUUID() };
  const oldNonce = randomBytes(12);
  const oldCipher = createCipheriv("aes-256-gcm", oldSecret, oldNonce);
  oldCipher.setAAD(associatedData(identity, 1));
  const seed = { ...identity, wrapping_nonce: oldNonce,
    wrapped_data_key: Buffer.concat([oldCipher.update(reportKey), oldCipher.final(), oldCipher.getAuthTag()]) };
  const replacement = rewrap(seed, 1, oldSecret, 2, newSecret);
  assert.notDeepEqual(replacement.wrapped, seed.wrapped_data_key);
  const decipher = createDecipheriv("aes-256-gcm", newSecret, replacement.nonce);
  decipher.setAAD(associatedData(identity, 2));
  decipher.setAuthTag(replacement.wrapped.subarray(32));
  assert.deepEqual(Buffer.concat([decipher.update(replacement.wrapped.subarray(0, 32)), decipher.final()]), reportKey);
  assert.throws(() => rewrap({ ...seed, report_id: randomUUID() }, 1, oldSecret, 2, newSecret));
});

test("rotation verifies zero old live envelopes before retirement", async () => {
  const oldSecret = randomBytes(32);
  const newSecret = randomBytes(32);
  const calls = [];
  const client = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes("rotation_candidates")) return { rows: [] };
    if (sql.includes("rotation_coverage")) return { rows: [{ old_live_count: "0", new_live_count: "3", other_live_count: "0" }] };
    return { rows: [{}] };
  } };
  const result = await rotateOfflineRecoveryKeys({ client, oldVersion: 8, newVersion: 9,
    keys: new Map([[8, oldSecret], [9, newSecret]]) });
  assert.equal(result.remainingOld, 0);
  assert.match(calls.at(-1).sql, /retire_wrapping_key_version/);
});

test("rotation refuses retirement when coverage is incomplete", async () => {
  const keys = new Map([[1, randomBytes(32)], [2, randomBytes(32)]]);
  const client = { query: async (sql) => sql.includes("rotation_candidates") ? { rows: [] }
    : sql.includes("rotation_coverage") ? { rows: [{ old_live_count: "1" }] } : { rows: [{}] } };
  await assert.rejects(rotateOfflineRecoveryKeys({ client, oldVersion: 1, newVersion: 2, keys }), /incomplete/);
});

test("database roles receive functions only and the audit shape excludes sensitive payloads", () => {
  assert.match(migration, /create role open_triage_offline_key_rotator nologin/);
  assert.match(migration, /create role open_triage_offline_recovery_purger nologin/);
  assert.match(migration, /grant execute on function offline_recovery\.purge_recovery_data/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on (?:table )?offline_recovery\./i);
  assert.match(migration, /'grant_request'.*'grant_issuance'.*'grant_denial'.*'grant_consumption'/s);
  assert.match(migration, /'envelope_registration'.*'recovery'.*'authorization_lock'.*'expiry'/s);
  assert.match(migration, /'rotation'.*'server_purge'.*'account_purge'.*'administrative_recovery_purge'/s);
  const eventDefinition = migration.slice(migration.indexOf("create table offline_recovery.key_lifecycle_event"), migration.indexOf("comment on table offline_recovery.key_lifecycle_event"));
  assert.doesNotMatch(eventDefinition, /ciphertext|wrapped_data_key|clinical|queued|browser|credential|token|network|ip_address/i);
});

test("backup contract retains every referenced version and warns that loss is unrecoverable", () => {
  assert.match(runbook, /every version[\s\S]*referenced by a live/i);
  assert.match(runbook, /Losing any referenced[\s\S]*permanently unrecoverable/i);
  assert.match(runbook, /retained backup is newer than the completed rotation/i);
});
