import assert from "node:assert/strict";
import { createCipheriv, randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { offlineRecoveryWrappingKey, ProtectedReportKeyService } from "../dist/reports/protected-report-key.service.js";

test("offline recovery wrapping uses a dedicated exact-length versioned secret", () => {
  const configured = offlineRecoveryWrappingKey({
    NODE_ENV: "production",
    OFFLINE_RECOVERY_KEY_VERSION: "7",
    OFFLINE_RECOVERY_SECRET_BASE64: Buffer.alloc(32, 0x71).toString("base64"),
  });
  assert.equal(configured.version, 7);
  assert.equal(configured.secret.byteLength, 32);
  assert.throws(() => offlineRecoveryWrappingKey({ NODE_ENV: "production" }), /required in production/);
  assert.throws(() => offlineRecoveryWrappingKey({
    OFFLINE_RECOVERY_KEY_VERSION: "1",
    OFFLINE_RECOVERY_SECRET_BASE64: Buffer.alloc(31).toString("base64"),
  }), /exactly 32 bytes/);
});

test("registration checks current clinical authority and stores only a wrapped key through the narrow function", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const recoveryHandle = randomUUID();
  const queries = [];
  const manager = { query: async (sql, parameters) => {
    queries.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    if (sql.includes("from clinical.report")) return [{ organization_id: organizationId, documenting_user_id: userId }];
    if (sql.includes("offline_recovery.register_report_key")) return [{
      recovery_handle: recoveryHandle,
      recovery_deadline: "2026-09-18T12:00:00.000Z",
      wrapping_key_version: 1,
      created: true,
    }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const dataSource = { transaction: async (work) => work(manager) };
  const sessions = {
    assertCsrf: async () => undefined,
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "clinical:document");
      return { organization: { id: organizationId }, user: { id: userId } };
    },
  };
  const service = new ProtectedReportKeyService(dataSource, sessions);
  const result = await service.register("session", reportId, {
    schemaVersion: 1,
    recoveryHandle,
    reportKeyBase64: Buffer.alloc(32, 0x41).toString("base64"),
  }, "csrf");

  assert.equal(result.recoveryHandle, recoveryHandle);
  const call = queries.find(({ sql }) => sql.includes("offline_recovery.register_report_key"));
  assert.ok(call);
  assert.equal(call.parameters[5].byteLength, 12);
  assert.equal(call.parameters[6].byteLength, 48);
  assert.notDeepEqual(call.parameters[6].subarray(0, 32), Buffer.alloc(32, 0x41));
});

test("an existing server envelope cannot be silently replaced with another browser key", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const manager = { query: async (sql) => sql.includes("from clinical.report")
    ? [{ organization_id: organizationId, documenting_user_id: userId }]
    : [{ recovery_handle: randomUUID(), recovery_deadline: new Date(), wrapping_key_version: 1, created: false }] };
  const service = new ProtectedReportKeyService(
    { transaction: async (work) => work(manager) },
    { assertCsrf: async () => undefined, requireCapability: async () => ({ organization: { id: organizationId }, user: { id: userId } }) },
  );
  await assert.rejects(service.register("session", reportId, {
    schemaVersion: 1, recoveryHandle: randomUUID(), reportKeyBase64: Buffer.alloc(32).toString("base64"),
  }, "csrf"), ConflictException);
});

test("ciphertext checkpoints carry current authority and map rollback rejection to a conflict", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const recoveryHandle = randomUUID();
  const sha = "a".repeat(64);
  const calls = [];
  const service = new ProtectedReportKeyService(
    { transaction: async (work) => work({ query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return [{ ciphertext_revision: "7", ciphertext_sha256: sha }];
    } }) },
    { assertCsrf: async () => undefined, requireCapability: async () => ({ organization: { id: organizationId }, user: { id: userId } }) },
  );
  assert.deepEqual(await service.checkpoint("session", reportId, {
    schemaVersion: 1, recoveryHandle, ciphertextRevision: 7, ciphertextSha256: sha,
  }, "csrf"), { ciphertextRevision: 7, ciphertextSha256: sha });
  assert.deepEqual(calls[0].parameters, [reportId, organizationId, userId, recoveryHandle, 7, sha]);

  const rejected = new ProtectedReportKeyService(
    { transaction: async () => { throw { driverError: { code: "40001" } }; } },
    { assertCsrf: async () => undefined, requireCapability: async () => undefined },
  );
  await assert.rejects(rejected.checkpoint("session", reportId, {
    schemaVersion: 1, recoveryHandle, ciphertextRevision: 6, ciphertextSha256: sha,
  }, "csrf"), ConflictException);
});

test("an authenticated ciphertext write advances only through the retention function", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const recoveryHandle = randomUUID();
  const calls = [];
  const service = new ProtectedReportKeyService(
    { transaction: async (work) => work({ query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return [{ recovery_deadline: "2026-09-18T12:00:00.000Z" }];
    } }) },
    {
      assertCsrf: async () => undefined,
      requireCapability: async () => ({ organization: { id: organizationId }, user: { id: userId } }),
    },
  );
  const receipt = await service.recordWrite("session", reportId, {
    schemaVersion: 1, recoveryHandle, ciphertextRevision: 3, ciphertextSha256: "a".repeat(64),
  }, "csrf");
  assert.equal(receipt.recoveryDeadline, "2026-09-18T12:00:00.000Z");
  assert.match(calls[0].sql, /offline_recovery\.record_ciphertext_write/);
  assert.deepEqual(calls[0].parameters, [reportId, organizationId, userId, recoveryHandle, 3, "a".repeat(64)]);
});

