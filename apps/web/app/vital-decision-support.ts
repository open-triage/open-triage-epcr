import {
  decisionSupportElementKey,
  isTriageColour,
  UNASSESSED_DECISION_SUPPORT,
  type ClinicalDecisionSupportConfiguration,
  type DraftDecisionSupportAssessment,
  type TriageColour,
  type EncounterElement,
  type EncounterGroupInstance,
} from "@open-triage/contracts";

export const UNASSESSED_VITAL: DraftDecisionSupportAssessment = {
  calculation: UNASSESSED_DECISION_SUPPORT,
  override: null,
};

export function vitalDecisionSupport(
  instance: EncounterGroupInstance | undefined,
  configuration: ClinicalDecisionSupportConfiguration,
): DraftDecisionSupportAssessment {
  const calculation = instance?.decisionSupportCalculation;
  if (calculation?.systemKey !== configuration.definition.key || calculation.version !== configuration.definition.version) {
    return UNASSESSED_VITAL;
  }
  const { fields: { overrideColour } } = configuration;
  const value = instance?.elements.find(({ id }) => id === decisionSupportElementKey(overrideColour))?.values[0];
  const { enteredBy, enteredAt, calculatedColourWhenSelected, inheritedFromMeasurement } = value?.attributes ?? {};
  return {
    calculation: calculation.status === "unassessed" ? UNASSESSED_DECISION_SUPPORT
      : { status: calculation.status, colour: calculation.colour },
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
  const { definition, fields: { overrideColour } } = configuration;
  if (overrideColour.datatype !== "coded") throw new Error("Invalid vital decision support override field");
  const key = decisionSupportElementKey(overrideColour);
  const prior = instance.elements.find(({ id }) => id === key);
  const elements = instance.elements.filter(({ id }) => id !== key);
  if (assessment.override) {
    const { colour, ...attributes } = assessment.override;
    const element: EncounterElement = { id: key, values: [{
      occurrenceId: prior?.values[0]?.occurrenceId ?? `${instance.instanceId}:decision-support-override`,
      kind: "coded",
      code: colour,
      system: overrideColour.codeSystem,
      display: overrideColour.choices.find(({ code }) => code === colour)?.label,
      attributes,
    }] };
    elements.push(element);
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
