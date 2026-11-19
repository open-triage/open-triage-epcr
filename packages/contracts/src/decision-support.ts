import type { CatalogDraftCustomElement } from "./index.js";

export const WEST_A_DECISION_SUPPORT_KEY = "west-a-2025";

export type DecisionSupportSystemKey = typeof WEST_A_DECISION_SUPPORT_KEY;
export type TriageColour = "green" | "yellow" | "orange" | "red";
type LocalizedLabel = { en: string; sv: string };

export interface DecisionSupportCriterion {
  id: string;
  text: string;
  displayLabel?: string;
  triage_color: TriageColour;
  population?: "paediatric";
  navigateToCategory?: string;
  time_window?: string;
}

export interface DecisionSupportCategory {
  id: string;
  category: string;
  displayLabel?: string;
  criteria: DecisionSupportCriterion[];
  subcategories?: DecisionSupportCategory[];
  combineSubcategoriesInPicker?: boolean | string;
  criterionLabelSuffix?: LocalizedLabel;
}

export interface DecisionSupportNumericInput {
  element: string;
  unit: string;
  precision: number;
  minValue: number;
  maxValue: number;
  preferMeasuredHeartRateOverPulse?: boolean;
  nonNumericValue?: string;
}

export interface DecisionSupportBand {
  minInclusive: number | null;
  maxInclusive: number | null;
  points: number;
}

type BandedScoreTable = { bands: DecisionSupportBand[] };

export type DecisionSupportScoreTable = BandedScoreTable
  | { pointsByValue: Record<string, number> }
  | { branchOn: string; branches: Record<string, BandedScoreTable> };

export interface DecisionSupportScale {
  label: LocalizedLabel;
  scoreName: string;
  tablesByInput: Record<string, string>;
  colourRules: string;
}

export interface DecisionSupportDefinition {
  schemaVersion: 1;
  key: DecisionSupportSystemKey;
  name: string;
  version: string;
  catalogKey: string;
  activation: { adminSetting: "decisionSupportSystem"; value: DecisionSupportSystemKey;
    scope: "installation"; activeByDefault: false; pinVersionOnEncounter: true };
  assessment: {
    group: string;
    colourPriority: TriageColour[];
    elements: {
      categories: { kind: "custom"; multiple: true };
      criteria: { kind: "custom"; multiple: true; filterOptionsBy: "categories";
        noneOption: { code: string; label: LocalizedLabel; scope: "category"; exclusiveWithinCategory: true } };
      noWarningCriteria: { kind: "custom"; type: "explicitBoolean" };
      newsScale: { kind: "custom"; defaultValue: string; label: LocalizedLabel;
        values: Record<string, DecisionSupportScale> };
      physiologyScore: { kind: "calculated"; type: "integer"; label: LocalizedLabel; readOnly: true };
      overrideColour: { kind: "custom"; type: "triageColour" };
    };
    carryFromPrecedingMeasurement: string[];
    optionSemantics: { time_window: { windows: Record<string, { startInclusive: string; endExclusive: string }> } };
    result: {
      overrideAllowed: TriageColour[];
      redIsDefinitiveWithIncompleteInputs: boolean;
      unsupportedDraft: { indicatorColour: string; label: LocalizedLabel };
      provisionalLabel: LocalizedLabel;
      finalization: { requiredElement: string; onMissing: string; message: LocalizedLabel };
    };
  };
  inputs: Record<string, DecisionSupportNumericInput | { values: string[]; explicit: true }>;
  scoreTables: Record<string, DecisionSupportScoreTable>;
  colourRules: { evaluation: "firstMatchingRule" } & Record<string, undefined | "firstMatchingRule" |
    Array<{ colour: TriageColour; minTotal?: number; anyComponentAtLeast?: number }>>;
  triage_colors: Record<TriageColour, string>;
  categories: DecisionSupportCategory[];
}

export type DecisionSupportFieldName = keyof DecisionSupportDefinition["assessment"]["elements"];
export type DecisionSupportCatalogElement = CatalogDraftCustomElement & {
  /** Shipped elements are defined by the versioned decision support artifact. */
  decisionSupportField: DecisionSupportFieldName;
  integer?: true;
  readOnly?: true;
};

export interface ClinicalDecisionSupportConfiguration {
  definition: DecisionSupportDefinition;
  fields: Record<DecisionSupportFieldName, DecisionSupportCatalogElement>;
}

export function decisionSupportPickerCategories(categories: readonly DecisionSupportCategory[]): DecisionSupportCategory[] {
  return categories.flatMap((category) => {
    if (category.combineSubcategoriesInPicker || !category.subcategories) return [category];
    return decisionSupportPickerCategories(category.subcategories);
  });
}

export function decisionSupportCategoryCriteria(category: DecisionSupportCategory): Array<{
  criterion: DecisionSupportCriterion;
  labelSuffix?: LocalizedLabel;
}> {
  return [
    ...category.criteria.map((criterion) => ({ criterion, labelSuffix: category.criterionLabelSuffix })),
    ...(category.subcategories ?? []).flatMap(decisionSupportCategoryCriteria),
  ];
}

export function isSelectableDecisionSupportCriterion(criterion: DecisionSupportCriterion): boolean {
  return criterion.population !== "paediatric" && !criterion.navigateToCategory;
}

export type DecisionSupportCalculation =
  | { readonly status: "unassessed"; readonly colour: null }
  | { readonly status: "provisional" | "definitive"; readonly colour: TriageColour; readonly criterionCode?: string };

