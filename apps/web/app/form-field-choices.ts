import type { ClinicalFormConfiguration, FormDraftDefinition } from "@open-triage/contracts";

export function previewCatalogFields(definition: FormDraftDefinition,
  catalogFields: ClinicalFormConfiguration["catalogFields"]): ClinicalFormConfiguration["catalogFields"] {
  const projected = { ...catalogFields };
  for (const section of definition.sections) for (const field of section.fields) {
    if (field.source.kind !== "nemsis" || field.choicePolicy === undefined) continue;
    const catalog = catalogFields[field.source.elementId];
    if (!catalog) continue;
    const chosenCodes = field.choicePolicy.filter((choice) => choice.kind === "code");
    const chosenNotValues = new Set(field.choicePolicy.filter((choice) => choice.kind === "not-value")
      .map((choice) => `not-value:${choice.code}`));
    projected[field.source.elementId] = { ...catalog, choiceOrder: field.choicePolicy,
      codeChoices: chosenCodes.flatMap((choice) => catalog.codeChoices?.filter((candidate) =>
        candidate.code === choice.code && candidate.codeSystem === choice.codeSystem) ?? []),
      exceptionalChoices: catalog.exceptionalChoices?.filter((choice) =>
        !choice.key.startsWith("not-value:") || chosenNotValues.has(choice.key)) };
  }
  return projected;
}
