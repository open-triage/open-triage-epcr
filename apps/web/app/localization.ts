import english from "../messages/en.json";
import swedish from "../messages/sv.json";

export type AgencyLanguage = "en" | "sv";
type Message = string | { one?: string; other: string };
type Dictionary = Record<string, Message>;
const dictionaries: Record<AgencyLanguage, Dictionary> = { en: english, sv: swedish };

/** Missing translations fall through to English; missing English keys stay visible. */
export function resolveMessage(language: AgencyLanguage, key: string,
  parameters: Record<string, string | number> = {}, count?: number): string {
  const selected = dictionaries[language][key] ?? dictionaries.en[key];
  if (!selected) return key;
  const english = dictionaries.en[key];
  const template = typeof selected === "string" ? selected :
    (count === 1 ? selected.one ?? (typeof english === "object" ? english.one : undefined) ?? selected.other : selected.other);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name: string) =>
    name in parameters ? String(parameters[name]) : name === "count" && count !== undefined ? String(count) : match);
}

export function applyDocumentLanguage(language: AgencyLanguage, document: Document): void {
  document.documentElement.lang = language;
}
