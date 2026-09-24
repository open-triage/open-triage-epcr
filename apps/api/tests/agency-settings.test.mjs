import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { AgencySettingsService } from "../dist/admin/agency-settings.service.js";
import { validateUpdateAgencyMediaSettings } from "../dist/admin/agency-settings.validation.js";

const organizationId = randomUUID();
const actorId = randomUUID();
const row = (revision = 1, bytes = 50 * 1024 * 1024) => ({
  organization_id: organizationId,
  report_media_allowance_bytes: bytes,
  revision,
  updated_at: "2026-09-24T10:00:00.000Z",
});

test("Agency Settings validation accepts bounded whole MiB values only", () => {
  assert.deepEqual(validateUpdateAgencyMediaSettings({
    expectedRevision: 2, reportMediaAllowanceBytes: 75 * 1024 * 1024,
  }), { expectedRevision: 2, reportMediaAllowanceBytes: 75 * 1024 * 1024 });
  for (const input of [
    null,
    { expectedRevision: 0, reportMediaAllowanceBytes: 50 * 1024 * 1024 },
    { expectedRevision: 1, reportMediaAllowanceBytes: 1024 * 1024 + 1 },
    { expectedRevision: 1, reportMediaAllowanceBytes: 2 * 1024 * 1024 * 1024 + 1024 * 1024 },
    { expectedRevision: 1, reportMediaAllowanceBytes: 50 * 1024 * 1024, secret: "not accepted" },
  ]) assert.throws(() => validateUpdateAgencyMediaSettings(input), UnprocessableEntityException);
});

test("authorized readers receive the 50 MiB default and revision without privileged spillover", async () => {
  const capabilities = [];
  const service = new AgencySettingsService({ query: async (sql, parameters) => {
    assert.match(sql, /where organization\.id = \$1/);
    assert.deepEqual(parameters, [organizationId, 50 * 1024 * 1024]);
    return [row()];
  } }, { requireCapability: async (_token, capability) => {
    capabilities.push(capability);
    return { organization: { id: organizationId }, user: { id: actorId } };
  } });
  assert.deepEqual(await service.get("session"), {
    organizationId,
    reportMediaAllowanceBytes: 50 * 1024 * 1024,
    revision: 1,
    defaultReportMediaAllowanceBytes: 50 * 1024 * 1024,
    storageGrowthWarning: false,
    updatedAt: "2026-09-24T10:00:00.000Z",
  });
  assert.deepEqual(capabilities, ["settings:read"]);
});

test("unauthorized settings requests stop before database access", async () => {
  const service = new AgencySettingsService({
    query: async () => { throw new Error("database touched"); },
    transaction: async (work) => work({ query: async () => { throw new Error("database touched"); } }),
  }, { requireCapability: async () => { throw new UnauthorizedException("missing authority"); } });
  await assert.rejects(service.get("session"), UnauthorizedException);
  await assert.rejects(service.update("session", {
    expectedRevision: 1, reportMediaAllowanceBytes: 60 * 1024 * 1024,
  }), UnauthorizedException);
});

test("a settings save is revision-guarded, immediately returned, and audited with bounded numeric values", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    if (sql.includes("insert into app_identity.agency_settings (") && sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [row(3)];
    if (sql.includes("update app_identity.agency_settings")) return [row(4, 80 * 1024 * 1024)];
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async (_token, capability, usedManager) => {
      assert.equal(capability, "settings:write");
      assert.equal(usedManager, manager);
      return { organization: { id: organizationId }, user: { id: actorId } };
    },
  });
  const updated = await service.update("session", {
    expectedRevision: 3, reportMediaAllowanceBytes: 80 * 1024 * 1024,
  });
  assert.equal(updated.revision, 4);
  assert.equal(updated.storageGrowthWarning, true);
  const mutation = calls.find(({ sql }) => sql.startsWith("update app_identity.agency_settings"));
  assert.deepEqual(mutation.parameters, [organizationId, 3, 80 * 1024 * 1024, actorId]);
  const audit = calls.find(({ sql }) => sql.includes("agency_settings_change_event"));
  assert.deepEqual(audit.parameters, [organizationId, actorId, 3, 4, 50 * 1024 * 1024, 80 * 1024 * 1024]);
  assert.doesNotMatch(JSON.stringify(audit), /patient|caption|content|token|secret/i);
});

test("a stale settings revision cannot overwrite or audit the newer value", async () => {
  const calls = [];
  const manager = { query: async (sql) => {
    calls.push(sql);
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [row(7, 40 * 1024 * 1024)];
    throw new Error("stale request mutated state");
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  await assert.rejects(service.update("session", {
    expectedRevision: 6, reportMediaAllowanceBytes: 70 * 1024 * 1024,
  }), (error) => error instanceof ConflictException && error.getResponse().actualRevision === 7);
  assert.equal(calls.some((sql) => sql.includes("update app_identity.agency_settings")), false);
  assert.equal(calls.some((sql) => sql.includes("agency_settings_change_event")), false);
});
