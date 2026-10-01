import type { ClinicalFormConfiguration, FormDraftField } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL } from "./nemsis-data-model";

type Choice = NonNullable<FormDraftField["choicePolicy"]>[number] | { kind: "pertinent-negative"; code: string };

const notValueLabels = new Map(NEMSIS_DATA_MODEL.elements.flatMap((element) => element.permittedNotValues).map(({ code, label }) => [code, label]));
const negativeLabels = new Map(NEMSIS_DATA_MODEL.elements.flatMap((element) => element.permittedPertinentNegatives).map(({ code, label }) => [code, label]));

/** Keep source identities in the policy while showing readable, localized catalog wording. */
export function formChoiceLabel(choice: Choice, field: FormDraftField,
  catalogFields: ClinicalFormConfiguration["catalogFields"] | undefined,
  customFields: ClinicalFormConfiguration["customFields"] | undefined, language: string): string {
  const catalog = field.source.kind === "nemsis" ? catalogFields?.[field.source.elementId] : undefined;
  const custom = field.source.kind === "custom" ? customFields?.[field.source.elementDefinitionId] : undefined;
  if (choice.kind === "code") {
    const value = catalog?.codeChoices?.find((item) => item.code === choice.code && item.codeSystem === choice.codeSystem)
      ?? (custom?.datatype === "coded" ? custom.choices.find((item) => item.code === choice.code) : undefined);
    return (language === "sv" ? value?.localization?.sv?.label?.trim() : undefined) || value?.label || choice.code;
  }
  const key = `${choice.kind}:${choice.code}`;
  const pinned = catalog?.exceptionalChoices?.find((item) => item.key === key);
  const configurationId = choice.kind === "not-value" ? "eCustomConfiguration.07" : "eCustomConfiguration.08";
  const configured = catalogFields?.[configurationId]?.codeChoices?.find((item) => item.code === choice.code);
  const translated = language === "sv" ? pinned?.localization?.sv?.label?.trim() || configured?.localization?.sv?.label?.trim() : undefined;
  const source = (choice.kind === "not-value" ? notValueLabels : negativeLabels).get(choice.code);
  return translated || configured?.label || source || (language === "sv" ? "Okänt undantagsvärde" : "Unknown exceptional value");
}
