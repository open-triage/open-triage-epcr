"use client";

import { createContext, useCallback, useContext } from "react";
import { resolveMessage, type AgencyLanguage } from "./localization";

export const AdminLanguageContext = createContext<AgencyLanguage>("en");

/** Administration copy uses the agency language. Definition text is rendered separately. */
export function useAdminText() {
  const language = useContext(AdminLanguageContext);
  return useCallback((english: string, parameters?: Record<string, string | number>) => {
    const key = `admin.${english}`;
    const translated = resolveMessage(language, key, parameters);
    return translated === key ? english.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
      (match, name: string) => parameters && name in parameters ? String(parameters[name]) : match) : translated;
  }, [language]);
}

export function AdminText({ english, parameters }: {
  readonly english: string;
  readonly parameters?: Record<string, string | number>;
}) {
  const t = useAdminText();
  return t(english, parameters);
}

/** Server exception prose is not localized; Swedish screens show a safe operation summary. */
export function useAdminError() {
  const language = useContext(AdminLanguageContext);
  const t = useAdminText();
  return useCallback((reason: unknown, englishFallback: string) =>
    language === "sv" ? t(englishFallback) : reason instanceof Error ? reason.message : t(englishFallback), [language, t]);
}
