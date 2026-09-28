// Generated from apps/web/messages/*.json. Run npm run build -w @open-triage/contracts.
export const SUPPORTED_UI_LANGUAGES: readonly string[] = ["en","sv"];
export function isSupportedUiLanguage(value: unknown): value is string {
  return typeof value === "string" && SUPPORTED_UI_LANGUAGES.includes(value);
}
