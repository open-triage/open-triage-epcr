export const QUALITY_RULE_VERSION = "clinical-quality-1.0.0-proposed";
export const NORMALIZATION_RULE_VERSION = "clinical-normalization-1.0.0-proposed";

const qualityRules = new Map([
  ["eVitals.06", { code: "vital.sbp.unusual", unit: "mm[Hg]", min: 40, max: 300 }],
  ["eVitals.07", { code: "vital.dbp.unusual", unit: "mm[Hg]", min: 20, max: 200 }],
  ["eVitals.10", { code: "vital.heart-rate.unusual", unit: "/min", min: 20, max: 250 }],
  ["eVitals.12", { code: "vital.spo2.unusual", unit: "%", min: 50, max: 100 }],
  ["eVitals.14", { code: "vital.respiratory-rate.unusual", unit: "/min", min: 4, max: 80 }],
  ["eVitals.18", { code: "vital.glucose.unusual", unit: "mg/dL", min: 20, max: 600 }],
  ["eVitals.24", { code: "vital.temperature.unusual", unit: "Cel", min: 25, max: 45 }]
]);

const etco2Units = new Map([
  ["3340001", { unit: "mm[Hg]", min: 10, max: 100 }],
  ["3340003", { unit: "%", min: 1.3, max: 13.2 }],
  ["3340005", { unit: "kPa", min: 1.3, max: 13.3 }]
]);

function numericValue(occurrence) {
  const raw = occurrence.valueKind === "integer"
    ? occurrence.valueInteger
    : occurrence.valueKind === "numeric" ? occurrence.valueNumeric : null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function etco2Type(occurrence) {
  const value = occurrence.sourceAttributes?.ETCO2Type;
  return typeof value === "string" ? value : null;
}

export function evaluateQualityAndNormalization(occurrences) {
  const qualityFindings = [];
  const derivedValues = [];
  for (const occurrence of occurrences) {
    const observed = numericValue(occurrence);
    if (observed === null) continue;

    let rule = qualityRules.get(occurrence.elementId);
    if (occurrence.elementId === "eVitals.16") {
      const sourceType = etco2Type(occurrence);
      const unitRule = sourceType ? etco2Units.get(sourceType) : undefined;
      if (unitRule) rule = { code: "vital.etco2.unusual", ...unitRule };
      if (sourceType === "3340005") {
        derivedValues.push({
          sourceOccurrenceId: occurrence.id,
          elementId: occurrence.elementId,
          sourceNumeric: observed,
          sourceUnitCode: "kPa",
          derivedNumeric: Math.round(observed * 7.50062 * 1000) / 1000,
          derivedUnitCode: "mm[Hg]",
          ruleId: "etco2.kpa-to-mmhg",
          ruleVersion: NORMALIZATION_RULE_VERSION
        });
      }
    }

    if (rule && (observed < rule.min || observed > rule.max)) {
      qualityFindings.push({
        sourceOccurrenceId: occurrence.id,
        elementId: occurrence.elementId,
        code: rule.code,
        severity: "warning",
        message: `${occurrence.elementId} value ${observed} ${rule.unit} is outside the inclusive ${rule.min}-${rule.max} review range`,
        observedNumeric: observed,
        sourceUnitCode: rule.unit,
        expectedMinInclusive: rule.min,
        expectedMaxInclusive: rule.max,
        ruleVersion: QUALITY_RULE_VERSION
      });
    }
  }
  return { qualityFindings, derivedValues };
}
