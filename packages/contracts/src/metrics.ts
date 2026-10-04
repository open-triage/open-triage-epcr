import { encounterValueFacets, type EncounterDocument, type EncounterValue } from "./index.js";
import { compileValidationRule, evaluateValidationOutcomes, type CompiledValidationRule,
  type ValidationCatalog, type ValidationDiagnostic, type ValidationEvaluationContext, type ValidationRuleProvenance,
  type ValidationRuleSource } from "./validation-rules.js";

/** Metrics have no workflow severity. Units on report inputs are explicit catalog mappings. */
export interface MetricSource {
  id: string; name: string; description: string; enabled: boolean; reviewEnabled: boolean; unit: string;
  applicability?: string; source: string;
  localization?: { schemaVersion: 1; sv?: { name?: string; description?: string } };
  provenance?: ValidationRuleProvenance[];
  /** Unresolved source mappings must be completed explicitly before enablement. */
  unresolved?: string[];
}
export type MetricExpression =
  | { operator: "value"; elementId: string; unit: string }
  | { operator: "timestamp"; elementId: string }
  | { operator: "first" | "last"; groupId: string; elementId: string; timeElementId: string; unit: string; where?: string; minimumDistinctTimes?: number }
  | { operator: "difference"; left: MetricExpression; right: MetricExpression }
  | { operator: "elapsed"; start: MetricExpression; end: MetricExpression; unit: "s" | "min" | "h" };
export interface CompiledMetric extends Omit<MetricSource, "source" | "applicability"> {
  schemaVersion: 2; validationVersionId: string; expression: MetricExpression;
  applicabilityRule?: CompiledValidationRule;
  predicates: Record<string, CompiledValidationRule>;
  references: { elementIds: string[]; groupIds: string[] };
  explanation: string;
}
export type DefinitionState = "valid" | "not-applicable" | "missing" | "absent" | "invalid" | "failed";
export interface MetricObservation {
  elementId: string; groupInstanceId: string; parentInstanceId?: string; values: readonly EncounterValue[];
}
export interface MetricResult {
  metricId: string; validationVersionId: string; state: DefinitionState; value: number | null; unit: string;
  inputElementIds: string[];
  reason?: string; observations: MetricObservation[];
}
export interface ValidationDefinition { schemaVersion: 2; rules: ValidationRuleSource[]; metrics: MetricSource[] }
export function readValidationDefinition(value: unknown): ValidationDefinition {
  if (Array.isArray(value)) return { schemaVersion: 2, rules: value as ValidationRuleSource[], metrics: [] };
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (object.schemaVersion === 2 && Array.isArray(object.rules) && Array.isArray(object.metrics))
      return object as unknown as ValidationDefinition;
    if (typeof object.id === "string" && typeof object.source === "string" && object.schemaVersion === undefined)
      return { schemaVersion: 2, rules: [object as unknown as ValidationRuleSource], metrics: [] };
  }
  throw new Error("Unsupported Validation definition format");
}
/** Keep the legacy representation for unchanged rule-only configurations. */
export function serializeValidationDefinition(rules: ValidationRuleSource[], metrics: MetricSource[] = []): ValidationRuleSource[] | ValidationDefinition {
  return metrics.length ? { schemaVersion: 2, rules, metrics } : rules;
}

