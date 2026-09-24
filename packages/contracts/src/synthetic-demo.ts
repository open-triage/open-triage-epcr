import type { AgencyAppearance } from "./index.js";
import type { InstallationSettings } from "./installation-settings.js";
import fixture from "./synthetic-demo-fixture.json" with { type: "json" };

export const SYNTHETIC_DEMO_FIXTURE = Object.freeze(fixture);

export interface PublicInstallationConfiguration {
  settings: InstallationSettings;
  appearance: AgencyAppearance;
}
