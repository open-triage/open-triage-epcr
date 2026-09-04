import type { EncounterDocument, EncounterGroup, EncounterValue } from "@open-triage/contracts";
import { loadEncounterDocument } from "./encounter-document";
import { getNemsisDataElement } from "./nemsis-data-model";
import type { EncounterEvent } from "./standard-encounter";

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

export const DEFAULT_AGENCY_TIME_ZONE = "America/New_York";
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
  if (value.kind === "scalar") return String(value.value);
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "";
  if (value.kind === "coded" || value.kind === "pertinent-negative") return value.display ?? value.code;
  return "";
}

function incidentValue(document: EncounterDocument, field: keyof typeof INCIDENT_FIELD_LOCATIONS): string {
  const { groupId, elementId } = INCIDENT_FIELD_LOCATIONS[field];
  return displayValue(valuesFor(document, groupId, elementId)[0]);
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

export function agencyDateTimeParts(value: string, timeZone = DEFAULT_AGENCY_TIME_ZONE): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid operational timestamp: ${value}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

/** Projects only configured operational times in agency time, retaining source lexical offsets. */
export function documentTimeline(document: EncounterDocument, timeZone = DEFAULT_AGENCY_TIME_ZONE): ReadonlyArray<EncounterEvent> {
  const entries = document.groups.flatMap((group) => group.instances.flatMap((instance) => instance.elements.flatMap((element) => {
    if (!OPERATIONAL_TIME_IDS.has(element.id)) return [];
    const catalogElement = getNemsisDataElement(element.id);
    if (!catalogElement) return [];
    return element.values.flatMap((value) => {
      if (value.kind !== "scalar" || typeof value.value !== "string") return [];
      const presented = agencyDateTimeParts(value.value, timeZone);
      return [{
        id: `document-${value.occurrenceId}`,
        ...presented,
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

const INCIDENT_GROUP_IDS = new Set(["eResponseSection", "eDispatchSection", "eCrew.CrewGroup", "eSceneSection", "eTimesSection"]);

type LegacyIncidentState = {
  readonly crew: unknown;
  readonly incident: unknown;
  readonly events: ReadonlyArray<Record<string, unknown>>;
};

/** Deterministically upgrades the one previously supported incident shape. */
export function migrateLegacyIncidentDocument(source: EncounterDocument, legacy: LegacyIncidentState): EncounterDocument {
  if (typeof legacy.crew !== "string" || legacy.crew.length < 2 || !legacy.incident || typeof legacy.incident !== "object") {
    throw new Error("saved incident data does not match the supported legacy shape");
  }
  const incident = legacy.incident as Record<string, unknown>;
  if ([incident.number, incident.complaint, incident.address].some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("saved incident data does not match the supported legacy shape");
  }
  const [incidentNumber = "", responseNumber = ""] = (incident.number as string).split(" · ", 2);
  const scalar = (occurrenceId: string, value: string, attributes?: Record<string, string>) => ({ kind: "scalar" as const, occurrenceId, value, ...(attributes ? { attributes } : {}) });
  const coded = (occurrenceId: string, code: string, display: string) => ({ kind: "coded" as const, occurrenceId, code, display });
  const eventById = new Map(legacy.events.map((event) => [event.id, event]));
  const timeElement = (id: string, legacyId: string, occurrenceId: string) => {
    const event = eventById.get(legacyId);
    if (!event || typeof event.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) {
      throw new Error("saved incident timeline does not match the supported legacy shape");
    }
    const date = typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : "2026-04-18";
    return { id, values: [scalar(occurrenceId, `${date}T${event.time}:00-04:00`, typeof event.detail === "string" ? { timelineDetail: event.detail } : undefined)] };
  };
  const groups: EncounterGroup[] = [
    { id: "eResponseSection", instances: [{ instanceId: "response-1", elements: [
      { id: "eResponse.03", values: [scalar("incident-number-1", incidentNumber)] },
      ...(responseNumber ? [{ id: "eResponse.04", values: [scalar("response-number-1", responseNumber)] }] : []),
      { id: "eResponse.14", values: [scalar("call-sign-1", legacy.crew)] },
    ] }] },
    { id: "eDispatchSection", instances: [{ instanceId: "dispatch-1", elements: [
      { id: "eDispatch.01", values: [coded("dispatch-reason-1", "2301051", incident.complaint as string)] },
      { id: "eDispatch.02", values: [coded("emd-1", "2302005", "Yes, Without Pre-Arrival Instructions")] },
      { id: "eDispatch.05", values: [coded("dispatch-priority-1", "2305005", "Routine response")] },
      ...(responseNumber ? [{ id: "eDispatch.06", values: [scalar("cad-record-1", responseNumber)] }] : []),
    ] }] },
    { id: "eCrew.CrewGroup", instances: [{ instanceId: "crew-1", elements: [{ id: "eCrew.01", values: [scalar("crew-member-1", legacy.crew)] }] }] },
    { id: "eSceneSection", instances: [{ instanceId: "scene-1", elements: [{ id: "eScene.15", values: [scalar("street-address-1", incident.address as string)] }] }] },
    { id: "eTimesSection", instances: [{ instanceId: "times-1", elements: [
      timeElement("eTimes.02", "baseline-4", "dispatch-time-1"),
      timeElement("eTimes.03", "baseline-3", "unit-notified-time-1"),
      timeElement("eTimes.05", "baseline-2", "unit-en-route-time-1"),
      timeElement("eTimes.06", "baseline-1", "unit-arrived-scene-time-1"),
    ] }] },
  ];
  const updated = { ...source, groups: [...source.groups.filter(({ id }) => !INCIDENT_GROUP_IDS.has(id)), ...groups] };
  return loadEncounterDocument(updated, { formProfiles: { [updated.formProfile.id]: [updated.formProfile.version] } });
}
