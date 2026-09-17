import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
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
