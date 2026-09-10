import {
  parseInstallationSettings,
  SYNTHETIC_DEMO_FIXTURE,
  type InstallationSettings,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import syntheticDemo from "@open-triage/contracts/config/installation.synthetic-demo.json";

export function selectedInstallationSettings(): InstallationSettings {
  const selection = process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE ?? "production";
  if (selection === "production") return parseInstallationSettings(production);
  if (selection === "synthetic-demo") return parseInstallationSettings(syntheticDemo);
  throw new TypeError(`Unknown installation settings baseline: ${selection}`);
}

function apiBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true") return null;
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

/** Server-backed clients use the API's profile; bundled settings are only a static-demo fallback. */
export async function loadInstallationConfiguration(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicInstallationConfiguration> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
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
  const response = await fetchImpl(`${baseUrl}/api/installation`, { cache: "no-store", credentials: "include" });
  if (!response.ok) throw new Error("Installation configuration is unavailable.");
  const result = await response.json() as PublicInstallationConfiguration;
  return { ...result, settings: parseInstallationSettings(result.settings) };
}
