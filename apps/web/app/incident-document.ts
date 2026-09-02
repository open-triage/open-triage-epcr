import type { EncounterDocument, EncounterGroup, EncounterValue } from "@open-triage/contracts";
import { loadEncounterDocument } from "./encounter-document";
import { getNemsisDataElement } from "./nemsis-data-model";
import type { EncounterEvent } from "./standard-encounter";

export const INCIDENT_FIELD_LOCATIONS = {
  incidentNumber: { groupId: "eResponseSection", elementId: "eResponse.03" },
  responseNumber: { groupId: "eResponseSection", elementId: "eResponse.04" },
  complaint: { groupId: "eDispatchSection", elementId: "eDispatch.01" },
  crew: { groupId: "eCrew.CrewGroup", elementId: "eCrew.01" },
  streetAddress: { groupId: "eSceneSection", elementId: "eScene.15" },
  unit: { groupId: "eSceneSection", elementId: "eScene.16" },
} as const;

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

/** Phone-header projection of the canonical response, dispatch, crew, and scene elements. */
export function incidentSummary(document: EncounterDocument) {
  const incidentNumber = incidentValue(document, "incidentNumber");
  const responseNumber = incidentValue(document, "responseNumber");
  const streetAddress = incidentValue(document, "streetAddress");
  const unit = incidentValue(document, "unit");
  return {
    number: [incidentNumber, responseNumber].filter(Boolean).join(" · "),
    complaint: incidentValue(document, "complaint"),
    address: [streetAddress, unit].filter(Boolean).join(", "),
    crew: document.groups.find((group) => group.id === INCIDENT_FIELD_LOCATIONS.crew.groupId)?.instances
      .flatMap((instance) => instance.elements.find((element) => element.id === INCIDENT_FIELD_LOCATIONS.crew.elementId)?.values ?? [])
      .map(displayValue).filter(Boolean).join(", ") ?? "",
  };
}

/** Projects every catalog date/time value onto the timeline without dispatch-event configuration or category switches. */
export function documentTimeline(document: EncounterDocument): ReadonlyArray<EncounterEvent> {
  const entries = document.groups.flatMap((group) => group.instances.flatMap((instance) => instance.elements.flatMap((element) => {
    const catalogElement = getNemsisDataElement(element.id);
    if (!catalogElement || catalogElement.datatype.base !== "dateTime") return [];
    return element.values.flatMap((value) => {
      if (value.kind !== "scalar" || typeof value.value !== "string") return [];
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.value);
      if (!match) return [];
      return [{
        id: `document-${value.occurrenceId}`,
        date: match[1]!,
        time: match[2]!,
        kind: "document" as const,
        title: catalogElement.name.replace(/ Date\/Time$/, ""),
        detail: typeof value.attributes?.timelineDetail === "string" ? value.attributes.timelineDetail : "",
        reference: catalogElement.id,
      }];
    });
  })));
  return entries.sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
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
      timeElement("eTimes.01", "baseline-4", "psap-call-time-1"),
      timeElement("eTimes.03", "baseline-3", "unit-notified-time-1"),
      timeElement("eTimes.05", "baseline-2", "unit-en-route-time-1"),
      timeElement("eTimes.06", "baseline-1", "unit-arrived-scene-time-1"),
    ] }] },
  ];
  const updated = { ...source, groups: [...source.groups.filter(({ id }) => !INCIDENT_GROUP_IDS.has(id)), ...groups] };
  return loadEncounterDocument(updated, { formProfiles: { [updated.formProfile.id]: [updated.formProfile.version] } });
}
