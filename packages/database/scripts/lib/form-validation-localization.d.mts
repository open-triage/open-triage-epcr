import type { MetricSource, ValidationRuleSource } from "@open-triage/contracts";

export function applyFormValidationLocalization(
  root: string,
  form: { key: unknown },
  validation: { rules: ValidationRuleSource[]; metrics?: MetricSource[] },
  options?: { missingOnly?: boolean; allowUnmatched?: boolean },
): Promise<{ rules: number; reviewPending: Array<{ id: string; reason: string }> }>;
