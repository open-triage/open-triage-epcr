import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { DEFAULT_AGENCY_APPEARANCE, parseInstallationSettings, SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import schema from "@open-triage/contracts/installation-settings.schema-1.0.0.json";
import production from "@open-triage/contracts/config/installation.production.json";
import {
  applyAgencyAppearance,
  applyAgencyColors,
  loadInstallationConfiguration,
  selectedInstallationSettings,
} from "../app/installation-settings";
import { createClinicianSession } from "../app/clinician-session";

test("the sole installation policy is the production security and retention baseline", () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(production), true, JSON.stringify(validate.errors));
  assert.deepEqual(parseInstallationSettings(production), production);
  assert.equal(production.language, "en");
  assert.deepEqual(selectedInstallationSettings(), production);
  assert.equal(production.authentication.minimumPasswordLength, 12);
  assert.equal(production.authentication.temporaryPasswordHours, 72);
  assert.deepEqual(production.signIn, {
    brandText: "OpenTriage ePCR",
    helperText: "Demo credentials: username **demo**, password **opentriagedemo**",
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

test("server-backed clients receive configurable public demo sign-in copy", async () => {
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
    assert.equal(loaded.settings.signIn.helperText.includes(SYNTHETIC_DEMO_FIXTURE.password), true);
  } finally {
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

test("agency appearance activates accessible colors, browser chrome, and PWA naming", () => {
  const declarations = new Map<string, string>();
  const rootRule = { cssText: ":root { font-family: Inter, system-ui, sans-serif; --agency-pwa-background: #dfe5df; }" };
  const rules = [rootRule];
  const theme = { name: "", content: "" };
  const manifest = { href: "" };
  const documentStub = {
    title: "",
    styleSheets: [{ cssRules: rules }],
    documentElement: { style: { setProperty(name: string, value: string) { declarations.set(name, value); } } },
    head: { append() {} },
    createElement: () => theme,
    querySelector: (selector: string) => selector.includes("theme-color") ? theme : manifest,
  } as unknown as Document;
  const configured = { ...DEFAULT_AGENCY_APPEARANCE, brandText: "County EMS",
    helperText: "Use agency-issued credentials.", accentColor: "#005ea8", accentDarkColor: "#004578",
    destructiveColor: "#9f241d",
    inactiveButtonColor: "#f2f5f3", textColor: "#202520",
    browserThemeColor: "#005ea8", pwaBackgroundColor: "#eef5fb",
    pwaName: "County EMS ePCR", pwaShortName: "County EMS" };

  applyAgencyAppearance(configured, documentStub);

  assert.equal(documentStub.title, "County EMS ePCR");
  assert.equal(theme.content, "#005ea8");
  assert.equal(declarations.get("--green"), "#005ea8");
  assert.equal(declarations.get("--green-dark"), "#004578");
  assert.equal(declarations.get("--destructive"), "#9f241d");
  assert.equal(declarations.get("--inactive-button"), "#f2f5f3");
  assert.equal(declarations.get("--text-color"), "#202520");
  assert.equal(declarations.get("--agency-pwa-background"), "#eef5fb");
  assert.equal(rules.length, 1);
  assert.equal(rules[0], rootRule, "appearance activation must not delete the global typography rule");
  const manifestJson = JSON.parse(decodeURIComponent(manifest.href.split(",", 2)[1]!));
  assert.equal(manifestJson.name, "County EMS ePCR");
  assert.equal(manifestJson.short_name, "County EMS");
  assert.equal(manifestJson.background_color, "#eef5fb");
});

test("button foregrounds retain contrast when a light destructive color darkens on hover", () => {
  const declarations = new Map<string, string>();
  const documentStub = { documentElement: { style: { setProperty(name: string, value: string) {
    declarations.set(name, value);
  } } } } as unknown as Document;
  applyAgencyColors({ ...DEFAULT_AGENCY_APPEARANCE, accentColor: "#ffff00", accentDarkColor: "#005ea8",
    destructiveColor: "#888888" }, documentStub);
  assert.equal(declarations.get("--accent-contrast"), "#000");
  assert.equal(declarations.get("--accent-dark-contrast"), "#fff");
  assert.equal(declarations.get("--destructive-contrast"), "#000");
  assert.equal(declarations.get("--destructive-hover-contrast"), "#fff");
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

test("offline startup uses only the last validated configuration for the same installation endpoint", async () => {
  const oldApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const oldLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  const bytes = new Map<string, string>();
  const storage = {
    getItem(key: string) { return bytes.get(key) ?? null; },
    setItem(key: string, value: string) { bytes.set(key, value); },
  };
  try {
    delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const unavailable = async () => { throw new TypeError("network unavailable"); };
    for (const language of ["en", "sv"] as const) {
      for (const regionalFormat of [null, "sv-SE"] as const) {
        const expected = { ...production, language, regionalFormat };
        await loadInstallationConfiguration(async () => new Response(JSON.stringify({ settings: expected,
          appearance: DEFAULT_AGENCY_APPEARANCE }), { status: 200 }), storage);
        const restored = await loadInstallationConfiguration(unavailable, storage);
        assert.equal(restored.settings.language, language);
        assert.equal(restored.settings.regionalFormat, regionalFormat);
      }
    }
    process.env.NEXT_PUBLIC_API_URL = "https://another.example.test";
    await assert.rejects(loadInstallationConfiguration(unavailable, storage), /network unavailable/);
  } finally {
    if (oldApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = oldApiUrl;
    if (oldLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = oldLocalDemo;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("older appearance configurations acquire default button and text colors online and offline", async () => {
  const oldApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const oldLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  const bytes = new Map<string, string>();
  const storage = {
    getItem(key: string) { return bytes.get(key) ?? null; },
    setItem(key: string, value: string) { bytes.set(key, value); },
  };
  try {
    delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const oldAppearance = { ...DEFAULT_AGENCY_APPEARANCE };
    Reflect.deleteProperty(oldAppearance, "destructiveColor");
    Reflect.deleteProperty(oldAppearance, "inactiveButtonColor");
    Reflect.deleteProperty(oldAppearance, "textColor");
    const online = await loadInstallationConfiguration(async () => Response.json({ settings: production, appearance: oldAppearance }), storage);
    assert.equal(online.appearance.destructiveColor, "#b42318");
    assert.equal(online.appearance.inactiveButtonColor, "#ffffff");
    assert.equal(online.appearance.textColor, "#1a1c1a");
    const cached = JSON.parse(bytes.values().next().value!);
    delete cached.configuration.appearance.destructiveColor;
    delete cached.configuration.appearance.inactiveButtonColor;
    delete cached.configuration.appearance.textColor;
    bytes.set([...bytes.keys()][0]!, JSON.stringify(cached));
    const offline = await loadInstallationConfiguration(async () => { throw new TypeError("offline"); }, storage);
    assert.equal(offline.appearance.destructiveColor, "#b42318");
    assert.equal(offline.appearance.inactiveButtonColor, "#ffffff");
    assert.equal(offline.appearance.textColor, "#1a1c1a");
  } finally {
    if (oldApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = oldApiUrl;
    if (oldLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = oldLocalDemo;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
