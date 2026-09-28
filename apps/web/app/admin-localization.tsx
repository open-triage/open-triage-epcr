"use client";

import { createContext, useCallback, useContext } from "react";
import { resolveErrorMessage, resolveMessage, type AgencyLanguage } from "./localization";
import { PlatformRequestError } from "./platform-errors";
import englishMessages from "../messages/en.json";

export const AdminLanguageContext = createContext<AgencyLanguage>("en");

const adminKeysByEnglish = new Map(Object.entries(englishMessages)
  .filter(([key, value]) => key.startsWith("admin.") && typeof value === "string")
  .map(([key, value]) => [value as string, key]));

function adminKey(messageOrKey: string): string {
  return messageOrKey.startsWith("admin.") ? messageOrKey : adminKeysByEnglish.get(messageOrKey) ?? messageOrKey;
}

/** Administration copy uses the agency language. Definition text is rendered separately. */
export function useAdminText() {
  const language = useContext(AdminLanguageContext);
  return useCallback((messageOrKey: string, parameters?: Record<string, string | number>) => {
    const key = adminKey(messageOrKey);
    const translated = resolveMessage(language, key, parameters);
    return translated === key ? messageOrKey.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
      (match, name: string) => parameters && name in parameters ? String(parameters[name]) : match) : translated;
  }, [language]);
}

export function AdminText({ messageKey, parameters }: {
  readonly messageKey: string;
  readonly parameters?: Record<string, string | number>;
}) {
  const t = useAdminText();
  return t(messageKey, parameters);
}

/** Server exception prose is not localized; Swedish screens show a safe operation summary. */
export function useAdminError() {
  const language = useContext(AdminLanguageContext);
  return useCallback((reason: unknown, fallbackKey: string) =>
    reason instanceof PlatformRequestError ? reason.message :
      resolveErrorMessage(language, reason instanceof Error ? reason.message : null, adminKey(fallbackKey)), [language]);
}

/** Stable capability keys identify translated descriptions; grants keep using those keys. */
export function useAdminCapabilityText() {
  const language = useContext(AdminLanguageContext);
  return useCallback((key: string, description: string) => {
    if (language === "en") return description;
    const messageKey = `admin.capability.${key}`;
    const localized = resolveMessage(language, messageKey);
    return localized === messageKey ? description : localized;
  }, [language]);
}
