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
