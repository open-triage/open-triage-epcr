import { createHash } from "node:crypto";
import type {
  CanonicalFormDefinition,
  CanonicalFormField,
  FormRuleExpression,
  PublishFormVersionCommand
} from "./form-publication.types.js";

export class FormPublicationValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Form publication failed: ${findings.join("; ")}`);
    this.name = "FormPublicationValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Removes wording accepted by historical form versions; the catalog now owns it. */
export function withoutLegacyFormWording(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const { locales: _locales, ...definition } = input;
  if (!Array.isArray(definition.sections)) return definition;
  return { ...definition, sections: definition.sections.map((candidate) => {
    if (!isRecord(candidate)) return candidate;
    const { presentation: _presentation, ...section } = candidate;
    if (!Array.isArray(section.fields)) return section;
    return { ...section, fields: section.fields.map((candidateField) => {
      if (!isRecord(candidateField)) return candidateField;
      const { configuration: _configuration, ...field } = candidateField;
      return field;
    }) };
  }) };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function canonicalDefinitionSha256(definition: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(definition))).digest("hex");
}

function validateExpression(
  expression: unknown,
  path: string,
  fieldKeys: ReadonlySet<string>,
  findings: string[]
): expression is FormRuleExpression {
  if (!isRecord(expression) || typeof expression.operator !== "string") {
    findings.push(`${path} must be a rule expression`);
    return false;
  }
  const fieldOperator = expression.operator === "exists" || expression.operator === "equals";
  if (fieldOperator) {
    if (typeof expression.field !== "string" || !fieldKeys.has(expression.field)) {
      findings.push(`${path}.field references an unknown field`);
    }
    if (expression.operator === "equals") {
      const value = expression.value;
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        findings.push(`${path}.value must be a scalar or null`);
      }
    }
    return true;
  }
  if (expression.operator === "not") {
    return validateExpression(expression.condition, `${path}.condition`, fieldKeys, findings);
  }
  if (expression.operator === "and" || expression.operator === "or") {
    if (!Array.isArray(expression.conditions) || expression.conditions.length === 0) {
      findings.push(`${path}.conditions must be a non-empty array`);
      return false;
    }
    expression.conditions.forEach((condition, index) =>
      validateExpression(condition, `${path}.conditions[${index}]`, fieldKeys, findings)
    );
    return true;
  }
  findings.push(`${path}.operator is not supported`);
  return false;
}

export function validateCanonicalFormDefinition(value: unknown): CanonicalFormDefinition {
  const findings: string[] = [];
  if (!isRecord(value)) throw new FormPublicationValidationError(["definition must be an object"]);
  if (value.schemaVersion !== 1) findings.push("schemaVersion must be 1");
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    findings.push("sections must be a non-empty array");
  }
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const fields: CanonicalFormField[] = [];
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const fieldSources = new Set<string>();
  sections.forEach((section, sectionIndex) => {
    const path = `sections[${sectionIndex}]`;
    if (!isRecord(section)) {
      findings.push(`${path} must be an object`);
      return;
    }
    if (typeof section.key !== "string" || !section.key.trim()) findings.push(`${path}.key is required`);
    else if (sectionKeys.has(section.key)) findings.push(`${path}.key is duplicated`);
    else sectionKeys.add(section.key);
    if (section.name !== undefined && (typeof section.name !== "string" || !section.name.trim() || section.name.length > 120)) {
      findings.push(`${path}.name must contain between 1 and 120 characters`);
    }
    if (section.presentation !== undefined) {
      findings.push(`${path}.presentation is unsupported; edit the catalog group name instead`);
    }
    if (!Array.isArray(section.fields)) findings.push(`${path}.fields must be an array`);
    else section.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields[${fieldIndex}]`;
      if (!isRecord(field)) {
        findings.push(`${fieldPath} must be an object`);
        return;
      }
      if (typeof field.key !== "string" || !field.key.trim()) findings.push(`${fieldPath}.key is required`);
      else if (fieldKeys.has(field.key)) findings.push(`${fieldPath}.key is duplicated`);
      else fieldKeys.add(field.key);
      if (!isRecord(field.source) || !["nemsis", "custom"].includes(String(field.source.kind))) {
        findings.push(`${fieldPath}.source is invalid`);
      } else if (field.source.kind === "nemsis" &&
        (typeof field.source.elementId !== "string" || !field.source.elementId.trim())) {
        findings.push(`${fieldPath}.source.elementId is required`);
      } else if (field.source.kind === "custom" &&
        (typeof field.source.elementDefinitionId !== "string" || !uuidPattern.test(field.source.elementDefinitionId))) {
        findings.push(`${fieldPath}.source.elementDefinitionId must be a UUID`);
      } else if (field.source.kind === "custom" && field.source.groupDefinitionId !== undefined &&
        (typeof field.source.groupDefinitionId !== "string" || !uuidPattern.test(field.source.groupDefinitionId))) {
        findings.push(`${fieldPath}.source.groupDefinitionId must be a UUID`);
      }
      if (isRecord(field.source)) {
        const sourceIdentity = field.source.kind === "nemsis" && typeof field.source.elementId === "string"
          ? `nemsis:${field.source.elementId}`
          : field.source.kind === "custom" && typeof field.source.elementDefinitionId === "string"
            ? `custom:${field.source.elementDefinitionId}` : null;
        if (sourceIdentity && fieldSources.has(sourceIdentity)) findings.push(`${fieldPath}.source is duplicated`);
        else if (sourceIdentity) fieldSources.add(sourceIdentity);
      }
      if (field.required !== undefined && typeof field.required !== "boolean") {
        findings.push(`${fieldPath}.required must be a boolean`);
      }
      if (field.allowedAbsenceStates !== undefined &&
        (!Array.isArray(field.allowedAbsenceStates) ||
         field.allowedAbsenceStates.some((state) => typeof state !== "string") ||
         new Set(field.allowedAbsenceStates).size !== field.allowedAbsenceStates.length)) {
        findings.push(`${fieldPath}.allowedAbsenceStates must contain unique strings`);
      }
      if (field.configuration !== undefined) {
        findings.push(`${fieldPath}.configuration is unsupported; edit wording in the element catalog`);
      }
      if (field.choicePolicy !== undefined) {
        if (!Array.isArray(field.choicePolicy) || field.choicePolicy.some((choice) => !isRecord(choice) ||
          !["code", "not-value"].includes(String(choice.kind)) || typeof choice.code !== "string" || !choice.code.trim() ||
          (choice.kind === "code" && typeof choice.codeSystem !== "string") ||
          (choice.kind === "not-value" && choice.codeSystem !== undefined))) {
          findings.push(`${fieldPath}.choicePolicy must contain coded or NOT choice identities`);
        } else {
          const identities = field.choicePolicy.map((choice) => `${choice.kind}:${choice.kind === "code" ? choice.codeSystem : ""}:${choice.code}`);
          if (new Set(identities).size !== identities.length)
            findings.push(`${fieldPath}.choicePolicy contains duplicate choices`);
        }
        if (!isRecord(field.source) || !["nemsis", "custom"].includes(String(field.source.kind)))
          findings.push(`${fieldPath}.choicePolicy requires a catalog field`);
      }
      if (field.rules !== undefined && !Array.isArray(field.rules)) findings.push(`${fieldPath}.rules must be an array`);
      fields.push(field as unknown as CanonicalFormField);
    });
  });
  fields.forEach((field, fieldIndex) => (Array.isArray(field.rules) ? field.rules : []).forEach((rule, ruleIndex) => {
    const path = `fields[${fieldIndex}].rules[${ruleIndex}]`;
    if (!isRecord(rule) || !["visibility", "requiredness"].includes(String(rule.kind))) {
      findings.push(`${path}.kind is invalid`);
      return;
    }
    validateExpression(rule.expression, `${path}.expression`, fieldKeys, findings);
  }));
  if (value.locales !== undefined) {
    findings.push("locales is unsupported; edit localization in the element catalog");
  }
  if (findings.length) throw new FormPublicationValidationError(findings);
  return value as unknown as CanonicalFormDefinition;
}

export function validatePublishCommand(value: unknown): PublishFormVersionCommand {
  if (!isRecord(value)) throw new FormPublicationValidationError(["request body must be an object"]);
  const findings: string[] = [];
  if (typeof value.publishedBy !== "string" || !uuidPattern.test(value.publishedBy)) findings.push("publishedBy must be a UUID");
  if (typeof value.changeNote !== "string" || !value.changeNote.trim()) findings.push("changeNote is required");
  if (value.displayName !== undefined && (typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.trim().length > 120)) {
    findings.push("displayName must contain 1 to 120 characters");
  }
  if (typeof value.definitionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.definitionSha256)) {
    findings.push("definitionSha256 must be a lowercase SHA-256 digest");
  }
  if (value.warningAcknowledgements !== undefined && !isRecord(value.warningAcknowledgements)) {
    findings.push("warningAcknowledgements must be an object");
  }
  if (findings.length) throw new FormPublicationValidationError(findings);
  return value as unknown as PublishFormVersionCommand;
}
