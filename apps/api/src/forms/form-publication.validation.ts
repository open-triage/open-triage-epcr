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
    if (section.presentation !== undefined && !isRecord(section.presentation)) {
      findings.push(`${path}.presentation must be an object`);
    } else if (isRecord(section.presentation) && section.presentation.title !== undefined &&
      (typeof section.presentation.title !== "string" || section.presentation.title.length > 500)) {
      findings.push(`${path}.presentation.title must be text of at most 500 characters`);
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
      if (field.configuration !== undefined && !isRecord(field.configuration)) {
        findings.push(`${fieldPath}.configuration must be an object`);
      } else if (isRecord(field.configuration)) {
        for (const property of ["label", "helpText"] as const) {
          const text = field.configuration[property];
          if (text !== undefined && (typeof text !== "string" || text.length > 500))
            findings.push(`${fieldPath}.configuration.${property} must be text of at most 500 characters`);
        }
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
    if (!Array.isArray(value.locales)) findings.push("locales must be an array");
    else {
      const locales = new Set<string>();
      value.locales.forEach((locale, index) => {
        if (!isRecord(locale) || locale.locale !== "sv") {
          findings.push(`locales[${index}].locale must be sv`);
        } else if (locales.has(locale.locale)) findings.push(`locales[${index}].locale is duplicated`);
        else locales.add(locale.locale);
        if (!isRecord(locale) || !isRecord(locale.translations)) {
          findings.push(`locales[${index}].translations must be an object`);
          return;
        }
        for (const scope of Object.keys(locale.translations)) {
          if (scope !== "sections" && scope !== "fields") findings.push(`locales[${index}].translations.${scope} is unsupported`);
        }
        for (const [scope, identities, properties] of [
          ["sections", sectionKeys, ["title"]], ["fields", fieldKeys, ["label", "helpText"]]
        ] as const) {
          const entries = locale.translations[scope];
          if (entries === undefined) continue;
          if (!isRecord(entries)) { findings.push(`locales[${index}].translations.${scope} must be an object`); continue; }
          for (const [key, entry] of Object.entries(entries)) {
            if (!identities.has(key)) findings.push(`locales[${index}].translations.${scope}.${key} references an unknown identity`);
            if (!isRecord(entry)) { findings.push(`locales[${index}].translations.${scope}.${key} must be an object`); continue; }
            for (const [property, text] of Object.entries(entry)) {
              if (!(properties as readonly string[]).includes(property) || typeof text !== "string" || !text.trim() || text.length > 500)
                findings.push(`locales[${index}].translations.${scope}.${key}.${property} must be non-empty supported text`);
            }
          }
        }
        if (locale.sourceReview !== undefined) {
          if (!isRecord(locale.sourceReview)) findings.push(`locales[${index}].sourceReview must be an object`);
          else for (const [path, reviewed] of Object.entries(locale.sourceReview)) {
            const valid = (path.startsWith("sections.") && path.endsWith(".title") && sectionKeys.has(path.slice(9, -6)))
              || (path.startsWith("fields.") && path.endsWith(".label") && fieldKeys.has(path.slice(7, -6)))
              || (path.startsWith("fields.") && path.endsWith(".helpText") && fieldKeys.has(path.slice(7, -9)));
            if (!valid || typeof reviewed !== "boolean") findings.push(`locales[${index}].sourceReview.${path} is invalid`);
          }
        }
      });
    }
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
