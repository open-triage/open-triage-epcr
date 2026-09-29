import { encounterValueFacets, type EncounterDocument, type EncounterValue } from "./index.js";
import { NEMSIS_351_EMS_LEGACY_CONTEXT_GUARDS, NEMSIS_351_EMS_MESSAGE_REPAIRS } from "./nemsis-3.5.1-ems.generated.js";

export const VALIDATION_LANGUAGE_VERSION = "1.0.0" as const;
export const VALIDATION_COMPILED_SCHEMA_VERSION = 1 as const;

export type ValidationSeverity = "error" | "warning" | "information";
export type ValidationExecutionTarget = "live" | "sign" | "review";
export type ValidationRuleSourceKind = "agency" | "nemsis" | "catalog" | "form" | "platform";

export interface ValidationRuleProvenance {
  standard: string;
  dataset?: string;
  sourceIdentity: string;
  sourceRelease: string;
  sourceBuild?: string;
  sourceSha256?: string;
  patternIdentity?: string;
  ruleIdentity?: string;
  context?: string;
  originalExpression: string;
  originalMessage: string;
  originalRole?: string;
  targetExpression?: string;
  subject?: string;
}

export interface ValidationRuleSource {
  id: string;
  name: string;
  enabled: boolean;
  severity: ValidationSeverity;
  executionTargets: ValidationExecutionTarget[];
  primaryTargetElementId: string;
  message: string;
  /** English source remains in name/message for older published definitions. */
  localization?: { schemaVersion: 1; sv?: { name?: string; message?: string;
    reviewedSource?: { name?: string; message?: string } } };
  /** Named values substituted in either language without affecting the assertion. */
  messageParameters?: Record<string, string | number>;
  /** `when <boolean>` is optional; `require <boolean>` is mandatory. */
  source: string;
  /** Origin metadata is retained when the editable normalized copy changes. */
  sourceKind?: ValidationRuleSourceKind;
  provenance?: ValidationRuleProvenance[];
}

export interface ValidationCatalogElement {
  elementId: string;
  label: string;
  baseDatatype: string;
  groupPath?: string[];
  intrinsicOccurrence?: { min: number; max: number | "unbounded" };
}

export interface ValidationCatalogGroup {
  groupId: string;
  label: string;
  repeating: boolean;
  parentGroupId?: string;
  intrinsicOccurrence: { min: number; max: number | "unbounded" };
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
  groups?: readonly ValidationCatalogGroup[];
  codes?: readonly ValidationCatalogCode[];
}

export interface ValidationDiagnostic {
  severity: "error" | "warning";
  code: "syntax" | "compatibility" | "resource-limit" | "catalog-reference" | "datatype" | "primary-target" | "execution-target" | "scope" | "occurrence-bound"
    | "compile" | "smoke-evaluation" | "exact-duplicate" | "similar-rule" | "possible-conflict" | "wording" | "message-parameters";
  message: string;
  ruleId: string;
  line?: number;
  column?: number;
}

export type CompiledValidationExpression =
  | { operator: "constant"; value: boolean }
  | { operator: "any-payload" }
  | { operator: "present"; elementId: string }
  | { operator: "coded"; elementId: string; codeSystem: string; code: string }
  | { operator: "equals"; elementId: string; value: string | number | boolean }
  | { operator: "minimum-occurrences"; elementId: string; count: number }
  | { operator: "maximum-occurrences"; elementId: string; count: number }
  | { operator: "undocumented"; elementId: string }
  | { operator: "has-not-value"; elementId: string; code?: string }
  | { operator: "has-pertinent-negative"; elementId: string; code?: string }
  | { operator: "member"; elementId: string; values: Array<string | number | boolean> }
  | { operator: "matches"; elementId: string; pattern: string }
  | { operator: "starts-with-element"; elementId: string; prefixElementId: string }
  | { operator: "code-type"; elementId: string; codeType: string }
  | { operator: "attribute"; elementId: string; name: string; value?: string }
  | { operator: "compare-literal"; elementId: string; comparison: ValidationComparison; value: string | number | boolean }
  | { operator: "empty-payload"; elementId: string }
  | { operator: "all-elements"; invariant: "nil-needs-absence" | "nv-needs-empty" | "pn-needs-empty-no-nv" | "unique-nv" | "unique-pn";
      excludedElementIds: string[] }
  | { operator: "quantified"; quantifier: "any" | "all" | "none"; elementId: string;
      predicate: "equals" | "member" | "matches" | "has-value" | "empty"; values?: Array<string | number | boolean>; pattern?: string }
  | { operator: "compare-elements"; leftElementId: string; comparison: ValidationComparison; rightElementId: string }
  | { operator: "compare-times"; leftElementId: string; comparison: "before" | "after" | "same-or-before" | "same-or-after";
      right: { kind: "element"; elementId: string } | { kind: "evaluation-time" }; offsetSeconds: number }
  | { operator: "occurrence-order"; firstElementId: string; relation: "before" | "adjacent"; secondElementId: string }
  | { operator: "all"; operands: CompiledValidationExpression[] }
  | { operator: "any"; operands: CompiledValidationExpression[] }
  | { operator: "not"; operand: CompiledValidationExpression };

export type ValidationComparison = "equal" | "not-equal" | "less-than" | "less-or-equal" | "greater-than" | "greater-or-equal";

export interface ValidationEvaluationContext {
  /** Caller-owned clock: evaluation never reads the ambient system time. */
  timestamp: string;
  language?: string;
  limits?: Partial<{ maxExpressionNodes: number; maxTraversalSteps: number; maxValues: number }>;
}

export class ValidationCompatibilityError extends Error {
  readonly name = "ValidationCompatibilityError";
}

export class ValidationResourceLimitError extends Error {
  readonly name = "ValidationResourceLimitError";
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
  scope?: { groupId: string; iteration: "each" };
  message: string;
  localization?: ValidationRuleSource["localization"];
  messageParameters?: ValidationRuleSource["messageParameters"];
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

/** Demographic (d*) NEMSIS elements belong to the agency dataset, not a patient care report. */
export function isNemsisDemographicElementId(elementId: string): boolean {
  return /^d[A-Za-z][A-Za-z0-9]*\.\d+$/.test(elementId);
}

function isPatientCareReportRule(rule: CompiledValidationRule): boolean {
  return !isNemsisDemographicElementId(rule.primaryTarget?.elementId ?? "")
    && !rule.references?.elementIds?.some(isNemsisDemographicElementId);
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

/** Select wording from the rule which produced the finding; identity never depends on locale. */
export function validationRuleText(rule: Pick<CompiledValidationRule, "name" | "message" | "localization" | "messageParameters"> & { ruleId?: string; id?: string },
  language: string, field: "name" | "message"): string {
  const source = language === "sv" ? rule.localization?.sv?.[field] : undefined;
  const template = source?.trim() || rule[field]?.trim() || rule.name?.trim() || rule.ruleId || rule.id || "Validation rule";
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key: string) =>
    rule.messageParameters?.[key] === undefined ? match : String(rule.messageParameters[key]));
}

function uniqueLegacyValues(values: Readonly<Record<string, string>>): Map<string, string | null> {
  const unique = new Map<string, string | null>();
  for (const [key, value] of Object.entries(values)) {
    const prefix = key.slice(0, key.lastIndexOf("\u0000") + 1);
    if (!unique.has(prefix)) unique.set(prefix, value);
    else if (unique.get(prefix) !== value) unique.set(prefix, null);
  }
  return unique;
}

const uniqueNemsisMessageRepairs = uniqueLegacyValues(NEMSIS_351_EMS_MESSAGE_REPAIRS);
const uniqueNemsisContextGuards = uniqueLegacyValues(NEMSIS_351_EMS_LEGACY_CONTEXT_GUARDS);

