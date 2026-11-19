import {
  WEST_A_DECISION_SUPPORT_KEY,
  decisionSupportPickerCategories,
  type DecisionSupportCategory,
  type DecisionSupportBand,
  type DecisionSupportDefinition,
  type DecisionSupportNumericInput,
  type TriageColour,
} from "@open-triage/contracts";

const colours = new Set<TriageColour>(["green", "yellow", "orange", "red"]);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/;
const clockTime = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  requireRule(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  return value as Record<string, unknown>;
}

function localized(value: unknown, path: string): void {
  const label = object(value, path);
  requireRule(typeof label.en === "string" && label.en.trim() && typeof label.sv === "string" && label.sv.trim(),
    `${path} must provide English and Swedish labels`);
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3;
}

function stringKeys(value: unknown, path: string): string[] {
  requireRule(Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && identifier.test(item))
    && new Set(value).size === value.length, `${path} must contain distinct codes`);
  return value;
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function validateBands(value: unknown, input: DecisionSupportNumericInput, path: string): void {
  requireRule(Array.isArray(value) && value.length, `${path} must have score bands`);
  const factor = 10 ** input.precision;
  const onGrid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(Math.round(n * factor))
    && Math.round(n * factor) / factor === n;
  const bands = value.map((raw) => {
    const { minInclusive, maxInclusive, points } = object(raw, path);
    requireRule((minInclusive === null || onGrid(minInclusive)) && (maxInclusive === null || onGrid(maxInclusive))
      && (minInclusive === null || maxInclusive === null || minInclusive <= maxInclusive) && score(points),
    `${path} has an invalid score band`);
    return { minInclusive, maxInclusive, points } satisfies DecisionSupportBand;
  });
  const first = Math.round(input.minValue * factor);
  const last = Math.round(input.maxValue * factor);
  requireRule(last - first <= 100_000, `${path} has an unsupported scoring domain`);
  for (let unit = first; unit <= last; unit++) {
    const observation = unit / factor;
    const matches = bands.filter(({ minInclusive, maxInclusive }) =>
      (minInclusive === null || observation >= minInclusive) && (maxInclusive === null || observation <= maxInclusive));
    requireRule(matches.length === 1, `${path} has ${matches.length ? "overlapping bands" : "a score gap"} at ${observation}`);
  }
}

function validateCategories(value: unknown, windows: Record<string, unknown>, noneCode: string): void {
  const categories = new Set<string>();
  const codes = new Set<string>();
  const references: Array<{ from: string; to: string }> = [];
  function visit(raw: unknown): void {
    requireRule(Array.isArray(raw) && raw.length, "Expected a nonempty category list");
    for (const value of raw) {
      const category = object(value, "Category");
      const { id, criteria, subcategories } = category;
      requireRule(typeof id === "string" && identifier.test(id) && !categories.has(id), `Invalid or duplicate category ${id}`);
      categories.add(id);
      requireRule(typeof category.category === "string" && category.category.trim() && Array.isArray(criteria), `Invalid category ${id}`);
      requireRule(category.displayLabel === undefined || typeof category.displayLabel === "string", `Invalid category label for ${id}`);
      requireRule(category.combineSubcategoriesInPicker === undefined || category.combineSubcategoriesInPicker === true ||
        typeof category.combineSubcategoriesInPicker === "string", `Invalid category grouping for ${id}`);
      if (category.criterionLabelSuffix !== undefined) localized(category.criterionLabelSuffix, `Criterion suffix for ${id}`);
      requireRule(!codes.has(`${id}.${noneCode}`), `Conflicting negative choice for ${id}`);
      codes.add(`${id}.${noneCode}`);
      for (const rawCriterion of criteria) {
        const criterion = object(rawCriterion, `Criterion in ${id}`);
        const code = criterion.id;
        requireRule(typeof code === "string" && identifier.test(code) && !codes.has(code), `Invalid or duplicate criterion ${code}`);
        codes.add(code);
        requireRule(typeof criterion.text === "string" && criterion.text.trim() &&
          colours.has(criterion.triage_color as TriageColour), `Invalid text or colour for ${code}`);
        requireRule(criterion.population === undefined || criterion.population === "paediatric", `Invalid population for ${code}`);
        requireRule(criterion.displayLabel === undefined || typeof criterion.displayLabel === "string", `Invalid criterion label for ${code}`);
        if (criterion.navigateToCategory !== undefined) {
          requireRule(typeof criterion.navigateToCategory === "string", `Invalid category reference from ${code}`);
          references.push({ from: code, to: criterion.navigateToCategory });
        }
        requireRule(criterion.time_window === undefined || (typeof criterion.time_window === "string" &&
          Object.hasOwn(windows, criterion.time_window)), `Unknown measurement-time window for ${code}`);
      }
      if (subcategories !== undefined) visit(subcategories);
    }
  }
  visit(value);
  const selectable = new Set(decisionSupportPickerCategories(value as DecisionSupportCategory[]).map(({ id }) => id));
  for (const { from, to } of references) {
    requireRule(selectable.has(to), `Unknown category ${to} referenced by ${from}`);
  }
}

