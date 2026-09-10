import {
  parseInstallationSettings,
  SYNTHETIC_DEMO_FIXTURE,
  type InstallationSettings,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export function selectedInstallationSettings(): InstallationSettings {
  const selection = process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE ?? "production";
  if (selection === "production") return parseInstallationSettings(production);
  if (selection === "synthetic-demo") return parseInstallationSettings(syntheticDemo);
  throw new TypeError(`Unknown installation settings baseline: ${selection}`);
}

/** Server-backed clients use the API's profile; bundled settings are only a static-demo fallback. */
export async function loadInstallationConfiguration(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicInstallationConfiguration> {
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/installation", configuration);
  if (!url) {
    const settings = selectedInstallationSettings();
    return {
      profile: settings.syntheticFixtures.enabled ? "synthetic-demo" : "production",
      settings,
      ...(settings.syntheticFixtures.enabled ? {
        demoLogin: {
          username: SYNTHETIC_DEMO_FIXTURE.clinicianUsername,
          password: SYNTHETIC_DEMO_FIXTURE.password,
        },
      } : {}),
    };
  }
  const response = await fetchImpl(url, browserRequestInit());
  if (!response.ok) throw new Error("Installation configuration is unavailable.");
  const result = await response.json() as PublicInstallationConfiguration;
  return { ...result, settings: parseInstallationSettings(result.settings) };
}
