import type { EncounterDocument, EncounterGroup, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import { stableDraftId } from "./draft-report";
import { demoAttributes, DEMO_FALLBACK_DATE, hasDemoProvenance, withoutDemoProvenance } from "./demo-provenance";
import { NEMSIS_DATA_MODEL, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { scalarEncounterValue, validateScalarInput } from "./stationary-scalar";

const DEMO_TIME = `${DEMO_FALLBACK_DATE}T14:35:00-04:00`;
// A fully populated demo report must describe one consistent scenario. The
// catalog's first code is not necessarily compatible with related fields.
const demoCodes: Readonly<Record<string, string>> = {
  "eResponse.05": "2205005", // Interfacility transfer explains eSituation.20.
  "eSituation.02": "9922005", // Injury explains the injury details.
  "eArrest.01": "3001005", // Arrest explains the resuscitation details.
  "eArrest.03": "3003005", // Chest compressions match eArrest.09.
  "eVitals.19": "4", // GCS eye, verbal, and motor add to total 15.
  "eVitals.20": "5",
  "eVitals.21": "6",
};
const demoVitalScalars: Readonly<Record<string, string>> = {
  "eVitals.06": "120", // Systolic blood pressure
  "eVitals.07": "80", // Diastolic blood pressure
  "eVitals.09": "93", // Mean arterial pressure
  "eVitals.10": "78", // Heart rate
  "eVitals.12": "98", // Pulse oximetry
  "eVitals.14": "16", // Respiratory rate
  "eVitals.16": "35", // ETCO2
  "eVitals.17": "1", // Carbon monoxide
  "eVitals.23": "15", // GCS total
  "eVitals.24": "37", // Temperature in Celsius
  "eVitals.27": "1", // Pain scale
  "eVitals.32": "8", // APGAR
  "eVitals.33": "12", // Revised trauma score
  "eVitals.34": "1", // Stroke scale score
};
const demoTimeMinutes: Readonly<Record<string, number>> = {
  "eTimes.01": -10,
  "eTimes.02": -5,
  "eTimes.03": 0,
  "eTimes.05": 5,
  "eTimes.06": 10,
  "eTimes.07": 15,
  "eTimes.09": 40,
  "eTimes.11": 55,
  "eTimes.12": 60,
  "eTimes.13": 75,
};
const editableGroups = new Set(COMPILED_STATIONARY_LAYOUT.groups.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));
const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));
const mobileEventParents: Readonly<Record<string, string>> = {
  "eVitals.VitalGroup": "eVitalsSection",
  "eProcedures.ProcedureGroup": "eProceduresSection",
  "eMedications.MedicationGroup": "eMedicationsSection",
};

function id(document: EncounterDocument, identity: string): string {
  return stableDraftId(document.encounter.id, `stationary-demo:${identity}`);
}

function patternedScalar(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  if (pattern.includes("[0-9]{5}|")) return "12345";
  if (pattern.includes("90(\\.[0]{1,6})?")) return "40.7128,-74.0060";
  if (pattern.includes("[C-HJ-NP-X]")) return "18TWL12345678";
  if (pattern.includes("[2-9][0-9][0-9]-")) return "212-555-0100";
  if (pattern === "[0-9]{9}") return "123456789";
  if (pattern === ".+@.+") return "demo@example.test";
  if (pattern.includes("|P|p")) return "100";
  if (pattern.includes("|High|Low")) return "100";
  return undefined;
}

/** One deterministic, catalog-valid value for every supported NEMSIS datatype. */
export function deterministicDemoScalar(element: NemsisDataElement): string | boolean {
  const vital = demoVitalScalars[element.id];
  if (vital !== undefined) return vital;
  const { base, constraints } = element.datatype;
  const patterned = patternedScalar(typeof constraints.pattern === "string" ? constraints.pattern : undefined);
  if (patterned) return patterned;
  if (base === "dateTime") return DEMO_TIME;
  if (base === "date") return "2000-01-01";
  if (base === "boolean") return true;
  if (["integer", "decimal", "double", "float"].includes(base)) {
    const minimum = Number(constraints.minInclusive ?? 1);
    return String(Number.isFinite(minimum) ? minimum : 1);
  }
  if (["binary", "base64Binary", "hexBinary"].includes(base)) return "ZGVtbw==";
  if (base === "anyURI") return "https://example.test/demo";
  if (base === "duration") return "PT5M";
  const minimum = Number(constraints.minLength ?? 1);
  const maximum = Number(constraints.maxLength ?? Math.max(minimum, 12));
  return "Demo value".padEnd(Math.max(1, minimum), "x").slice(0, maximum);
}

