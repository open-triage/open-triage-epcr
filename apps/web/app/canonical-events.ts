import type { EncounterDocument, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import type { EncounterDefinition, VitalField } from "./encounter-definition";
import { getNemsisDataElement, resolveNemsisElementValues, requireNemsisDataElement } from "./nemsis-data-model";
import type { EncounterEvent, MedicationAdministration, VitalValues } from "./standard-encounter";

const OWNER = "x-open-triage-owner";
const DOCUMENTED_TIME = "documentedTime";
const eventGroups = new Set([
  "eNarrativeSection", "eVitals.VitalGroup", "eMedications.MedicationGroup",
  "eMedications.DosageGroup", "eProcedures.ProcedureGroup",
]);

function timestamp(date: string | undefined, time: string): string {
  return `${date ?? "2026-04-18"}T${time.slice(0, 5)}:00-04:00`;
}

function dateAndTime(value: unknown): { date: string; time: string } {
  const lexical = typeof value === "string" ? value : "2026-04-18T00:00:00Z";
  return { date: lexical.slice(0, 10), time: lexical.slice(11, 16) };
}

function element(instance: EncounterGroupInstance, id: string) {
  return instance.elements.find((candidate) => candidate.id === id);
}

function scalar(instance: EncounterGroupInstance, id: string): string {
  const value = element(instance, id)?.values[0];
  return value?.kind === "scalar" ? String(value.value) : "";
}

function coded(instance: EncounterGroupInstance, id: string): { code: string; display: string; system?: string; attributes?: Readonly<Record<string, string | number | boolean | null>> } | null {
  const value = element(instance, id)?.values[0];
  return value?.kind === "coded" ? { code: value.code, display: value.display ?? value.code, system: value.system, attributes: value.attributes } : null;
}

function clinician(instance: EncounterGroupInstance): boolean {
  return instance.attributes?.[OWNER] === "clinician";
}

function owned(instanceId: string, documentedTime: string, elements: EncounterGroupInstance["elements"], parentInstanceId?: string): EncounterGroupInstance {
  return {
    instanceId,
    ...(parentInstanceId ? { parentInstanceId } : {}),
    attributes: { [OWNER]: "clinician", [DOCUMENTED_TIME]: documentedTime },
    elements,
  };
}

function optionCode(elementId: string, label: string) {
  return resolveNemsisElementValues(requireNemsisDataElement(elementId)).permissibleValues
    .find((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
}

function choice(elementId: string, label: string) {
  return optionCode(elementId, label) ?? (label ? { code: label, label } : null);
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

function eventInstances(event: EncounterEvent, definition: EncounterDefinition): ReadonlyArray<{ groupId: string; instance: EncounterGroupInstance }> {
  const observedAt = timestamp(event.date, event.time);
  if (event.kind === "note") return [{
    groupId: "eNarrativeSection",
    instance: owned(event.id, observedAt, [{ id: "eNarrative.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:narrative`, value: event.detail }] }]),
  }];
  if (event.vitals) {
    const elements: Array<{ id: string; values: EncounterValue[] }> = [{
      id: "eVitals.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: observedAt }],
    }];
    definition.events.vitals.fields.forEach((field) => {
      const raw = event.vitals![field.id];
      const absence = event.vitals!.nullValues?.[field.id];
      if (raw) elements.push({ id: field.reference, values: [{ kind: "scalar", occurrenceId: `${event.id}:${field.reference}`, value: scalarValue(field.reference, raw) }] });
      else if (absence) {
        const pertinent = field.absenceStates.find((item) => item.code === absence)?.kind === "PN";
        elements.push({ id: field.reference, values: [pertinent
          ? { kind: "pertinent-negative", occurrenceId: `${event.id}:${field.reference}`, code: absence }
          : { kind: "null", occurrenceId: `${event.id}:${field.reference}`, notValue: { code: absence } }] });
      }
    });
    return [{ groupId: "eVitals.VitalGroup", instance: owned(event.id, observedAt, elements) }];
  }
  if (event.procedure) {
    const procedure = event.procedure;
    const successLabel = definition.events.procedure.successOptions.find(({ value }) => value === procedure.success)?.label ?? procedure.success;
    const outcomeLabel = definition.events.procedure.outcomeOptions.find(({ value }) => value === procedure.outcome)?.label ?? procedure.outcome;
    const success = choice("eProcedures.06", successLabel);
    const outcome = choice("eProcedures.08", outcomeLabel);
    return [{ groupId: "eProcedures.ProcedureGroup", instance: owned(event.id, observedAt, [
      { id: "eProcedures.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: observedAt }] },
      { id: "eProcedures.03", values: [{ kind: "coded", occurrenceId: `${event.id}:procedure`, code: procedure.code, system: "SNOMED-CT", display: procedure.label, attributes: { warningAcknowledged: procedure.warningAcknowledged } }] },
      { id: "eProcedures.05", values: [{ kind: "scalar", occurrenceId: `${event.id}:attempts`, value: procedure.attempts }] },
      ...(success ? [{ id: "eProcedures.06", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:success`, code: success.code, display: success.label }] }] : []),
      ...(outcome ? [{ id: "eProcedures.08", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:outcome`, code: outcome.code, display: outcome.label }] }] : []),
      ...(procedure.complications.length ? [{ id: "eProcedures.07", values: procedure.complications.map((code, index) => ({ kind: "coded" as const, occurrenceId: `${event.id}:complication:${index}`, code })) }] : []),
    ]) }];
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
      ]) },
      { groupId: "eMedications.DosageGroup", instance: owned(`${event.id}:dosage`, observedAt, [
        ...(medication.dose ? [{ id: "eMedications.05", values: [{ kind: "scalar" as const, occurrenceId: `${event.id}:dose`, value: Number(medication.dose) }] }] : []),
        ...(unit ? [{ id: "eMedications.06", values: [{ kind: "coded" as const, occurrenceId: `${event.id}:unit`, code: unit.code, display: unit.label }] }] : []),
      ], event.id) },
    ];
  }
  return [];
}

export function saveCanonicalEvent(document: EncounterDocument, event: EncounterEvent, definition: EncounterDefinition): EncounterDocument {
  const updatedAt = timestamp(event.date, event.time);
  let groups = document.groups.map((group) => eventGroups.has(group.id)
    ? { ...group, instances: group.instances.filter((instance) => !(clinician(instance) && (instance.instanceId === event.id || instance.parentInstanceId === event.id))) }
    : group);
  for (const { groupId, instance } of eventInstances(event, definition)) {
    const existing = groups.find((group) => group.id === groupId);
    groups = existing
      ? groups.map((group) => group === existing ? { ...group, instances: [...group.instances, instance] } : group)
      : [...groups, { id: groupId, instances: [instance] }];
  }
  return { ...document, encounter: { ...document.encounter, updatedAt }, groups };
}

export function removeCanonicalEvent(document: EncounterDocument, eventId: string): EncounterDocument {
  return {
    ...document,
    encounter: { ...document.encounter },
    groups: document.groups.map((group) => ({
      ...group,
      instances: group.instances.filter((instance) => !(clinician(instance) && (instance.instanceId === eventId || instance.parentInstanceId === eventId))),
    })).filter((group) => group.instances.length > 0),
  };
}

export function encounterEvents(document: EncounterDocument, definition: EncounterDefinition): ReadonlyArray<EncounterEvent> {
  const events: EncounterEvent[] = [];
  const dosage = new Map(document.groups.find((group) => group.id === "eMedications.DosageGroup")?.instances
    .filter(clinician).map((instance) => [instance.parentInstanceId ?? instance.instanceId.replace(/:dosage$/, ""), instance]) ?? []);
  for (const group of document.groups) for (const instance of group.instances) {
    if (!clinician(instance) || group.id === "eMedications.DosageGroup") continue;
    const observed = dateAndTime(instance.attributes?.[DOCUMENTED_TIME] ?? scalar(instance, group.id === "eVitals.VitalGroup" ? "eVitals.01" : group.id === "eProcedures.ProcedureGroup" ? "eProcedures.01" : "eMedications.01"));
    if (group.id === "eNarrativeSection") events.push({ id: instance.instanceId, ...observed, time: observed.time, kind: "note", title: definition.events.note.labels.timelineTitle, detail: scalar(instance, "eNarrative.01"), reference: definition.events.note.references.summary, visitorEntered: true });
    if (group.id === "eVitals.VitalGroup") {
      const values = { systolic: "", diastolic: "", heartRate: "", spo2: "", respiratoryRate: "", gcs: "", pain: "", nullValues: {} } as VitalValues;
      definition.events.vitals.fields.forEach((field) => {
        const value = element(instance, field.reference)?.values[0];
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
        code: procedure.code, label: procedure.display, attempts: Number(scalar(instance, "eProcedures.05")) || 0,
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
  return events.sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
}
