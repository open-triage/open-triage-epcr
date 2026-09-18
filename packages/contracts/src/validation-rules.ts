import type { EncounterDocument, EncounterValue } from "./index.js";

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
  /** `when <boolean>` is optional; `require <boolean>` is mandatory. */
  source: string;
}

export interface ValidationCatalogElement {
  elementId: string;
  label: string;
  baseDatatype: string;
}

export interface ValidationCatalogCode {
  elementId: string;
  code: string;
  codeSystem: string;
  label: string;
  enabled?: boolean;
}

export interface ValidationCatalog {
  elements: readonly ValidationCatalogElement[];
  codes?: readonly ValidationCatalogCode[];
}

export interface ValidationDiagnostic {
  severity: "error" | "warning";
  code: "syntax" | "catalog-reference" | "datatype" | "primary-target" | "execution-target";
  message: string;
  ruleId: string;
  line?: number;
  column?: number;
}

export type CompiledValidationExpression =
  | { operator: "present"; elementId: string }
  | { operator: "coded"; elementId: string; codeSystem: string; code: string }
  | { operator: "equals"; elementId: string; value: string | number | boolean }
  | { operator: "all"; operands: CompiledValidationExpression[] }
  | { operator: "any"; operands: CompiledValidationExpression[] }
  | { operator: "not"; operand: CompiledValidationExpression };

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
  applicability?: CompiledValidationExpression;
  assertion: CompiledValidationExpression;
  references: { elementIds: string[]; codes: Array<{ elementId: string; codeSystem: string; code: string }> };
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
  primaryTarget: { elementId: string; groupInstanceId?: string; occurrenceId?: string };
  inputFingerprint: string;
}

type Token = { kind: "identifier" | "string" | "number" | "punctuation" | "eof"; value: string; offset: number };
type ParsedSource = { applicability?: CompiledValidationExpression; assertion: CompiledValidationExpression };

class ParseFailure extends Error {
  constructor(message: string, readonly offset: number) { super(message); }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) { offset += 1; continue; }
    const start = offset;
    const character = source[offset]!;
    if (character === "(" || character === ")" || character === ",") {
      tokens.push({ kind: "punctuation", value: character, offset }); offset += 1; continue;
    }
    if (character === '"') {
      offset += 1;
      let value = "";
      while (offset < source.length && source[offset] !== '"') {
        if (source[offset] === "\\") {
          const escaped = source[offset + 1];
          if (escaped !== '"' && escaped !== "\\") throw new ParseFailure("Only quoted strings and backslashes may be escaped", offset);
          value += escaped; offset += 2;
        } else { value += source[offset]; offset += 1; }
      }
      if (source[offset] !== '"') throw new ParseFailure("Unterminated string literal", start);
      offset += 1; tokens.push({ kind: "string", value, offset: start }); continue;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/.exec(source.slice(offset));
    if (number) { tokens.push({ kind: "number", value: number[0], offset }); offset += number[0].length; continue; }
    const identifier = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(offset));
    if (identifier) { tokens.push({ kind: "identifier", value: identifier[0], offset }); offset += identifier[0].length; continue; }
    throw new ParseFailure(`Unexpected character ${JSON.stringify(character)}`, offset);
  }
  tokens.push({ kind: "eof", value: "", offset: source.length });
  return tokens;
}