/** Check the exact clinical definition before it can be registered or used for scoring. */
export function validateDecisionSupportDefinition(value: unknown): DecisionSupportDefinition {
  const root = object(value, "Decision support definition");
  requireRule(root.schemaVersion === 1 && root.key === WEST_A_DECISION_SUPPORT_KEY &&
    typeof root.version === "string" && identifier.test(root.version) && typeof root.name === "string" && root.name.trim() &&
    typeof root.catalogKey === "string" && identifier.test(root.catalogKey), "Invalid definition identity");
  const activation = object(root.activation, "Activation");
  requireRule(activation.adminSetting === "decisionSupportSystem" && activation.scope === "installation" &&
    activation.value === root.key && activation.activeByDefault === false && activation.pinVersionOnEncounter === true,
  "Invalid activation binding");
  const assessment = object(root.assessment, "Assessment");
  requireRule(typeof assessment.group === "string" && identifier.test(assessment.group), "Invalid vital group binding");
  const priority = stringKeys(assessment.colourPriority, "Colour priority");
  requireRule(priority.length === colours.size && priority.every((colour) => colours.has(colour as TriageColour))
    && priority[0] === "green" && priority.at(-1) === "red", "Invalid colour priority");
  const colourLabels = object(root.triage_colors, "Triage colours");
  requireRule(sameKeys(colourLabels, priority) && Object.values(colourLabels).every((label) => typeof label === "string" && label.trim()),
    "Invalid triage colour labels");
  const elements = object(assessment.elements, "Assessment elements");
  const categories = object(elements.categories, "Categories");
  const criteria = object(elements.criteria, "Criteria");
  const negative = object(criteria.noneOption, "No criteria choice");
  const scaleSelector = object(elements.newsScale, "NEWS scale");
  const scoreField = object(elements.physiologyScore, "Physiology score");
  const noWarnings = object(elements.noWarningCriteria, "No warning criteria");
  const override = object(elements.overrideColour, "Override colour");
  requireRule(categories.kind === "custom" && categories.multiple === true && criteria.kind === "custom"
    && criteria.multiple === true && criteria.filterOptionsBy === "categories" && negative.scope === "category"
    && negative.exclusiveWithinCategory === true && typeof negative.code === "string" && identifier.test(negative.code)
    && negative.triageColour === null && noWarnings.kind === "custom" && noWarnings.type === "explicitBoolean"
    && override.kind === "custom" && override.type === "triageColour" && scaleSelector.kind === "custom"
    && scoreField.kind === "calculated" && scoreField.type === "integer" && scoreField.readOnly === true
    && scoreField.scaleElement === "newsScale", "Invalid assessment element bindings");
  localized(negative.label, "No criteria label");
  localized(scaleSelector.label, "NEWS scale label");
  localized(scoreField.label, "Physiology score label");
  const optionSemantics = object(assessment.optionSemantics, "Criterion options");
  const timeSemantics = object(optionSemantics.time_window, "Measurement-time windows");
  requireRule(timeSemantics.clock === "measurementLocalTime", "Invalid criterion clock");
  const windows = object(timeSemantics.windows, "Criterion windows");
  for (const [key, raw] of Object.entries(windows)) {
    const { startInclusive, endExclusive } = object(raw, key);
    requireRule(typeof startInclusive === "string" && clockTime.test(startInclusive) &&
      typeof endExclusive === "string" && clockTime.test(endExclusive) && startInclusive < endExclusive,
    `Invalid measurement-time window ${key}`);
  }
  validateCategories(root.categories, windows, negative.code);

  const result = object(assessment.result, "Assessment result");
  const overrides = stringKeys(result.overrideAllowed, "Override options");
  requireRule(overrides.length === colours.size && overrides.every((colour) => colours.has(colour as TriageColour)),
    "Invalid override options");
  const draft = object(result.unsupportedDraft, "Unsupported draft");
  requireRule(typeof draft.indicatorColour === "string" && draft.indicatorColour.trim(), "Invalid unsupported draft indicator");
  localized(draft.label, "Unsupported draft label");
  localized(result.provisionalLabel, "Provisional label");
  const finalization = object(result.finalization, "Finalization");
  requireRule(finalization.requiredElement === "effectiveColour" && finalization.onMissing === "keepDraft", "Invalid finalization rule");
  localized(finalization.message, "Finalization message");
  const carry = stringKeys(assessment.carryFromPrecedingMeasurement, "Carry-forward elements");
  requireRule(carry.every((field) => Object.hasOwn(elements, field)), "Unknown carry-forward field");

  const inputs = object(root.inputs, "Score inputs");
  for (const [name, raw] of Object.entries(inputs)) {
    const input = object(raw, name);
    if (input.values !== undefined) {
      stringKeys(input.values, name);
      requireRule(input.explicit === true, `Invalid coded input ${name}`);
      continue;
    }
    const { minValue, maxValue, precision, element, unit } = input;
    requireRule(typeof element === "string" && identifier.test(element) && typeof unit === "string" && unit.trim() &&
      typeof precision === "number" && Number.isInteger(precision) && precision >= 0 && precision <= 6 &&
      (input.nonNumericValue === undefined || typeof input.nonNumericValue === "string" && input.nonNumericValue.trim()),
    `Invalid observation binding for ${name}`);
    const factor = 10 ** precision;
    requireRule(typeof minValue === "number" && typeof maxValue === "number" && minValue <= maxValue
      && [minValue, maxValue].every((bound) => Number.isSafeInteger(Math.round(bound * factor)) &&
        Math.round(bound * factor) / factor === bound), `Invalid observation domain for ${name}`);
  }

  const tables = object(root.scoreTables, "Score tables");
  const scales = object(scaleSelector.values, "NEWS scales");
  requireRule(typeof scaleSelector.defaultValue === "string" && Object.hasOwn(scales, scaleSelector.defaultValue),
    "Unknown default NEWS scale");
  const colourRules = object(root.colourRules, "Score colour rules");
  requireRule(colourRules.evaluation === "firstMatchingRule", "Invalid colour-rule evaluation");
  const boundInputs = new Set<string>();
  const boundTables = new Set<string>();
  for (const [name, value] of Object.entries(scales)) {
    const scale = object(value, name);
    localized(scale.label, `${name} scale label`);
    requireRule(typeof scale.scoreName === "string" && scale.scoreName.trim(),
      `Invalid score name for ${name}`);
    validateColourRules(colourRules, scale.colourRules, name);
    const bindings = object(scale.tablesByInput, `${name} inputs`);
    requireRule(Object.keys(bindings).length > 0, `No inputs for ${name}`);
    for (const [inputName, tableName] of Object.entries(bindings)) {
      requireRule(Object.hasOwn(inputs, inputName) && typeof tableName === "string" && Object.hasOwn(tables, tableName),
        `Unknown input or table for ${name}.${inputName}`);
      boundInputs.add(inputName);
      boundTables.add(tableName);
      const path = `${name}.${inputName} (${tableName})`;
      const input = object(inputs[inputName], path);
      const table = object(tables[tableName], path);
      if (Array.isArray(input.values)) {
        const points = object(table.pointsByValue, path);
        requireRule(sameKeys(table, ["pointsByValue"]) && sameKeys(points, input.values) && Object.values(points).every(score),
          `${path} must supply one valid score per code`);
      } else if (table.branchOn !== undefined) {
        validateBranches(table, inputs, bindings, input, path);
      } else {
        requireRule(sameKeys(table, ["bands"]), `${path} must have numeric score bands`);
        validateBands(table.bands, input as unknown as DecisionSupportNumericInput, path);
      }
    }
  }
  requireRule(sameKeys(inputs, [...boundInputs]) && sameKeys(tables, [...boundTables]), "Unbound score input or table");
  return root as unknown as DecisionSupportDefinition;
}

