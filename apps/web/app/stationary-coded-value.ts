import type { CodedEncounterValue, EncounterDocument, EncounterValue } from "@open-triage/contracts";
import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import {
  NEMSIS_DATA_MODEL,
  requireNemsisDataElement,
  resolveNemsisElementValues,
  type NemsisCodeSystem,
  type NemsisCodeValue,
  type NemsisDataElement,
} from "./nemsis-data-model";
import { currentCatalogLanguage } from "./catalog-localization";
import { clinicianOwnedAttributes, withoutDemoProvenance } from "./demo-provenance";

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
  readonly maxOccurs: number | null;
  readonly options: ReadonlyArray<StationaryCodedOption>;
  readonly systems: ReadonlyArray<NemsisCodeSystem>;
  readonly exceptionalChoices: ReadonlyArray<StationaryExceptionalChoice>;
  readonly choiceOrder?: NonNullable<ClinicalFormConfiguration["catalogFields"][string]["choiceOrder"]>;
};

export type StationaryCodedSelection = ({
  readonly notValue?: { readonly code: string; readonly display?: string };
  readonly pertinentNegative?: { readonly code: string; readonly display?: string };
} & (
  | { readonly kind: "coded"; readonly code: string; readonly display?: string; readonly system?: string; readonly terminologyVersion?: string }
  | { readonly kind: "null"; readonly code?: string; readonly display?: string }
  | { readonly kind: "pertinent-negative"; readonly code: string; readonly display?: string }
));

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
    maxOccurs: element.occurrence.max === "unbounded" ? null : element.occurrence.max,
    options,
    systems: resolved.externalCodeSystems,
    exceptionalChoices,
  };
}

/** Applies the report-pinned catalog labels, ordering, additions, and disabled choices. */
export function configuredStationaryCodedField(
  elementOrId: NemsisDataElement | string,
  configured?: ClinicalFormConfiguration["catalogFields"][string],
): StationaryCodedField {
  const base = stationaryCodedField(elementOrId);
  const language = currentCatalogLanguage();
  const exceptionalChoices = base.exceptionalChoices.filter((choice) =>
    !choice.key.startsWith("not-value:") || configured?.exceptionalChoices === undefined ||
      configured.exceptionalChoices.some((candidate) => candidate.key === choice.key)).map((choice) => {
    const localization = configured?.exceptionalChoices?.find((candidate) => candidate.key === choice.key)?.localization;
    return { ...choice, label: language === "sv" ? localization?.sv?.label?.trim() || choice.label : choice.label };
  }) as StationaryCodedField["exceptionalChoices"];
  if (!configured?.codeChoices) return { ...base, exceptionalChoices, maxOccurs: configured?.maxOccurs ?? base.maxOccurs };
  return { ...base, exceptionalChoices, maxOccurs: configured.maxOccurs ?? base.maxOccurs,
    ...(configured.choiceOrder ? { choiceOrder: configured.choiceOrder } : {}),
    options: configured.codeChoices.map((choice) => ({
    code: choice.code,
    label: language === "sv" ? choice.localization?.sv?.label?.trim() || choice.label : choice.label,
    ...(choice.codeSystem ? { system: choice.codeSystem } : {}),
    ...(choice.terminologyVersion ? { terminologyVersion: choice.terminologyVersion } : {}),
    suggested: true,
  })) };
}