function legacyNemsisValue(values: Readonly<Record<string, string>>, unique: ReadonlyMap<string, string | null>,
  message: string, primaryElementId: string, referencedElementIds: ReadonlyArray<string>): string | undefined {
  const prefix = `${primaryElementId}\u0000${message}\u0000`;
  return values[`${prefix}${[...referencedElementIds].sort().join(",")}`] ?? unique.get(prefix) ?? undefined;
}

/** Restores labels lost from sch:value-of in previously published NEMSIS bundles. */
export function repairNemsisImportedMessage(message: string, primaryElementId: string,
  referencedElementIds: ReadonlyArray<string>): string {
  return legacyNemsisValue(NEMSIS_351_EMS_MESSAGE_REPAIRS, uniqueNemsisMessageRepairs,
    message, primaryElementId, referencedElementIds) ?? message;
}

export interface ValidationRuntimeFailure {
  validationVersionId: string;
  ruleId: string;
  executionTarget: ValidationExecutionTarget;
  code: "compatibility" | "resource-limit" | "runtime";
  message: string;
}

export interface ValidationEvaluationResult {
  findings: ValidationFinding[];
  failures: ValidationRuntimeFailure[];
}

type Token = { kind: "identifier" | "string" | "number" | "punctuation" | "eof"; value: string; offset: number };
type ParsedSource = { scopeGroupId?: string; applicability?: CompiledValidationExpression; assertion: CompiledValidationExpression };

class ParseFailure extends Error {
  constructor(message: string, readonly offset: number,
    readonly code: ValidationDiagnostic["code"] = "syntax") { super(message); }
}

const MAX_SOURCE_LENGTH = 16_384;
const MAX_EXPRESSION_NODES = 256;
const MAX_EXPRESSION_DEPTH = 32;
const MAX_REGEX_LENGTH = 256;
const MAX_REGEX_INPUT_LENGTH = 4_096;
const MAX_TEMPORAL_OFFSET_SECONDS = 366 * 24 * 60 * 60 * 10;
const MAX_TRAVERSAL_STEPS = 100_000;
const MAX_VALUES = 50_000;
const MAX_RULES_PER_EVALUATION = 1024;

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stableJson(child)]));
  return value;
}

