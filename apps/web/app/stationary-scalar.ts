import type { EncounterAttributes, EncounterDocument, EncounterValue, ScalarEncounterValue } from "@open-triage/contracts";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { NEMSIS_DATA_MODEL, requireNemsisDataElement, type NemsisDataElement } from "./nemsis-data-model";
import { withoutDemoProvenance } from "./demo-provenance";
import {
  validateStationaryExceptionalSelection,
  type StationaryExceptionalSelection,
} from "./stationary-value-picker";

export type ScalarDatatypeFamily = "text" | "numeric" | "integer" | "boolean" | "date" | "datetime" | "time" | "uri" | "duration" | "binary";

export interface ScalarControlPresentation {
  readonly elementId: string;
  readonly groupId: string;
  readonly label: string;
  readonly help: string;
  readonly family: ScalarDatatypeFamily;
  readonly inputType: "text" | "number" | "checkbox" | "date" | "url" | "file";
  readonly inputMode?: "text" | "decimal" | "numeric" | "url";
  readonly min?: string;
  readonly max?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly step?: string;
  readonly repeatable: boolean;
  readonly maximumOccurrences: number | "unbounded";
}

export interface ScalarValidationFinding {
  readonly elementId: string;
  readonly occurrenceId?: string;
  readonly code: "required" | "datatype" | "pattern" | "minimum" | "maximum" | "length" | "cardinality";
  readonly message: string;
}

export type ScalarEditResult =
  | { readonly ok: true; readonly document: EncounterDocument; readonly occurrenceId: string }
  | { readonly ok: false; readonly document: EncounterDocument; readonly findings: ReadonlyArray<ScalarValidationFinding> };

export type StationaryScalarSelection =
  | { readonly kind: "scalar"; readonly input: string | boolean }
  | StationaryExceptionalSelection;

export function scalarDatatypeFamily(base: string): ScalarDatatypeFamily {
  if (["decimal", "double", "float"].includes(base)) return "numeric";
  if (base === "integer") return "integer";
  if (base === "boolean") return "boolean";
  if (base === "date") return "date";
  if (base === "dateTime") return "datetime";
  if (base === "time") return "time";
  if (base === "anyURI") return "uri";
  if (base === "duration") return "duration";
  if (["binary", "base64Binary", "hexBinary"].includes(base)) return "binary";
  return "text";
}

