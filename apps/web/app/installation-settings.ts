import { parseInstallationSettings, type InstallationSettings } from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";

export function selectedInstallationSettings(): InstallationSettings {
  const selection = process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE ?? "production";
  if (selection === "production") return parseInstallationSettings(production);
  if (selection === "synthetic-demo") return parseInstallationSettings(syntheticDemo);
  throw new TypeError(`Unknown installation settings baseline: ${selection}`);
}