function validateBranches(table: Record<string, unknown>, inputs: Record<string, unknown>,
  bindings: Record<string, unknown>, input: Record<string, unknown>, path: string): void {
  requireRule(sameKeys(table, ["branchOn", "branches"]) && typeof table.branchOn === "string" &&
    Object.hasOwn(bindings, table.branchOn) && Object.hasOwn(inputs, table.branchOn), `${path} has an unknown branch input`);
  const needed = object(inputs[table.branchOn], path).values;
  const branches = object(table.branches, path);
  requireRule(Array.isArray(needed) && sameKeys(branches, needed), `${path} must cover every branch value exactly once`);
  for (const [branch, raw] of Object.entries(branches)) {
    const branchTable = object(raw, path);
    requireRule(sameKeys(branchTable, ["bands"]), `${path}.${branch} must have numeric score bands`);
    validateBands(branchTable.bands, input as unknown as DecisionSupportNumericInput, `${path}.${branch}`);
  }
}

function validateColourRules(groups: Record<string, unknown>, key: unknown, scale: string): void {
  requireRule(typeof key === "string" && Object.hasOwn(groups, key), `Unknown colour rules for ${scale}`);
  const rules = groups[key];
  requireRule(Array.isArray(rules) && rules.length > 0, `Missing colour rules for ${scale}`);
  for (const value of rules) {
    const rule = object(value, `${scale} colour rule`);
    const { minTotal, anyComponentAtLeast } = rule;
    requireRule(colours.has(rule.colour as TriageColour) && ((typeof minTotal === "number" && Number.isSafeInteger(minTotal)
      && minTotal >= 0 && anyComponentAtLeast === undefined) || (minTotal === undefined && score(anyComponentAtLeast))),
    `Invalid colour threshold for ${scale}`);
  }
  requireRule(rules.at(-1).minTotal === 0, `Colour rules for ${scale} must cover a score of zero`);
}
