import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import { getNemsisDataElement } from "./nemsis-data-model";
import type { EncounterEvent } from "./standard-encounter";
import { localStationaryDateTimeParts } from "./stationary-date-time";

export const INCIDENT_FIELD_LOCATIONS = {
  incidentNumber: { groupId: "eResponseSection", elementId: "eResponse.03" },
  responseNumber: { groupId: "eResponseSection", elementId: "eResponse.04" },
  callSign: { groupId: "eResponseSection", elementId: "eResponse.14" },
  dispatchReason: { groupId: "eDispatchSection", elementId: "eDispatch.01" },
  dispatchPriority: { groupId: "eDispatchSection", elementId: "eDispatch.05" },
  streetAddress: { groupId: "eSceneSection", elementId: "eScene.15" },
  apartment: { groupId: "eSceneSection", elementId: "eScene.16" },
  city: { groupId: "eSceneSection", elementId: "eScene.17" },
  state: { groupId: "eSceneSection", elementId: "eScene.18" },
  zip: { groupId: "eSceneSection", elementId: "eScene.19" },
} as const;

const OPERATIONAL_TIME_IDS = new Set([
  "eTimes.02", "eTimes.03", "eTimes.04", "eTimes.05", "eTimes.06", "eTimes.14", "eTimes.17",
]);

function valuesFor(document: EncounterDocument, groupId: string, elementId: string): ReadonlyArray<EncounterValue> {
  return document.groups.find((group) => group.id === groupId)?.instances.flatMap((instance) =>
    instance.elements.find((element) => element.id === elementId)?.values ?? [],
  ) ?? [];
}

function displayValue(value: EncounterValue | undefined): string {
  if (!value) return "";
  const pn = value.pertinentNegative ? ` — ${value.pertinentNegative.display ?? value.pertinentNegative.code}` : "";
  if (value.kind === "scalar") return `${String(value.value)}${pn}`;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "";
  if (value.kind === "coded") return `${value.display ?? value.code}${pn}`;
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  return "";
}

function incidentValue(document: EncounterDocument, field: keyof typeof INCIDENT_FIELD_LOCATIONS): string {
  const { groupId, elementId } = INCIDENT_FIELD_LOCATIONS[field];
  return displayValue(valuesFor(document, groupId, elementId)[0]);
}

/** eRecord.01 is assigned by the server and displayed without an editor. */
export function reportNumber(document: EncounterDocument): string {
  return displayValue(valuesFor(document, "eRecordSection", "eRecord.01")[0]);
}

/** Projects only the operational NEMSIS fields approved for the mobile encounter header. */
export function incidentSummary(document: EncounterDocument) {
  const streetAddress = incidentValue(document, "streetAddress");
  const apartment = incidentValue(document, "apartment");
  const locality = [incidentValue(document, "city"), incidentValue(document, "state"), incidentValue(document, "zip")]
    .filter(Boolean).join(" ");
  return {
    incidentNumber: incidentValue(document, "incidentNumber"),
    responseNumber: incidentValue(document, "responseNumber"),
    callSign: incidentValue(document, "callSign"),
    dispatchPriority: incidentValue(document, "dispatchPriority"),
    location: [[streetAddress, apartment].filter(Boolean).join(", "), locality].filter(Boolean).join(" · "),
  };
}

/** Assignment-card projection of the explicitly configured NEMSIS elements. */
export function assignmentSummary(document: EncounterDocument) {
  return {
    incidentNumber: incidentValue(document, "incidentNumber"),
    callSign: incidentValue(document, "callSign"),
    unitNotifiedAt: displayValue(valuesFor(document, "eTimesSection", "eTimes.03")[0]),
    dispatchReason: incidentValue(document, "dispatchReason") || "Dispatch reason not provided",
    dispatchPriority: incidentValue(document, "dispatchPriority") || "Priority not provided",
  };
}

/** Present operational instants in the browser's local time without changing their stored offsets. */
export function documentTimeline(document: EncounterDocument, zone: string | null = null): ReadonlyArray<EncounterEvent> {
  const entries = document.groups.flatMap((group) => group.instances.flatMap((instance) => instance.elements.flatMap((element) => {
    if (!OPERATIONAL_TIME_IDS.has(element.id)) return [];
    const catalogElement = getNemsisDataElement(element.id);
    if (!catalogElement) return [];
    return element.values.flatMap((value) => {
      if (value.kind !== "scalar" || typeof value.value !== "string") return [];
      if (Number.isNaN(Date.parse(value.value))) return [];
      const presented = localStationaryDateTimeParts(value.value, zone);
      if (!presented) return [];
      return [{
        id: `document-${value.occurrenceId}`,
        date: presented.date, time: presented.time,
        dateTime: value.value,
        kind: "document" as const,
        title: catalogElement.name.replace(/ Date\/Time$/, ""),
        detail: "",
        reference: catalogElement.id,
      }];
    });
  })));
  return entries.sort((a, b) => Date.parse(b.dateTime ?? "") - Date.parse(a.dateTime ?? ""));
}
