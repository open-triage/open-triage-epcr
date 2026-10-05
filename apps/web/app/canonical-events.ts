import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import { clinicianOwnedAttributes, DEMO_FALLBACK_DATE, hasDemoProvenance, withoutDemoProvenance } from "./demo-provenance";
import { stableDraftId } from "./draft-report";
import type { EncounterDefinition } from "./encounter-definition";
import { getNemsisDataElement, resolveNemsisElementValues, requireNemsisDataElement } from "./nemsis-data-model";
import type { EncounterEvent, MedicationAdministration, VitalValues } from "./standard-encounter";
import { localStationaryDateTimeParts, stationaryLocalDateTimeInput } from "./stationary-date-time";

const OWNER = "x-open-triage-owner";
const DOCUMENTED_TIME = "documentedTime";
const eventGroups = new Set([
  "eVitals.VitalGroup", "eMedications.MedicationGroup",
  "eMedications.DosageGroup", "eProcedures.ProcedureGroup",
]);
const eventSections = {
  vitals: "eVitalsSection",
  procedure: "eProceduresSection",
  medication: "eMedicationsSection",
} as const;

function timestamp(document: EncounterDocument, event: EncounterEvent, zone: string | null): string {
  const existing = document.groups.flatMap(({ instances }) => instances).find(({ instanceId }) => instanceId === event.id);
  const timeElement = event.vitals ? "eVitals.01" : event.procedure ? "eProcedures.01" : "eMedications.01";
  const original = existing ? scalar(existing, timeElement) || String(existing.attributes?.[DOCUMENTED_TIME] ?? "") : event.dateTime;
  const local = original ? localStationaryDateTimeParts(original, zone) : undefined;
  // Retain seconds and the original instant when another field is edited,
  // including the second occurrence of an ambiguous autumn DST wall clock.
  if (original && local && local.date === event.date && local.time === event.time) return original;
  // Quick capture intentionally retains incomplete/invalid values for review.
  // They do not describe an instant, so do not normalize them into a valid time.
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time.slice(0, 5))) {
    return `${event.date ?? DEMO_FALLBACK_DATE}T${event.time.slice(0, 5)}:00+00:00`;
  }
  return stationaryLocalDateTimeInput(event.date ?? DEMO_FALLBACK_DATE, event.time.slice(0, 5), zone,
    event.dateTime && local?.date === event.date && local?.time === event.time ? new Date(event.dateTime).toISOString() : undefined);
}

function dateAndTime(value: unknown, zone: string | null): { date: string; time: string; dateTime: string } {
  const lexical = typeof value === "string" ? value : `${DEMO_FALLBACK_DATE}T00:00:00Z`;
  const local = localStationaryDateTimeParts(lexical, zone);
  return { date: local?.date ?? lexical.slice(0, 10), time: local?.time ?? lexical.slice(11, 16), dateTime: lexical };
}

function element(instance: EncounterGroupInstance, id: string) {
  return instance.elements.find((candidate) => candidate.id === id);
}

function scalar(instance: EncounterGroupInstance, id: string): string {
  const value = element(instance, id)?.values[0];
  return value?.kind === "scalar" ? String(value.value) : "";
}

function instanceForElement(document: EncounterDocument, root: EncounterGroupInstance, elementId: string): EncounterGroupInstance | undefined {
  const targetGroupId = getNemsisDataElement(elementId)?.groupPath.at(-1) ?? "eVitals.VitalGroup";
  if (!targetGroupId || targetGroupId === "eVitals.VitalGroup") return root;
  const byId = new Map(document.groups.flatMap(({ instances }) => instances.map((instance) => [instance.instanceId, instance] as const)));
  return document.groups.find(({ id }) => id === targetGroupId)?.instances.find((candidate) => {
    let parentId = candidate.parentInstanceId;
    while (parentId) {
      if (parentId === root.instanceId) return true;
      parentId = byId.get(parentId)?.parentInstanceId;
    }
    return false;
  });
}

function coded(instance: EncounterGroupInstance, id: string): { code: string; display: string; system?: string; attributes?: Readonly<Record<string, string | number | boolean | null>> } | null {
  const value = element(instance, id)?.values[0];
  return value?.kind === "coded" ? { code: value.code, display: value.display ?? value.code, system: value.system, attributes: value.attributes } : null;
}

function clinician(instance: EncounterGroupInstance): boolean {
  return instance.attributes?.[OWNER] === "clinician";
}

