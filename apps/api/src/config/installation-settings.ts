import { parseInstallationSettings, type InstallationSettings } from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";

export const READ_ONLY_ADMINISTRATION_MESSAGE =
  "Publishing and activation are disabled for this installation. Drafts can still be created, edited, validated, and saved.";

export type InstallationSettingsBaseline = "production" | "synthetic-demo";

export function selectedInstallationSettings(
  selection = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE ?? "production",
): InstallationSettings {
  if (selection === "production") return parseInstallationSettings(production);
  if (selection === "synthetic-demo") return parseInstallationSettings(syntheticDemo);
  throw new TypeError(`Unknown installation settings baseline: ${selection}`);
}

export function configurationPublishingAllowed(
  settings = selectedInstallationSettings(),
): boolean {
  return !settings.administration.readOnly;
}
