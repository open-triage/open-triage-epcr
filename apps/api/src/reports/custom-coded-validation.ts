import type { CatalogDraftCustomCodedElement, FormDraftField } from "@open-triage/contracts";

type ChoicePolicy = FormDraftField["choicePolicy"];
type CodedValue = {
  kind: string; code?: string | null; codeSystem?: string | null;
  absenceCode?: string | null;
  notValue?: { code: string } | null; pertinentNegative?: { code: string } | null;
};

/** Checks custom identity and the form's narrower policy against a pinned definition. */
export function customCodedValueFindings(definition: CatalogDraftCustomCodedElement, value: CodedValue,
  policy: ChoicePolicy, allowedAbsenceStates: readonly string[]): string[] {
  const findings: string[] = [];
  if (value.kind === "coded") {
    if (value.codeSystem !== definition.codeSystem || !definition.choices.some((choice) => choice.code === value.code))
      findings.push(`Code ${value.code ?? ""} is not a choice in ${definition.namespace}.${definition.slug}`);
    if (policy && !policy.some((choice) => choice.kind === "code" && choice.code === value.code && choice.codeSystem === value.codeSystem))
      findings.push(`Code ${value.code ?? ""} is disabled by the form`);
  } else if (!["null", "pertinent-negative", "absent"].includes(value.kind)) {
    findings.push(`Custom coded element ${definition.namespace}.${definition.slug} requires a coded or exceptional value`);
  }
  const notValue = value.notValue?.code ?? (value.kind === "null" ? value.absenceCode : undefined);
  const pertinentNegative = value.pertinentNegative?.code ?? (value.kind === "pertinent-negative" ? value.absenceCode : undefined);
  if (notValue && (!definition.permittedNotValues.includes(notValue) || !allowedAbsenceStates.includes(notValue) ||
    policy && !policy.some((choice) => choice.kind === "not-value" && choice.code === notValue)))
    findings.push(`NOT value ${notValue} is unavailable for this custom field`);
  if (pertinentNegative && (!definition.permittedPertinentNegatives.includes(pertinentNegative) ||
    !allowedAbsenceStates.includes(pertinentNegative)))
    findings.push(`Pertinent negative ${pertinentNegative} is unavailable for this custom field`);
  return findings;
}