function numberConstraint(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Compiles an input description directly from one pinned catalog element. */
export function scalarControlPresentation(element: NemsisDataElement, label = element.name, help = element.definition): ScalarControlPresentation {
  const family = scalarDatatypeFamily(element.datatype.base);
  const constraints = element.datatype.constraints;
  const fractionDigits = numberConstraint(constraints.fractionDigits);
  const inputType = family === "numeric" || family === "integer" ? "number"
    : family === "boolean" ? "checkbox" : family === "date" ? "date"
      : family === "uri" ? "url" : family === "binary" ? "file" : "text";
  return {
    elementId: element.id,
    groupId: element.groupPath.at(-1)!,
    label,
    help,
    family,
    inputType,
    ...(family === "numeric" ? { inputMode: "decimal" as const } : {}),
    ...(family === "integer" ? { inputMode: "numeric" as const } : {}),
    ...(family === "uri" ? { inputMode: "url" as const } : {}),
    ...(constraints.minInclusive !== undefined ? { min: String(constraints.minInclusive) } : {}),
    ...(constraints.maxInclusive !== undefined ? { max: String(constraints.maxInclusive) } : {}),
    ...(constraints.minLength !== undefined ? { minLength: Number(constraints.minLength) } : {}),
    ...(constraints.maxLength !== undefined ? { maxLength: Number(constraints.maxLength) } : {}),
    ...(constraints.pattern !== undefined ? { pattern: String(constraints.pattern) } : {}),
    ...(family === "integer" ? { step: "1" } : family === "numeric" && fractionDigits !== undefined ? { step: String(10 ** -fractionDigits) } : {}),
    repeatable: element.occurrence.max === "unbounded" || element.occurrence.max > 1,
    maximumOccurrences: element.occurrence.max,
  };
}

const layoutElements = new Map(COMPILED_STATIONARY_LAYOUT.elements.map((element) => [element.id, element]));

/** Every editable scalar in the pinned layout; consumers choose grouping and visual arrangement. */
export const STATIONARY_SCALAR_PRESENTATIONS: ReadonlyArray<ScalarControlPresentation> = NEMSIS_DATA_MODEL.elements
  .filter((element) => element.valueSource.kind === "scalar" && layoutElements.get(element.id)?.mode === "editable")
  .map((element) => {
    const placement = layoutElements.get(element.id)!;
    return scalarControlPresentation(element, placement.label ?? element.name, placement.help ?? element.definition);
  });

function finding(element: NemsisDataElement, code: ScalarValidationFinding["code"], message: string, occurrenceId?: string): ScalarValidationFinding {
  return { elementId: element.id, ...(occurrenceId ? { occurrenceId } : {}), code, message };
}

function validCalendarDate(input: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === input;
}

function patternMatches(pattern: string, input: string): boolean {
  try { return new RegExp(`^(?:${pattern})$`, "u").test(input); } catch { return false; }
}

/** Returns field-associated errors without coercing or mutating unsupported input. */
export function validateScalarInput(element: NemsisDataElement, input: string | boolean, occurrenceId?: string): ReadonlyArray<ScalarValidationFinding> {
  const family = scalarDatatypeFamily(element.datatype.base);
  const lexical = typeof input === "boolean" ? String(input) : input;
  const constraints = element.datatype.constraints;
  const findings: ScalarValidationFinding[] = [];
  if (!lexical.length) return element.occurrence.min > 0 ? [finding(element, "required", `${element.name} is required.`, occurrenceId)] : [];
  if (family === "boolean" && typeof input !== "boolean") findings.push(finding(element, "datatype", `${element.name} must be true or false.`, occurrenceId));
  if (family === "integer" && !/^[+-]?\d+$/.test(lexical)) findings.push(finding(element, "datatype", `${element.name} must be a whole number.`, occurrenceId));
  if (family === "numeric" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lexical)) findings.push(finding(element, "datatype", `${element.name} must be a decimal number.`, occurrenceId));
  if (family === "date" && !validCalendarDate(lexical)) findings.push(finding(element, "datatype", `${element.name} must be a valid ISO date.`, occurrenceId));
  if (family === "datetime" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(lexical) || !Number.isFinite(Date.parse(lexical)))) findings.push(finding(element, "datatype", `${element.name} must include a valid date, time, seconds, and UTC offset.`, occurrenceId));
  if (family === "time" && !validIsoTime(lexical)) findings.push(finding(element, "datatype", `${element.name} must be a valid ISO time.`, occurrenceId));
  if (family === "uri" && /\s/.test(lexical)) findings.push(finding(element, "datatype", `${element.name} must be a URI without spaces.`, occurrenceId));
  if (family === "duration" && !/^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(lexical)) findings.push(finding(element, "datatype", `${element.name} must be an ISO 8601 duration.`, occurrenceId));
  if (family === "binary" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(lexical)) findings.push(finding(element, "datatype", `${element.name} must be base64-encoded binary data.`, occurrenceId));
  const minLength = numberConstraint(constraints.minLength);
  const maxLength = numberConstraint(constraints.maxLength);
  if (minLength !== undefined && lexical.length < minLength) findings.push(finding(element, "length", `${element.name} must contain at least ${minLength} characters.`, occurrenceId));
  if (maxLength !== undefined && lexical.length > maxLength) findings.push(finding(element, "length", `${element.name} must contain no more than ${maxLength} characters.`, occurrenceId));
  if (typeof constraints.pattern === "string" && !patternMatches(constraints.pattern, lexical)) findings.push(finding(element, "pattern", `${element.name} does not match the catalog format.`, occurrenceId));
  if ((family === "numeric" || family === "integer") && !findings.some(({ code }) => code === "datatype")) {
    const numeric = Number(lexical);
    const min = numberConstraint(constraints.minInclusive);
    const max = numberConstraint(constraints.maxInclusive);
    if (min !== undefined && numeric < min) findings.push(finding(element, "minimum", `${element.name} must be at least ${min}.`, occurrenceId));
    if (max !== undefined && numeric > max) findings.push(finding(element, "maximum", `${element.name} must be no more than ${max}.`, occurrenceId));
    const fractionDigits = numberConstraint(constraints.fractionDigits);
    const totalDigits = numberConstraint(constraints.totalDigits);
    const digits = lexical.replace(/^[+-]/, "").replace(".", "");
    const fraction = lexical.split(".")[1]?.length ?? 0;
    if (fractionDigits !== undefined && fraction > fractionDigits) findings.push(finding(element, "datatype", `${element.name} allows at most ${fractionDigits} decimal places.`, occurrenceId));
    if (totalDigits !== undefined && digits.length > totalDigits) findings.push(finding(element, "datatype", `${element.name} allows at most ${totalDigits} digits.`, occurrenceId));
  }
  if ((family === "date" || family === "datetime") && !findings.some(({ code }) => code === "datatype")) {
    const datePart = lexical.slice(0, 10);
    if (constraints.minInclusive !== undefined && datePart < String(constraints.minInclusive).slice(0, 10)) findings.push(finding(element, "minimum", `${element.name} is before the earliest permitted date.`, occurrenceId));
    if (constraints.maxInclusive !== undefined && datePart > String(constraints.maxInclusive).slice(0, 10)) findings.push(finding(element, "maximum", `${element.name} is after the latest permitted date.`, occurrenceId));
  }
  return findings;
}

