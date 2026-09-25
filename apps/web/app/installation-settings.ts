import {
  DEFAULT_AGENCY_APPEARANCE,
  type AgencyAppearance,
  parseInstallationSettings,
  type InstallationSettings,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export function selectedInstallationSettings(): InstallationSettings {
  return parseInstallationSettings(production);
}

export function applyAgencyColors(appearance: AgencyAppearance, document: Document): void {
  document.documentElement.style.setProperty("--green", appearance.accentColor);
  document.documentElement.style.setProperty("--green-dark", appearance.accentDarkColor);
  document.documentElement.style.setProperty("--agency-pwa-background", appearance.pwaBackgroundColor);
}

export function applyAgencyAppearance(appearance: AgencyAppearance, document: Document): void {
  applyAgencyColors(appearance, document);
  document.title = appearance.pwaName;
  let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!theme) {
    theme = document.createElement("meta");
    theme.name = "theme-color";
    document.head.append(theme);
  }
  theme.content = appearance.browserThemeColor;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) manifest.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify({
    name: appearance.pwaName, short_name: appearance.pwaShortName,
    description: appearance.helperText, start_url: "./", scope: "./", display: "standalone",
    background_color: appearance.pwaBackgroundColor, theme_color: appearance.browserThemeColor,
  }))}`;
}

/** Server-backed clients use the API's profile; bundled settings are only a static-demo fallback. */
export async function loadInstallationConfiguration(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicInstallationConfiguration> {
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/installation", configuration);
  if (!url) {
    return { settings: selectedInstallationSettings(), appearance: { ...DEFAULT_AGENCY_APPEARANCE } };
  }
  const response = await fetchImpl(url, browserRequestInit());
  if (!response.ok) throw new Error("Installation configuration is unavailable.");
  const result = await response.json() as PublicInstallationConfiguration;
  return { ...result, settings: parseInstallationSettings(result.settings),
    appearance: result.appearance ?? { ...DEFAULT_AGENCY_APPEARANCE } };
}