class ExpressionParser {
  private index = 0;
  private readonly tokens: Token[];
  constructor(private readonly source: string, private readonly sourceOffset: number) { this.tokens = tokenize(source); }
  parse(): CompiledValidationExpression {
    const expression = this.expression();
    const remainder = this.peek();
    if (remainder.kind !== "eof") throw new ParseFailure(`Unexpected ${remainder.value}`, this.sourceOffset + remainder.offset);
    return expression;
  }
  private expression(): CompiledValidationExpression {
    const functionName = this.take("identifier", "Expected a Boolean function");
    this.punctuation("(");
    if (functionName.value === "present") {
      const elementId = this.take("string", "present expects an element ID string").value;
      this.punctuation(")"); return { operator: "present", elementId };
    }
    if (functionName.value === "coded") {
      const elementId = this.take("string", "coded expects an element ID string").value; this.punctuation(",");
      const codeSystem = this.take("string", "coded expects a code-system string").value; this.punctuation(",");
      const code = this.take("string", "coded expects a code string").value; this.punctuation(")");
      return { operator: "coded", elementId, codeSystem, code };
    }
    if (functionName.value === "equals") {
      const elementId = this.take("string", "equals expects an element ID string").value; this.punctuation(",");
      const literal = this.peek();
      if (!(["string", "number", "identifier"] as Token["kind"][]).includes(literal.kind)) {
        throw new ParseFailure("equals expects a string, number, or Boolean value", this.sourceOffset + literal.offset);
      }
      this.index += 1;
      let value: string | number | boolean;
      if (literal.kind === "number") value = Number(literal.value);
      else if (literal.kind === "identifier" && ["true", "false"].includes(literal.value)) value = literal.value === "true";
      else if (literal.kind === "string") value = literal.value;
      else throw new ParseFailure("equals accepts only true or false as unquoted values", this.sourceOffset + literal.offset);
      this.punctuation(")"); return { operator: "equals", elementId, value };
    }
    if (functionName.value === "not") {
      const operand = this.expression(); this.punctuation(")"); return { operator: "not", operand };
    }
    if (functionName.value === "all" || functionName.value === "any") {
      const operands: CompiledValidationExpression[] = [this.expression()];
      while (this.peek().value === ",") { this.index += 1; operands.push(this.expression()); }
      this.punctuation(")");
      if (operands.length < 2) throw new ParseFailure(`${functionName.value} expects at least two Boolean expressions`, this.sourceOffset + functionName.offset);
      return { operator: functionName.value, operands };
    }
    throw new ParseFailure(`Unknown Boolean function ${functionName.value}`, this.sourceOffset + functionName.offset);
  }
  private peek(): Token { return this.tokens[this.index]!; }
  private take(kind: Token["kind"], message: string): Token {
    const token = this.peek();
    if (token.kind !== kind) throw new ParseFailure(message, this.sourceOffset + token.offset);
    this.index += 1; return token;
  }
  private punctuation(value: string): void {
    const token = this.peek();
    if (token.kind !== "punctuation" || token.value !== value) throw new ParseFailure(`Expected ${value}`, this.sourceOffset + token.offset);
    this.index += 1;
  }
}

function sourceSections(source: string): { when?: { text: string; offset: number }; require: { text: string; offset: number } } {
  const marker = /(^|\n)\s*(when|require|assert)\b/g;
  const matches = [...source.matchAll(marker)];
  if (!matches.length) throw new ParseFailure("Expected require <Boolean expression>", 0);
  const first = matches[0]!;
  const firstKind = first[2]!;
  const contentOffset = first.index! + first[0].length;
  if (firstKind === "assert" || firstKind === "require") {
    return { require: { text: source.slice(contentOffset).trim(), offset: contentOffset } };
  }
  const requireMarker = matches.find((match) => match[2] === "require");
  if (!requireMarker) throw new ParseFailure("A when condition must be followed by require", source.length);
  const requireOffset = requireMarker.index! + requireMarker[0].length;
  const whenText = source.slice(contentOffset, requireMarker.index).trim();
  return { ...(whenText ? { when: { text: whenText, offset: contentOffset } } : {}),
    require: { text: source.slice(requireOffset).trim(), offset: requireOffset } };
}

function parseSource(source: string): ParsedSource {
  const sections = sourceSections(source);
  if (!sections.require.text) throw new ParseFailure("require must contain a Boolean expression", sections.require.offset);
  return { ...(sections.when ? { applicability: new ExpressionParser(sections.when.text, sections.when.offset).parse() } : {}),
    assertion: new ExpressionParser(sections.require.text, sections.require.offset).parse() };
}

