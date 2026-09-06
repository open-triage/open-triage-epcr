import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseInstallationSettings } from "@open-triage/contracts";
import schema from "@open-triage/contracts/installation-settings.schema-1.0.0.json";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";
import { selectedInstallationSettings } from "../app/installation-settings";

test("production and synthetic demo baselines conform to the installation settings schema", () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  for (const baseline of [production, syntheticDemo]) {
    assert.equal(validate(baseline), true, JSON.stringify(validate.errors));
    assert.deepEqual(parseInstallationSettings(baseline), baseline);
  }
});

test("production defaults do not inherit independently selectable demo behavior", () => {
  assert.equal(production.syntheticFixtures.enabled, false);
  assert.equal(production.sampleDispatchAssignment.enabled, false);
  assert.equal(production.syntheticDataBanner.enabled, false);
  assert.equal(production.clinicalRetention.durationHours, 10 * 365 * 24);
  assert.equal(production.clinicalRetention.automaticDeletionEnabled, false);
  assert.equal(production.administration.readOnly, false);
  assert.equal(production.exports.downloadsAllowed, true);

  assert.equal(syntheticDemo.syntheticFixtures.enabled, true);
  assert.equal(syntheticDemo.sampleDispatchAssignment.enabled, true);
  assert.equal(syntheticDemo.syntheticDataBanner.enabled, true);
  assert.equal(syntheticDemo.clinicalRetention.durationHours, 24);
  assert.equal(syntheticDemo.administration.readOnly, true);
  assert.equal(syntheticDemo.exports.downloadsAllowed, false);
});

test("the browser selects a baseline explicitly and fails closed on unknown selections", () => {
  const original = process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE;
  try {
    delete process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE;
    assert.equal(selectedInstallationSettings().syntheticDataBanner.enabled, false);
    process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
    assert.equal(selectedInstallationSettings().syntheticDataBanner.enabled, true);
    process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE = "not-an-installation";
    assert.throws(() => selectedInstallationSettings(), /Unknown installation settings baseline/);
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE;
    else process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE = original;
  }
});

test("settings reject undeclared fields instead of silently enabling behavior", () => {
  assert.throws(() => parseInstallationSettings({ ...production, demo: true }), /invalid keys/);
});

test("fixture, assignment, banner, and restriction controls accept independent combinations", () => {
  const mixed = parseInstallationSettings({
    ...production,
    syntheticFixtures: { enabled: true },
    sampleDispatchAssignment: { enabled: false },
    syntheticDataBanner: { ...production.syntheticDataBanner, enabled: true },
    administration: { readOnly: true },
  });
  assert.deepEqual({
    fixture: mixed.syntheticFixtures.enabled,
    assignment: mixed.sampleDispatchAssignment.enabled,
    banner: mixed.syntheticDataBanner.enabled,
    readOnly: mixed.administration.readOnly,
    downloads: mixed.exports.downloadsAllowed,
  }, { fixture: true, assignment: false, banner: true, readOnly: true, downloads: true });
});