function validIsoTime(input: string): boolean {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(input);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return false;
  const offsetHour = Number(match[5] ?? 0);
  const offsetMinute = Number(match[6] ?? 0);
  return offsetHour <= 14 && offsetMinute <= 59 && !(offsetHour === 14 && offsetMinute > 0);
}

function offsetMinutes(input: string): number | undefined {
  const match = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(input);
  if (!match) return undefined;
  if (match[1] === "Z") return 0;
  const minutes = Number(match[3]) * 60 + Number(match[4]);
  return match[2] === "-" ? -minutes : minutes;
}

function temporalPrecision(family: ScalarDatatypeFamily, input: string): string | undefined {
  if (family === "date") return "day";
  if (family !== "datetime" && family !== "time") return undefined;
  const fraction = /\.(\d+)/.exec(input)?.[1];
  return fraction ? `fractional-${fraction.length}` : "second";
}

export function scalarEncounterValue(element: NemsisDataElement, input: string | boolean, occurrenceId: string, attributes?: EncounterAttributes): ScalarEncounterValue {
  const family = scalarDatatypeFamily(element.datatype.base);
  const lexical = typeof input === "boolean" ? String(input) : input;
  return {
    kind: "scalar", occurrenceId, value: input,
    ...(attributes ? { attributes } : {}),
    ...(["numeric", "integer", "duration"].includes(family) ? { lexical } : {}),
    ...(temporalPrecision(family, lexical) ? { precision: temporalPrecision(family, lexical) } : {}),
    ...(offsetMinutes(lexical) !== undefined ? { utcOffsetMinutes: offsetMinutes(lexical) } : {}),
  };
}

function replaceElementValues(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string, values: ReadonlyArray<EncounterValue>, now: Date): EncounterDocument {
  const groupIndex = document.groups.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) throw new Error(`Canonical document is missing ${groupId}`);
  const group = document.groups[groupIndex]!;
  const instanceIndex = group.instances.findIndex((instance) => instance.instanceId === groupInstanceId);
  if (instanceIndex < 0) throw new Error(`Canonical document is missing ${groupId} occurrence ${groupInstanceId}`);
  const instance = group.instances[instanceIndex]!;
  const elementIndex = instance.elements.findIndex((element) => element.id === elementId);
  const elements = [...instance.elements];
  if (elementIndex < 0) elements.push({ id: elementId, values });
  else elements[elementIndex] = { ...elements[elementIndex]!, values };
  const instances = [...group.instances];
  instances[instanceIndex] = { ...instance, attributes: withoutDemoProvenance(instance.attributes), elements };
  const groups = [...document.groups];
  groups[groupIndex] = { ...group, instances };
  return { ...document, encounter: { ...document.encounter, updatedAt: now.toISOString() }, groups };
}