test("recovery grants are opaque, expire after sixty seconds, and bind every authority dimension", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const recoveryHandle = randomUUID();
  const queries = [];
  const manager = { query: async (sql, parameters) => {
    queries.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    return [{ result: "created", recovery_handle: recoveryHandle, grant_id: randomUUID(), expires_at: "2026-09-17T12:01:00.000Z" }];
  } };
  const service = new ProtectedReportKeyService(
    { transaction: async (work) => work(manager) },
    {
      assertCsrf: async () => undefined,
      get: async () => ({ organization: { id: organizationId }, user: { id: userId } }),
    },
  );
  const result = await service.createRecoveryGrant("session-secret", reportId,
    { schemaVersion: 1, envelopeVersion: 1 }, "csrf");
  assert.equal(result.recoveryHandle, recoveryHandle);
  assert.match(result.grant, /^[A-Za-z0-9_-]{43}$/);
  const call = queries[0];
  assert.match(call.sql, /create_report_recovery_grant/);
  assert.deepEqual(call.parameters.slice(0, 3), [reportId, organizationId, userId]);
  assert.match(call.parameters[3], /^[a-f0-9]{64}$/);
  assert.match(call.parameters[4], /^[a-f0-9]{64}$/);
  assert.notEqual(call.parameters[3], "session-secret");
  assert.notEqual(call.parameters[4], result.grant);
  assert.equal(call.parameters[5], 1);
});

test("recovery consumption unwraps one report key only after the atomic database consume", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const recoveryHandle = randomUUID();
  const rawKey = Buffer.alloc(32, 0x5a);
  const wrappingSecret = Buffer.alloc(32, 0x71);
  const nonce = Buffer.alloc(12, 0x13);
  const associatedData = Buffer.from(JSON.stringify({
    schemaVersion: 1, organizationId, reportId, ownerUserId: userId,
    recoveryHandle, wrappingKeyVersion: 7,
  }));
  const cipher = createCipheriv("aes-256-gcm", wrappingSecret, nonce);
  cipher.setAAD(associatedData);
  const wrapped = Buffer.concat([cipher.update(rawKey), cipher.final(), cipher.getAuthTag()]);
  const previousSecret = process.env.OFFLINE_RECOVERY_SECRET_BASE64;
  const previousVersion = process.env.OFFLINE_RECOVERY_KEY_VERSION;
  process.env.OFFLINE_RECOVERY_SECRET_BASE64 = wrappingSecret.toString("base64");
  process.env.OFFLINE_RECOVERY_KEY_VERSION = "7";
  try {
    const service = new ProtectedReportKeyService(
      { transaction: async (work) => work({ query: async () => [{
        result: "consumed", recovery_handle: recoveryHandle, wrapping_key_version: 7,
        wrapping_nonce: nonce, wrapped_data_key: wrapped,
      }] }) },
      { assertCsrf: async () => undefined, get: async () => ({ organization: { id: organizationId }, user: { id: userId } }) },
    );
    const recovered = await service.consumeRecoveryGrant("session-secret", reportId, {
      schemaVersion: 1, envelopeVersion: 1, grant: Buffer.alloc(32, 0x61).toString("base64url"),
    }, "csrf");
    assert.deepEqual(Buffer.from(recovered.reportKeyBase64, "base64"), rawKey);
  } finally {
    if (previousSecret === undefined) delete process.env.OFFLINE_RECOVERY_SECRET_BASE64;
    else process.env.OFFLINE_RECOVERY_SECRET_BASE64 = previousSecret;
    if (previousVersion === undefined) delete process.env.OFFLINE_RECOVERY_KEY_VERSION;
    else process.env.OFFLINE_RECOVERY_KEY_VERSION = previousVersion;
  }
});

test("grant assurance failures are distinct while every recovery denial is generic", async () => {
  const session = { organization: { id: randomUUID() }, user: { id: randomUUID() } };
  const serviceFor = (result) => new ProtectedReportKeyService(
    { transaction: async (work) => work({ query: async () => [result] }) },
    { assertCsrf: async () => undefined, get: async () => session },
  );
  await assert.rejects(serviceFor({ result: "reauthentication_required" }).createRecoveryGrant(
    "session", randomUUID(), { schemaVersion: 1, envelopeVersion: 1 }, "csrf"),
  (error) => error instanceof HttpException && error.getStatus() === 428);
  await assert.rejects(serviceFor({ result: "denied" }).createRecoveryGrant(
    "session", randomUUID(), { schemaVersion: 1, envelopeVersion: 1 }, "csrf"), NotFoundException);
  await assert.rejects(serviceFor({ result: "denied" }).consumeRecoveryGrant(
    "session", randomUUID(), { schemaVersion: 1, envelopeVersion: 1, grant: Buffer.alloc(32).toString("base64url") }, "csrf"),
  (error) => error instanceof NotFoundException && error.message === "Protected report recovery is unavailable");
});
