import type { FormDraftDefinition, FormDraftField } from "@open-triage/contracts";

export type FormLanguage = "en" | "sv";
export type FormTextKind = "title" | "label" | "helpText";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Author overrides belong to the pinned form version. Missing translations use its English source. */
export function formSectionTitle(definition: FormDraftDefinition, sectionKey: string, language: FormLanguage): string | undefined {
  const section = definition.sections.find(({ key }) => key === sectionKey);
  const translated = language === "sv" ? definition.locales?.find(({ locale }) => locale === "sv")?.translations.sections?.[sectionKey]?.title : undefined;
  return text(translated) ?? text(section?.presentation?.title);
}

export function formFieldText(definition: FormDraftDefinition, field: FormDraftField | undefined,
  language: FormLanguage, kind: "label" | "helpText"): string | undefined {
  if (!field) return undefined;
  const translated = language === "sv" ? definition.locales?.find(({ locale }) => locale === "sv")?.translations.fields?.[field.key]?.[kind] : undefined;
  return text(translated) ?? text(field.configuration?.[kind]);
}

export function formFieldForElement(definition: FormDraftDefinition | undefined, elementId: string): FormDraftField | undefined {
  return definition?.sections.flatMap(({ fields }) => fields).find((field) =>
    field.source.kind === "nemsis" && field.source.elementId === elementId);
}

export function formTranslationWarnings(definition: FormDraftDefinition, language: FormLanguage): string[] {
  if (language !== "sv") return [];
  const locale = definition.locales?.find(({ locale }) => locale === "sv");
  const warnings: string[] = [];
  for (const section of definition.sections) {
    if (!text(section.presentation?.title)) warnings.push(`${section.key}: English heading missing`);
    if (text(section.presentation?.title) && !text(locale?.translations.sections?.[section.key]?.title))
      warnings.push(`${section.key}: Swedish heading missing`);
    for (const field of section.fields) {
      for (const kind of ["label", "helpText"] as const) {
        if (text(field.configuration?.[kind]) && !text(locale?.translations.fields?.[field.key]?.[kind]))
          warnings.push(`${section.key} / ${field.key}: Swedish ${kind === "label" ? "label" : "help text"} missing`);
      }
    }
  }
  return warnings;
}

export function pruneFormTranslations(definition: FormDraftDefinition): FormDraftDefinition {
  const sections = new Set(definition.sections.map(({ key }) => key));
  const fields = new Set(definition.sections.flatMap((section) => section.fields.map(({ key }) => key)));
  if (!definition.locales) return definition;
  return { ...definition, locales: definition.locales.map((locale) => ({ ...locale,
    translations: { ...locale.translations,
      sections: Object.fromEntries(Object.entries(locale.translations.sections ?? {}).filter(([key]) => sections.has(key))),
      fields: Object.fromEntries(Object.entries(locale.translations.fields ?? {}).filter(([key]) => fields.has(key))) },
    sourceReview: Object.fromEntries(Object.entries(locale.sourceReview ?? {}).filter(([key]) => {
      if (key.startsWith("sections.") && key.endsWith(".title")) return sections.has(key.slice(9, -6));
      if (key.startsWith("fields.") && (key.endsWith(".label") || key.endsWith(".helpText")))
        return fields.has(key.slice(7, key.endsWith(".label") ? -6 : -9));
      return false;
    })) })) };
}
