import type { ClinicalFormConfiguration } from "@open-triage/contracts";

/** Resolves text only from the catalog version pinned to the open report. */
export function resolveCatalogElementText(
  field: Pick<ClinicalFormConfiguration["catalogFields"][string], "name" | "description" | "localization"> | undefined,
  elementId: string,
  language: string,
  kind: "label" | "description",
): string {
  const translated = language === "sv" ? field?.localization?.sv?.[kind] : undefined;
  const english = kind === "label" ? field?.name : field?.description;
  return translated?.trim() || english?.trim() || elementId;
}

export function currentCatalogLanguage(): "en" | "sv" {
  return typeof document !== "undefined" && document.documentElement.lang === "sv" ? "sv" : "en";
}

/** Prefer pinned group translations and retain the layout label for older configurations. */
export function resolveCatalogGroupText(
  groups: ClinicalFormConfiguration["catalogGroups"], groupId: string, language: string, fallback: string,
): string {
  const group = groups?.[groupId];
  return (language === "sv" ? group?.localization?.sv?.name?.trim() : undefined)
    || group?.name?.trim() || fallback;
}
