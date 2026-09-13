import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseInstallationSettings, SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import schema from "@open-triage/contracts/installation-settings.schema-1.0.0.json";
import production from "@open-triage/contracts/config/installation.production.json";
import { loadInstallationConfiguration, selectedInstallationSettings } from "../app/installation-settings";
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
    helperText: "Demo credentials: username **demo**, password **opentriagedemo**",
  });
  assert.deepEqual(production.clinicalRetention, {
    durationHours: 10 * 365 * 24,
    automaticDeletionEnabled: false,
  });
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
      return new Response(JSON.stringify({ settings: production }), { status: 200 });
    });
    assert.deepEqual(loaded, { settings: production });
    assert.equal(loaded.settings.signIn.helperText.includes(SYNTHETIC_DEMO_FIXTURE.password), true);
  } finally {
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

test("the static prototype accepts manually supplied local credentials as a clinician only", async () => {
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  try {
    process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
    assert.deepEqual(await loadInstallationConfiguration(), { settings: production });
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
