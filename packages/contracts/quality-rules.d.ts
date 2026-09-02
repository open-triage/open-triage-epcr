export interface QualityRuleOccurrence {
  id: string;
  elementId: string;
  valueKind: string;
  valueInteger?: string | number | null;
  valueNumeric?: string | number | null;
  sourceAttributes?: Record<string, unknown> | null;
}

export interface QualityFinding {
  sourceOccurrenceId: string;
  elementId: string;
  code: string;
  severity: "warning";
  message: string;
  observedNumeric: number;
  sourceUnitCode: string;
  expectedMinInclusive: number;
  expectedMaxInclusive: number;
  ruleVersion: string;
}

export interface DerivedValue {
  sourceOccurrenceId: string;
  elementId: string;
  sourceNumeric: number;
  sourceUnitCode: string;
  derivedNumeric: number;
  derivedUnitCode: string;
  ruleId: string;
  ruleVersion: string;
}

export interface QualityEvaluation {
  qualityFindings: QualityFinding[];
  derivedValues: DerivedValue[];
}

export const QUALITY_RULE_VERSION: "clinical-quality-1.0.0-proposed";
export const NORMALIZATION_RULE_VERSION: "clinical-normalization-1.0.0-proposed";
export function evaluateQualityAndNormalization(
  occurrences: readonly QualityRuleOccurrence[]
): QualityEvaluation;
