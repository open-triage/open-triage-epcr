import type { ClinicalFormConfiguration, FormDraftDefinition } from "@open-triage/contracts";

type CatalogFields = ClinicalFormConfiguration["catalogFields"];
type ChoicePolicy = NonNullable<FormDraftDefinition["sections"][number]["fields"][number]["choicePolicy"]>;

export function validateFieldChoicePolicies(definition: FormDraftDefinition, catalogFields: CatalogFields): string[] {
  const findings: string[] = [];
  for (const section of definition.sections) for (const field of section.fields) {
    if (field.choicePolicy === undefined || field.source.kind !== "nemsis") continue;
    const catalog = catalogFields[field.source.elementId];
    if (!catalog) {
      findings.push(`field ${field.key} has no matching catalog definition`);
      continue;
    }
    if (!catalog.codeChoices && !catalog.supportsNotValues)
      findings.push(`field ${field.key} does not support coded or NOT choices`);
    for (const choice of field.choicePolicy) {
      const valid = choice.kind === "code"
        ? catalog.codeChoices?.some((candidate) => candidate.code === choice.code && candidate.codeSystem === choice.codeSystem)
        : catalog.supportsNotValues && catalog.exceptionalChoices?.some((candidate) => candidate.key === `not-value:${choice.code}`);
      if (!valid) findings.push(`field ${field.key} choice ${choice.kind}:${choice.code} is unavailable in the pinned catalog`);
    }
  }
  return findings;
}

/** Resolve one field's ordered policy without modifying shared catalog data. */
export function effectiveFieldChoices(field: FormDraftDefinition["sections"][number]["fields"][number],
  catalogFields: CatalogFields, availableCatalogFields: CatalogFields = catalogFields): CatalogFields[string] | undefined {
  if (field.source.kind !== "nemsis") return undefined;
  const catalog = (field.choicePolicy === undefined ? catalogFields : availableCatalogFields)[field.source.elementId];
  if (!catalog || field.choicePolicy === undefined) return catalog;
  const codes = field.choicePolicy.filter((choice): choice is Extract<ChoicePolicy[number], { kind: "code" }> => choice.kind === "code");
  const notValues = new Set(field.choicePolicy.filter((choice) => choice.kind === "not-value")
    .map((choice) => `not-value:${choice.code}`));
  return { ...catalog,
    choiceOrder: field.choicePolicy,
    codeChoices: codes.flatMap((choice) => catalog.codeChoices?.filter((candidate) =>
      candidate.code === choice.code && candidate.codeSystem === choice.codeSystem) ?? []),
    exceptionalChoices: catalog.exceptionalChoices?.filter((choice) =>
      !choice.key.startsWith("not-value:") || notValues.has(choice.key)),
  };
}

export function effectiveCatalogFields(definition: FormDraftDefinition, catalogFields: CatalogFields,
  availableCatalogFields: CatalogFields = catalogFields): CatalogFields {
  const projected = { ...catalogFields };
  for (const section of definition.sections) for (const field of section.fields) {
    if (field.source.kind === "nemsis") {
      const resolved = effectiveFieldChoices(field, catalogFields, availableCatalogFields);
      if (resolved) projected[field.source.elementId] = resolved;
    }
  }
  return projected;
}

/** Snapshot the effective legacy catalog selection when a successor is created. */
export function materializeLegacyChoicePolicies(definition: FormDraftDefinition, catalogFields: CatalogFields): FormDraftDefinition {
  return { ...definition, sections: definition.sections.map((section) => ({ ...section,
    fields: section.fields.map((field) => {
      if (field.source.kind !== "nemsis" || field.choicePolicy !== undefined) return field;
      const catalog = catalogFields[field.source.elementId];
      if (!catalog?.codeChoices?.length && !catalog?.exceptionalChoices?.some((choice) => choice.key.startsWith("not-value:"))) return field;
      return { ...field, choicePolicy: [
        ...(catalog.codeChoices ?? []).map(({ code, codeSystem }) => ({ kind: "code" as const, code, codeSystem })),
        ...(catalog.exceptionalChoices ?? []).filter((choice) => choice.key.startsWith("not-value:"))
          .map((choice) => ({ kind: "not-value" as const, code: choice.key.slice("not-value:".length) })),
      ] };
    }) })) };
}
