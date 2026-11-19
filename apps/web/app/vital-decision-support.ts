import {
  calculateDecisionSupportFindings,
  decisionSupportElementKey,
  decisionSupportFindingResult,
  decisionSupportMeasurementLocalTime,
  EMPTY_DECISION_SUPPORT_FINDINGS,
  isTriageColour,
  UNASSESSED_DECISION_SUPPORT,
  type ClinicalDecisionSupportConfiguration,
  type DecisionSupportDefinition,
  type DraftDecisionSupportAssessment,
  type TriageColour,
  type EncounterElement,
  type EncounterGroupInstance,
} from "@open-triage/contracts";
import { clinicalInstantParts } from "./agency-time-zone";

export const UNASSESSED_VITAL: DraftDecisionSupportAssessment = {
  calculation: UNASSESSED_DECISION_SUPPORT,
  override: null,
};

export function vitalAssessmentWithFindings(assessment: DraftDecisionSupportAssessment,
  definition: DecisionSupportDefinition, localTime: string): DraftDecisionSupportAssessment {
  const result = decisionSupportFindingResult(definition, assessment.findings ?? EMPTY_DECISION_SUPPORT_FINDINGS, localTime);
  return { ...assessment, calculation: calculateDecisionSupportFindings(definition, result) };
}

function measurement(instance: EncounterGroupInstance | undefined) {
  const value = instance?.elements.find(({ id }) => id === "eVitals.01")?.values[0];
  return value?.kind === "scalar" && typeof value.value === "string" ? value : undefined;
}

export function vitalRecordedLocalTime(instance: EncounterGroupInstance | undefined): string | undefined {
  const time = measurement(instance);
  if (typeof time?.utcOffsetMinutes !== "number") return undefined;
  return decisionSupportMeasurementLocalTime(String(time.value), time.utcOffsetMinutes);
}

/** Mobile canonical timestamps use UTC; preserve the measurement's original wall clock separately. */
export function withVitalMeasurementOffset(instance: EncounterGroupInstance, timeZone: string | null, replaceExisting = false): EncounterGroupInstance {
  const time = measurement(instance);
  if (!time || (!replaceExisting && typeof time.utcOffsetMinutes === "number")) return instance;
  const local = clinicalInstantParts(String(time.value), timeZone);
  if (!local) return instance;
  const minutes = (Number(local.offset.slice(1, 3)) * 60 + Number(local.offset.slice(4))) * (local.offset.startsWith("-") ? -1 : 1);
  return { ...instance, elements: instance.elements.map((element) => element.id === "eVitals.01"
    ? { ...element, values: [{ ...time, utcOffsetMinutes: minutes }, ...element.values.slice(1)] } : element) };
}

export function vitalDecisionSupport(
  instance: EncounterGroupInstance | undefined,
  configuration: ClinicalDecisionSupportConfiguration,
): DraftDecisionSupportAssessment {
  const calculation = instance?.decisionSupportCalculation;
  if (calculation?.systemKey !== configuration.definition.key || calculation.version !== configuration.definition.version) {
    return UNASSESSED_VITAL;
  }
  const { fields } = configuration;
  const values = (field: keyof typeof fields) =>
    instance?.elements.find(({ id }) => id === decisionSupportElementKey(fields[field]))?.values ?? [];
  const value = values("overrideColour")[0];
  const { enteredBy, enteredAt, calculatedColourWhenSelected, inheritedFromMeasurement } = value?.attributes ?? {};
  const negative = values("noWarningCriteria")[0];
  return {
    calculation: calculation.status === "unassessed" ? UNASSESSED_DECISION_SUPPORT
      : { status: calculation.status, colour: calculation.colour,
        ...(calculation.criterionCode ? { criterionCode: calculation.criterionCode } : {}) },
    findings: {
      criteria: values("criteria").flatMap((criterion) => criterion.kind === "coded" ? [criterion.code] : []),
      noWarningCriteria: negative?.kind === "scalar" && negative.value === true,
    },
    override: value?.kind === "coded" && isTriageColour(value.code) &&
      typeof enteredBy === "string" && typeof enteredAt === "string" ? {
        colour: value.code,
        enteredBy,
        enteredAt,
        calculatedColourWhenSelected: isTriageColour(calculatedColourWhenSelected) ? calculatedColourWhenSelected : null,
        ...(typeof inheritedFromMeasurement === "string" ? { inheritedFromMeasurement } : {}),
      } : null,
  };
}

export function withVitalDecisionSupport(
  instance: EncounterGroupInstance,
  configuration: ClinicalDecisionSupportConfiguration,
  assessment: DraftDecisionSupportAssessment,
): EncounterGroupInstance {
  const { definition, fields } = configuration;
  const managed = [fields.overrideColour, fields.categories, fields.criteria, fields.noWarningCriteria].map(decisionSupportElementKey);
  const elements = instance.elements.filter(({ id }) => !managed.includes(id));
  function writeCodes(field: keyof typeof fields, codes: readonly string[], attributes?: EncounterElement["values"][number]["attributes"]) {
    if (!codes.length) return;
    const configured = fields[field];
    if (configured.datatype !== "coded") throw new Error(`Invalid decision support field: ${field}`);
    const key = decisionSupportElementKey(configured);
    const prior = instance.elements.find(({ id }) => id === key)?.values ?? [];
    elements.push({ id: key, values: codes.map((code) => ({
      occurrenceId: (field === "overrideColour" ? prior[0] : prior.find((value) => value.kind === "coded" && value.code === code))?.occurrenceId
        ?? (field === "overrideColour" ? `${instance.instanceId}:decision-support-override` : `${instance.instanceId}:decision-support:${field}:${code}`),
      kind: "coded", code, system: configured.codeSystem,
      display: configured.choices.find((choice) => choice.code === code)?.label,
      ...(attributes ? { attributes } : {}),
    })) });
  }
  if (assessment.override) {
    const { colour, ...attributes } = assessment.override;
    writeCodes("overrideColour", [colour], attributes);
  }
  if (assessment.findings) {
    const { criteria, noWarningCriteria } = assessment.findings;
    const categoryCodes = decisionSupportFindingResult(definition, assessment.findings, vitalRecordedLocalTime(instance) ?? "").categoryCodes;
    writeCodes("criteria", criteria);
    writeCodes("categories", categoryCodes);
    if (noWarningCriteria) {
      const key = decisionSupportElementKey(fields.noWarningCriteria);
      const prior = instance.elements.find(({ id }) => id === key)?.values[0];
      elements.push({ id: key, values: [{ kind: "scalar", value: true,
        occurrenceId: prior?.occurrenceId ?? `${instance.instanceId}:decision-support:negative` }] });
    }
  }
  return {
    ...instance, elements,
    decisionSupportCalculation: { ...assessment.calculation, systemKey: definition.key, version: definition.version },
  };
}

export function chooseVitalOverride(assessment: DraftDecisionSupportAssessment, colour: TriageColour | null,
  enteredBy: string, enteredAt: string): DraftDecisionSupportAssessment {
  if ((assessment.override?.colour ?? null) === colour) return assessment;
  return { ...assessment, override: colour
    ? { colour, enteredBy, enteredAt, calculatedColourWhenSelected: assessment.calculation.colour }
    : null };
}
