import { resolveMessage, type AgencyLanguage } from "./localization";

type ErrorBody = { code?: unknown; params?: unknown; message?: unknown; findings?: unknown };

export class PlatformRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "PlatformRequestError"; }
}

function currentLanguage(): AgencyLanguage {
  return typeof document !== "undefined" && document.documentElement.lang === "sv" ? "sv" : "en";
}

export function platformErrorMessage(body: ErrorBody, status: number, language: AgencyLanguage = currentLanguage()): string {
  const code = typeof body.code === "string" && /^[a-z][a-zA-Z0-9.]{0,99}$/.test(body.code)
    ? body.code : `legacy.http${status}`;
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? Object.fromEntries(Object.entries(body.params).filter((entry): entry is [string, string | number] =>
      /^[a-zA-Z][a-zA-Z0-9]*$/.test(entry[0]) && (typeof entry[1] === "string" || typeof entry[1] === "number"))) : {};
  const key = `platform.error.${code}`;
  const translated = resolveMessage(language, key, params);
  if (translated !== key) return translated;
  const category = code.match(/^([a-z]+)\.http(\d{3})$/);
  if (category) {
    const domainKey = `platform.domain.${category[1]}`;
    const domain = resolveMessage(language, domainKey);
    const statusKey = `platform.status.${category[2]}`;
    const statusMessage = resolveMessage(language, statusKey);
    if (domain !== domainKey && statusMessage !== statusKey) {
      return resolveMessage(language, "platform.error.generic", { domain, reason: statusMessage });
    }
  }
  return resolveMessage(language, "platform.error.unknown", { code });
}

/** Do not display legacy server prose: it may contain free text or private data. */
export async function platformRequestError(response: Response, language?: AgencyLanguage): Promise<PlatformRequestError> {
  let body: ErrorBody = {};
  try { body = await response.clone().json() as ErrorBody; } catch { /* Legacy or non-JSON error. */ }
  const code = typeof body.code === "string" ? body.code : `legacy.http${response.status}`;
  return new PlatformRequestError(code, response.status, platformErrorMessage(body, response.status, language));
}
