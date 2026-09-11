import {
  parseInstallationSettings,
  type InstallationSettings,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export function selectedInstallationSettings(): InstallationSettings {
  return parseInstallationSettings(production);
}

/** Server-backed clients use the API's profile; bundled settings are only a static-demo fallback. */
export async function loadInstallationConfiguration(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicInstallationConfiguration> {
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/installation", configuration);
  if (!url) {
    return { settings: selectedInstallationSettings() };
  }
  const response = await fetchImpl(url, browserRequestInit());
  if (!response.ok) throw new Error("Installation configuration is unavailable.");
  const result = await response.json() as PublicInstallationConfiguration;
  return { ...result, settings: parseInstallationSettings(result.settings) };
}
