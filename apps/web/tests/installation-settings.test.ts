import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { DEFAULT_AGENCY_APPEARANCE, parseInstallationSettings, SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import schema from "@open-triage/contracts/installation-settings.schema-1.0.0.json";
import production from "@open-triage/contracts/config/installation.production.json";
import {
  applyAgencyAppearance,
  loadInstallationConfiguration,
  selectedInstallationSettings,
} from "../app/installation-settings";
import { createClinicianSession } from "../app/clinician-session";

test("the sole installation policy is the production security and retention baseline", () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(production), true, JSON.stringify(validate.errors));
  assert.deepEqual(parseInstallationSettings(production), production);
  assert.deepEqual(selectedInstallationSettings(), production);
  assert.equal(production.authentication.minimumPasswordLength, 12);
  assert.equal(production.authentication.temporaryPasswordHours, 72);
  assert.deepEqual(production.signIn, {
    brandText: "OpenTriage ePCR",
    helperText: "Sign in with your agency-issued credentials.",
  });
  assert.deepEqual(production.clinicalRetention, {
    durationHours: 10 * 365 * 24,
    automaticDeletionEnabled: false,
  });
  assert.deepEqual(production.offlineRecovery, {
    windowHours: 24,
    restartReauthenticationRequired: true,
  });
  assert.throws(() => parseInstallationSettings({
    ...production, offlineRecovery: { ...production.offlineRecovery, windowHours: 169 },
  }), /less than or equal to 168/);
  for (const removed of ["syntheticFixtures", "sampleDispatchAssignment", "syntheticDataBanner", "administration"]) {
    assert.equal(removed in production, false);
  }
});

test("settings reject retired demo-profile behavior", () => {
  for (const field of ["syntheticFixtures", "sampleDispatchAssignment", "syntheticDataBanner", "administration", "demo"]) {
    assert.throws(() => parseInstallationSettings({ ...production, [field]: {} }), /invalid keys/);
  }
});

test("server-backed clients receive configurable public sign-in copy without fixture metadata", async () => {
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  try {
    delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const loaded = await loadInstallationConfiguration(async (input) => {
      assert.equal(String(input), "https://api.example.test/api/installation");
      return new Response(JSON.stringify({ settings: production, appearance: DEFAULT_AGENCY_APPEARANCE }), { status: 200 });
    });
    assert.deepEqual(loaded, { settings: production, appearance: DEFAULT_AGENCY_APPEARANCE });
    assert.equal(loaded.settings.signIn.helperText.includes(SYNTHETIC_DEMO_FIXTURE.password), false);
  } finally {
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

test("agency appearance activates accessible colors, browser chrome, and PWA naming", () => {
  const rules: Array<{ cssText: string }> = [];
  const sheet = {
    cssRules: rules,
    deleteRule(index: number) { rules.splice(index, 1); },
    insertRule(rule: string) { rules.push({ cssText: rule }); return rules.length - 1; },
  };
  const theme = { name: "", content: "" };
  const manifest = { href: "" };
  const documentStub = {
    title: "",
    styleSheets: [sheet],
    head: { append() {} },
    createElement: () => theme,
    querySelector: (selector: string) => selector.includes("theme-color") ? theme : manifest,
  } as unknown as Document;
  const configured = { ...DEFAULT_AGENCY_APPEARANCE, brandText: "County EMS",
    helperText: "Use agency-issued credentials.", accentColor: "#005ea8", accentDarkColor: "#004578",
    browserThemeColor: "#005ea8", pwaBackgroundColor: "#eef5fb",
    pwaName: "County EMS ePCR", pwaShortName: "County EMS" };

  applyAgencyAppearance(configured, documentStub);

  assert.equal(documentStub.title, "County EMS ePCR");
  assert.equal(theme.content, "#005ea8");
  assert.match(rules[0]!.cssText, /--green: #005ea8/);
  const manifestJson = JSON.parse(decodeURIComponent(manifest.href.split(",", 2)[1]!));
  assert.equal(manifestJson.name, "County EMS ePCR");
  assert.equal(manifestJson.short_name, "County EMS");
  assert.equal(manifestJson.background_color, "#eef5fb");
});

test("the static prototype accepts manually supplied local credentials as a clinician only", async () => {
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  try {
    process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
    assert.deepEqual(await loadInstallationConfiguration(), { settings: production,
      appearance: DEFAULT_AGENCY_APPEARANCE });
    const session = await createClinicianSession({
      username: SYNTHETIC_DEMO_FIXTURE.username,
      password: SYNTHETIC_DEMO_FIXTURE.password,
    });
    assert.deepEqual(session.capabilities, ["clinical:demo", "clinical:document"]);
    assert.equal(session.capabilities?.some((capability) => capability.startsWith("admin")), false);
  } finally {
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});
