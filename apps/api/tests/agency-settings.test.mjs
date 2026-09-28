import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import { AgencySettingsService } from "../dist/admin/agency-settings.service.js";
import { contrastRatio, validateUpdateAgencyMediaSettings } from "../dist/admin/agency-settings.validation.js";

const organizationId = randomUUID();
const actorId = randomUUID();
const demographicId = randomUUID();
const catalogReleaseId = randomUUID();
const appearance = { ...DEFAULT_AGENCY_APPEARANCE, brandText: "County EMS", pwaName: "County EMS" };
const demographics = { agencyUniqueStateId: "STATE-1", agencyNumber: "AGENCY-1", stateCode: "36",
  stateDisplay: "New York", stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null };
const settingsRow = (revision = 1, bytes = 50 * 1024 * 1024) => ({
  organization_id: organizationId, language: "en", regional_format: null, report_media_allowance_bytes: bytes, image_media_limit_bytes: 10 * 1024 * 1024, revision,
  brand_text: appearance.brandText, helper_text: appearance.helperText, logo_png_data_url: null,
  accent_color: appearance.accentColor, accent_dark_color: appearance.accentDarkColor,
  browser_theme_color: appearance.browserThemeColor, pwa_background_color: appearance.pwaBackgroundColor,
  pwa_name: appearance.pwaName, pwa_short_name: appearance.pwaShortName,
  updated_at: "2026-09-24T10:00:00.000Z",
});
const demographicRow = (version = 1) => ({ id: demographicId, catalog_release_id: catalogReleaseId,
  version, dagency_01: demographics.agencyUniqueStateId, dagency_02: demographics.agencyNumber,
  dagency_04: demographics.stateCode, dagency_04_display: demographics.stateDisplay,
  dagency_04_system: demographics.stateCodeSystem,
  dagency_04_terminology_version: demographics.stateTerminologyVersion,
  definition_sha256: "a".repeat(64), effective_from: "2026-09-24T09:00:00.000Z" });
const command = (revision = 1, bytes = 50 * 1024 * 1024) => ({ expectedRevision: revision, language: "en",
  reportMediaAllowanceBytes: bytes, imageMediaLimitBytes: Math.min(10 * 1024 * 1024, bytes), appearance, demographics });

test("Agency Settings validation accepts complete bounded settings and rejects unsafe presentation", () => {
  assert.deepEqual(validateUpdateAgencyMediaSettings(command(2, 75 * 1024 * 1024)), command(2, 75 * 1024 * 1024));
  assert.ok(contrastRatio("#00783a", "#ffffff") >= 4.5);
  for (const input of [
    null,
    { ...command(), expectedRevision: 0 },
    { ...command(), language: "fr" },
    { ...command(), regionalFormat: "fr-FR" },
    { ...command(), reportMediaAllowanceBytes: 1024 * 1024 + 1 },
    { ...command(), imageMediaLimitBytes: 51 * 1024 * 1024 },
    { ...command(), appearance: { ...appearance, accentColor: "#ffffff" } },
    { ...command(), appearance: { ...appearance, helperText: "username: demo password: demo" } },
    { ...command(), demographics: { ...demographics, stateCode: "NY" } },
    { ...command(), secret: "not accepted" },
  ]) assert.throws(() => validateUpdateAgencyMediaSettings(input), UnprocessableEntityException);
});

test("authorized readers receive appearance and the current canonical demographic version", async () => {
  const capabilities = [];
  const service = new AgencySettingsService({ query: async (sql, parameters) => {
    assert.deepEqual(parameters, [organizationId]);
    if (sql.includes("agency_settings")) return [settingsRow()];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    throw new Error(`Unexpected SQL: ${sql}`);
  } }, { requireCapability: async (_token, capability) => {
    capabilities.push(capability);
    return { organization: { id: organizationId }, user: { id: actorId } };
  } });
  const result = await service.get("session");
  assert.equal(result.appearance.brandText, "County EMS");
  assert.equal(result.demographics.versionId, demographicId);
  assert.equal(result.demographics.agencyNumber, "AGENCY-1");
  assert.deepEqual(capabilities, ["settings:read"]);
});

test("unauthorized settings requests stop before database access", async () => {
  const service = new AgencySettingsService({
    query: async () => { throw new Error("database touched"); },
    transaction: async (work) => work({ query: async () => { throw new Error("database touched"); } }),
  }, { requireCapability: async () => { throw new UnauthorizedException("missing authority"); } });
  await assert.rejects(service.get("session"), UnauthorizedException);
  await assert.rejects(service.update("session", command()), UnauthorizedException);
});