function documented(instance: EncounterGroupInstance): boolean {
  return clinician(instance) || hasDemoProvenance(instance.attributes);
}

function owned(instanceId: string, documentedTime: string, elements: EncounterGroupInstance["elements"], parentInstanceId?: string): EncounterGroupInstance {
  return {
    instanceId,
    ...(parentInstanceId ? { parentInstanceId } : {}),
    attributes: { [OWNER]: "clinician", [DOCUMENTED_TIME]: documentedTime },
    elements,
  };
}

function eventSection(event: EncounterEvent): string | undefined {
  if (event.vitals) return eventSections.vitals;
  if (event.procedure) return eventSections.procedure;
  if (event.medication) return eventSections.medication;
  return undefined;
}

/** Ensures mobile-authored event groups have the canonical section ancestry expected by Populate. */
function ensureEventSection(document: EncounterDocument, event: EncounterEvent): EncounterDocument {
  const groupId = eventSection(event);
  if (!groupId || document.groups.find(({ id }) => id === groupId)?.instances.length) return document;
  const parentInstanceId = document.groups.find(({ id }) => id === "PatientCareReportGroup")?.instances[0]?.instanceId;
  const instance: EncounterGroupInstance = {
    instanceId: stableDraftId(document.encounter.id, `canonical-event-section:${groupId}:${parentInstanceId ?? "root"}`),
    ...(parentInstanceId ? { parentInstanceId } : {}),
    elements: [],
  };
  const existing = document.groups.find(({ id }) => id === groupId);
  const groups = existing
    ? document.groups.map((group) => group === existing ? { ...group, instances: [...group.instances, instance] } : group)
    : [...document.groups, { id: groupId, instances: [instance] }];
  return { ...document, groups };
}

function eventSectionInstanceId(document: EncounterDocument, event: EncounterEvent): string | undefined {
  const groupId = eventSection(event);
  return groupId ? document.groups.find(({ id }) => id === groupId)?.instances[0]?.instanceId : undefined;
}