/** Portable SHA-256 used to verify the exact compiled artifact in Node and offline browsers. */
export function compiledValidationBundleSha256(bundle: CompiledValidationBundle): string {
  const bytes = new TextEncoder().encode(JSON.stringify(stableJson(bundle)));
  const words = new Uint32Array(64);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const input = new Uint8Array(paddedLength);
  input.set(bytes);
  input[bytes.length] = 0x80;
  const view = new DataView(input.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const constants = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  for (let offset = 0; offset < input.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const before = words[index - 15]!; const previous = words[index - 2]!;
      const s0 = rotate(before, 7) ^ rotate(before, 18) ^ (before >>> 3);
      const s1 = rotate(previous, 17) ^ rotate(previous, 19) ^ (previous >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (h! + upper + choice + constants[index]! + words[index]!) >>> 0;
      const lower = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (lower + majority) >>> 0;
      h=g; g=f; f=e; e=(d!+first)>>>0; d=c; c=b; b=a; a=(first+second)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, index) => { hash[index] = (hash[index]! + value!) >>> 0; });
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
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
          if (escaped === undefined) throw new ParseFailure("Unterminated string escape", offset);
          value += escaped === '"' || escaped === "\\" ? escaped : `\\${escaped}`; offset += 2;
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
  private nodes = 0;
  constructor(private readonly source: string, private readonly sourceOffset: number) { this.tokens = tokenize(source); }
  parse(): CompiledValidationExpression {
    const expression = this.expression();
    const remainder = this.peek();
    if (remainder.kind !== "eof") throw new ParseFailure(`Unexpected ${remainder.value}`, this.sourceOffset + remainder.offset);
    return expression;
  }
  private expression(depth = 0): CompiledValidationExpression {
    this.nodes += 1;
    if (this.nodes > MAX_EXPRESSION_NODES) throw new ParseFailure(`Expression exceeds ${MAX_EXPRESSION_NODES} nodes`, this.sourceOffset, "resource-limit");
    if (depth > MAX_EXPRESSION_DEPTH) throw new ParseFailure(`Expression exceeds nesting depth ${MAX_EXPRESSION_DEPTH}`, this.sourceOffset, "resource-limit");
    const functionName = this.take("identifier", "Expected a Boolean function");
    this.punctuation("(");
    if (functionName.value === "always" || functionName.value === "never") {
      this.punctuation(")"); return { operator: "constant", value: functionName.value === "always" };
    }
    if (functionName.value === "anyPayload") { this.punctuation(")"); return { operator: "any-payload" }; }
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
    if (functionName.value === "minimum" || functionName.value === "maximum") {
      const elementId = this.take("string", `${functionName.value} expects an element ID string`).value; this.punctuation(",");
      const count = this.take("number", `${functionName.value} expects a non-negative integer`).value;
      if (!/^\d+$/.test(count)) throw new ParseFailure(`${functionName.value} expects a non-negative integer`, this.sourceOffset + functionName.offset);
      this.punctuation(")");
      return { operator: functionName.value === "minimum" ? "minimum-occurrences" : "maximum-occurrences",
        elementId, count: Number(count) };
    }
    if (functionName.value === "undocumented") {
      const elementId = this.stringArgument("undocumented expects an element ID string");
      this.punctuation(")"); return { operator: "undocumented", elementId };
    }
    if (functionName.value === "hasNotValue" || functionName.value === "hasPertinentNegative") {
      const elementId = this.stringArgument(`${functionName.value} expects an element ID string`);
      let code: string | undefined;
      if (this.peek().value === ",") { this.index += 1; code = this.stringArgument(`${functionName.value} expects a code string`); }
      this.punctuation(")");
      return { operator: functionName.value === "hasNotValue" ? "has-not-value" : "has-pertinent-negative", elementId, ...(code ? { code } : {}) };
    }
    if (functionName.value === "member") {
      const elementId = this.stringArgument("member expects an element ID string");
      const values = this.literalArguments("member expects one or more literal values");
      this.punctuation(")"); return { operator: "member", elementId, values };
    }
    if (functionName.value === "matches") {
      const elementId = this.stringArgument("matches expects an element ID string"); this.punctuation(",");
      const pattern = this.stringArgument("matches expects a regular-expression string");
      validateSafePattern(pattern, this.sourceOffset + functionName.offset);
      this.punctuation(")"); return { operator: "matches", elementId, pattern };
    }
    if (functionName.value === "startsWith") {
      const elementId = this.stringArgument("startsWith expects an element ID string"); this.punctuation(",");
      const prefixElementId = this.stringArgument("startsWith expects a prefix element ID string"); this.punctuation(")");
      return { operator: "starts-with-element", elementId, prefixElementId };
    }
    if (functionName.value === "codeType") {
      const elementId = this.stringArgument("codeType expects an element ID string"); this.punctuation(",");
      const codeType = this.stringArgument("codeType expects a code type string"); this.punctuation(")");
      return { operator: "code-type", elementId, codeType };
    }
    if (functionName.value === "attribute") {
      const elementId = this.stringArgument("attribute expects an element ID string"); this.punctuation(",");
      const name = this.stringArgument("attribute expects an attribute name string");
      let value: string | undefined;
      if (this.peek().value === ",") { this.index += 1; value = this.stringArgument("attribute expects a string value"); }
      this.punctuation(")"); return { operator: "attribute", elementId, name, ...(value === undefined ? {} : { value }) };
    }
    if (functionName.value === "compareValue") {
      const elementId = this.stringArgument("compareValue expects an element ID string"); this.punctuation(",");
      const comparison = this.stringArgument("compareValue expects a comparison"); this.punctuation(",");
      const value = this.literal(); this.punctuation(")");
      if (!isComparison(comparison)) throw new ParseFailure(`Unsupported comparison ${comparison}`, this.sourceOffset + functionName.offset, "compatibility");
      return { operator: "compare-literal", elementId, comparison, value };
    }
    if (functionName.value === "emptyPayload") {
      const elementId = this.stringArgument("emptyPayload expects an element ID string"); this.punctuation(")");
      return { operator: "empty-payload", elementId };
    }
    if (functionName.value === "allElements") {
      const invariant = this.stringArgument("allElements expects an invariant string");
      if (!(invariant === "nil-needs-absence" || invariant === "nv-needs-empty" || invariant === "pn-needs-empty-no-nv"
        || invariant === "unique-nv" || invariant === "unique-pn")) {
        throw new ParseFailure(`Unsupported all-element invariant ${invariant}`, this.sourceOffset + functionName.offset, "compatibility");
      }
      const excludedElementIds: string[] = [];
      while (this.peek().value === ",") { this.index += 1; excludedElementIds.push(this.stringArgument("allElements exclusions must be element IDs")); }
      this.punctuation(")"); return { operator: "all-elements", invariant, excludedElementIds };
    }
    if (["anyValue", "allValues", "noValue"].includes(functionName.value)) {
      const elementId = this.stringArgument(`${functionName.value} expects an element ID string`); this.punctuation(",");
      const predicateToken = this.take("identifier", `${functionName.value} expects a predicate`);
      const predicate = predicateToken.value;
      const quantifier = functionName.value === "anyValue" ? "any" : functionName.value === "allValues" ? "all" : "none";
      if (predicate === "hasValue" || predicate === "empty") {
        this.punctuation(")"); return { operator: "quantified", quantifier, elementId,
          predicate: predicate === "hasValue" ? "has-value" : "empty" };
      }
      if (predicate === "matches") {
        this.punctuation(","); const pattern = this.stringArgument("matches expects a regular-expression string");
        validateSafePattern(pattern, this.sourceOffset + predicateToken.offset);
        this.punctuation(")"); return { operator: "quantified", quantifier, elementId, predicate, pattern };
      }
      if (predicate !== "equals" && predicate !== "member") throw new ParseFailure(`Unsupported collection predicate ${predicate}`, this.sourceOffset + predicateToken.offset, "compatibility");
      const values = this.literalArguments(`${predicate} expects literal values`);
      if (predicate === "equals" && values.length !== 1) throw new ParseFailure("equals expects exactly one literal value", this.sourceOffset + predicateToken.offset);
      this.punctuation(")"); return { operator: "quantified", quantifier, elementId, predicate, values };
    }
    if (functionName.value === "compare") {
      const leftElementId = this.stringArgument("compare expects a left element ID"); this.punctuation(",");
      const comparison = this.stringArgument("compare expects a comparison"); this.punctuation(",");
      const rightElementId = this.stringArgument("compare expects a right element ID"); this.punctuation(")");
      if (!isComparison(comparison)) throw new ParseFailure(`Unsupported comparison ${comparison}`, this.sourceOffset + functionName.offset, "compatibility");
      return { operator: "compare-elements", leftElementId, comparison, rightElementId };
    }
    if (functionName.value === "timeCompare") {
      const leftElementId = this.stringArgument("timeCompare expects a left element ID"); this.punctuation(",");
      const comparison = this.stringArgument("timeCompare expects a temporal comparison"); this.punctuation(",");
      const rightId = this.stringArgument("timeCompare expects an element ID or evaluation-time");
      let offsetSeconds = 0;
      if (this.peek().value === ",") { this.index += 1; offsetSeconds = Number(this.take("number", "timeCompare expects an offset in seconds").value); }
      this.punctuation(")");
      if (!(comparison === "before" || comparison === "after" || comparison === "same-or-before" || comparison === "same-or-after")) {
        throw new ParseFailure(`Unsupported temporal comparison ${comparison}`, this.sourceOffset + functionName.offset, "compatibility");
      }
      if (!Number.isInteger(offsetSeconds) || Math.abs(offsetSeconds) > MAX_TEMPORAL_OFFSET_SECONDS) {
        throw new ParseFailure(`Temporal offset must be an integer within ${MAX_TEMPORAL_OFFSET_SECONDS} seconds`, this.sourceOffset + functionName.offset, "resource-limit");
      }
      return { operator: "compare-times", leftElementId, comparison,
        right: rightId === "evaluation-time" ? { kind: "evaluation-time" } : { kind: "element", elementId: rightId }, offsetSeconds };
    }
    if (functionName.value === "occurs") {
      const firstElementId = this.stringArgument("occurs expects a first element ID"); this.punctuation(",");
      const relation = this.stringArgument("occurs expects before or adjacent"); this.punctuation(",");
      const secondElementId = this.stringArgument("occurs expects a second element ID"); this.punctuation(")");
      if (relation !== "before" && relation !== "adjacent") throw new ParseFailure(`Unsupported occurrence relation ${relation}`, this.sourceOffset + functionName.offset, "compatibility");
      return { operator: "occurrence-order", firstElementId, relation, secondElementId };
    }
    if (functionName.value === "not") {
      const operand = this.expression(depth + 1); this.punctuation(")"); return { operator: "not", operand };
    }
    if (functionName.value === "all" || functionName.value === "any") {
      const operands: CompiledValidationExpression[] = [this.expression(depth + 1)];
      while (this.peek().value === ",") { this.index += 1; operands.push(this.expression(depth + 1)); }
      this.punctuation(")");
      if (operands.length < 2) throw new ParseFailure(`${functionName.value} expects at least two Boolean expressions`, this.sourceOffset + functionName.offset);
      return { operator: functionName.value, operands };
    }
    throw new ParseFailure(`Unsupported domain function ${functionName.value}`, this.sourceOffset + functionName.offset, "compatibility");
  }
  private stringArgument(message: string): string { return this.take("string", message).value; }
  private literal(): string | number | boolean {
    const token = this.peek();
    if (token.kind === "string") { this.index += 1; return token.value; }
    if (token.kind === "number") { this.index += 1; return Number(token.value); }
    if (token.kind === "identifier" && (token.value === "true" || token.value === "false")) { this.index += 1; return token.value === "true"; }
    throw new ParseFailure("Expected a string, number, or Boolean literal", this.sourceOffset + token.offset);
  }
  private literalArguments(message: string): Array<string | number | boolean> {
    const values: Array<string | number | boolean> = [];
    while (this.peek().value === ",") { this.index += 1; values.push(this.literal()); }
    if (!values.length) throw new ParseFailure(message, this.sourceOffset + this.peek().offset);
    return values;
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

function isComparison(value: string): value is ValidationComparison {
  return ["equal", "not-equal", "less-than", "less-or-equal", "greater-than", "greater-or-equal"].includes(value);
}

function validateSafePattern(pattern: string, offset: number): void {
  if (pattern.length > MAX_REGEX_LENGTH) throw new ParseFailure(`Regular expression exceeds ${MAX_REGEX_LENGTH} characters`, offset, "resource-limit");
  if (/\\[1-9]|\(\?[=!<]|\(\?>|\(\?<[^=!]/.test(pattern)) {
    throw new ParseFailure("Regular expression uses backreferences, lookaround, or named/atomic groups", offset, "compatibility");
  }
  if (/\([^)]*\)[+*{]|\([^)]*[+*][^)]*\)[+*{]|(?:\+|\*|\{\d+(?:,\d*)?\})(?:\+|\*)/.test(pattern)) {
    throw new ParseFailure("Regular expression contains nested or stacked repetition", offset, "compatibility");
  }
  try { new RegExp(pattern, "u"); } catch { throw new ParseFailure("Regular expression is invalid", offset); }
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
  if (source.length > MAX_SOURCE_LENGTH) throw new ParseFailure(`Rule source exceeds ${MAX_SOURCE_LENGTH} characters`, 0, "resource-limit");
  const scopeMatch = /^\s*for\s+each\(\s*"([^"\\]+)"\s*\)\s*(?:\r?\n|$)/.exec(source);
  const scopedSource = scopeMatch ? `${" ".repeat(scopeMatch[0].length)}${source.slice(scopeMatch[0].length)}` : source;
  const sections = sourceSections(scopedSource);
  if (!sections.require.text) throw new ParseFailure("require must contain a Boolean expression", sections.require.offset);
  return { ...(scopeMatch ? { scopeGroupId: scopeMatch[1] } : {}),
    ...(sections.when ? { applicability: new ExpressionParser(sections.when.text, sections.when.offset).parse() } : {}),
    assertion: new ExpressionParser(sections.require.text, sections.require.offset).parse() };
}

function location(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

function escape(value: string): string { return JSON.stringify(value); }
function formatExpression(expression: CompiledValidationExpression, depth = 0): string {
  if (expression.operator === "constant") return expression.value ? "always()" : "never()";
  if (expression.operator === "any-payload") return "anyPayload()";
  if (expression.operator === "present") return `present(${escape(expression.elementId)})`;
  if (expression.operator === "coded") return `coded(${escape(expression.elementId)}, ${escape(expression.codeSystem)}, ${escape(expression.code)})`;
  if (expression.operator === "equals") return `equals(${escape(expression.elementId)}, ${typeof expression.value === "string" ? escape(expression.value) : expression.value})`;
  if (expression.operator === "minimum-occurrences") return `minimum(${escape(expression.elementId)}, ${expression.count})`;
  if (expression.operator === "maximum-occurrences") return `maximum(${escape(expression.elementId)}, ${expression.count})`;
  if (expression.operator === "undocumented") return `undocumented(${escape(expression.elementId)})`;
  if (expression.operator === "has-not-value" || expression.operator === "has-pertinent-negative") {
    const name = expression.operator === "has-not-value" ? "hasNotValue" : "hasPertinentNegative";
    return `${name}(${escape(expression.elementId)}${expression.code ? `, ${escape(expression.code)}` : ""})`;
  }
  if (expression.operator === "member") return `member(${escape(expression.elementId)}, ${expression.values.map(formatLiteral).join(", ")})`;
  if (expression.operator === "matches") return `matches(${escape(expression.elementId)}, ${escape(expression.pattern)})`;
  if (expression.operator === "starts-with-element") return `startsWith(${escape(expression.elementId)}, ${escape(expression.prefixElementId)})`;
  if (expression.operator === "code-type") return `codeType(${escape(expression.elementId)}, ${escape(expression.codeType)})`;
  if (expression.operator === "attribute") return `attribute(${escape(expression.elementId)}, ${escape(expression.name)}${expression.value === undefined ? "" : `, ${escape(expression.value)}`})`;
  if (expression.operator === "compare-literal") return `compareValue(${escape(expression.elementId)}, ${escape(expression.comparison)}, ${formatLiteral(expression.value)})`;
  if (expression.operator === "empty-payload") return `emptyPayload(${escape(expression.elementId)})`;
  if (expression.operator === "all-elements") return `allElements(${escape(expression.invariant)}${expression.excludedElementIds.map((id) => `, ${escape(id)}`).join("")})`;
  if (expression.operator === "quantified") {
    const name = expression.quantifier === "any" ? "anyValue" : expression.quantifier === "all" ? "allValues" : "noValue";
    const argumentsText = expression.pattern !== undefined ? `, ${escape(expression.pattern)}`
      : expression.values?.length ? `, ${expression.values.map(formatLiteral).join(", ")}` : "";
    const predicate = expression.predicate === "has-value" ? "hasValue" : expression.predicate;
    return `${name}(${escape(expression.elementId)}, ${predicate}${argumentsText})`;
  }
  if (expression.operator === "compare-elements") return `compare(${escape(expression.leftElementId)}, ${escape(expression.comparison)}, ${escape(expression.rightElementId)})`;
  if (expression.operator === "compare-times") return `timeCompare(${escape(expression.leftElementId)}, ${escape(expression.comparison)}, ${escape(expression.right.kind === "element" ? expression.right.elementId : "evaluation-time")}${expression.offsetSeconds ? `, ${expression.offsetSeconds}` : ""})`;
  if (expression.operator === "occurrence-order") return `occurs(${escape(expression.firstElementId)}, ${escape(expression.relation)}, ${escape(expression.secondElementId)})`;
  if (expression.operator === "not") return `not(${formatExpression(expression.operand, depth)})`;
  const indent = "  ".repeat(depth + 1);
  const closing = "  ".repeat(depth);
  return `${expression.operator}(\n${expression.operands.map((operand) => `${indent}${formatExpression(operand, depth + 1)}`).join(",\n")}\n${closing})`;
}
function formatLiteral(value: string | number | boolean): string { return typeof value === "string" ? escape(value) : String(value); }

export function formatRequiredElementSource(elementId: string): string { return `require present(${escape(elementId)})`; }
export function formatOccurrenceSource(elementId: string, kind: "minimum" | "maximum", count: number,
  scopeGroupId?: string): string {
  return `${scopeGroupId ? `for each(${escape(scopeGroupId)})\n` : ""}require ${kind}(${escape(elementId)}, ${count})`;
}

export function formatValidationSource(source: string): { formatted?: string; diagnostics: ValidationDiagnostic[] } {
  try {
    const parsed = parseSource(source);
    return { diagnostics: [], formatted: `${parsed.scopeGroupId ? `for each(${escape(parsed.scopeGroupId)})\n` : ""}${parsed.applicability ? `when ${formatExpression(parsed.applicability)}\n` : ""}require ${formatExpression(parsed.assertion)}` };
  } catch (error) {
    const failure = error instanceof ParseFailure ? error : new ParseFailure("Invalid rule source", 0);
    return { diagnostics: [{ severity: "error", code: failure.code, ruleId: "", message: failure.message, ...location(source, failure.offset) }] };
  }
}

function catalogParts(catalog: ReadonlySet<string> | ValidationCatalog): {
  elements: Map<string, ValidationCatalogElement | undefined>; codes: ValidationCatalogCode[]; validateCodes: boolean;
} {
  if (!("elements" in catalog)) return { elements: new Map([...catalog].map((id) => [id, undefined])), codes: [], validateCodes: false };
  return { elements: new Map(catalog.elements.map((element) => [element.elementId, element])),
    codes: [...(catalog.codes ?? [])], validateCodes: true };
}

type ExpressionReference = { elementId: string; expression: CompiledValidationExpression };
function referencedExpressions(expression: CompiledValidationExpression): ExpressionReference[] {
  if (expression.operator === "constant" || expression.operator === "any-payload") return [];
  if (expression.operator === "all" || expression.operator === "any") return expression.operands.flatMap(referencedExpressions);
  if (expression.operator === "not") return referencedExpressions(expression.operand);
  if (expression.operator === "compare-elements") return [
    { elementId: expression.leftElementId, expression }, { elementId: expression.rightElementId, expression }];
  if (expression.operator === "compare-times") return [
    { elementId: expression.leftElementId, expression },
    ...(expression.right.kind === "element" ? [{ elementId: expression.right.elementId, expression }] : [])];
  if (expression.operator === "occurrence-order") return [
    { elementId: expression.firstElementId, expression }, { elementId: expression.secondElementId, expression }];
  if (expression.operator === "starts-with-element") return [
    { elementId: expression.elementId, expression }, { elementId: expression.prefixElementId, expression }];
  if (expression.operator === "all-elements") return [];
  return [{ elementId: expression.elementId, expression }];
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
    diagnostics.push({ severity: "error", code: failure.code, ruleId: rule.id, message: failure.message, ...location(rule.source, failure.offset) });
    return { diagnostics };
  }
  const localized = rule.localization;
  if (localized !== undefined && (localized.schemaVersion !== 1 ||
    (localized.sv !== undefined && (typeof localized.sv !== "object" || localized.sv === null ||
      [localized.sv.name, localized.sv.message].some((value) => value !== undefined && typeof value !== "string") ||
      (localized.sv.reviewedSource !== undefined &&
        [localized.sv.reviewedSource.name, localized.sv.reviewedSource.message].some((value) => value !== undefined && typeof value !== "string")))))) {
    diagnostics.push({ severity: "error", code: "wording", ruleId: rule.id, message: "Malformed localized rule wording" });
  }
  if (!rule.name?.trim() || !rule.message?.trim()) diagnostics.push({ severity: "warning", code: "wording", ruleId: rule.id,
    message: "English rule name or message is missing" });
  if (localized && (!localized.sv?.name?.trim() || !localized.sv.message?.trim())) diagnostics.push({ severity: "warning", code: "wording", ruleId: rule.id,
    message: "Swedish rule name or message is missing" });
  if (localized?.sv?.reviewedSource && (localized.sv.reviewedSource.name !== rule.name ||
      localized.sv.reviewedSource.message !== rule.message)) diagnostics.push({ severity: "warning", code: "wording", ruleId: rule.id,
    message: "Swedish wording needs English source review" });
  const parameters = rule.messageParameters;
  if (parameters !== undefined && (typeof parameters !== "object" || parameters === null || Array.isArray(parameters) ||
      Object.entries(parameters).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
        !["string", "number"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)))) {
    diagnostics.push({ severity: "error", code: "message-parameters", ruleId: rule.id, message: "Malformed message parameters" });
  }
  const placeholders = [rule.message, localized?.sv?.message].filter((value): value is string => typeof value === "string")
    .flatMap((value) => [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!));
  if (placeholders.some((key) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || parameters?.[key] === undefined))
    diagnostics.push({ severity: "error", code: "message-parameters", ruleId: rule.id,
      message: "Message references an undefined or malformed named parameter" });
  const known = catalogParts(catalog);
  const expressions = [...(parsed.applicability ? referencedExpressions(parsed.applicability) : []), ...referencedExpressions(parsed.assertion)];
  for (const reference of expressions) {
    const { elementId, expression } = reference;
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
    const literals = expression.operator === "member" ? expression.values
      : expression.operator === "quantified" ? expression.values : undefined;
    if (element && literals?.some((value) => typeof value !== expectedLiteralType(element.baseDatatype))) {
      diagnostics.push({ severity: "error", code: "datatype", ruleId: rule.id,
        message: `${elementId} has datatype ${element.baseDatatype}; collection predicates require ${expectedLiteralType(element.baseDatatype)} values` });
    }
    if (expression.operator === "matches" || (expression.operator === "quantified" && expression.predicate === "matches")) {
      if (element && expectedLiteralType(element.baseDatatype) === "boolean") diagnostics.push({ severity: "error", code: "datatype", ruleId: rule.id,
        message: `${elementId} has datatype ${element.baseDatatype}; regular expressions require string or numeric values` });
    }
  }
  const compoundExpressions = [...(parsed.applicability ? walkExpressions(parsed.applicability) : []), ...walkExpressions(parsed.assertion)];
  for (const expression of compoundExpressions) {
    if (expression.operator === "compare-elements") {
      const left = known.elements.get(expression.leftElementId); const right = known.elements.get(expression.rightElementId);
      if (left && right && expectedLiteralType(left.baseDatatype) !== expectedLiteralType(right.baseDatatype)) diagnostics.push({
        severity: "error", code: "datatype", ruleId: rule.id,
        message: `${expression.leftElementId} and ${expression.rightElementId} do not have comparable datatypes`,
      });
    }
    if (expression.operator === "compare-times") for (const elementId of [expression.leftElementId,
      ...(expression.right.kind === "element" ? [expression.right.elementId] : [])]) {
      const datatype = known.elements.get(elementId)?.baseDatatype.toLowerCase();
      if (datatype && !/(date|time)/.test(datatype)) diagnostics.push({ severity: "error", code: "datatype", ruleId: rule.id,
        message: `${elementId} has datatype ${datatype}; temporal comparison requires date/time values` });
    }
  }
  if (rule.primaryTargetElementId !== "*" && !known.elements.has(rule.primaryTargetElementId)) diagnostics.push({ severity: "error", code: "primary-target", ruleId: rule.id,
    message: `Primary target ${rule.primaryTargetElementId} is not present in the bound catalog` });
  if (rule.primaryTargetElementId === "*" && parsed.assertion.operator !== "all-elements") diagnostics.push({ severity: "error", code: "primary-target", ruleId: rule.id,
    message: "Dynamic primary targets require an allElements assertion" });
  if (parsed.scopeGroupId) {
    const catalogDefinition = "elements" in catalog ? catalog : undefined;
    const group = catalogDefinition?.groups?.find(({ groupId }) => groupId === parsed.scopeGroupId);
    const groupExistsInElementPaths = catalogDefinition?.elements.some(({ groupPath }) => groupPath?.includes(parsed.scopeGroupId!));
    if (catalogDefinition && !group && !groupExistsInElementPaths) diagnostics.push({ severity: "error", code: "scope", ruleId: rule.id,
      message: `Scope ${parsed.scopeGroupId} is not present in the bound catalog` });
    // A Schematron context may be a singleton group and may reference values in ancestor or sibling groups.
    // The evaluator resolves those external references against the document while retaining row-local values.
  }
  for (const { expression } of expressions) {
    if (expression.operator !== "minimum-occurrences" && expression.operator !== "maximum-occurrences") continue;
    const bound = known.elements.get(expression.elementId)?.intrinsicOccurrence;
    const intrinsicMaximum = bound?.max;
    if (expression.operator === "maximum-occurrences" && typeof intrinsicMaximum === "number" && expression.count > intrinsicMaximum) {
      diagnostics.push({ severity: "warning", code: "occurrence-bound", ruleId: rule.id,
        message: `The editable maximum of ${expression.count} cannot broaden ${expression.elementId}'s intrinsic Catalog maximum of ${intrinsicMaximum}` });
    }
  }
  if (!rule.executionTargets.length) diagnostics.push({ severity: "error", code: "execution-target", ruleId: rule.id,
    message: "Select at least one execution target" });
  if (diagnostics.some(({ severity }) => severity === "error")) return { diagnostics };
  const elements = [...new Set(expressions.map(({ elementId }) => elementId))].sort();
  const codes = expressions.map(({ expression }) => expression)
    .filter((expression): expression is Extract<CompiledValidationExpression, { operator: "coded" }> => expression.operator === "coded")
    .map(({ elementId, codeSystem, code }) => ({ elementId, codeSystem, code }))
    .sort((left, right) => `${left.elementId}|${left.codeSystem}|${left.code}`.localeCompare(`${right.elementId}|${right.codeSystem}|${right.code}`));
  return { diagnostics, compiled: {
    schemaVersion: VALIDATION_COMPILED_SCHEMA_VERSION, languageVersion: VALIDATION_LANGUAGE_VERSION,
    ruleId: rule.id, validationVersionId, name: rule.name.trim(), enabled: rule.enabled,
    severity: rule.severity, executionTargets: [...new Set(rule.executionTargets)].sort(),
    primaryTarget: { elementId: rule.primaryTargetElementId }, message: rule.message.trim(),
    ...(rule.localization ? { localization: rule.localization } : {}),
    ...(rule.messageParameters ? { messageParameters: rule.messageParameters } : {}),
    ...(parsed.scopeGroupId ? { scope: { groupId: parsed.scopeGroupId, iteration: "each" as const } } : {}),
    ...(parsed.applicability ? { applicability: parsed.applicability } : {}), assertion: parsed.assertion,
    references: { elementIds: elements, codes },
  } };
}

function walkExpressions(expression: CompiledValidationExpression): CompiledValidationExpression[] {
  if (expression.operator === "all" || expression.operator === "any") return [expression, ...expression.operands.flatMap(walkExpressions)];
  if (expression.operator === "not") return [expression, ...walkExpressions(expression.operand)];
  return [expression];
}

function labelFor(elementId: string, catalog: ValidationCatalog): string {
  const label = catalog.elements.find((element) => element.elementId === elementId)?.label;
  return label ? `${label} (${elementId})` : elementId;
}

function explainExpression(expression: CompiledValidationExpression, catalog: ValidationCatalog): string {
  if (expression.operator === "constant") return expression.value ? "always" : "never";
  if (expression.operator === "any-payload") return "some element in this scope has an ordinary payload without a Pertinent Negative";
  if (expression.operator === "present") return `${labelFor(expression.elementId, catalog)} has a documented value`;
  if (expression.operator === "equals") return `${labelFor(expression.elementId, catalog)} equals ${JSON.stringify(expression.value)}`;
  if (expression.operator === "coded") {
    const codeLabel = catalog.codes?.find((code) => code.elementId === expression.elementId && code.codeSystem === expression.codeSystem && code.code === expression.code)?.label;
    return `${labelFor(expression.elementId, catalog)} contains ${codeLabel ? `${codeLabel} ` : ""}(${expression.codeSystem}|${expression.code})`;
  }
  if (expression.operator === "minimum-occurrences") return `${labelFor(expression.elementId, catalog)} has at least ${expression.count} documented occurrence(s)`;
  if (expression.operator === "maximum-occurrences") return `${labelFor(expression.elementId, catalog)} has at most ${expression.count} documented occurrence(s)`;
  if (expression.operator === "undocumented") return `${labelFor(expression.elementId, catalog)} has no occurrences`;
  if (expression.operator === "has-not-value") return `${labelFor(expression.elementId, catalog)} has Not Value${expression.code ? ` ${expression.code}` : ""}`;
  if (expression.operator === "has-pertinent-negative") return `${labelFor(expression.elementId, catalog)} has Pertinent Negative${expression.code ? ` ${expression.code}` : ""}`;
  if (expression.operator === "member") return `${labelFor(expression.elementId, catalog)} is a member of ${expression.values.map((value) => JSON.stringify(value)).join(", ")}`;
  if (expression.operator === "matches") return `${labelFor(expression.elementId, catalog)} safely matches ${JSON.stringify(expression.pattern)}`;
  if (expression.operator === "starts-with-element") return `${labelFor(expression.elementId, catalog)} starts with ${labelFor(expression.prefixElementId, catalog)}`;
  if (expression.operator === "code-type") return `${labelFor(expression.elementId, catalog)} uses CodeType ${expression.codeType}`;
  if (expression.operator === "attribute") return `${labelFor(expression.elementId, catalog)} has attribute ${expression.name}${expression.value === undefined ? "" : ` equal to ${expression.value}`}`;
  if (expression.operator === "compare-literal") return `${labelFor(expression.elementId, catalog)} is ${expression.comparison} ${JSON.stringify(expression.value)}`;
  if (expression.operator === "empty-payload") return `${labelFor(expression.elementId, catalog)} has no ordinary payload`;
  if (expression.operator === "all-elements") return `every documented element satisfies ${expression.invariant}`;
  if (expression.operator === "quantified") return `${expression.quantifier} values of ${labelFor(expression.elementId, catalog)} satisfy ${expression.predicate}`;
  if (expression.operator === "compare-elements") return `${labelFor(expression.leftElementId, catalog)} is ${expression.comparison} ${labelFor(expression.rightElementId, catalog)}`;
  if (expression.operator === "compare-times") return `${labelFor(expression.leftElementId, catalog)} is ${expression.comparison} ${expression.right.kind === "element" ? labelFor(expression.right.elementId, catalog) : "the evaluation time"}`;
  if (expression.operator === "occurrence-order") return `${labelFor(expression.firstElementId, catalog)} occurs ${expression.relation} ${labelFor(expression.secondElementId, catalog)}`;
  if (expression.operator === "not") return `not (${explainExpression(expression.operand, catalog)})`;
  const joiner = expression.operator === "all" ? " and " : " or ";
  return expression.operands.map((operand) => `(${explainExpression(operand, catalog)})`).join(joiner);
}

export function explainValidationRule(compiled: CompiledValidationRule, catalog: ValidationCatalog): string {
  const group = compiled.scope && catalog.groups?.find(({ groupId }) => groupId === compiled.scope!.groupId);
  const scope = `Finding target: ${labelFor(compiled.primaryTarget.elementId, catalog)}.${compiled.scope ?
    ` Evaluate each ${group?.label ?? compiled.scope.groupId} row independently.` : ""}`;
  const condition = compiled.applicability ? `Applies when ${explainExpression(compiled.applicability, catalog)}.` : "Always applies.";
  return `${scope} ${condition} Requires ${explainExpression(compiled.assertion, catalog)}.`;
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

type DocumentElement = { element: { id: string; values: readonly EncounterValue[] }; groupInstanceId: string; order: number };
type EvaluationState = { timestamp: number; steps: number; maxSteps: number; maxValues: number; globalElements?: DocumentElement[];
  scopeElementIds?: ReadonlySet<string> };
function tick(state: EvaluationState, amount = 1): void {
  state.steps += amount;
  if (state.steps > state.maxSteps) throw new ValidationResourceLimitError(`Validation traversal exceeds ${state.maxSteps} steps`);
}
function ordinaryValue(value: EncounterValue): string | number | boolean | undefined {
  return value.kind === "scalar" ? value.value : value.kind === "coded" ? value.code : undefined;
}
function timestampValue(value: EncounterValue): number | undefined {
  const raw = ordinaryValue(value);
  if (typeof raw !== "string") return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return undefined;
  const parsed = Date.parse(normalized); return Number.isFinite(parsed) ? parsed : undefined;
}
function regexMatches(regex: RegExp, value: string | number | boolean | undefined): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const input = String(value);
  if (input.length > MAX_REGEX_INPUT_LENGTH) throw new ValidationResourceLimitError(
    `Regular-expression input exceeds ${MAX_REGEX_INPUT_LENGTH} characters`);
  return regex.test(input);
}
function compareValues(left: string | number | boolean, comparison: ValidationComparison, right: string | number | boolean): boolean {
  if (comparison === "equal") return left === right;
  if (comparison === "not-equal") return left !== right;
  if (typeof left !== typeof right) return false;
  if (comparison === "less-than") return left < right;
  if (comparison === "less-or-equal") return left <= right;
  if (comparison === "greater-than") return left > right;
  return left >= right;
}
function referencedElements(elements: DocumentElement[], elementId: string, state: EvaluationState): DocumentElement[] {
  const local = elements.filter(({ element }) => element.id === elementId);
  return local.length || state.scopeElementIds?.has(elementId) ? local
    : (state.globalElements ?? []).filter(({ element }) => element.id === elementId);
}
function evaluateExpression(expression: CompiledValidationExpression, elements: DocumentElement[], state: EvaluationState): boolean {
  tick(state);
  if (expression.operator === "constant") return expression.value;
  if (expression.operator === "any-payload") return elements.some(({ element }) => element.values.some((value) => {
    const facets = encounterValueFacets(value); return facets.hasValue && !facets.hasPertinentNegative;
  }));
  if (expression.operator === "all") return expression.operands.every((operand) => evaluateExpression(operand, elements, state));
  if (expression.operator === "any") return expression.operands.some((operand) => evaluateExpression(operand, elements, state));
  if (expression.operator === "not") return !evaluateExpression(expression.operand, elements, state);
  if (expression.operator === "compare-elements") {
    const left = referencedElements(elements, expression.leftElementId, state).flatMap(({ element }) => element.values).map(ordinaryValue).filter((value) => value !== undefined);
    const right = referencedElements(elements, expression.rightElementId, state).flatMap(({ element }) => element.values).map(ordinaryValue).filter((value) => value !== undefined);
    tick(state, left.length + right.length);
    return left.some((leftValue) => right.some((rightValue) => compareValues(leftValue, expression.comparison, rightValue)));
  }
  if (expression.operator === "compare-times") {
    const left = referencedElements(elements, expression.leftElementId, state).flatMap(({ element }) => element.values)
      .map(timestampValue).filter((value): value is number => value !== undefined);
    const rightElementId = expression.right.kind === "element" ? expression.right.elementId : undefined;
    const right = rightElementId === undefined ? [state.timestamp]
      : referencedElements(elements, rightElementId, state).flatMap(({ element }) => element.values)
        .map(timestampValue).filter((value): value is number => value !== undefined);
    tick(state, left.length + right.length);
    const offset = expression.offsetSeconds * 1000;
    return left.some((leftValue) => right.some((rightValue) => expression.comparison === "before" ? leftValue < rightValue + offset
      : expression.comparison === "after" ? leftValue > rightValue + offset
      : expression.comparison === "same-or-before" ? leftValue <= rightValue + offset : leftValue >= rightValue + offset));
  }
  if (expression.operator === "occurrence-order") {
    const first = referencedElements(elements, expression.firstElementId, state).filter(({ element }) => element.values.length).map(({ order }) => order);
    const second = referencedElements(elements, expression.secondElementId, state).filter(({ element }) => element.values.length).map(({ order }) => order);
    tick(state, first.length + second.length);
    return expression.relation === "before" ? first.some((a) => second.some((b) => a < b))
      : first.some((a) => second.some((b) => Math.abs(a - b) === 1));
  }
  if (expression.operator === "starts-with-element") {
    const values = referencedElements(elements, expression.elementId, state).flatMap(({ element }) => element.values)
      .map((value) => ordinaryValue(value) ?? "").map(String);
    const prefixes = referencedElements(elements, expression.prefixElementId, state).flatMap(({ element }) => element.values)
      .map((value) => ordinaryValue(value) ?? "").map(String);
    tick(state, values.length + prefixes.length);
    return values.some((value) => prefixes.some((prefix) => value.startsWith(prefix)));
  }
  if (expression.operator === "all-elements") return violatingAllElements(expression.invariant, elements, expression.excludedElementIds).length === 0;
  const values = referencedElements(elements, expression.elementId, state).flatMap(({ element }) => element.values);
  tick(state, values.length);
  if (values.length > state.maxValues) throw new ValidationResourceLimitError(`Validation value collection exceeds ${state.maxValues} values`);
  if (expression.operator === "minimum-occurrences") return values.length >= expression.count;
  if (expression.operator === "maximum-occurrences") return values.length <= expression.count;
  if (expression.operator === "undocumented") return values.length === 0;
  if (expression.operator === "present") return values.some((value) => {
    const facets = encounterValueFacets(value);
    return facets.hasValue || facets.hasNotValue || facets.hasPertinentNegative;
  });
  if (expression.operator === "coded") return values.some((value) => value.kind === "coded" && value.code === expression.code
    && (value.system ?? "") === expression.codeSystem);
  if (expression.operator === "equals") return values.some((value) => ordinaryValue(value) === expression.value);
  if (expression.operator === "code-type") return values.some((value) => value.attributes?.CodeType === expression.codeType
    || (value.kind === "coded" && value.system === expression.codeType));
  if (expression.operator === "attribute") return values.some((value) => expression.name in (value.attributes ?? {})
    && (expression.value === undefined || String(value.attributes?.[expression.name]) === expression.value));
  // A missing value is not the named literal. Imported conditional rules use
  // this branch to mean "unless the other field says Yes"; existential
  // not-equal made an entirely blank report fail those rules.
  if (expression.operator === "compare-literal" && expression.comparison === "not-equal") {
    return values.every((value) => ordinaryValue(value) !== expression.value);
  }
  if (expression.operator === "compare-literal") return values.some((value) => {
    const ordinary = ordinaryValue(value) ?? ""; return compareValues(ordinary, expression.comparison, expression.value);
  });
  if (expression.operator === "empty-payload") return values.some((value) => !encounterValueFacets(value).hasValue);
  if (expression.operator === "has-not-value") return values.some((value) => value.notValue !== undefined
    && (!expression.code || value.notValue?.code === expression.code));
  if (expression.operator === "has-pertinent-negative") return values.some((value) => encounterValueFacets(value).hasPertinentNegative
    && (!expression.code || value.pertinentNegative?.code === expression.code || (value.kind === "pertinent-negative" && value.code === expression.code)));
  if (expression.operator === "member") return values.some((value) => {
    const ordinary = ordinaryValue(value); return ordinary !== undefined && expression.values.includes(ordinary);
  });
  if (expression.operator === "matches") {
    const regex = new RegExp(expression.pattern, "u");
    return values.some((value) => regexMatches(regex, ordinaryValue(value)));
  }
  if (expression.operator === "quantified") {
    const regex = expression.predicate === "matches" ? new RegExp(expression.pattern!, "u") : undefined;
    const predicate = (value: EncounterValue): boolean => {
      const ordinary = ordinaryValue(value);
      if (expression.predicate === "has-value") return ordinary !== undefined;
      if (expression.predicate === "empty") return encounterValueFacets(value).empty;
      if (expression.predicate === "matches") return regexMatches(regex!, ordinary);
      if (expression.predicate === "equals") return ordinary === expression.values![0];
      return ordinary !== undefined && expression.values!.includes(ordinary);
    };
    return expression.quantifier === "any" ? values.some(predicate) : expression.quantifier === "all" ? values.every(predicate) : !values.some(predicate);
  }
  throw new ValidationCompatibilityError(`Unsupported compiled validation operator ${(expression as { operator: string }).operator}`);
}

function violatingAllElements(invariant: Extract<CompiledValidationExpression, { operator: "all-elements" }>["invariant"],
  elements: DocumentElement[], excludedElementIds: readonly string[] = []): DocumentElement[] {
  return elements.filter(({ element }) => !excludedElementIds.includes(element.id) && (() => {
    const values = element.values;
    if (invariant === "unique-nv") return values.some((value) => value.notValue !== undefined) && values.length > 1;
    if (invariant === "unique-pn") return values.some((value) => value.pertinentNegative !== undefined || value.kind === "pertinent-negative") && values.length > 1;
    return values.some((value) => {
      const facets = encounterValueFacets(value);
      if (invariant === "nil-needs-absence") return (value.kind === "null" || value.kind === "absent")
        && value.notValue === undefined && value.pertinentNegative === undefined;
      if (invariant === "nv-needs-empty") return value.notValue !== undefined && facets.hasValue;
      return (value.pertinentNegative !== undefined || value.kind === "pertinent-negative")
        && (facets.hasValue || value.notValue !== undefined);
    });
  })());
}

export function evaluateValidationBundle(bundle: CompiledValidationBundle, document: EncounterDocument,
  executionTarget: ValidationExecutionTarget, context: ValidationEvaluationContext): ValidationFinding[] {
  if (bundle.schemaVersion !== VALIDATION_COMPILED_SCHEMA_VERSION || bundle.languageVersion !== VALIDATION_LANGUAGE_VERSION) {
    throw new ValidationCompatibilityError(`Unsupported validation bundle ${bundle.schemaVersion}/${bundle.languageVersion}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(context.timestamp)) {
    throw new TypeError("Validation evaluation timestamp must be an offset-aware ISO date/time");
  }
  const timestamp = Date.parse(context.timestamp);
  if (!Number.isFinite(timestamp)) throw new TypeError("Validation evaluation timestamp must be an offset-aware ISO date/time");
  const requestedSteps = context.limits?.maxTraversalSteps ?? 10_000;
  const requestedValues = context.limits?.maxValues ?? 5_000;
  const requestedNodes = context.limits?.maxExpressionNodes ?? MAX_EXPRESSION_NODES;
  if (!Number.isInteger(requestedSteps) || requestedSteps < 1 || !Number.isInteger(requestedValues) || requestedValues < 1
    || !Number.isInteger(requestedNodes) || requestedNodes < 1) {
    throw new TypeError("Validation evaluation limits must be positive integers");
  }
  const state: EvaluationState = { timestamp, steps: 0, maxSteps: Math.min(requestedSteps, MAX_TRAVERSAL_STEPS),
    maxValues: Math.min(requestedValues, MAX_VALUES) };
  let order = 0;
  const elements = document.groups.flatMap((group) => group.instances.flatMap((instance) =>
    instance.elements.map((element) => ({ element, groupInstanceId: instance.instanceId, order: order++ }))));
  state.globalElements = elements;
  tick(state, elements.length);
  const scopedRows = (groupId: string): Array<{ elements: DocumentElement[]; rootGroupInstanceId: string;
    scopeElementIds: ReadonlySet<string> }> => {
    const roots = document.groups.find(({ id }) => id === groupId)?.instances ?? [];
    const ownedByRoot = new Map(roots.map((root) => [root.instanceId, new Set([root.instanceId])]));
    for (const ownedInstanceIds of ownedByRoot.values()) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const group of document.groups) for (const instance of group.instances) {
          tick(state);
          if (instance.parentInstanceId && ownedInstanceIds.has(instance.parentInstanceId) && !ownedInstanceIds.has(instance.instanceId)) {
            ownedInstanceIds.add(instance.instanceId); changed = true;
          }
        }
      }
    }
    const scopeElementIds = new Set(document.groups.flatMap((group) => group.instances
      .filter(({ instanceId }) => [...ownedByRoot.values()].some((ids) => ids.has(instanceId)))
      .flatMap((instance) => instance.elements.map(({ id }) => id))));
    return roots.map((root) => {
      const ownedInstanceIds = ownedByRoot.get(root.instanceId)!;
      return { rootGroupInstanceId: root.instanceId, scopeElementIds,
        elements: document.groups.flatMap((group) => group.instances.filter(({ instanceId }) => ownedInstanceIds.has(instanceId))
          .flatMap((instance) => instance.elements.map((element) => ({ element, groupInstanceId: instance.instanceId,
            order: elements.find(({ element: candidate, groupInstanceId }) => candidate === element && groupInstanceId === instance.instanceId)?.order ?? 0 })))) };
    });
  };
  return bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes(executionTarget)).flatMap((rule) => {
    const scopes: Array<{ elements: DocumentElement[]; rootGroupInstanceId?: string; scopeElementIds?: ReadonlySet<string> }> = rule.scope
      ? scopedRows(rule.scope.groupId) : [{ elements }];
    return scopes.flatMap((scope) => {
    state.scopeElementIds = scope.scopeElementIds;
    const nodeCount = walkExpressions(rule.assertion).length + (rule.applicability ? walkExpressions(rule.applicability).length : 0);
    if (nodeCount > Math.min(requestedNodes, MAX_EXPRESSION_NODES)) throw new ValidationResourceLimitError("Compiled expression exceeds evaluation node limit");
    // Published pre-fix NEMSIS bundles omitted Schematron's element-context selection.
    // Match only the pinned legacy assertion signature; never rewrite stored versions.
    const legacyContextElement = legacyNemsisValue(NEMSIS_351_EMS_LEGACY_CONTEXT_GUARDS,
      uniqueNemsisContextGuards, rule.message, rule.primaryTarget.elementId, rule.references?.elementIds ?? []);
    if (legacyContextElement && evaluateExpression({ operator: "undocumented", elementId: legacyContextElement },
      scope.elements, state)) return [];
    if (rule.applicability && !evaluateExpression(rule.applicability, scope.elements, state)) return [];
    if (evaluateExpression(rule.assertion, scope.elements, state)) return [];
    if (rule.primaryTarget.elementId === "*" && rule.assertion.operator === "all-elements") {
      return violatingAllElements(rule.assertion.invariant, scope.elements, rule.assertion.excludedElementIds).map((match) => ({
        validationVersionId: bundle.validationVersionId, ruleId: rule.ruleId, severity: rule.severity,
        executionTarget, message: repairNemsisImportedMessage(validationRuleText(rule, context.language ?? "en", "message"), rule.primaryTarget.elementId,
          rule.references?.elementIds ?? []), primaryTarget: { elementId: match.element.id,
          groupInstanceId: match.groupInstanceId, ...(match.element.values[0]?.occurrenceId ? { occurrenceId: match.element.values[0].occurrenceId } : {}) },
        inputFingerprint: fingerprint(JSON.stringify([{ elementId: match.element.id, groupInstanceId: match.groupInstanceId,
          values: match.element.values }])) } satisfies ValidationFinding));
    }
    const matches = scope.elements.filter(({ element }) => element.id === rule.primaryTarget.elementId);
    const referencedElementIds = rule.references?.elementIds ?? referencedExpressions(rule.assertion).map(({ elementId }) => elementId);
    const relevantInputs: unknown[] = scope.elements.filter(({ element }) => referencedElementIds.includes(element.id))
      .map(({ element, groupInstanceId }) => ({ elementId: element.id, groupInstanceId, values: element.values }));
    // Evaluation time is not a clinician-authored input. Including it here made
    // an acknowledged warning acquire a new identity on every refresh (and at
    // signing), even when the documented values had not changed.
    return [{ validationVersionId: bundle.validationVersionId, ruleId: rule.ruleId, severity: rule.severity,
      executionTarget, message: repairNemsisImportedMessage(validationRuleText(rule, context.language ?? "en", "message"), rule.primaryTarget.elementId,
        rule.references?.elementIds ?? []), primaryTarget: { elementId: rule.primaryTarget.elementId,
        ...(matches[0]?.groupInstanceId ?? scope.rootGroupInstanceId ? { groupInstanceId: matches[0]?.groupInstanceId ?? scope.rootGroupInstanceId } : {}),
        ...(matches[0]?.element.values[0]?.occurrenceId ? { occurrenceId: matches[0].element.values[0].occurrenceId } : {}) },
      inputFingerprint: fingerprint(JSON.stringify(relevantInputs)) } satisfies ValidationFinding];
    });
  });
}

/** Evaluates rules independently so one broken artifact is attributable and cannot suppress healthy findings. */
export function evaluateValidationBundleSafely(bundle: CompiledValidationBundle, document: EncounterDocument,
  executionTarget: ValidationExecutionTarget, context: ValidationEvaluationContext): ValidationEvaluationResult {
  if (!Array.isArray(bundle?.rules)) return { findings: [], failures: [{
    validationVersionId: bundle?.validationVersionId ?? "unknown", ruleId: "bundle", executionTarget,
    code: "compatibility", message: "The compiled validation bundle has no rule list",
  }] };
  const targetRules = bundle.rules.filter((rule) => rule?.enabled && Array.isArray(rule.executionTargets)
    && rule.executionTargets.includes(executionTarget) && isPatientCareReportRule(rule));
  if (targetRules.length > MAX_RULES_PER_EVALUATION) return { findings: [], failures: [{
    validationVersionId: bundle.validationVersionId, ruleId: "bundle", executionTarget,
    code: "resource-limit", message: `The compiled validation bundle exceeds ${MAX_RULES_PER_EVALUATION} rules`,
  }] };
  const findings: ValidationFinding[] = [];
  const failures: ValidationRuntimeFailure[] = [];
  for (const rule of targetRules) {
    try {
      findings.push(...evaluateValidationBundle({ ...bundle, rules: [rule] }, document, executionTarget, context)
        .filter((finding) => !isNemsisDemographicElementId(finding.primaryTarget.elementId)));
    } catch (error) {
      failures.push({ validationVersionId: bundle.validationVersionId, ruleId: rule?.ruleId ?? "unknown", executionTarget,
        code: error instanceof ValidationResourceLimitError ? "resource-limit"
          : error instanceof ValidationCompatibilityError ? "compatibility" : "runtime",
        message: error instanceof ValidationResourceLimitError ? "Validation rule exceeded its execution limit"
          : error instanceof ValidationCompatibilityError ? "Validation rule is incompatible with this runtime"
          : "Validation rule could not be evaluated" });
    }
  }
  return { findings, failures };
}
