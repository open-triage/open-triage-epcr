import assert from "node:assert/strict";
import test from "node:test";
import production from "@open-triage/contracts/config/installation.production.json" with { type: "json" };
import { selectedInstallationSettings } from "../dist/config/installation-settings.js";

test("the API always uses ordinary production installation policy", () => {
  const original = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
  try {
    process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
    assert.deepEqual(selectedInstallationSettings(), production);
    for (const removed of ["syntheticFixtures", "sampleDispatchAssignment", "syntheticDataBanner", "administration"]) {
      assert.equal(removed in selectedInstallationSettings(), false);
    }
    assert.equal(production.authentication.minimumPasswordLength, 12);
    assert.equal(production.authentication.temporaryPasswordHours, 72);
    assert.deepEqual(production.clinicalRetention, {
      durationHours: 10 * 365 * 24,
      automaticDeletionEnabled: false,
    });
    assert.deepEqual(production.offlineRecovery, {
      windowHours: 24,
      restartReauthenticationRequired: true,
    });
  } finally {
    if (original === undefined) delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    else process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = original;
  }
});
