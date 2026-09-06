import assert from "node:assert/strict";
import test from "node:test";
import production from "@open-triage/contracts/config/installation.production.json" with { type: "json" };
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json" with { type: "json" };
import { selectedInstallationSettings } from "../dist/config/installation-settings.js";
import { shouldCreateSampleReplacement } from "../dist/calls/assigned-calls.service.js";

test("the API defaults to production and requires an explicit demo selection", () => {
  const original = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
  try {
    delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    assert.deepEqual(selectedInstallationSettings(), production);
    process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
    assert.deepEqual(selectedInstallationSettings(), syntheticDemo);
  } finally {
    if (original === undefined) delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    else process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = original;
  }
});

test("sample assignment generation is independent of synthetic record identity", () => {
  assert.equal(shouldCreateSampleReplacement(true, production), false);
  assert.equal(shouldCreateSampleReplacement(false, syntheticDemo), false);
  assert.equal(shouldCreateSampleReplacement(true, syntheticDemo), true);
});
