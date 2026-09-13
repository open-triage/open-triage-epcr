import assert from "node:assert/strict";
import test from "node:test";
import production from "@open-triage/contracts/config/installation.production.json" with { type: "json" };
import { InstallationController } from "../dist/config/installation.controller.js";

test("publishes policy and configurable public sign-in copy without fixture metadata", () => {
  const result = new InstallationController().get();
  assert.deepEqual(result, { settings: production });
  assert.equal("profile" in result, false);
  assert.equal("fixture" in result, false);
  assert.equal("demoLogin" in result, false);
  assert.deepEqual(result.settings.signIn, {
    brandText: "OpenTriage ePCR",
    helperText: "Demo credentials: username **demo**, password **opentriagedemo**",
  });
});