test("a settings save is revision-guarded, active immediately, and audits bounded safe values", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    if (sql.includes("insert into app_identity.agency_settings (") && sql.includes("on conflict")) return [];
    if (sql.includes("agency_demographic_version") && sql.includes("select *")) return [demographicRow()];
    if (sql.includes("agency_settings") && sql.includes("for update")) return [settingsRow(3)];
    if (sql.includes("update app_identity.agency_settings")) return [settingsRow(4, 80 * 1024 * 1024)];
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async (_token, capability, usedManager) => {
      assert.equal(capability, "settings:write"); assert.equal(usedManager, manager);
      return { organization: { id: organizationId }, user: { id: actorId } };
    },
  });
  const updated = await service.update("session", command(3, 80 * 1024 * 1024));
  assert.equal(updated.revision, 4);
  assert.equal(updated.storageGrowthWarning, true);
  const mutation = calls.find(({ sql }) => sql.startsWith("update app_identity.agency_settings"));
  assert.equal(mutation.parameters[0], organizationId);
  assert.equal(mutation.parameters[1], 3);
  assert.equal(mutation.parameters[2], 80 * 1024 * 1024);
  assert.equal(mutation.parameters.at(-3), actorId);
  assert.equal(mutation.parameters.at(-2), "en");
  assert.equal(mutation.parameters.at(-1), null);
  const audit = calls.find(({ sql }) => sql.includes("agency_settings_change_event"));
  assert.equal(audit.parameters[0], organizationId);
  assert.equal(audit.parameters[2], 3);
  assert.equal(audit.parameters[3], 4);
  assert.deepEqual(audit.parameters.slice(-4), ["en", "en", null, null]);
  assert.doesNotMatch(JSON.stringify(audit), /logoPngDataUrl|patient|caption|content|token|secret/i);
});

test("a dAgency change appends a canonical version and bounded audit event", async () => {
  const calls = [];
  const changed = { ...demographics, agencyNumber: "AGENCY-2" };
  const inserted = { ...demographicRow(2), id: randomUUID(), dagency_02: "AGENCY-2", definition_sha256: "b".repeat(64) };
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), parameters });
    if (sql.includes("insert into app_identity.agency_settings (") && sql.includes("on conflict")) return [];
    if (sql.includes("agency_settings") && sql.includes("for update")) return [settingsRow(2)];
    if (sql.includes("select * from app_identity.agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) return [settingsRow(3)];
    if (sql.includes("insert into app_identity.agency_demographic_version")) return [inserted];
    if (sql.includes("change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  const updated = await service.update("session", { ...command(2), demographics: changed });
  assert.equal(updated.demographics.version, 2);
  assert.equal(updated.demographics.agencyNumber, "AGENCY-2");
  assert.ok(calls.some(({ sql }) => sql.includes("insert into app_identity.agency_demographic_change_event")));
});

test("a stale settings revision cannot overwrite or audit the newer value", async () => {
  const calls = [];
  const manager = { query: async (sql) => {
    calls.push(sql);
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [settingsRow(7)];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    throw new Error("stale request mutated state");
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  await assert.rejects(service.update("session", command(6, 70 * 1024 * 1024)),
    (error) => error instanceof ConflictException && error.getResponse().actualRevision === 7);
  assert.equal(calls.some((sql) => sql.includes("update app_identity.agency_settings")), false);
  assert.equal(calls.some((sql) => sql.includes("change_event")), false);
});


test("language-only changes use the same revision and audit transaction", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [settingsRow(2)];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) return [{ ...settingsRow(3), language: "sv" }];
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "settings:write");
      return { organization: { id: organizationId }, user: { id: actorId } };
    },
  });
  const saved = await service.update("session", { ...command(2), language: "sv" });
  assert.equal(saved.language, "sv");
  assert.equal(saved.revision, 3);
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters.at(-2), "sv");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(-4), ["en", "sv", null, null]);
});


test("public installation configuration exposes only the agency language and appearance", async () => {
  const service = new AgencySettingsService({ query: async () => [{ ...settingsRow(), language: "sv" }] }, {
    requireCapability: async () => { throw new Error("Public configuration must not need a session"); },
  });
  const result = await service.publicConfiguration();
  assert.equal(result.settings.language, "sv");
  assert.equal(result.settings.signIn.brandText, appearance.brandText);
  assert.equal("organizationId" in result, false);
  assert.equal("revision" in result.settings, false);
});

test("regional format persists independently of language and can return to compatibility default", async () => {
  const calls = [];
  let current = settingsRow(2);
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [current];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) {
      current = { ...current, revision: current.revision + 1, regional_format: parameters.at(-1) };
      return [current];
    }
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  const saved = await service.update("session", { ...command(2), regionalFormat: "sv-SE" });
  assert.equal(saved.language, "en");
  assert.equal(saved.regionalFormat, "sv-SE");
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters.at(-1), "sv-SE");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(-2), [null, "sv-SE"]);
  calls.length = 0;
  const reset = await service.update("session", { ...command(3), regionalFormat: null });
  assert.equal(reset.regionalFormat, null);
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters.at(-1), null);
});