function location(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

function escape(value: string): string { return JSON.stringify(value); }
function formatExpression(expression: CompiledValidationExpression, depth = 0): string {
  if (expression.operator === "present") return `present(${escape(expression.elementId)})`;
  if (expression.operator === "coded") return `coded(${escape(expression.elementId)}, ${escape(expression.codeSystem)}, ${escape(expression.code)})`;
  if (expression.operator === "equals") return `equals(${escape(expression.elementId)}, ${typeof expression.value === "string" ? escape(expression.value) : expression.value})`;
  if (expression.operator === "not") return `not(${formatExpression(expression.operand, depth)})`;
  const indent = "  ".repeat(depth + 1);
  const closing = "  ".repeat(depth);
  return `${expression.operator}(\n${expression.operands.map((operand) => `${indent}${formatExpression(operand, depth + 1)}`).join(",\n")}\n${closing})`;
}

export function formatRequiredElementSource(elementId: string): string { return `require present(${escape(elementId)})`; }

export function formatValidationSource(source: string): { formatted?: string; diagnostics: ValidationDiagnostic[] } {
  try {
    const parsed = parseSource(source);
    return { diagnostics: [], formatted: `${parsed.applicability ? `when ${formatExpression(parsed.applicability)}\n` : ""}require ${formatExpression(parsed.assertion)}` };
  } catch (error) {
    const failure = error instanceof ParseFailure ? error : new ParseFailure("Invalid rule source", 0);
    return { diagnostics: [{ severity: "error", code: "syntax", ruleId: "", message: failure.message, ...location(source, failure.offset) }] };
  }
}

function catalogParts(catalog: ReadonlySet<string> | ValidationCatalog): {
  elements: Map<string, ValidationCatalogElement | undefined>; codes: ValidationCatalogCode[]; validateCodes: boolean;
} {
  if (!("elements" in catalog)) return { elements: new Map([...catalog].map((id) => [id, undefined])), codes: [], validateCodes: false };
  return { elements: new Map(catalog.elements.map((element) => [element.elementId, element])),
    codes: [...(catalog.codes ?? [])], validateCodes: true };
}

function referencedExpressions(expression: CompiledValidationExpression): Array<Extract<CompiledValidationExpression,
  { operator: "present" | "coded" | "equals" }>> {
  if (expression.operator === "all" || expression.operator === "any") return expression.operands.flatMap(referencedExpressions);
  if (expression.operator === "not") return referencedExpressions(expression.operand);
  return [expression];
}

function expectedLiteralType(datatype: string): "string" | "number" | "boolean" {
  const normalized = datatype.toLowerCase();
  if (/(integer|decimal|double|float|number)/.test(normalized)) return "number";
  if (/boolean/.test(normalized)) return "boolean";
  return "string";
}

export function compileValidationRule(rule: ValidationRuleSource, validationVersionId: string,
  catalog: ReadonlySet<string> | ValidationCatalog): { compiled?: CompiledValidationRule; diagnostics: ValidationDiagnostic[] } {
  const diagnostics: ValidationDiagnostic[] = [];
  let parsed: ParsedSource;
  try { parsed = parseSource(rule.source); }
  catch (error) {
    const failure = error instanceof ParseFailure ? error : new ParseFailure("Invalid rule source", 0);
    diagnostics.push({ severity: "error", code: "syntax", ruleId: rule.id, message: failure.message, ...location(rule.source, failure.offset) });
    return { diagnostics };
  }
  const known = catalogParts(catalog);
  const expressions = [...(parsed.applicability ? referencedExpressions(parsed.applicability) : []), ...referencedExpressions(parsed.assertion)];
  for (const expression of expressions) {
    const elementId = expression.elementId;
    const element = known.elements.get(elementId);
    if (!known.elements.has(elementId)) {
      diagnostics.push({ severity: "error", code: "catalog-reference", ruleId: rule.id,
        message: `Element ${elementId} is not present in the bound catalog` });
      continue;
    }
    if (expression.operator === "coded" && known.validateCodes) {
      const code = known.codes.find((candidate) => candidate.elementId === elementId && candidate.codeSystem === expression.codeSystem && candidate.code === expression.code);
      if (!code) diagnostics.push({ severity: "error", code: "catalog-reference", ruleId: rule.id,
        message: `Code ${expression.codeSystem}|${expression.code} is not available for ${elementId}` });
      else if (code.enabled === false) diagnostics.push({ severity: "error", code: "catalog-reference", ruleId: rule.id,
        message: `Code ${expression.codeSystem}|${expression.code} is disabled for ${elementId}` });
    }
    if (expression.operator === "equals" && element && typeof expression.value !== expectedLiteralType(element.baseDatatype)) {
      diagnostics.push({ severity: "error", code: "datatype", ruleId: rule.id,
        message: `${elementId} has datatype ${element.baseDatatype}; equals requires a ${expectedLiteralType(element.baseDatatype)} value` });
    }
  }
  if (!known.elements.has(rule.primaryTargetElementId)) diagnostics.push({ severity: "error", code: "primary-target", ruleId: rule.id,
    message: `Primary target ${rule.primaryTargetElementId} is not present in the bound catalog` });
  if (!rule.executionTargets.length) diagnostics.push({ severity: "error", code: "execution-target", ruleId: rule.id,
    message: "Select at least one execution target" });
  if (diagnostics.some(({ severity }) => severity === "error")) return { diagnostics };
  const elements = [...new Set(expressions.map((expression) => expression.elementId))].sort();
  const codes = expressions.filter((expression): expression is Extract<CompiledValidationExpression, { operator: "coded" }> => expression.operator === "coded")
    .map(({ elementId, codeSystem, code }) => ({ elementId, codeSystem, code }))
    .sort((left, right) => `${left.elementId}|${left.codeSystem}|${left.code}`.localeCompare(`${right.elementId}|${right.codeSystem}|${right.code}`));
  return { diagnostics, compiled: {
    schemaVersion: VALIDATION_COMPILED_SCHEMA_VERSION, languageVersion: VALIDATION_LANGUAGE_VERSION,
    ruleId: rule.id, validationVersionId, name: rule.name.trim(), enabled: rule.enabled,
    severity: rule.severity, executionTargets: [...new Set(rule.executionTargets)].sort(),
    primaryTarget: { elementId: rule.primaryTargetElementId }, message: rule.message.trim(),
    ...(parsed.applicability ? { applicability: parsed.applicability } : {}), assertion: parsed.assertion,
    references: { elementIds: elements, codes },
  } };
}

function labelFor(elementId: string, catalog: ValidationCatalog): string {
  const label = catalog.elements.find((element) => element.elementId === elementId)?.label;
  return label ? `${label} (${elementId})` : elementId;
}

function explainExpression(expression: CompiledValidationExpression, catalog: ValidationCatalog): string {
  if (expression.operator === "present") return `${labelFor(expression.elementId, catalog)} has a documented value`;
  if (expression.operator === "equals") return `${labelFor(expression.elementId, catalog)} equals ${JSON.stringify(expression.value)}`;
  if (expression.operator === "coded") {
    const codeLabel = catalog.codes?.find((code) => code.elementId === expression.elementId && code.codeSystem === expression.codeSystem && code.code === expression.code)?.label;
    return `${labelFor(expression.elementId, catalog)} contains ${codeLabel ? `${codeLabel} ` : ""}(${expression.codeSystem}|${expression.code})`;
  }
  if (expression.operator === "not") return `not (${explainExpression(expression.operand, catalog)})`;
  const joiner = expression.operator === "all" ? " and " : " or ";
  return expression.operands.map((operand) => `(${explainExpression(operand, catalog)})`).join(joiner);
}

export function explainValidationRule(compiled: CompiledValidationRule, catalog: ValidationCatalog): string {
  const scope = `Finding target: ${labelFor(compiled.primaryTarget.elementId, catalog)}.`;
  const condition = compiled.applicability ? `Applies when ${explainExpression(compiled.applicability, catalog)}.` : "Always applies.";
  return `${scope} ${condition} Requires ${explainExpression(compiled.assertion, catalog)}.`;
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

type DocumentElement = { element: { id: string; values: readonly EncounterValue[] }; groupInstanceId: string };
function evaluateExpression(expression: CompiledValidationExpression, elements: DocumentElement[]): boolean {
  if (expression.operator === "all") return expression.operands.every((operand) => evaluateExpression(operand, elements));
  if (expression.operator === "any") return expression.operands.some((operand) => evaluateExpression(operand, elements));
  if (expression.operator === "not") return !evaluateExpression(expression.operand, elements);
  const values = elements.filter(({ element }) => element.id === expression.elementId).flatMap(({ element }) => element.values);
  if (expression.operator === "present") return values.some((value) => value.kind !== "absent");
  if (expression.operator === "coded") return values.some((value) => value.kind === "coded" && value.code === expression.code
    && (value.system ?? "") === expression.codeSystem);
  return values.some((value) => value.kind === "scalar" && value.value === expression.value);
}

export function evaluateValidationBundle(bundle: CompiledValidationBundle, document: EncounterDocument,
  executionTarget: ValidationExecutionTarget): ValidationFinding[] {
  const elements = document.groups.flatMap((group) => group.instances.flatMap((instance) =>
    instance.elements.map((element) => ({ element, groupInstanceId: instance.instanceId }))));
  return bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes(executionTarget)).flatMap((rule) => {
    if (rule.applicability && !evaluateExpression(rule.applicability, elements)) return [];
    if (evaluateExpression(rule.assertion, elements)) return [];
    const matches = elements.filter(({ element }) => element.id === rule.primaryTarget.elementId);
    const referencedElementIds = rule.references?.elementIds ?? referencedExpressions(rule.assertion).map(({ elementId }) => elementId);
    const relevantInputs = elements.filter(({ element }) => referencedElementIds.includes(element.id))
      .map(({ element, groupInstanceId }) => ({ elementId: element.id, groupInstanceId, values: element.values }));
    return [{ validationVersionId: bundle.validationVersionId, ruleId: rule.ruleId, severity: rule.severity,
      executionTarget, message: rule.message, primaryTarget: { elementId: rule.primaryTarget.elementId,
        ...(matches[0]?.groupInstanceId ? { groupInstanceId: matches[0].groupInstanceId } : {}) },
      inputFingerprint: fingerprint(JSON.stringify(relevantInputs)) } satisfies ValidationFinding];
  });
}