export function scalarOccurrences(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string): ReadonlyArray<ScalarEncounterValue> {
  return scalarSelectionOccurrences(document, groupId, groupInstanceId, elementId)
    .filter((value): value is ScalarEncounterValue => value.kind === "scalar");
}

/** All ordinary and exceptional occurrences owned by a scalar element. */
export function scalarSelectionOccurrences(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string): ReadonlyArray<EncounterValue> {
  return elementValues(document, groupId, groupInstanceId, elementId);
}

function elementValues(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string): ReadonlyArray<EncounterValue> {
  return document.groups.find((group) => group.id === groupId)?.instances
    .find((instance) => instance.instanceId === groupInstanceId)?.elements
    .find((element) => element.id === elementId)?.values ?? [];
}

export const scalarElementValues = scalarSelectionOccurrences;

export function editScalarOccurrence(document: EncounterDocument, options: {
  readonly groupId: string; readonly groupInstanceId: string; readonly elementId: string;
  readonly occurrenceId?: string; readonly input: string | boolean; readonly attributes?: EncounterAttributes;
}, createId: () => string = () => crypto.randomUUID(), now = new Date()): ScalarEditResult {
  const element = requireNemsisDataElement(options.elementId);
  if (element.groupPath.at(-1) !== options.groupId) throw new Error(`${options.elementId} does not belong to ${options.groupId}`);
  const existing = elementValues(document, options.groupId, options.groupInstanceId, options.elementId);
  const findings = validateScalarInput(element, options.input, options.occurrenceId);
  if (findings.length) return { ok: false, document, findings };
  const occurrenceId = options.occurrenceId ?? createId();
  const index = existing.findIndex((value) => value.occurrenceId === occurrenceId);
  if (options.input === "" && index >= 0) return removeScalarOccurrence(document, options.groupId, options.groupInstanceId, options.elementId, occurrenceId, now);
  if (options.input === "" && index < 0) return { ok: true, document, occurrenceId };
  if (index < 0 && element.occurrence.max !== "unbounded" && existing.length >= element.occurrence.max) {
    return { ok: false, document, findings: [finding(element, "cardinality", `${element.name} allows ${element.occurrence.max} occurrence${element.occurrence.max === 1 ? "" : "s"}.`, occurrenceId)] };
  }
  const previous = existing[index];
  const previousRecord: Record<string, unknown> = previous ?? {};
  const { kind: _kind, occurrenceId: _occurrenceId, value: _value, lexical: _lexical, precision: _precision,
    utcOffsetMinutes: _utcOffsetMinutes, attributes: _attributes, ...compatibleExtensions } = previousRecord;
  const next = {
    ...compatibleExtensions,
    ...scalarEncounterValue(element, options.input, occurrenceId, options.attributes ?? withoutDemoProvenance(previous?.attributes)),
  };
  const values = [...existing];
  if (index < 0) values.push(next); else values[index] = next;
  return { ok: true, document: replaceElementValues(document, options.groupId, options.groupInstanceId, options.elementId, values, now), occurrenceId };
}

