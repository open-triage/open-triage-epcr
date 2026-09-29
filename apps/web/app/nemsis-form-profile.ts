import { requireNemsisDataElement, resolveNemsisElementValues, type NemsisCodeValue } from "./nemsis-data-model";
import type { NemsisReference, ProcedureField, VitalNullValue } from "./encounter-definition";
import { procedureSuccessState, procedureOutcomeState, procedureNoneCode } from "./procedure-code-state";

export function requiredByNemsis(reference: NemsisReference): boolean {
  return requireNemsisDataElement(reference).occurrence.min > 0;
}

function numericBoundary(reference: NemsisReference, key: "minInclusive" | "maxInclusive"): number {
  const element = requireNemsisDataElement(reference);
  const explicit = element.datatype.constraints[key];
  if (typeof explicit === "number") return explicit;
  const numericValues = resolveNemsisElementValues(element).permissibleValues.map(({ code }) => Number(code)).filter(Number.isFinite);
  if (numericValues.length) return key === "minInclusive" ? Math.min(...numericValues) : Math.max(...numericValues);
  const pattern = element.datatype.constraints.pattern;
  if (typeof pattern === "string") {
    const expression = new RegExp(`^(?:${pattern})$`);
    const patternValues = Array.from({ length: 10_001 }, (_, value) => value).filter((value) => expression.test(String(value)));
    if (patternValues.length) return key === "minInclusive" ? patternValues[0]! : patternValues.at(-1)!;
  }
  throw new Error(`${reference} has no numeric ${key} catalog constraint`);
}

export function vitalElementMetadata(reference: NemsisReference, warningLow: number, warningHigh: number) {
  const element = requireNemsisDataElement(reference);
  return {
    required: requiredByNemsis(reference),
    boundaries: { min: numericBoundary(reference, "minInclusive"), max: numericBoundary(reference, "maxInclusive"), warningLow, warningHigh },
    absenceStates: [
      ...element.permittedNotValues.map(({ code, label }) => ({ code: code as VitalNullValue, kind: "NV" as const, label: `${label} (NV)` })),
      ...element.permittedPertinentNegatives.map(({ code, label }) => ({ code: code as VitalNullValue, kind: "PN" as const, label: `${label} (PN)` })),
    ],
  };
}

export function elementValues(reference: NemsisReference): ReadonlyArray<NemsisCodeValue> {
  return resolveNemsisElementValues(requireNemsisDataElement(reference)).permissibleValues;
}

export function procedureElementMetadata(references: Record<ProcedureField, NemsisReference>) {
  const required = Object.fromEntries(Object.entries(references).map(([field, reference]) => [field, requiredByNemsis(reference)])) as Record<ProcedureField, boolean>;
  const attemptsElement = requireNemsisDataElement(references.attempts);
  const attemptMin = attemptsElement.datatype.constraints.minInclusive;
  const attemptMax = attemptsElement.datatype.constraints.maxInclusive;
  if (typeof attemptMin !== "number" || typeof attemptMax !== "number") throw new Error(`${references.attempts} lacks numeric attempt boundaries`);
  const successOptions = elementValues(references.success).map(({ code, label }) => ({ value: procedureSuccessState(code), label, code }));
  if (successOptions.some(({ value }) => !value)) throw new Error("Unknown procedure success code");
  const outcomeOptions = elementValues(references.outcome).map(({ code, label }) => ({ value: procedureOutcomeState(code), code, label }));
  if (outcomeOptions.some(({ value }) => !value)) throw new Error("Unknown procedure outcome code");
  const complicationOptions = elementValues(references.complications);
  const noneCode = procedureNoneCode;
  if (!noneCode) throw new Error(`${references.complications} has no None value`);
  const procedure = requireNemsisDataElement(references.procedure);
  const codeSystem = procedure.valueSource.kind === "external-code-system" ? procedure.valueSource.systems[0]?.label ?? "" : "";
  return { required, attempts: { defaultValue: attemptMin, min: attemptMin, max: attemptMax }, successOptions, outcomeOptions, complicationOptions, noneCode, terminology: { catalog: procedure.id as NemsisReference, codeSystem } };
}

export function medicationElementMetadata(references: ReadonlyArray<{ readonly id: string; readonly reference: NemsisReference }>) {
  const doseUnits = elementValues("eMedications.06").map(({ label }) => label);
  const routes = elementValues("eMedications.04").map(({ label }) => label);
  return {
    required: new Map(references.map(({ id, reference }) => [id, requiredByNemsis(reference)])),
    doseUnits,
    routes,
  };
}
