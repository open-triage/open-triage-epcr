import type { CatalogDraftDefinition } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL, getNemsisGroup } from "./nemsis-data-model";
import swedishCatalog from "../../../defines/localization/localization_sv.json";

export function fixedGroupName(groupId: string, language: "en" | "sv"): string {
  const group = getNemsisGroup(groupId);
  if (language === "en") return group?.name ?? groupId;
  const translations = swedishCatalog.catalog.groups as Record<string, { name: string }>;
  return translations[groupId]?.name || group?.name || groupId;
}

export function customCorrelationOptions(definition: CatalogDraftDefinition) {
  const visible = definition.elements.filter((element) => !definition.hiddenElementIds?.includes(element.elementId));
  return NEMSIS_DATA_MODEL.groups.filter((group) => group.repeating && group.id !== "PatientCareReportGroup" &&
    group.path.includes("PatientCareReportGroup") && visible.some((element) => element.storageSemantics.groupPath.includes(group.id)));
}

export function customCorrelationLabel(groupId: string | undefined, language: "en" | "sv"): string {
  if (!groupId) return language === "sv" ? "Patientrapport" : "Patient report";
  return fixedGroupName(groupId, language);
}

export function customSpecialOptions(definition: CatalogDraftDefinition, elementId: string) {
  return definition.codeLists.flatMap((list) => list.elementIds.includes(elementId) ? list.values.filter((value) => value.enabled) : []);
}
