import assert from "node:assert/strict";
import test from "node:test";
import production from "@open-triage/contracts/config/installation.production.json" with { type: "json" };
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import { InstallationController } from "../dist/config/installation.controller.js";

test("publishes revisioned appearance with the documented demo sign-in guidance", async () => {
  const result = await new InstallationController({ publicConfiguration: async () => ({
    settings: production, appearance: DEFAULT_AGENCY_APPEARANCE,
  }) }).get();
  assert.deepEqual(result, { settings: production, appearance: DEFAULT_AGENCY_APPEARANCE });
  assert.equal("profile" in result, false);
  assert.equal("fixture" in result, false);
  assert.equal("demoLogin" in result, false);
  assert.deepEqual(result.settings.signIn, {
    brandText: "OpenTriage ePCR",
    helperText: "Demo credentials: username **demo**, password **opentriagedemo**",
  });
  assert.match(result.settings.signIn.helperText, /username \*\*demo\*\*, password \*\*opentriagedemo\*\*/);
});
