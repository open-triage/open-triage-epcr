import { SUPPORTED_UI_LANGUAGES } from "@open-triage/contracts";
import { MESSAGE_DICTIONARIES } from "./message-dictionaries.generated";

export type AgencyLanguage = string;
type Message = string | { one?: string; other: string };
type Dictionary = Record<string, Message>;
const dictionaries: Record<string, Dictionary> = MESSAGE_DICTIONARIES;

/** UI languages are discovered from apps/web/messages/*.json at build time. */
export const availableUiLanguages = SUPPORTED_UI_LANGUAGES;

export function languageDisplayName(language: string, displayLanguage: string): string {
  try {
    const locale = dictionaries[displayLanguage] ? displayLanguage : "en";
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch { return language; }
}

/** Missing translations fall through to English; missing English keys stay visible. */
export function resolveMessage(language: AgencyLanguage, key: string,
  parameters: Record<string, string | number> = {}, count?: number): string {
  const selected = dictionaries[language]?.[key] ?? dictionaries.en?.[key];
  if (!selected) return key;
  const english = dictionaries.en?.[key];
  const template = typeof selected === "string" ? selected :
    (count === 1 ? selected.one ?? (typeof english === "object" ? english.one : undefined) ?? selected.other : selected.other);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name: string) =>
    name in parameters ? String(parameters[name]) : name === "count" && count !== undefined ? String(count) : match);
}

export function applyDocumentLanguage(language: AgencyLanguage, document: Document): void {
  document.documentElement.lang = dictionaries[language] ? language : "en";
}

/** Translate application error copy; unrecognized server detail uses a safe localized fallback. */
export function resolveErrorMessage(language: AgencyLanguage, message: string | null | undefined, fallbackKey: string): string {
  if (!message) return resolveMessage(language, fallbackKey);
  const entry = Object.entries(dictionaries.en ?? {}).find(([, value]) => value === message);
  if (entry) return resolveMessage(language, entry[0]);
  return language === "en" ? message : resolveMessage(language, fallbackKey);
}
