import { parseInstallationSettings, type InstallationSettings } from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";

export type InstallationSettingsBaseline = "production" | "synthetic-demo";

export function selectedInstallationSettings(
  selection = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE ?? "production",
): InstallationSettings {
  if (selection === "production") return parseInstallationSettings(production);
  if (selection === "synthetic-demo") return parseInstallationSettings(syntheticDemo);
  throw new TypeError(`Unknown installation settings baseline: ${selection}`);
}