/** Replaces one scalar occurrence with an ordinary, exceptional, or unset state without changing its identity. */
export function editScalarSelection(document: EncounterDocument, options: {
  readonly groupId: string; readonly groupInstanceId: string; readonly elementId: string;
  readonly occurrenceId?: string; readonly selection?: StationaryScalarSelection; readonly attributes?: EncounterAttributes;
}, createId: () => string = () => crypto.randomUUID(), now = new Date()): ScalarEditResult {
  if (options.selection?.kind === "scalar") return editScalarOccurrence(document, {
    groupId: options.groupId,
    groupInstanceId: options.groupInstanceId,
    elementId: options.elementId,
    ...(options.occurrenceId ? { occurrenceId: options.occurrenceId } : {}),
    input: options.selection.input,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  }, createId, now);

  const element = requireNemsisDataElement(options.elementId);
  if (element.valueSource.kind !== "scalar") throw new Error(`${options.elementId} is coded, not scalar`);
  if (element.groupPath.at(-1) !== options.groupId) throw new Error(`${options.elementId} does not belong to ${options.groupId}`);
  if (options.selection) validateStationaryExceptionalSelection(element, options.selection);
  const existing = elementValues(document, options.groupId, options.groupInstanceId, options.elementId);
  const index = options.occurrenceId
    ? existing.findIndex(({ occurrenceId }) => occurrenceId === options.occurrenceId)
    : element.occurrence.max === 1 && existing.length ? 0 : -1;
  const previous = index >= 0 ? existing[index] : undefined;
  const occurrenceId = previous?.occurrenceId ?? options.occurrenceId ?? createId();
  if (!options.selection) {
    if (!previous) return { ok: true, document, occurrenceId };
    return removeScalarOccurrence(document, options.groupId, options.groupInstanceId, options.elementId, occurrenceId, now);
  }
  if (!previous && element.occurrence.max !== "unbounded" && existing.length >= element.occurrence.max) {
    return { ok: false, document, findings: [finding(element, "cardinality", `${element.name} allows ${element.occurrence.max} occurrence${element.occurrence.max === 1 ? "" : "s"}.`, occurrenceId)] };
  }
  const previousRecord: Record<string, unknown> = previous ?? {};
  const { kind: _kind, occurrenceId: _occurrenceId, value: _value, lexical: _lexical, precision: _precision,
    utcOffsetMinutes: _utcOffsetMinutes, attributes: _attributes, code: _code, display: _display,
    notValue: _notValue, ...compatibleExtensions } = previousRecord;
  const attributes = options.attributes ?? withoutDemoProvenance(previous?.attributes);
  const common = { ...compatibleExtensions, occurrenceId, ...(attributes ? { attributes } : {}) };
  const next: EncounterValue = options.selection.kind === "pertinent-negative"
    ? { ...common, kind: "pertinent-negative", code: options.selection.code, ...(options.selection.display ? { display: options.selection.display } : {}) }
    : { ...common, kind: "null", ...(options.selection.code ? { notValue: { code: options.selection.code, ...(options.selection.display ? { display: options.selection.display } : {}) } } : {}) };
  const values = [...existing];
  if (index < 0) values.push(next); else values[index] = next;
  return { ok: true, document: replaceElementValues(document, options.groupId, options.groupInstanceId, options.elementId, values, now), occurrenceId };
}

export function removeScalarOccurrence(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string, occurrenceId: string, now = new Date()): ScalarEditResult {
  const element = requireNemsisDataElement(elementId);
  const existing = elementValues(document, groupId, groupInstanceId, elementId);
  if (existing.length <= element.occurrence.min) return { ok: false, document, findings: [finding(element, "cardinality", `${element.name} requires ${element.occurrence.min} occurrence${element.occurrence.min === 1 ? "" : "s"}.`, occurrenceId)] };
  return { ok: true, document: replaceElementValues(document, groupId, groupInstanceId, elementId, existing.filter((value) => value.occurrenceId !== occurrenceId), now), occurrenceId };
}

export function moveScalarOccurrence(document: EncounterDocument, groupId: string, groupInstanceId: string, elementId: string, occurrenceId: string, toIndex: number, now = new Date()): ScalarEditResult {
  const element = requireNemsisDataElement(elementId);
  const values = [...elementValues(document, groupId, groupInstanceId, elementId)];
  const fromIndex = values.findIndex((value) => value.occurrenceId === occurrenceId);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= values.length) return { ok: false, document, findings: [finding(element, "cardinality", `The requested ${element.name} occurrence order is unavailable.`, occurrenceId)] };
  const [moved] = values.splice(fromIndex, 1);
  values.splice(toIndex, 0, moved!);
  return { ok: true, document: replaceElementValues(document, groupId, groupInstanceId, elementId, values, now), occurrenceId };
}
