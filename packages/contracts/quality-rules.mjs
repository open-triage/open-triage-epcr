import policy from "./quality-normalization-policy.json" with { type: "json" };

export const QUALITY_RULE_VERSION = policy.qualityRuleVersion;
export const NORMALIZATION_RULE_VERSION = policy.normalizationRuleVersion;

const qualityRules = new Map(policy.qualityRules.map((rule) => [rule.elementId, rule]));

function numericValue(occurrence) {
  const raw = occurrence.valueKind === "integer"
    ? occurrence.valueInteger
    : occurrence.valueKind === "numeric" ? occurrence.valueNumeric : null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function sourceAttribute(occurrence, name) {
  const value = occurrence.sourceAttributes?.[name];
  return typeof value === "string" ? value : null;
}

function rounded(value, increment) {
  return Math.round(value / increment) * increment;
}

export function evaluateQualityAndNormalization(occurrences) {
  const qualityFindings = [];
  const derivedValues = [];
  for (const occurrence of occurrences) {
    const observed = numericValue(occurrence);
    if (observed === null) continue;

    let rule = qualityRules.get(occurrence.elementId);
    if (occurrence.elementId === policy.etco2.elementId) {
      const sourceType = sourceAttribute(occurrence, policy.etco2.typeAttribute);
      const unitRule = sourceType ? policy.etco2.typeMappings[sourceType] : undefined;
      if (unitRule) rule = { code: policy.etco2.qualityCode, ...unitRule };
    }

    for (const normalization of policy.normalizationRules) {
      if (occurrence.elementId === normalization.elementId &&
          sourceAttribute(occurrence, normalization.sourceAttribute) === normalization.sourceAttributeValue) {
        if (normalization.operation !== "multiply") {
          throw new Error(`Unsupported normalization operation ${normalization.operation}`);
        }
        derivedValues.push({
          sourceOccurrenceId: occurrence.id,
          elementId: occurrence.elementId,
          sourceNumeric: observed,
          sourceUnitCode: normalization.sourceUnitCode,
          derivedNumeric: rounded(observed * normalization.factor, normalization.roundTo),
          derivedUnitCode: normalization.derivedUnitCode,
          ruleId: normalization.ruleId,
          ruleVersion: NORMALIZATION_RULE_VERSION
        });
      }
    }

    if (rule && (observed < rule.minInclusive || observed > rule.maxInclusive)) {
      qualityFindings.push({
        sourceOccurrenceId: occurrence.id,
        elementId: occurrence.elementId,
        code: rule.code,
        severity: "warning",
        message: `${occurrence.elementId} value ${observed} ${rule.unitCode} is outside the inclusive ${rule.minInclusive}-${rule.maxInclusive} review range`,
        observedNumeric: observed,
        sourceUnitCode: rule.unitCode,
        expectedMinInclusive: rule.minInclusive,
        expectedMaxInclusive: rule.maxInclusive,
        ruleVersion: QUALITY_RULE_VERSION
      });
    }
  }
  return { qualityFindings, derivedValues };
}
