import assert from "node:assert/strict";
import test from "node:test";
import production from "@open-triage/contracts/config/installation.production.json" with { type: "json" };
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import { InstallationController } from "../dist/config/installation.controller.js";

test("publishes safe revisioned appearance without fixture metadata", async () => {
  const result = await new InstallationController({ publicConfiguration: async () => ({
    settings: production, appearance: DEFAULT_AGENCY_APPEARANCE,
  }) }).get();
  assert.deepEqual(result, { settings: production, appearance: DEFAULT_AGENCY_APPEARANCE });
  assert.equal("profile" in result, false);
  assert.equal("fixture" in result, false);
  assert.equal("demoLogin" in result, false);
  assert.deepEqual(result.settings.signIn, {
    brandText: "OpenTriage ePCR",
    helperText: "Sign in with your agency-issued credentials.",
  });
  assert.doesNotMatch(JSON.stringify(result), /opentriagedemo|username\s*:/i);
});