function optionCode(elementId: string, label: string) {
  return resolveNemsisElementValues(requireNemsisDataElement(elementId)).permissibleValues
    .find((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
}

function scalarValue(elementId: string, value: string): string | number {
  const base = getNemsisDataElement(elementId)?.datatype.base;
  return base && ["integer", "decimal", "double", "float"].includes(base) ? Number(value) : value;
}

function vitalDetail(values: VitalValues, definition: EncounterDefinition): string {
  return definition.events.vitals.summary.map((item) => {
    if (!item.fields.some((field) => values[field] || values.nullValues[field])) return null;
    return `${item.label} ${item.fields.map((field) => values[field] || (values.nullValues[field] ? definition.events.vitals.labels.absentSummary : "—")).join(item.separator)}${item.unit}`;
  }).filter(Boolean).join(" · ");
}

function eventInstances(document: EncounterDocument, event: EncounterEvent, definition: EncounterDefinition, observedAt: string): ReadonlyArray<{ groupId: string; instance: EncounterGroupInstance }> {
  const sectionInstanceId = eventSectionInstanceId(document, event);
  if (event.vitals) {
    const rootElements: Array<{ id: string; values: EncounterValue[] }> = [{
      id: "eVitals.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: observedAt }],
    }];
    const nestedElements = new Map<string, Array<{ id: string; values: EncounterValue[] }>>();
    definition.events.vitals.fields.forEach((field) => {
      const raw = event.vitals![field.id];
      const absence = event.vitals!.nullValues?.[field.id];
      const targetGroupId = getNemsisDataElement(field.reference)?.groupPath.at(-1) ?? "eVitals.VitalGroup";
      const elements = targetGroupId === "eVitals.VitalGroup" ? rootElements : nestedElements.get(targetGroupId) ?? [];
      if (raw) elements.push({ id: field.reference, values: [{ kind: "scalar", occurrenceId: `${event.id}:${field.reference}`, value: scalarValue(field.reference, raw) }] });
      else if (absence) {
        const pertinent = field.absenceStates.find((item) => item.code === absence)?.kind === "PN";
        elements.push({ id: field.reference, values: [pertinent
          ? { kind: "pertinent-negative", occurrenceId: `${event.id}:${field.reference}`, code: absence }
          : { kind: "null", occurrenceId: `${event.id}:${field.reference}`, notValue: { code: absence } }] });
      }
      if (targetGroupId !== "eVitals.VitalGroup") nestedElements.set(targetGroupId, elements);
    });
    return [
      { groupId: "eVitals.VitalGroup", instance: owned(event.id, observedAt, rootElements, sectionInstanceId) },
      ...[...nestedElements].map(([groupId, elements]) => ({
        groupId,
        instance: owned(`${event.id}:${groupId}`, observedAt, elements, event.id),
      })),
    ];
  }
  if (event.procedure) {
    const procedure = event.procedure;
    const success = definition.events.procedure.successOptions.find(({ value }) => value === procedure.success);
    const outcome = definition.events.procedure.outcomeOptions.find(({ value }) => value === procedure.outcome);
    return [{ groupId: "eProcedures.ProcedureGroup", instance: owned(event.id, observedAt, [
      { id: "eProcedures.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: observedAt }] },
      { id: "eProcedures.03", values: [{ kind: "coded", occurrenceId: `${event.id}:procedure`, code: procedure.code, system: "SNOMED-CT", display: procedure.label, attributes: { warningAcknowledged: procedure.warningAcknowledged } }] },
      ...(procedure.attempts === "" ? [] : [{ id: "eProcedures.05", values: [{ kind: "scalar" as const, occurrenceId: `${event.id}:attempts`, value: procedure.attempts }] }]),
      ...(success ? [{ id: "eProcedures.06", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:success`, code: success.code, display: success.label }] }] : []),
      ...(outcome ? [{ id: "eProcedures.08", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:outcome`, code: outcome.code, display: outcome.label }] }] : []),
      ...(procedure.complications.length ? [{ id: "eProcedures.07", values: procedure.complications.map((code, index) => ({ kind: "coded" as const, occurrenceId: `${event.id}:complication:${index}`, code })) }] : []),
    ], sectionInstanceId) }];
  }
  if (event.medication) {
    const medication = event.medication;
    const route = optionCode("eMedications.04", medication.route.replace(/^.*?—\s*/, "")) ?? optionCode("eMedications.04", medication.route);
    const unit = optionCode("eMedications.06", medication.unit);
    const response = optionCode("eMedications.07", medication.response);
    return [
      { groupId: "eMedications.MedicationGroup", instance: owned(event.id, observedAt, [
        { id: "eMedications.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: observedAt }] },
        { id: "eMedications.03", values: [{ kind: "coded", occurrenceId: `${event.id}:medication`, code: medication.medicationCode, system: medication.codeType, display: medication.label, attributes: { dose: medication.dose, unit: medication.unit, route: medication.route, response: medication.response, warningAcknowledged: medication.warningAcknowledged } }] },
        ...(route ? [{ id: "eMedications.04", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:route`, code: route.code, display: route.label }] }] : []),
        ...(response ? [{ id: "eMedications.07", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:response`, code: response.code, display: response.label }] }] : []),
      ], sectionInstanceId) },
      { groupId: "eMedications.DosageGroup", instance: owned(`${event.id}:dosage`, observedAt, [
        ...(medication.dose ? [{ id: "eMedications.05", values: [{ kind: "scalar" as const, occurrenceId: `${event.id}:dose`, value: Number(medication.dose) }] }] : []),
        ...(unit ? [{ id: "eMedications.06", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:unit`, code: unit.code, display: unit.label }] }] : []),
      ], event.id) },
    ];
  }
  return [];
}

type EventSources = Map<string, Map<string, EncounterGroupInstance>>;

function sameValue(a: EncounterValue, b: EncounterValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "scalar" && b.kind === "scalar") return a.value === b.value;
  if (a.kind === "coded" && b.kind === "coded") return a.code === b.code && a.system === b.system;
  if (a.kind === "pertinent-negative" && b.kind === "pertinent-negative") return a.code === b.code;
  if (a.kind === "null" && b.kind === "null") return JSON.stringify(a.notValue) === JSON.stringify(b.notValue);
  return false;
}

/** Merge the dialog's projection into its source occurrences, never replace the stored subtree. */
export function saveCanonicalEvent(document: EncounterDocument, event: EncounterEvent, definition: EncounterDefinition, zone: string | null = null): EncounterDocument {
  if (event.kind === "note") return document;
  document = ensureEventSection(document, event);
  const updatedAt = timestamp(document, event, zone);
  const sources: EventSources = new Map();
  const previousEvent = readEncounterEvents(document, definition, zone, sources).find(({ id }) => id === event.id);
  const before = previousEvent ? eventInstances(document, previousEvent, definition, timestamp(document, previousEvent, zone)) : [];
  const after = eventInstances(document, event, definition, updatedAt);
  let groups = document.groups;
  const occurrenceIds = new Set(document.groups.flatMap(({ instances }) => instances.flatMap(({ elements }) =>
    elements.flatMap(({ values }) => values.map(({ occurrenceId }) => occurrenceId)))));
  // Include formerly projected groups so clearing a field removes only its represented values.
  for (const groupId of new Set([...before, ...after].map((item) => item.groupId))) {
    const previousProjection = before.find((item) => item.groupId === groupId)?.instance;
    const generated = after.find((item) => item.groupId === groupId)?.instance;
    const current = sources.get(event.id)?.get(groupId);
    if (!generated && !current) continue;
    const managed = new Set([...(previousProjection?.elements ?? []), ...(generated?.elements ?? [])].map(({ id }) => id));
    const replacements = new Map([...managed].map((id) => {
      const stored = current?.elements.find((element) => element.id === id);
      const projected = previousProjection?.elements.find((element) => element.id === id);
      const next = generated?.elements.find((element) => element.id === id);
      const representedIds = new Set<string>();
      const represented = (projected?.values ?? []).flatMap((value, index) => {
        const source = stored?.values.find((candidate) => !representedIds.has(candidate.occurrenceId) && sameValue(candidate, value))
          ?? stored?.values[index];
        if (!source || representedIds.has(source.occurrenceId)) return [];
        representedIds.add(source.occurrenceId);
        return [source];
      });
      const used = new Set<string>();
      const values = (next?.values ?? []).map((value, index) => {
        // Match unchanged selections before falling back to position for single-value edits.
        const previous = represented.find((candidate) => !used.has(candidate.occurrenceId) && sameValue(candidate, value))
          ?? (represented.length === 1 && next?.values.length === 1 ? represented[index] : undefined);
        if (!previous) {
          let occurrenceId = value.occurrenceId;
          let suffix = 0;
          while (occurrenceIds.has(occurrenceId)) {
            occurrenceId = stableDraftId(document.encounter.id, `canonical-value:${value.occurrenceId}:${++suffix}`);
          }
          occurrenceIds.add(occurrenceId);
          return { ...value, occurrenceId };
        }
        used.add(previous.occurrenceId);
        const attributes = { ...withoutDemoProvenance(previous.attributes), ...value.attributes };
        return { ...(sameValue(previous, value) ? previous : value), occurrenceId: previous.occurrenceId,
          attributes: Object.keys(attributes).length ? attributes : undefined };
      });
      // Values outside the projection belong to other documentation.
      values.push(...(stored?.values.filter(({ occurrenceId }) => !representedIds.has(occurrenceId)) ?? []));
      return [id, values.length ? { ...stored, ...next, id, values } : undefined] as const;
    }));
    const elements = (current?.elements ?? []).flatMap((element) => {
      if (!managed.has(element.id)) return [element];
      const replacement = replacements.get(element.id);
      replacements.delete(element.id);
      return replacement ? [replacement] : [];
    });
    const instance: EncounterGroupInstance = { ...current, ...generated,
      instanceId: current?.instanceId ?? generated!.instanceId,
      parentInstanceId: current?.parentInstanceId ?? generated?.parentInstanceId,
      attributes: { ...clinicianOwnedAttributes(current?.attributes), ...generated?.attributes },
      elements: [...elements, ...[...replacements.values()].filter((item) => item !== undefined)] };
    const group = groups.find(({ id }) => id === groupId);
    groups = group ? groups.map((item) => item !== group ? item : { ...group,
      instances: current ? group.instances.map((item) => item === current ? instance : item) : [...group.instances, instance] })
      : [...groups, { id: groupId, instances: [instance] }];
  }
  return { ...document, encounter: { ...document.encounter, updatedAt }, groups };
}

/** Recover legacy queued edits identified by regenerated projection occurrence identities. */
export function repairRecreatedCanonicalEvents(document: EncounterDocument, baseline: EncounterDocument,
  definition: EncounterDefinition, zone: string | null = null): EncounterDocument {
  const baselineSources: EventSources = new Map();
  readEncounterEvents(baseline, definition, zone, baselineSources);
  const localSources: EventSources = new Map();
  for (const event of readEncounterEvents(document, definition, zone, localSources)) {
    const comparable = eventInstances(document, event, definition, timestamp(document, event, zone)).flatMap(({ groupId, instance }) =>
      instance.elements.flatMap((element) => element.values.flatMap((value, index) => {
        const oldId = baselineSources.get(event.id)?.get(groupId)?.elements.find(({ id }) => id === element.id)?.values[index]?.occurrenceId;
        const localId = localSources.get(event.id)?.get(groupId)?.elements.find(({ id }) => id === element.id)?.values[index]?.occurrenceId;
        return oldId && localId ? [{ oldId, localId, generatedId: value.occurrenceId }] : [];
      })));
    // A legacy replacement regenerates the whole projection. A newly added value alone is not evidence.
    if (!comparable.some(({ oldId, localId }) => oldId !== localId) ||
      !comparable.every(({ localId, generatedId }) =>
        [generatedId, stableDraftId(document.encounter.id, `occurrence:${generatedId}`)].includes(localId))) continue;
    const repaired = saveCanonicalEvent(baseline, event, definition, zone);
    const localIds = eventSubtreeIds(document, event.id);
    const repairedIds = eventSubtreeIds(repaired, event.id);
    const groups = document.groups.map((group) => ({ ...group,
      instances: group.instances.filter(({ instanceId }) => !localIds.has(instanceId) && !repairedIds.has(instanceId)) }));
    for (const group of repaired.groups) {
      const instances = group.instances.filter(({ instanceId }) => repairedIds.has(instanceId));
      if (!instances.length) continue;
      const target = groups.find(({ id }) => id === group.id);
      if (target) {
        const position = group.instances.findIndex(({ instanceId }) => repairedIds.has(instanceId));
        target.instances.splice(Math.min(position, target.instances.length), 0, ...instances);
      }
      else groups.push({ ...group, instances });
    }
    document = { ...document, groups };
  }
  return document;
}

export function removeCanonicalEvent(document: EncounterDocument, eventId: string): EncounterDocument {
  const removedIds = eventSubtreeIds(document, eventId);
  return {
    ...document,
    encounter: { ...document.encounter },
    groups: document.groups.map((group) => ({
      ...group,
      instances: group.instances.filter((instance) => !removedIds.has(instance.instanceId)),
    })).filter((group) => group.instances.length > 0),
  };
}

function eventSubtreeIds(document: EncounterDocument, eventId: string): Set<string> {
  const removed = new Set(document.groups.flatMap(({ id, instances }) => eventGroups.has(id)
    ? instances.filter((instance) => instance.instanceId === eventId && documented(instance)).map(({ instanceId }) => instanceId)
    : []));
  let changed = true;
  while (changed) {
    changed = false;
    for (const instance of document.groups.flatMap(({ instances }) => instances)) {
      if (instance.parentInstanceId && removed.has(instance.parentInstanceId) && !removed.has(instance.instanceId)) {
        removed.add(instance.instanceId);
        changed = true;
      }
    }
  }
  return removed;
}

export function encounterEvents(document: EncounterDocument, definition: EncounterDefinition, zone: string | null = null): ReadonlyArray<EncounterEvent> {
  return readEncounterEvents(document, definition, zone);
}

function readEncounterEvents(document: EncounterDocument, definition: EncounterDefinition, zone: string | null,
  sources?: EventSources): ReadonlyArray<EncounterEvent> {
  const remember = (eventId: string, instance: EncounterGroupInstance) => {
    if (!sources) return;
    const group = document.groups.find(({ instances }) => instances.includes(instance));
    if (!group) return;
    const eventSources = sources.get(eventId) ?? new Map<string, EncounterGroupInstance>();
    eventSources.set(group.id, instance);
    sources.set(eventId, eventSources);
  };
  const events: EncounterEvent[] = [];
  const dosage = new Map(document.groups.find((group) => group.id === "eMedications.DosageGroup")?.instances
    .filter(documented).map((instance) => [instance.parentInstanceId ?? instance.instanceId.replace(/:dosage$/, ""), instance]) ?? []);
  for (const group of document.groups) for (const instance of group.instances) {
    if (!documented(instance) || group.id === "eMedications.DosageGroup") continue;
    remember(instance.instanceId, instance);
    const observed = dateAndTime(scalar(instance, group.id === "eVitals.VitalGroup" ? "eVitals.01" : group.id === "eProcedures.ProcedureGroup" ? "eProcedures.01" : "eMedications.01") || instance.attributes?.[DOCUMENTED_TIME], zone);
    if (group.id === "eVitals.VitalGroup") {
      const values = { systolic: "", diastolic: "", heartRate: "", spo2: "", respiratoryRate: "", gcs: "", pain: "", nullValues: {} } as VitalValues;
      definition.events.vitals.fields.forEach((field) => {
        const fieldInstance = instanceForElement(document, instance, field.reference);
        if (fieldInstance) remember(instance.instanceId, fieldInstance);
        const value = fieldInstance ? element(fieldInstance, field.reference)?.values[0] : undefined;
        if (value?.kind === "scalar") values[field.id] = String(value.value);
        else if (value?.kind === "null" && value.notValue) values.nullValues[field.id] = value.notValue.code;
        else if (value?.kind === "pertinent-negative") values.nullValues[field.id] = value.code;
      });
      events.push({ id: instance.instanceId, ...observed, kind: "care", title: definition.events.vitals.labels.timelineTitle, detail: vitalDetail(values, definition), reference: definition.events.vitals.references.group, visitorEntered: true, vitals: values });
    }
    if (group.id === "eProcedures.ProcedureGroup") {
      const procedure = coded(instance, "eProcedures.03");
      if (!procedure) continue;
      const success = coded(instance, "eProcedures.06");
      const outcome = coded(instance, "eProcedures.08");
      events.push({ id: instance.instanceId, ...observed, kind: "procedure", title: procedure.display, detail: "", reference: `${definition.events.procedure.references.procedure} · ${definition.events.procedure.terminology.codeSystem} ${procedure.code}`, visitorEntered: true, procedure: {
        code: procedure.code, label: procedure.display, attempts: scalar(instance, "eProcedures.05") === "" ? "" : Number(scalar(instance, "eProcedures.05")) || 0,
        success: definition.events.procedure.successOptions.find((item) => item.label === success?.display || item.value === success?.code)?.value ?? "" as "yes",
        outcome: definition.events.procedure.outcomeOptions.find((item) => item.label === outcome?.display || item.code === outcome?.code || item.value === outcome?.code)?.value ?? "" as "improved",
        complications: element(instance, "eProcedures.07")?.values.flatMap((value) => value.kind === "coded" ? [value.code] : []) ?? [],
        warningAcknowledged: procedure.attributes?.warningAcknowledged === true,
      } });
    }
    if (group.id === "eMedications.MedicationGroup") {
      const medication = coded(instance, "eMedications.03");
      if (!medication) continue;
      const dose = dosage.get(instance.instanceId);
      if (dose) remember(instance.instanceId, dose);
      const administration: MedicationAdministration = {
        medicationCode: medication.code, codeType: medication.system === "SNOMED-CT" ? "SNOMED-CT" : "RxNorm", label: medication.display,
        dose: dose ? scalar(dose, "eMedications.05") : typeof medication.attributes?.dose === "string" ? medication.attributes.dose : "",
        unit: typeof medication.attributes?.unit === "string" ? medication.attributes.unit : dose ? coded(dose, "eMedications.06")?.display ?? "" : "",
        route: typeof medication.attributes?.route === "string" ? medication.attributes.route : coded(instance, "eMedications.04")?.display ?? "", response: typeof medication.attributes?.response === "string" ? medication.attributes.response : coded(instance, "eMedications.07")?.display ?? "",
        warningAcknowledged: medication.attributes?.warningAcknowledged === true,
      };
      events.push({ id: instance.instanceId, ...observed, kind: "medication", title: `${administration.label}${administration.dose ? ` ${administration.dose}` : ""}${administration.unit ? ` ${administration.unit}` : ""}`, detail: `${administration.route}${administration.response ? ` · ${administration.response}` : ""}`, reference: `${definition.events.medication.fields.find((field) => field.id === "medication")!.reference} · ${administration.codeType} ${administration.medicationCode}`, visitorEntered: true, medication: administration });
    }
  }
  return events.sort((a, b) => Date.parse(b.dateTime ?? `${b.date}T${b.time}:00`)
    - Date.parse(a.dateTime ?? `${a.date}T${a.time}:00`) || b.id.localeCompare(a.id));
}
