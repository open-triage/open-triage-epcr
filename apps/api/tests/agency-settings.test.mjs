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
  synthetic_retention_hours: "24", organization_id: organizationId, language: "en", regional_format: null, time_zone: null, report_media_allowance_bytes: bytes, image_media_limit_bytes: 10 * 1024 * 1024, revision,
  brand_text: appearance.brandText, helper_text: appearance.helperText, logo_png_data_url: null,
  accent_color: appearance.accentColor, accent_dark_color: appearance.accentDarkColor,
  destructive_color: appearance.destructiveColor,
  inactive_button_color: appearance.inactiveButtonColor, text_color: appearance.textColor,
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
    { ...command(), timeZone: "Invalid/Zone" },
    { ...command(), timeZone: "+02:00" },
    { ...command(), reportMediaAllowanceBytes: 1024 * 1024 + 1 },
    { ...command(), imageMediaLimitBytes: 51 * 1024 * 1024 },
    { ...command(), appearance: { ...appearance, accentColor: "#ffffff" } },
    { ...command(), appearance: { ...appearance, destructiveColor: "#ffffff" } },
    { ...command(), appearance: { ...appearance, destructiveColor: "red" } },
    { ...command(), appearance: { ...appearance, destructiveColor: "#ABCDEF" } },
    { ...command(), appearance: { ...appearance, destructiveColor: null } },
    { ...command(), appearance: { ...appearance, inactiveButtonColor: "white" } },
    { ...command(), appearance: { ...appearance, textColor: null } },
    { ...command(), appearance: { ...appearance, textColor: "#ffffff" } },
    { ...command(), appearance: { ...appearance, inactiveButtonColor: "#1a1c1a" } },
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
  assert.equal(result.appearance.destructiveColor, appearance.destructiveColor);
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
  assert.equal(mutation.parameters[14], actorId);
  assert.equal(mutation.parameters[15], "en");
  assert.equal(mutation.parameters[17], null);
  const audit = calls.find(({ sql }) => sql.includes("agency_settings_change_event"));
  assert.equal(audit.parameters[0], organizationId);
  assert.equal(audit.parameters[2], 3);
  assert.equal(audit.parameters[3], 4);
  assert.deepEqual(audit.parameters.slice(28, 34), ["en", "en", null, null, null, null]);
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
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters[15], "sv");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(28, 34), ["en", "sv", null, null, null, null]);
});


test("public installation configuration exposes only the agency language and appearance", async () => {
  const service = new AgencySettingsService({ query: async () => [{ ...settingsRow(), language: "sv" }] }, {
    requireCapability: async () => { throw new Error("Public configuration must not need a session"); },
  });
  const result = await service.publicConfiguration();
  assert.equal(result.settings.language, "sv");
  assert.equal(result.settings.signIn.brandText, appearance.brandText);
  assert.equal("regionalFormat" in result.settings, false);
  assert.equal("timeZone" in result.settings, false);
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
      current = { ...current, revision: current.revision + 1, regional_format: parameters[16] };
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
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters[16], "sv-SE");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(30, 34), [null, "sv-SE", null, null]);
  calls.length = 0;
  const reset = await service.update("session", { ...command(3), regionalFormat: null });
  assert.equal(reset.regionalFormat, null);
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters[16], null);
});

test("named clinical zone saves independently and uses the settings revision and audit", async () => {
  const calls = [];
  let current = settingsRow(2);
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [current];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) {
      current = { ...current, revision: current.revision + 1, time_zone: parameters[17] };
      return [current];
    }
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "settings:write");
      return { organization: { id: organizationId }, user: { id: actorId } };
    },
  });
  const saved = await service.update("session", { ...command(2), timeZone: "Europe/Stockholm" });
  assert.equal(saved.timeZone, "Europe/Stockholm");
  assert.equal(saved.language, "en");
  assert.equal(saved.regionalFormat, null);
  assert.equal(calls.find(({ sql }) => sql.includes("update app_identity.agency_settings")).parameters[17], "Europe/Stockholm");
  assert.deepEqual(calls.find(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(32, 34), [null, "Europe/Stockholm"]);
  await assert.rejects(service.update("session", { ...command(2), timeZone: null }), ConflictException);
});