export type FinalizedDecisionSupportCalculation = DecisionSupportCalculation & {
  readonly systemKey: DecisionSupportSystemKey;
  readonly version: string;
};

export interface DecisionSupportOverride {
  readonly colour: TriageColour;
  readonly enteredBy: string;
  readonly enteredAt: string;
  readonly calculatedColourWhenSelected: TriageColour | null;
  readonly inheritedFromMeasurement?: string;
}

export interface DraftDecisionSupportAssessment {
  readonly calculation: DecisionSupportCalculation;
  readonly override: DecisionSupportOverride | null;
  readonly findings?: DecisionSupportFindings;
}

export const UNASSESSED_DECISION_SUPPORT: DecisionSupportCalculation = { status: "unassessed", colour: null };

export function isTriageColour(value: unknown): value is TriageColour {
  return value === "green" || value === "yellow" || value === "orange" || value === "red";
}

export function effectiveDecisionSupportColour(
  calculation: DecisionSupportCalculation, overrideColour?: TriageColour | null,
): TriageColour | null {
  return overrideColour ?? calculation.colour;
}

export function decisionSupportElementKey(field: Pick<DecisionSupportCatalogElement, "namespace" | "slug">): string {
  return `${field.namespace}.${field.slug}`;
}

export interface DecisionSupportFindings {
  readonly criteria: readonly string[];
  readonly noWarningCriteria: boolean;
}

export const EMPTY_DECISION_SUPPORT_FINDINGS: DecisionSupportFindings = { criteria: [], noWarningCriteria: false };

export function decisionSupportNegativeCode(definition: DecisionSupportDefinition, categoryId: string): string {
  return `${categoryId}.${definition.assessment.elements.criteria.noneOption.code}`;
}

export function decisionSupportCriterionLabel(criterion: DecisionSupportCriterion, suffix?: LocalizedLabel,
  language: keyof LocalizedLabel = "en"): string {
  const label = criterion.displayLabel ?? criterion.text;
  return suffix ? `${label} · ${suffix[language]}` : label;
}

export function decisionSupportCriterionAvailable(definition: DecisionSupportDefinition, criterion: DecisionSupportCriterion,
  localTime: string): boolean {
  if (criterion.population === "paediatric") return false;
  if (!criterion.time_window) return true;
  const window = definition.assessment.optionSemantics.time_window.windows[criterion.time_window];
  return !!window && /^([01]\d|2[0-3]):[0-5]\d$/.test(localTime) &&
    localTime >= window.startInclusive && localTime < window.endExclusive;
}

/** Use the offset recorded with the measurement on both sides of synchronization. */
export function decisionSupportMeasurementLocalTime(instant: string | Date, utcOffsetMinutes = 0): string {
  const time = new Date(instant).getTime();
  return Number.isFinite(time) ? new Date(time + utcOffsetMinutes * 60_000).toISOString().slice(11, 16) : "";
}

export function decisionSupportFindingCategories(definition: DecisionSupportDefinition, selectedCodes: readonly string[]) {
  const selected = new Set(selectedCodes);
  return decisionSupportPickerCategories(definition.categories).map((category) => ({
    category,
    negative: selected.has(decisionSupportNegativeCode(definition, category.id)),
    criteria: decisionSupportCategoryCriteria(category).filter(({ criterion }) =>
      isSelectableDecisionSupportCriterion(criterion) && selected.has(criterion.id)),
  })).filter(({ negative, criteria }) => negative || criteria.length);
}

export function decisionSupportFindingResult(definition: DecisionSupportDefinition, findings: DecisionSupportFindings,
  localTime: string) {
  const categories = decisionSupportFindingCategories(definition, findings.criteria);
  const represented = categories.reduce((total, category) => total + category.criteria.length + Number(category.negative), 0);
  const available = categories.flatMap(({ criteria }) => criteria)
    .filter(({ criterion }) => decisionSupportCriterionAvailable(definition, criterion, localTime));
  const priority = definition.assessment.colourPriority;
  const highest = available.reduce<typeof available[number] | undefined>((best, item) =>
    !best || priority.indexOf(item.criterion.triage_color) > priority.indexOf(best.criterion.triage_color) ? item : best, undefined);
  const explicitNoWarningCriteria = findings.noWarningCriteria || (categories.length > 0 && categories.every(({ negative }) => negative));
  return {
    valid: findings.criteria.length === represented && !categories.some(({ negative, criteria }) => negative && criteria.length) &&
      !(findings.noWarningCriteria && highest && highest.criterion.triage_color !== "green"),
    categoryCodes: categories.map(({ category }) => category.id),
    highest,
    explicitNoWarningCriteria,
  };
}

/** Incomplete physiology can support yellow or orange provisionally, and red definitively. */
export function calculateDecisionSupportFindings(definition: DecisionSupportDefinition,
  result: ReturnType<typeof decisionSupportFindingResult>): DecisionSupportCalculation {
  const criterion = result.highest?.criterion;
  if (!result.valid || !criterion || criterion.triage_color === "green") return UNASSESSED_DECISION_SUPPORT;
  const definitive = criterion.triage_color === "red" && definition.assessment.result.redIsDefinitiveWithIncompleteInputs;
  return { status: definitive ? "definitive" : "provisional", colour: criterion.triage_color,
    criterionCode: criterion.id };
}