function demoDateTime(document: EncounterDocument, elementId: string): string {
  const notified = document.groups.flatMap(({ instances }) => instances)
    .flatMap(({ elements }) => elements).find(({ id }) => id === "eTimes.03")?.values[0];
  const notifiedTime = notified?.kind === "scalar" && !hasDemoProvenance(notified.attributes)
    ? Date.parse(String(notified.value)) : Number.NaN;
  const baseTime = Number.isFinite(notifiedTime) ? notifiedTime : Date.parse(DEMO_TIME);
  const createdTime = Date.parse(document.encounter.createdAt);
  const elapsedMinutes = Number.isFinite(createdTime) ? Math.max(0, (createdTime - baseTime) / 60_000) : 0;
  const offsetMinutes = Math.min(demoTimeMinutes[elementId] ?? 30, elapsedMinutes);
  return new Date(baseTime + offsetMinutes * 60_000).toISOString().replace("Z", "+00:00");
}

function demoValue(document: EncounterDocument, element: NemsisDataElement, instanceId: string): EncounterValue {
  const occurrenceId = id(document, `occurrence:${element.id}:${instanceId}`);
  const resolved = resolveNemsisElementValues(element);
  if (resolved.kind === "scalar") {
    const input = element.datatype.base === "dateTime" ? demoDateTime(document, element.id) : deterministicDemoScalar(element);
    const findings = validateScalarInput(element, input);
    if (findings.length) throw new Error(`No valid deterministic demo value for ${element.id}: ${findings[0]!.message}`);
    const attributes = demoAttributes(element.id === "eVitals.16" ? { ETCO2Type: "3340001" } : {});
    if (["integer", "decimal", "double", "float"].includes(element.datatype.base)) {
      return { kind: "scalar", occurrenceId, value: Number(input), lexical: String(input), attributes };
    }
    return scalarEncounterValue(element, input, occurrenceId, attributes);
  }
  const option = resolved.permissibleValues.find(({ code }) => code === demoCodes[element.id]) ?? resolved.permissibleValues[0];
  const candidateSystem = option && "codeSystem" in option ? option.codeSystem : resolved.externalCodeSystems[0]?.url;
  const system = typeof candidateSystem === "string" ? candidateSystem : undefined;
  return {
    kind: "coded",
    occurrenceId,
    code: option?.code ?? "DEMO",
    display: option?.label ?? "Synthetic demo value",
    ...(system ? { system } : {}),
    attributes: demoAttributes(),
  };
}

function instances(document: EncounterDocument, groupId: string): ReadonlyArray<EncounterGroupInstance> {
  return document.groups.find(({ id }) => id === groupId)?.instances ?? [];
}

/**
 * Fills empty editable targets and refreshes previously generated demo values.
 * Existing dispatch and clinician values are immutable inputs; stable identities
 * make repeated Populate calls idempotent.
 */