test("a destructive-color-only save persists and audits the agency color without changing demographics", async () => {
  const calls = [];
  const customColor = "#9f241d";
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [settingsRow(2)];
    if (sql.includes("select * from app_identity.agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) {
      assert.match(sql, /destructive_color = \$14/);
      assert.equal(parameters[13], customColor);
      return [{ ...settingsRow(3), destructive_color: parameters[13] }];
    }
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: async (work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  const saved = await service.update("session", { ...command(2), appearance: { ...appearance, destructiveColor: customColor } });
  assert.equal(saved.appearance.destructiveColor, customColor);
  assert.equal(saved.appearance.accentColor, appearance.accentColor);
  assert.equal(saved.revision, 3);
  assert.equal(saved.demographics.version, 1);
  const audit = calls.find(({ sql }) => sql.includes("agency_settings_change_event"));
  assert.match(audit.sql, /old_destructive_color,new_destructive_color/);
  assert.deepEqual(audit.parameters.slice(8, 10), [appearance.destructiveColor, customColor]);
  assert.equal(calls.some(({ sql }) => sql.includes("insert into app_identity.agency_demographic_version")), false);
});

test("inactive button and text colors persist, audit, and appear in public configuration", async () => {
  const calls = [];
  const colors = { inactiveButtonColor: "#f2f5f3", textColor: "#202520" };
  let current = settingsRow(2);
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [current];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) {
      current = { ...current, revision: 3, inactive_button_color: parameters[18], text_color: parameters[19] };
      return [current];
    }
    if (sql.includes("agency_settings_change_event")) return [];
    if (sql.includes("join app_identity.organization")) return [current];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ ...manager, transaction: async work => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId } }),
  });
  const input = validateUpdateAgencyMediaSettings({ ...command(2), appearance: { ...appearance, ...colors } });
  const saved = await service.update("session", input);
  assert.equal(saved.appearance.inactiveButtonColor, colors.inactiveButtonColor);
  assert.equal(saved.appearance.textColor, colors.textColor);
  assert.equal(saved.revision, 3);
  assert.equal(saved.demographics.version, 1);
  const audit = calls.find(({ sql }) => sql.includes("agency_settings_change_event"));
  assert.deepEqual(audit.parameters.slice(34, 38), [appearance.inactiveButtonColor, colors.inactiveButtonColor, appearance.textColor, colors.textColor]);
  const publicConfiguration = await service.publicConfiguration();
  assert.equal(publicConfiguration.appearance.inactiveButtonColor, colors.inactiveButtonColor);
  assert.equal(publicConfiguration.appearance.textColor, colors.textColor);
});


test("demo retention accepts positive whole hours without a product maximum and null disables wiping", () => {
  for (const hours of [1, 24, 721, 100_000, null]) {
    assert.equal(validateUpdateAgencyMediaSettings({ ...command(), syntheticRetentionHours: hours }).syntheticRetentionHours, hours);
  }
  assert.equal("syntheticRetentionHours" in validateUpdateAgencyMediaSettings(command()), false);
  for (const hours of [0, -1, 1.5, "24", "", false, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateUpdateAgencyMediaSettings({ ...command(), syntheticRetentionHours: hours }), UnprocessableEntityException);
  }
});

test("demo retention saves per agency, audits changes, preserves omitted policy, and guards revisions", async () => {
  const calls = [];
  let current = settingsRow();
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("on conflict")) return [];
    if (sql.includes("for update")) return [current];
    if (sql.includes("agency_demographic_version")) return [demographicRow()];
    if (sql.includes("update app_identity.agency_settings")) {
      assert.equal(parameters[0], organizationId);
      current = { ...current, revision: current.revision + 1, language: parameters[15], synthetic_retention_hours: parameters[20] };
      return [current];
    }
    if (sql.includes("agency_settings_change_event")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new AgencySettingsService({ transaction: work => work(manager) }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "settings:write");
      return { organization: { id: organizationId }, user: { id: actorId } };
    },
  });
  for (const hours of [100_000, null, 1]) {
    const before = current;
    const saved = await service.update("session", { ...command(current.revision), syntheticRetentionHours: hours });
    assert.equal(saved.syntheticRetentionHours, hours);
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual(calls.findLast(({ sql }) => sql.includes("agency_settings_change_event")).parameters.slice(38),
      [before.synthetic_retention_hours, hours]);
    await assert.rejects(service.update("session", { ...command(before.revision), syntheticRetentionHours: 24 }), ConflictException);
    const writes = calls.filter(({ sql }) => sql.includes("update app_identity.agency_settings")).length;
    await service.update("session", command(current.revision));
    assert.equal(calls.filter(({ sql }) => sql.includes("update app_identity.agency_settings")).length, writes);
  }
  await service.update("session", { ...command(current.revision), syntheticRetentionHours: null });
  const saved = await service.update("session", { ...command(current.revision), language: "sv" });
  assert.equal(saved.syntheticRetentionHours, null);
});
