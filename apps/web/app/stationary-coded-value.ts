import type { CodedEncounterValue, EncounterDocument, EncounterValue } from "@open-triage/contracts";
import {
  NEMSIS_DATA_MODEL,
  requireNemsisDataElement,
  resolveNemsisElementValues,
  type NemsisCodeSystem,
  type NemsisCodeValue,
  type NemsisDataElement,
} from "./nemsis-data-model";

export type StationaryCodedControlKind = "select" | "combobox" | "external-search";
export type StationaryCodedOption = NemsisCodeValue & {
  readonly system?: string;
  readonly terminologyVersion?: string;
  readonly suggested: boolean;
};
export type StationaryExceptionalChoice =
  | { readonly key: "null"; readonly kind: "null"; readonly label: "No value" }
  | { readonly key: `not-value:${string}`; readonly kind: "null"; readonly code: string; readonly label: string }
  | { readonly key: `pertinent-negative:${string}`; readonly kind: "pertinent-negative"; readonly code: string; readonly label: string };

export type StationaryCodedField = {
  readonly elementId: string;
  readonly label: string;
  readonly help: string;
  readonly controlKind: StationaryCodedControlKind;
  readonly exhaustive: boolean;
  readonly options: ReadonlyArray<StationaryCodedOption>;
  readonly systems: ReadonlyArray<NemsisCodeSystem>;
  readonly exceptionalChoices: ReadonlyArray<StationaryExceptionalChoice>;
};

export type StationaryCodedSelection =
  | { readonly kind: "coded"; readonly code: string; readonly display?: string; readonly system?: string; readonly terminologyVersion?: string }
  | { readonly kind: "null"; readonly code?: string; readonly display?: string }
  | { readonly kind: "pertinent-negative"; readonly code: string; readonly display?: string };

/** Compiles catalog-owned coded and absence semantics into a presentation contract. */
export function stationaryCodedField(elementOrId: NemsisDataElement | string): StationaryCodedField {
  const element = typeof elementOrId === "string" ? requireNemsisDataElement(elementOrId) : elementOrId;
  const resolved = resolveNemsisElementValues(element);
  if (resolved.kind === "scalar") throw new Error(`${element.id} is scalar, not coded`);

  const lists = "bundledListIds" in element.valueSource
    ? element.valueSource.bundledListIds.map((id) => {
      const list = NEMSIS_DATA_MODEL.bundledLists.find((candidate) => candidate.id === id);
      if (!list) throw new Error(`${element.id} references missing bundled list ${id}`);
      return list;
    })
    : [];
  const options: StationaryCodedOption[] = element.valueSource.kind === "inline-enumerated"
    ? element.valueSource.values.map((value) => ({ ...value, suggested: false }))
    : lists.flatMap((list) => list.values.map((value) => ({
      code: value.code,
      label: value.label,
      ...(value.codeSystem ? { system: value.codeSystem } : {}),
      terminologyVersion: list.publishedAt,
      suggested: true,
    })));
  const exceptionalChoices: StationaryExceptionalChoice[] = [
    ...(element.nillable && element.permittedNotValues.length === 0
      ? [{ key: "null", kind: "null", label: "No value" } as const]
      : []),
    ...element.permittedNotValues.map(({ code, label }) => ({ key: `not-value:${code}` as const, kind: "null" as const, code, label })),
    ...element.permittedPertinentNegatives.map(({ code, label }) => ({ key: `pertinent-negative:${code}` as const, kind: "pertinent-negative" as const, code, label })),
  ];
  return {
    elementId: element.id,
    label: element.name,
    help: element.definition,
    controlKind: resolved.exhaustive ? "select" : resolved.kind === "external-code-system" ? "external-search" : "combobox",
    exhaustive: resolved.exhaustive,
    options,
    systems: resolved.externalCodeSystems,
    exceptionalChoices,
  };
}

/** Rejects values that a generated control must never persist for this element. */
export function validateStationaryCodedSelection(field: StationaryCodedField, selection: StationaryCodedSelection): void {
  if (selection.kind === "coded") {
    if (!selection.code.trim()) throw new Error(`${field.elementId} requires a code`);
    if (field.exhaustive && !field.options.some(({ code }) => code === selection.code)) {
      throw new Error(`${selection.code} is not in the exhaustive value set for ${field.elementId}`);
    }
    if (field.controlKind === "external-search" && !selection.system) {
      throw new Error(`${field.elementId} requires a code system`);
    }
    if (selection.system && field.systems.length && !field.systems.some(({ id, label, url }) => [id, label, url].includes(selection.system!))) {
      throw new Error(`${selection.system} is not a supported code system for ${field.elementId}`);
    }
    return;
  }
  const key = selection.kind === "null" && !selection.code ? "null" : `${selection.kind === "null" ? "not-value" : "pertinent-negative"}:${selection.code}`;
  if (!field.exceptionalChoices.some((choice) => choice.key === key)) {
    throw new Error(`${key} is not permitted for ${field.elementId}`);
  }
}

