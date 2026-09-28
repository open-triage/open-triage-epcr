import type { CatalogDraftDefinition, FormDraftDefinition, ValidationRuleSource } from "@open-triage/contracts";

export type TranslationIssue = { id: string; field: string; kind: "english" | "agency" | "review"; message: string };
export type TranslationLanguage = "en" | "sv";

function present(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0; }

function check(issues: TranslationIssue[], id: string, field: string, source: unknown, translated: unknown,
  reviewedSource: unknown, language: TranslationLanguage, required = true) {
  if (required && !present(source)) issues.push({ id, field, kind: "english", message: "Missing English text" });
  if (language === "en" || (!required && !present(source))) return;
  if (!present(translated)) issues.push({ id, field, kind: "agency", message: "Missing Swedish text" });
  else if (typeof reviewedSource === "string" && reviewedSource !== source)
    issues.push({ id, field, kind: "review", message: "English source changed; review Swedish text" });
}

export function catalogTranslationIssues(definition: CatalogDraftDefinition, language: TranslationLanguage = "sv"): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  for (const element of definition.elements) {
    if (definition.hiddenElementIds?.includes(element.elementId)) continue;
    const id = element.elementId;
    check(issues, id, "label", element.label, element.localization?.sv?.label,
      element.localization?.sv?.reviewedSource?.label, language);
    check(issues, id, "description", element.description, element.localization?.sv?.description,
      element.localization?.sv?.reviewedSource?.description, language, false);
    for (const choice of element.specialChoices ?? []) check(issues, id, `${choice.kind} ${choice.code}`,
      choice.label, choice.localization?.sv?.label, choice.localization?.sv?.reviewedSource?.label, language);
  }
  for (const list of definition.codeLists) {
    check(issues, list.listId, "name", list.name, list.localization?.sv?.name,
      list.localization?.sv?.reviewedSource?.name, language);
    for (const value of list.values) check(issues, list.listId, `${value.codeSystem} ${value.code}`,
      value.label, value.localization?.sv?.label, value.localization?.sv?.reviewedSource?.label, language);
  }
  return issues;
}

export function validationTranslationIssues(rules: ReadonlyArray<ValidationRuleSource>, language: TranslationLanguage = "sv"): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  for (const rule of rules) {
    check(issues, rule.id, "name", rule.name, rule.localization?.sv?.name,
      rule.localization?.sv?.reviewedSource?.name, language);
    check(issues, rule.id, "message", rule.message, rule.localization?.sv?.message,
      rule.localization?.sv?.reviewedSource?.message, language);
  }
  return issues;
}

/** Preserve legacy translations and their old source when English is edited for the first time. */
export function updateCatalogEnglish(element: CatalogDraftDefinition["elements"][number],
  field: "label" | "description", next: string): CatalogDraftDefinition["elements"][number] {
  const source = element[field] ?? "";
  if (next === source) return element;
  const translated = element.localization?.sv?.[field];
  if (!present(translated)) return { ...element, [field]: next };
  return { ...element, [field]: next, localization: { schemaVersion: 1, ...element.localization,
    sv: { ...element.localization?.sv, reviewedSource: { ...element.localization?.sv?.reviewedSource,
      [field]: element.localization?.sv?.reviewedSource?.[field] ?? source } } } };
}

export function updateValidationEnglish(rule: ValidationRuleSource, field: "name" | "message", next: string): ValidationRuleSource {
  const source = rule[field];
  if (next === source) return rule;
  const translated = rule.localization?.sv?.[field];
  if (!present(translated)) return { ...rule, [field]: next };
  return { ...rule, [field]: next, localization: { schemaVersion: 1, ...rule.localization,
    sv: { ...rule.localization?.sv, reviewedSource: { ...rule.localization?.sv?.reviewedSource,
      [field]: rule.localization?.sv?.reviewedSource?.[field] ?? source } } } };
}

export function updateCatalogChoiceEnglish(value: CatalogDraftDefinition["codeLists"][number]["values"][number], next: string) {
  if (next === value.label) return value;
  if (!present(value.localization?.sv?.label)) return { ...value, label: next };
  return { ...value, label: next, localization: { schemaVersion: 1 as const, ...value.localization,
    sv: { ...value.localization?.sv, reviewedSource: { label: value.localization?.sv?.reviewedSource?.label ?? value.label } } } };
}
