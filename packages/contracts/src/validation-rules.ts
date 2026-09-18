import type { EncounterDocument } from "./index.js";

export const VALIDATION_LANGUAGE_VERSION = "1.0.0" as const;
export const VALIDATION_COMPILED_SCHEMA_VERSION = 1 as const;

export type ValidationSeverity = "error" | "warning" | "information";
export type ValidationExecutionTarget = "live" | "sign" | "review";

export interface ValidationRuleSource {
  id: string;
  name: string;
  enabled: boolean;
  severity: ValidationSeverity;
  executionTargets: ValidationExecutionTarget[];
  primaryTargetElementId: string;
  message: string;
  /** Version 1 grammar: assert present("<catalog element id>") */
  source: string;
}

export interface ValidationDiagnostic {
  severity: "error" | "warning";
  code: "syntax" | "catalog-reference" | "primary-target" | "execution-target";
  message: string;
  ruleId: string;
}

export interface CompiledValidationRule {
  schemaVersion: 1;
  languageVersion: typeof VALIDATION_LANGUAGE_VERSION;
  ruleId: string;
  validationVersionId: string;
  name: string;
  enabled: boolean;
  severity: ValidationSeverity;
  executionTargets: ValidationExecutionTarget[];
  primaryTarget: { elementId: string };
  message: string;
  assertion: { operator: "present"; elementId: string };
}

export interface CompiledValidationBundle {
  schemaVersion: 1;
  languageVersion: typeof VALIDATION_LANGUAGE_VERSION;
  validationVersionId: string;
  catalogReleaseId: string;
  rules: CompiledValidationRule[];
}

export interface ValidationFinding {
  validationVersionId: string;
  ruleId: string;
  severity: ValidationSeverity;
  executionTarget: ValidationExecutionTarget;
  message: string;
  primaryTarget: {
    elementId: string;
    groupInstanceId?: string;
    occurrenceId?: string;
  };
  inputFingerprint: string;
}

const requiredElementSource = /^\s*assert\s+present\(\s*"([A-Za-z][A-Za-z0-9_.:-]{0,199})"\s*\)\s*;?\s*$/;

export function formatRequiredElementSource(elementId: string): string {
  return `assert present("${elementId}")`;
}

export function compileValidationRule(
  rule: ValidationRuleSource,
  validationVersionId: string,
  catalogElementIds: ReadonlySet<string>,
): { compiled?: CompiledValidationRule; diagnostics: ValidationDiagnostic[] } {
  const diagnostics: ValidationDiagnostic[] = [];
  const match = requiredElementSource.exec(rule.source);
  if (!match) {
    diagnostics.push({ severity: "error", code: "syntax", ruleId: rule.id,
      message: 'Expected assert present("<catalog element id>")' });
    return { diagnostics };
  }
  const elementId = match[1]!;
  if (!catalogElementIds.has(elementId)) diagnostics.push({ severity: "error", code: "catalog-reference", ruleId: rule.id,
    message: `Element ${elementId} is not present in the bound catalog` });
  if (rule.primaryTargetElementId !== elementId) diagnostics.push({ severity: "error", code: "primary-target", ruleId: rule.id,
    message: "The primary target must match the required element in this language version" });
  if (!rule.executionTargets.length) diagnostics.push({ severity: "error", code: "execution-target", ruleId: rule.id,
    message: "Select at least one execution target" });
  if (diagnostics.some(({ severity }) => severity === "error")) return { diagnostics };
  return { diagnostics, compiled: {
    schemaVersion: VALIDATION_COMPILED_SCHEMA_VERSION,
    languageVersion: VALIDATION_LANGUAGE_VERSION,
    ruleId: rule.id,
    validationVersionId,
    name: rule.name.trim(),
    enabled: rule.enabled,
    severity: rule.severity,
    executionTargets: [...new Set(rule.executionTargets)].sort(),
    primaryTarget: { elementId },
    message: rule.message.trim(),
    assertion: { operator: "present", elementId },
  } };
}

function fingerprint(value: string): string {
  // FNV-1a is intentionally portable between browser and server. It fingerprints
  // the relevant inputs for acknowledgement invalidation; it is not a security digest.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function evaluateValidationBundle(
  bundle: CompiledValidationBundle,
  document: EncounterDocument,
  executionTarget: ValidationExecutionTarget,
): ValidationFinding[] {
  const elements = document.groups.flatMap((group) => group.instances.flatMap((instance) =>
    instance.elements.map((element) => ({ element, groupInstanceId: instance.instanceId }))));
  return bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes(executionTarget)).flatMap((rule) => {
    const matches = elements.filter(({ element }) => element.id === rule.assertion.elementId);
    const present = matches.some(({ element }) => element.values.some((value) => value.kind !== "absent"));
    if (present) return [];
    return [{
      validationVersionId: bundle.validationVersionId,
      ruleId: rule.ruleId,
      severity: rule.severity,
      executionTarget,
      message: rule.message,
      primaryTarget: {
        elementId: rule.primaryTarget.elementId,
        ...(matches[0]?.groupInstanceId ? { groupInstanceId: matches[0].groupInstanceId } : {}),
      },
      inputFingerprint: fingerprint(JSON.stringify({ elementId: rule.assertion.elementId, values: [] })),
    } satisfies ValidationFinding];
  });
}
