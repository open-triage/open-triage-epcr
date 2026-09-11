import { parseInstallationSettings, type InstallationSettings } from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";

export function selectedInstallationSettings(): InstallationSettings {
  return parseInstallationSettings(production);
}