export function populateStationaryDemoData(document: EncounterDocument): EncounterDocument {
  const groups: EncounterGroup[] = document.groups.map((group) => ({ ...group, instances: [...group.instances] }));
  let next: EncounterDocument = { ...document, groups };
  const orderedGroups = [...NEMSIS_DATA_MODEL.groups].sort((left, right) => left.path.length - right.path.length);

  for (const catalogGroup of orderedGroups) {
    if (!editableGroups.has(catalogGroup.id)) continue;
    const parents = catalogGroup.parentId === null ? [undefined] : instances(next, catalogGroup.parentId);
    for (const parent of parents) {
      const matching = instances(next, catalogGroup.id).filter((candidate) => candidate.parentInstanceId === parent?.instanceId);
      if (matching.length) continue;
      const orphanedMobileEvents = parent && parents.length === 1 && mobileEventParents[catalogGroup.id] === catalogGroup.parentId
        ? instances(next, catalogGroup.id).filter((candidate) => !candidate.parentInstanceId)
        : [];
      if (parent && orphanedMobileEvents.length) {
        const orphanIds = new Set(orphanedMobileEvents.map(({ instanceId }) => instanceId));
        const parentInstanceId = parent.instanceId;
        const groupIndex = groups.findIndex(({ id }) => id === catalogGroup.id);
        const group = groups[groupIndex]!;
        groups[groupIndex] = { ...group, instances: group.instances.map((instance) => orphanIds.has(instance.instanceId)
          ? { ...instance, parentInstanceId }
          : instance) };
        next = { ...next, groups };
        continue;
      }
      const instanceId = id(next, `group:${catalogGroup.id}:${parent?.instanceId ?? "root"}`);
      const created: EncounterGroupInstance = {
        instanceId,
        ...(parent ? { parentInstanceId: parent.instanceId } : {}),
        attributes: demoAttributes(),
        elements: [],
      };
      const groupIndex = groups.findIndex(({ id: groupId }) => groupId === catalogGroup.id);
      if (groupIndex < 0) groups.push({ id: catalogGroup.id, instances: [created] });
      else groups[groupIndex] = { ...groups[groupIndex]!, instances: [...groups[groupIndex]!.instances, created] };
      next = { ...next, groups };
    }
  }

  for (const element of NEMSIS_DATA_MODEL.elements) {
    if (!editableElements.has(element.id)) continue;
    const groupId = element.groupPath.at(-1)!;
    const groupIndex = groups.findIndex(({ id: candidate }) => candidate === groupId);
    if (groupIndex < 0) continue;
    const group = groups[groupIndex]!;
    const populatedInstances = group.instances.map((instance) => {
      const elementIndex = instance.elements.findIndex(({ id: candidate }) => candidate === element.id);
      const existing = elementIndex < 0 ? undefined : instance.elements[elementIndex];
      if (existing?.values.length && !existing.values.every((value) => hasDemoProvenance(value.attributes))) return instance;
      const elements = [...instance.elements];
      const generated = demoValue(next, element, instance.instanceId);
      const populated = { id: element.id, values: [{ ...generated,
        occurrenceId: existing?.values[0]?.occurrenceId ?? generated.occurrenceId }] };
      if (existing && JSON.stringify(existing.values) === JSON.stringify(populated.values)) return instance;
      if (elementIndex < 0) elements.push(populated);
      else elements[elementIndex] = { ...existing!, ...populated };
      return { ...instance, elements };
    });
    groups[groupIndex] = { ...group, instances: populatedInstances };
  }
  return { ...document, groups };
}

/** Removes exactly demo-owned values and empty demo-created group subtrees. */
export function clearStationaryDemoData(document: EncounterDocument): EncounterDocument {
  const demoInstances = new Set(document.groups.flatMap((group) => group.instances.filter((instance) => hasDemoProvenance(instance.attributes)).map(({ instanceId }) => instanceId)));
  const hasDemoValues = document.groups.some((group) => group.instances.some((instance) => instance.elements.some((element) => element.values.some((value) => hasDemoProvenance(value.attributes)))));
  if (!demoInstances.size && !hasDemoValues) return document;
  const cleaned = document.groups.map((group) => ({
    ...group,
    instances: group.instances.map((instance) => ({
      ...instance,
      elements: instance.elements.flatMap((element) => {
        const values = element.values.filter((value) => !hasDemoProvenance(value.attributes));
        return values.length || element.values.length === 0 ? [{ ...element, values }] : [];
      }),
    })),
  }));
  const protectedIds = new Set(cleaned.flatMap((group) => group.instances.filter((instance) => !demoInstances.has(instance.instanceId) || instance.elements.some(({ values }) => values.length)).map(({ instanceId }) => instanceId)));
  let priorSize = -1;
  while (priorSize !== protectedIds.size) {
    priorSize = protectedIds.size;
    for (const group of cleaned) for (const instance of group.instances) {
      if (protectedIds.has(instance.instanceId) && instance.parentInstanceId) protectedIds.add(instance.parentInstanceId);
    }
  }
  const groups = cleaned.flatMap((group) => {
    const retained = group.instances.filter((instance) => !demoInstances.has(instance.instanceId) || protectedIds.has(instance.instanceId)).map((instance) => demoInstances.has(instance.instanceId)
      ? { ...instance, ...(withoutDemoProvenance(instance.attributes) ? { attributes: withoutDemoProvenance(instance.attributes) } : { attributes: undefined }) }
      : instance);
    return retained.length ? [{ ...group, instances: retained }] : [];
  });
  return { ...document, encounter: { ...document.encounter, updatedAt: new Date().toISOString() }, groups };
}
