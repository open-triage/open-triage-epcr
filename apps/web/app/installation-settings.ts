import {
  DEFAULT_AGENCY_APPEARANCE,
  type AgencyAppearance,
  parseInstallationSettings,
  type InstallationSettings,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import production from "@open-triage/contracts/config/installation.production.json";
import { applyDocumentLanguage } from "./localization";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export function selectedInstallationSettings(): InstallationSettings {
  return parseInstallationSettings(production);
}

export const INSTALLATION_CONFIGURATION_STORAGE_KEY = "open-triage:installation-configuration-v1";
type ConfigurationStorage = Pick<Storage, "getItem" | "setItem">;

function cachedConfiguration(storage: ConfigurationStorage | undefined, endpoint: string): PublicInstallationConfiguration | null {
  if (!storage) return null;
  try {
    const envelope = JSON.parse(storage.getItem(INSTALLATION_CONFIGURATION_STORAGE_KEY) ?? "null") as {
      endpoint?: string; configuration?: PublicInstallationConfiguration;
    } | null;
    if (envelope?.endpoint !== endpoint || !envelope.configuration) return null;
    return { settings: parseInstallationSettings(envelope.configuration.settings),
      appearance: envelope.configuration.appearance ?? { ...DEFAULT_AGENCY_APPEARANCE } };
  } catch { return null; }
}

export function applyAgencyColors(appearance: AgencyAppearance, document: Document): void {
  document.documentElement.style.setProperty("--green", appearance.accentColor);
  document.documentElement.style.setProperty("--green-dark", appearance.accentDarkColor);
  document.documentElement.style.setProperty("--agency-pwa-background", appearance.pwaBackgroundColor);
}

export function applyAgencyAppearance(appearance: AgencyAppearance, document: Document, language: string = "en"): void {
  applyDocumentLanguage(language, document);
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
  storage: ConfigurationStorage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): Promise<PublicInstallationConfiguration> {
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/installation", configuration);
  if (!url) {
    return { settings: selectedInstallationSettings(), appearance: { ...DEFAULT_AGENCY_APPEARANCE } };
  }
  try {
    const response = await fetchImpl(url, browserRequestInit());
    if (!response.ok) throw new Error("Installation configuration is unavailable.");
    const result = await response.json() as PublicInstallationConfiguration;
    const configuration = { ...result, settings: parseInstallationSettings(result.settings),
      appearance: result.appearance ?? { ...DEFAULT_AGENCY_APPEARANCE } };
    try { storage?.setItem(INSTALLATION_CONFIGURATION_STORAGE_KEY, JSON.stringify({ endpoint: url, configuration })); }
    catch { /* Browsers with unavailable storage can still use the online configuration. */ }
    return configuration;
  } catch (error) {
    const cached = cachedConfiguration(storage, url);
    if (cached && (typeof navigator === "undefined" || navigator.onLine === false)) return cached;
    throw error;
  }
}