export function compileMetric(metric: MetricSource, versionId: string, catalog: ValidationCatalog): {
  compiled?: CompiledMetric; diagnostics: ValidationDiagnostic[];
} {
  const diagnostics: ValidationDiagnostic[] = [];
  const error = (message: string, code: ValidationDiagnostic["code"] = "datatype") => {
    diagnostics.push({ severity: "error", code, ruleId: metric.id, definitionKind: "metric", message });
  };
  const elements = new Map(catalog.elements.map((element) => [element.elementId, element]));
  const references = { elementIds: new Set<string>(), groupIds: new Set<string>() };
  const predicates: Record<string, CompiledValidationRule> = {};
  function predicate(source: string): CompiledValidationRule | undefined {
    // Metrics never depend on metrics or outcomes. The ordinary Boolean language is reused unchanged.
    if (/\bmetric(?:Available|Compare)\s*\(/.test(source)) { error("Metrics cannot reference other metrics or rules"); return; }
    const result = compileValidationRule({ id: metric.id, name: metric.name, message: metric.name, enabled: true,
      severity: "none", executionTargets: ["review"], primaryTargetElementId: catalog.elements[0]?.elementId ?? "",
      source: `require ${source}` }, versionId, catalog);
    diagnostics.push(...result.diagnostics.map((diagnostic) => ({ ...diagnostic, definitionKind: "metric" as const })));
    result.compiled?.references.elementIds.forEach((id) => references.elementIds.add(id));
    result.compiled?.references.groupIds?.forEach((id) => references.groupIds.add(id));
    return result.compiled;
  }
  let nodes = 0;
  const unitText = (unit: unknown): unit is string => typeof unit === "string" && unit.length > 0 && unit.length <= 64;
  function element(id: string, numeric: boolean) {
    references.elementIds.add(id);
    const entry = elements.get(id);
    if (!entry) error(`Element ${id} is not present in the bound catalog`, "catalog-reference");
    else if (numeric && catalog.codes?.some((code) => code.elementId === id)) error(`${id} is a coded category, not a continuous numeric input`);
    else if (numeric ? !/(integer|decimal|double|float|number)/i.test(entry.baseDatatype) : !/(dateTime|datetime)/i.test(entry.baseDatatype))
      error(`${id} must have ${numeric ? "numeric" : "date/time"} datatype`);
    return entry;
  }
  function check(input: unknown, depth = 0): { unit: string; explanation: string } {
    if (++nodes > 64 || depth > 12) throw new Error("Metric expression exceeds 64 nodes or nesting depth 12");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a numeric expression object");
    const expression = input as MetricExpression;
    const allowed: Record<string, string[]> = { value: ["operator", "elementId", "unit"], timestamp: ["operator", "elementId"],
      first: ["operator", "groupId", "elementId", "timeElementId", "unit", "where", "minimumDistinctTimes"], last: ["operator", "groupId", "elementId", "timeElementId", "unit", "where", "minimumDistinctTimes"],
      difference: ["operator", "left", "right"], elapsed: ["operator", "start", "end", "unit"] };
    if (!allowed[expression.operator] || Object.keys(expression).some((key) => !allowed[expression.operator]!.includes(key)))
      throw new Error("Unsupported metric operator or argument");
    if (expression.operator === "value" || expression.operator === "timestamp") {
      const numeric = expression.operator === "value";
      const entry = element(expression.elementId, numeric);
      if (numeric && (!unitText(expression.unit) || expression.unit === "timestamp")) error("Numeric inputs require an explicit unit");
      return { unit: numeric ? expression.unit : "timestamp", explanation: entry?.label ?? expression.elementId };
    }
    if (expression.operator === "first" || expression.operator === "last") {
      if (!unitText(expression.unit)) error("Selected observations require an explicit unit (or timestamp)");
      if (expression.minimumDistinctTimes !== undefined && (!Number.isInteger(expression.minimumDistinctTimes) ||
        expression.minimumDistinctTimes < 1 || expression.minimumDistinctTimes > 5000))
        error("minimumDistinctTimes must be an integer from 1 to 5000");
      const entry = element(expression.elementId, expression.unit !== "timestamp");
      const time = element(expression.timeElementId, false);
      references.groupIds.add(expression.groupId);
      if (!catalog.groups?.some((group) => group.groupId === expression.groupId) &&
        !catalog.elements.some((item) => item.groupPath?.includes(expression.groupId))) error(`Unknown group ${expression.groupId}`, "scope");
      if (!entry?.groupPath?.includes(expression.groupId) || !time?.groupPath?.includes(expression.groupId))
        error("Selection value and clinical time must belong to the selected group", "scope");
      if (expression.where) {
        const compiled = predicate(expression.where);
        if (compiled) {
          if (compiled.references.elementIds.some((id) => !elements.get(id)?.groupPath?.includes(expression.groupId)))
            error("Selection predicates must reference observations within the selected group", "scope");
          predicates[expression.where] = compiled;
        }
      }
      return { unit: expression.unit, explanation: `${expression.operator} ${entry?.label ?? expression.elementId} in ${expression.groupId}, ordered by ${time?.label ?? expression.timeElementId}${expression.where ? ` where ${expression.where}` : ""}${expression.minimumDistinctTimes ? `; requires ${expression.minimumDistinctTimes} distinct clinical observation times` : ""}` };
    }
    if (expression.operator === "difference") {
      const left = check(expression.left, depth + 1), right = check(expression.right, depth + 1);
      if (left.unit !== right.unit || left.unit === "timestamp") error("Differences require matching numeric units; use elapsed for timestamps");
      return { unit: left.unit, explanation: `(${left.explanation}) minus (${right.explanation})` };
    }
    if (expression.operator !== "elapsed") throw new Error("Unsupported metric expression");
    const start = check(expression.start, depth + 1), end = check(expression.end, depth + 1);
    if (start.unit !== "timestamp" || end.unit !== "timestamp" || !["s", "min", "h"].includes(expression.unit))
      error("Elapsed time requires two timestamps and a unit of s, min, or h");
    return { unit: expression.unit, explanation: `Elapsed ${expression.unit} from (${start.explanation}) to (${end.explanation}); negative intervals are invalid` };
  }
  try {
    if (typeof metric.source !== "string" || metric.source.length > 16384) throw new Error("Metric source exceeds 16,384 characters");
    if (!metric.id || !metric.name?.trim() || !unitText(metric.unit)) error("Metric identity, name and unit are required");
    if (typeof metric.enabled !== "boolean" || typeof metric.reviewEnabled !== "boolean") error("Metric enabled and Review-enabled states must be Boolean");
    if (metric.unresolved?.length) metric.unresolved.forEach((message) => error(`Complete source mapping: ${message}`, "catalog-reference"));
    const expression = JSON.parse(metric.source) as MetricExpression;
    const result = check(expression);
    if (result.unit === "timestamp" || result.unit !== metric.unit) error(`Expression unit ${result.unit} does not match numeric metric unit ${metric.unit}`);
    const applicabilityRule = metric.applicability?.trim() ? predicate(metric.applicability) : undefined;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return { diagnostics };
    const { source: _source, applicability: _applicability, ...metadata } = metric;
    return { diagnostics, compiled: { ...metadata, schemaVersion: 2, validationVersionId: versionId, expression,
      ...(applicabilityRule ? { applicabilityRule } : {}), predicates,
      references: { elementIds: [...references.elementIds].sort(), groupIds: [...references.groupIds].sort() },
      explanation: `${result.explanation}. ${metric.applicability ? `Eligible when ${metric.applicability}.` : "All reports are eligible."}` } };
  } catch (reason) { error(reason instanceof Error ? reason.message : "Invalid metric source", "syntax"); return { diagnostics }; }
}

class Unavailable extends Error {
  constructor(readonly state: Exclude<DefinitionState, "valid" | "not-applicable">, message: string) { super(message); }
}
export function evaluateMetric(metric: CompiledMetric, document: EncounterDocument, context: ValidationEvaluationContext): MetricResult {
  const observations: MetricObservation[] = [];
  const result = (state: DefinitionState, value: number | null, reason?: string): MetricResult => ({
    metricId: metric.id, validationVersionId: metric.validationVersionId, unit: metric.unit, state, value,
    ...(reason ? { reason } : {}), inputElementIds: metric.references.elementIds, observations });
  let steps = 0, values = 0;
  const tick = (amount = 1) => { steps += amount; if (steps > Math.min(context.limits?.maxTraversalSteps ?? 10000, 100000))
    throw new Unavailable("failed", "Metric traversal limit exceeded"); };
  const test = (rule: CompiledValidationRule, input: EncounterDocument) => {
    const outcome = evaluateValidationOutcomes({ schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: metric.validationVersionId,
      catalogReleaseId: "metric", rules: [rule] }, input, "review", context).outcomes[0];
    if (!outcome || outcome.state !== "valid") throw new Unavailable("failed", "Metric predicate could not be evaluated");
    return outcome.value === true;
  };
  const read = (id: string, input: EncounterDocument, unit: string): number => {
    const candidates: EncounterValue[] = [];
    for (const group of input.groups) for (const instance of group.instances) for (const element of instance.elements) {
      tick(); if (element.id !== id) continue;
      observations.push({ elementId: id, groupInstanceId: instance.instanceId,
        ...(instance.parentInstanceId ? { parentInstanceId: instance.parentInstanceId } : {}), values: element.values });
      candidates.push(...element.values); values += element.values.length;
      if (values > Math.min(context.limits?.maxValues ?? 5000, 50000)) throw new Unavailable("failed", "Metric value limit exceeded");
    }
    if (!candidates.length) throw new Unavailable("missing", `Missing ${id}`);
    if (candidates.length !== 1) throw new Unavailable("invalid", `Ambiguous ${id}; select a qualifying clinical observation`);
    const candidate = candidates[0]!;
    const facets = encounterValueFacets(candidate);
    if (facets.hasNotValue || facets.hasPertinentNegative || !facets.hasValue) throw new Unavailable("absent", `Recorded absence for ${id}`);
    if (candidate.kind !== "scalar") throw new Unavailable("invalid", `${id} must be a scalar value`);
    if (unit === "timestamp") {
      if (typeof candidate.value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(candidate.value))
        throw new Unavailable("invalid", `${id} needs an offset-aware clinical timestamp`);
      const date = candidate.value.slice(0, 10), calendar = new Date(`${date}T00:00:00Z`);
      const value = Date.parse(candidate.value);
      if (!Number.isFinite(value) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date)
        throw new Unavailable("invalid", `Invalid timestamp ${id}`);
      return value;
    }
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)) throw new Unavailable("invalid", `Invalid numeric value ${id}`);
    if (candidate.unit && candidate.unit !== unit) throw new Unavailable("invalid", `Incompatible recorded unit for ${id}`);
    return candidate.value;
  };
  function evaluate(expression: MetricExpression, depth = 0): number {
    tick(); if (depth > 12) throw new Unavailable("failed", "Metric nesting limit exceeded");
    if (expression.operator === "value" || expression.operator === "timestamp")
      return read(expression.elementId, document, expression.operator === "timestamp" ? "timestamp" : expression.unit);
    if (expression.operator === "difference") return evaluate(expression.left, depth + 1) - evaluate(expression.right, depth + 1);
    if (expression.operator === "elapsed") {
      const start = evaluate(expression.start, depth + 1), end = evaluate(expression.end, depth + 1);
      if (end < start) throw new Unavailable("invalid", "Elapsed duration is negative");
      return (end - start) / ({ s: 1000, min: 60000, h: 3600000 }[expression.unit]);
    }
    if (expression.operator !== "first" && expression.operator !== "last") throw new Unavailable("failed", "Unsupported metric operator");
    const roots = document.groups.find((group) => group.id === expression.groupId)?.instances ?? [];
    const candidates: Array<{ id: string; time: number; document: EncounterDocument }> = [];
    for (const root of roots) {
      tick(); const owned = new Set([root.instanceId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const group of document.groups) for (const instance of group.instances) {
          tick(); if (instance.parentInstanceId && owned.has(instance.parentInstanceId) && !owned.has(instance.instanceId)) {
            owned.add(instance.instanceId); changed = true;
          }
        }
      }
      const scoped = { ...document, groups: document.groups.map((group) => ({ ...group, instances: group.instances.filter((instance) => owned.has(instance.instanceId)) })) };
      const predicate = expression.where ? metric.predicates[expression.where] : undefined;
      if (expression.where && !predicate) throw new Unavailable("failed", "Missing compiled selection predicate");
      if (predicate) {
        for (const group of scoped.groups) for (const instance of group.instances) for (const element of instance.elements) {
          tick(); if (predicate.references.elementIds.includes(element.id)) observations.push({ elementId: element.id, groupInstanceId: instance.instanceId,
            ...(instance.parentInstanceId ? { parentInstanceId: instance.parentInstanceId } : {}), values: element.values });
        }
        if (!test(predicate, scoped)) continue;
      }
      candidates.push({ id: root.instanceId, time: read(expression.timeElementId, scoped, "timestamp"), document: scoped });
    }
    if (!candidates.length) throw new Unavailable("missing", "No qualifying clinical observation");
    if (new Set(candidates.map((candidate) => candidate.time)).size < (expression.minimumDistinctTimes ?? 1))
      throw new Unavailable("missing", `At least ${expression.minimumDistinctTimes} distinct clinical observation times are required`);
    // Equal clinical timestamps are resolved by stable instance identity, never array order.
    candidates.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const selected = expression.operator === "first" ? candidates[0]! : candidates.at(-1)!;
    return read(expression.elementId, selected.document, expression.unit);
  }
  try {
    if (!metric.enabled) return result("failed", null, "Metric is disabled");
    if (metric.schemaVersion !== 2) throw new Unavailable("failed", "Unsupported metric schema");
    if (metric.applicabilityRule) {
      for (const group of document.groups) for (const instance of group.instances) for (const element of instance.elements) {
        tick(); if (metric.applicabilityRule.references.elementIds.includes(element.id)) observations.push({ elementId: element.id,
          groupInstanceId: instance.instanceId, values: element.values });
      }
      if (!test(metric.applicabilityRule, document)) return result("not-applicable", null);
    }
    const value = evaluate(metric.expression);
    if (!Number.isFinite(value)) throw new Unavailable("invalid", "Metric produced a non-finite result");
    return result("valid", value);
  } catch (reason) { return result(reason instanceof Unavailable ? reason.state : "failed", null,
    reason instanceof Error ? reason.message : "Metric evaluation failed"); }
}

export function compileMetricLibrary(metrics: MetricSource[], versionId: string, catalog: ValidationCatalog) {
  const results = metrics.map((metric) => compileMetric(metric, versionId, catalog));
  const diagnostics = results.flatMap((result, index) => result.diagnostics.map((diagnostic) =>
    metrics[index]!.enabled ? diagnostic : { ...diagnostic, severity: "warning" as const, message: `Disabled metric: ${diagnostic.message}` }));
  if (metrics.length > 256) diagnostics.push({ severity: "error", code: "resource-limit", ruleId: "metrics", definitionKind: "metric", message: "At most 256 metrics are supported" });
  if (new Set(metrics.map((metric) => metric.id)).size !== metrics.length)
    diagnostics.push({ severity: "error", code: "catalog-reference", ruleId: "metrics", definitionKind: "metric", message: "Metric identities must be unique" });
  return { diagnostics, metrics: results.flatMap((result) => result.compiled ? [result.compiled] : []) };
}