/** Rejects values that a generated control must never persist for this element. */
export function validateStationaryCodedSelection(field: StationaryCodedField, selection: StationaryCodedSelection): void {
  if (selection.notValue && !field.exceptionalChoices.some((choice) => choice.key === `not-value:${selection.notValue!.code}`)) {
    throw new Error(`not-value:${selection.notValue.code} is not permitted for ${field.elementId}`);
  }
  if (selection.pertinentNegative && !field.exceptionalChoices.some((choice) => choice.key === `pertinent-negative:${selection.pertinentNegative!.code}`)) {
    throw new Error(`pertinent-negative:${selection.pertinentNegative.code} is not permitted for ${field.elementId}`);
  }
  if (selection.kind === "coded") {
    if (!selection.code.trim()) throw new Error(`${field.elementId} requires a code`);
    if ((field.exhaustive || field.choiceOrder !== undefined) && !field.options.some(({ code, system }) => code === selection.code &&
      (system ?? "") === (selection.system ?? ""))) {
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

/** A repeatable element may carry each pertinent-negative assertion only once. */
export function repeatableExceptionalChoices(field: StationaryCodedField, values: ReadonlyArray<EncounterValue>, current?: EncounterValue): ReadonlyArray<StationaryExceptionalChoice> {
  const used = new Set(values.flatMap((value) => value.kind === "pertinent-negative" && value !== current
    ? [`pertinent-negative:${value.code}`]
    : []));
  return field.exceptionalChoices.filter((choice) => choice.kind !== "pertinent-negative" || !used.has(choice.key));
}

function canonicalValue(selection: StationaryCodedSelection, occurrenceId: string, attributes?: EncounterValue["attributes"]): EncounterValue {
  const common = { occurrenceId, ...(attributes ? { attributes } : {}),
    ...(selection.notValue ? { notValue: selection.notValue } : {}),
    ...(selection.pertinentNegative ? { pertinentNegative: selection.pertinentNegative } : {}) };
  if (selection.kind === "null") return { ...common, kind: "null", ...(selection.code ? { notValue: { code: selection.code, ...(selection.display ? { display: selection.display } : {}) } } : {}) };
  if (selection.kind === "pertinent-negative") return { ...common, kind: "pertinent-negative", code: selection.code, ...(selection.display ? { display: selection.display } : {}) };
  return { ...common, kind: "coded", code: selection.code, ...(selection.system ? { system: selection.system } : {}), ...(selection.display ? { display: selection.display } : {}), ...(selection.terminologyVersion ? { terminologyVersion: selection.terminologyVersion } : {}) } as CodedEncounterValue;
}

function compatibleValueExtensions(value: EncounterValue | undefined): Readonly<Record<string, unknown>> {
  if (!value) return {};
  const { kind: _kind, occurrenceId: _occurrenceId, attributes: _attributes, code: _code,
    display: _display, system: _system, terminologyVersion: _terminologyVersion,
    notValue: _notValue, pertinentNegative: _pertinentNegative,
    value: _value, lexical: _lexical, precision: _precision,
    utcOffsetMinutes: _utcOffsetMinutes, ...extensions } = value;
  return extensions;
}

/** Atomically replaces an ordinary or exceptional value, so incompatible states cannot coexist. */
export function editStationaryCodedValue(
  document: EncounterDocument,
  target: { readonly groupId: string; readonly instanceId: string; readonly elementId: string; readonly occurrenceId?: string; readonly codedField?: StationaryCodedField },
  selection: StationaryCodedSelection | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now = new Date(),
): EncounterDocument {
  const field = target.codedField ?? stationaryCodedField(target.elementId);
  const elementDefinition = requireNemsisDataElement(target.elementId);
  if (selection) validateStationaryCodedSelection(field, selection);
  const groupIndex = document.groups.findIndex(({ id }) => id === target.groupId);
  const group = document.groups[groupIndex];
  if (!group) throw new Error(`Canonical document is missing ${target.groupId}`);
  const instanceIndex = group.instances.findIndex(({ instanceId }) => instanceId === target.instanceId);
  const instance = group.instances[instanceIndex];
  if (!instance) throw new Error(`${target.groupId} is missing instance ${target.instanceId}`);
  const expectedGroup = elementDefinition.groupPath.at(-1);
  if (expectedGroup !== target.groupId) throw new Error(`${target.elementId} belongs to ${expectedGroup}, not ${target.groupId}`);
  const elementIndex = instance.elements.findIndex(({ id }) => id === target.elementId);
  const existingElement = instance.elements[elementIndex];
  const repeatable = elementDefinition.occurrence.max === "unbounded" || elementDefinition.occurrence.max > 1;
  const valueIndex = target.occurrenceId
    ? existingElement?.values.findIndex(({ occurrenceId }) => occurrenceId === target.occurrenceId) ?? -1
    : repeatable ? -1 : 0;
  const existingValue = valueIndex >= 0 ? existingElement?.values[valueIndex] : undefined;
  if (target.occurrenceId && !existingValue) throw new Error(`${target.elementId} is missing occurrence ${target.occurrenceId}`);
  const values = [...existingElement?.values ?? []];
  if (selection) {
    const otherValues = values.filter((value) => value !== existingValue);
    if (field.maxOccurs !== null && otherValues.length >= field.maxOccurs)
      throw new Error(`${target.elementId} permits at most ${field.maxOccurs} choices`);
    if (otherValues.length && (selection.kind !== "coded" || otherValues.some((value) => value.kind !== "coded")))
      throw new Error(`${target.elementId} cannot combine exceptional and ordinary choices`);
    if (selection.kind === "coded" && otherValues.some((value) => value.kind === "coded" && value.code === selection.code &&
      (value.system ?? "") === (selection.system ?? "")))
      throw new Error(`${target.elementId} already has this choice`);
    const value = {
      ...compatibleValueExtensions(existingValue),
      ...canonicalValue(selection, existingValue?.occurrenceId ?? createId(), withoutDemoProvenance(existingValue?.attributes)),
    } as EncounterValue;
    if (existingValue) values[valueIndex] = value;
    else values.push(value);
  } else if (existingValue) values.splice(valueIndex, 1);
  const elements = [...instance.elements];
  if (existingElement && values.length === 0) elements.splice(elementIndex, 1);
  else if (existingElement) elements[elementIndex] = { ...existingElement, values };
  else if (selection) elements.push({ id: target.elementId, values });
  const instances = [...group.instances];
  instances[instanceIndex] = { ...instance, attributes: clinicianOwnedAttributes(instance.attributes), elements };
  const groups = [...document.groups];
  groups[groupIndex] = { ...group, instances };
  return { ...document, encounter: { ...document.encounter, updatedAt: now.toISOString() }, groups };
}