export function codedSelectionFromOption(option: StationaryCodedOption): StationaryCodedSelection {
  return { kind: "coded", code: option.code, display: option.label, ...(option.system ? { system: option.system } : {}), ...(option.terminologyVersion ? { terminologyVersion: option.terminologyVersion } : {}) };
}

export function exceptionalSelection(field: StationaryCodedField, key: string): StationaryCodedSelection | undefined {
  if (!key) return undefined;
  const choice = field.exceptionalChoices.find((candidate) => candidate.key === key);
  if (!choice) throw new Error(`${key} is not permitted for ${field.elementId}`);
  if (choice.kind === "pertinent-negative") return { kind: choice.kind, code: choice.code, display: choice.label };
  return { kind: "null", ...(choice.key === "null" ? {} : { code: choice.code, display: choice.label }) };
}

function canonicalValue(selection: StationaryCodedSelection, occurrenceId: string, attributes?: EncounterValue["attributes"]): EncounterValue {
  const common = { occurrenceId, ...(attributes ? { attributes } : {}) };
  if (selection.kind === "null") return { ...common, kind: "null", ...(selection.code ? { notValue: { code: selection.code, ...(selection.display ? { display: selection.display } : {}) } } : {}) };
  if (selection.kind === "pertinent-negative") return { ...common, kind: "pertinent-negative", code: selection.code, ...(selection.display ? { display: selection.display } : {}) };
  return { ...common, kind: "coded", code: selection.code, ...(selection.system ? { system: selection.system } : {}), ...(selection.display ? { display: selection.display } : {}), ...(selection.terminologyVersion ? { terminologyVersion: selection.terminologyVersion } : {}) } as CodedEncounterValue;
}

/** Atomically replaces an ordinary or exceptional value, so incompatible states cannot coexist. */
export function editStationaryCodedValue(
  document: EncounterDocument,
  target: { readonly groupId: string; readonly instanceId: string; readonly elementId: string; readonly occurrenceId?: string },
  selection: StationaryCodedSelection | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): EncounterDocument {
  const field = stationaryCodedField(target.elementId);
  if (selection) validateStationaryCodedSelection(field, selection);
  const groupIndex = document.groups.findIndex(({ id }) => id === target.groupId);
  const group = document.groups[groupIndex];
  if (!group) throw new Error(`Canonical document is missing ${target.groupId}`);
  const instanceIndex = group.instances.findIndex(({ instanceId }) => instanceId === target.instanceId);
  const instance = group.instances[instanceIndex];
  if (!instance) throw new Error(`${target.groupId} is missing instance ${target.instanceId}`);
  const expectedGroup = requireNemsisDataElement(target.elementId).groupPath.at(-1);
  if (expectedGroup !== target.groupId) throw new Error(`${target.elementId} belongs to ${expectedGroup}, not ${target.groupId}`);
  const elementIndex = instance.elements.findIndex(({ id }) => id === target.elementId);
  const existingElement = instance.elements[elementIndex];
  const valueIndex = target.occurrenceId
    ? existingElement?.values.findIndex(({ occurrenceId }) => occurrenceId === target.occurrenceId) ?? -1
    : 0;
  const existingValue = valueIndex >= 0 ? existingElement?.values[valueIndex] : undefined;
  if (target.occurrenceId && !existingValue) throw new Error(`${target.elementId} is missing occurrence ${target.occurrenceId}`);
  const values = [...existingElement?.values ?? []];
  if (selection) {
    const value = canonicalValue(selection, existingValue?.occurrenceId ?? createId(), existingValue?.attributes);
    if (existingValue) values[valueIndex] = value;
    else values.push(value);
  } else if (existingValue) values.splice(valueIndex, 1);
  const elements = [...instance.elements];
  if (existingElement) elements[elementIndex] = { ...existingElement, values };
  else if (selection) elements.push({ id: target.elementId, values });
  const instances = [...group.instances];
  instances[instanceIndex] = { ...instance, elements };
  const groups = [...document.groups];
  groups[groupIndex] = { ...group, instances };
  return { ...document, encounter: { ...document.encounter, updatedAt: now.toISOString() }, groups };
}
