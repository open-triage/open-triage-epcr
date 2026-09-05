import type { EncounterDocument, EncounterGroup, EncounterGroupInstance, EncounterValue } from "@open-triage/contracts";
import { stableDraftId } from "./draft-report";
import { demoAttributes, hasDemoProvenance, withoutDemoProvenance } from "./demo-provenance";
import { NEMSIS_DATA_MODEL, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { scalarEncounterValue, validateScalarInput } from "./stationary-scalar";

const DEMO_TIME = "2026-04-18T14:35:00-04:00";
const editableGroups = new Set(COMPILED_STATIONARY_LAYOUT.groups.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));
const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));

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

function demoValue(document: EncounterDocument, element: NemsisDataElement, instanceId: string): EncounterValue {
  const occurrenceId = id(document, `occurrence:${element.id}:${instanceId}`);
  const resolved = resolveNemsisElementValues(element);
  if (resolved.kind === "scalar") {
    const input = deterministicDemoScalar(element);
    const findings = validateScalarInput(element, input);
    if (findings.length) throw new Error(`No valid deterministic demo value for ${element.id}: ${findings[0]!.message}`);
    if (["integer", "decimal", "double", "float"].includes(element.datatype.base)) {
      return { kind: "scalar", occurrenceId, value: Number(input), lexical: String(input), attributes: demoAttributes() };
    }
    return scalarEncounterValue(element, input, occurrenceId, demoAttributes());
  }
  const option = resolved.permissibleValues[0];
  const system = option && "codeSystem" in option ? option.codeSystem : resolved.externalCodeSystems[0]?.url;
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
 * Fills only empty editable targets. Existing dispatch and clinician values are
 * immutable inputs; stable identities make repeated Populate calls idempotent.
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
      if (existing?.values.length) return instance;
      const elements = [...instance.elements];
      const populated = { id: element.id, values: [demoValue(next, element, instance.instanceId)] };
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
