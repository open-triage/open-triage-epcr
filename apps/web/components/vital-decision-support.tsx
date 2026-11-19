import { decisionSupportCategoryCriteria, decisionSupportCriterionLabel, decisionSupportPickerCategories, effectiveDecisionSupportColour, isTriageColour, type DecisionSupportDefinition,
  type DraftDecisionSupportAssessment, type TriageColour } from "@open-triage/contracts";
import type { Ref } from "react";
import { resolveMessage } from "../app/localization";

export function VitalDecisionSupport({
  definition, assessment, language, overrideRef, missingColour, onOverride,
}: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly language: string;
  readonly overrideRef: Ref<HTMLSelectElement>;
  readonly missingColour: boolean;
  readonly onOverride: (colour: TriageColour | null) => void;
}) {
  const t = (key: string, params?: Record<string, string>) => resolveMessage(language, key, params);
  const locale = language === "sv" ? "sv" : "en";
  const { calculation, override } = assessment;
  const effective = effectiveDecisionSupportColour(calculation, override?.colour);
  const label = (colour: TriageColour | null) => colour ? t(`mobile.westColour.${colour}`)
    : definition.assessment.result.unsupportedDraft.label[locale];
  const calculationLabel = calculation.status === "provisional"
    ? t("mobile.westProvisional", { colour: label(calculation.colour) }) : label(calculation.colour);
  const driver = calculation.status === "unassessed" || !calculation.criterionCode ? undefined
    : decisionSupportPickerCategories(definition.categories).flatMap(decisionSupportCategoryCriteria)
      .find(({ criterion }) => criterion.id === calculation.criterionCode);
  const changed = override && calculation.colour !== override.calculatedColourWhenSelected;
  return <div className="vital-decision-support">
    <div className="vital-decision-support-controls">
      <div role="status" className="vital-decision-support-result">
        <span className="vital-decision-support-indicator" data-colour={effective ?? "gray"} aria-hidden="true" />
        <div>
          <strong>{override ? t("mobile.westManual", { colour: label(effective) }) : calculationLabel}</strong>
          {override && <small>{t("mobile.westCalculated", { result: calculationLabel })}</small>}
          {changed && <small>{t("mobile.westCalculationChanged")}</small>}
          {driver && <small>{decisionSupportCriterionLabel(driver.criterion, driver.labelSuffix, locale)}</small>}
        </div>
      </div>
      <label>
        {t("mobile.westOverride")}
        <select ref={overrideRef} value={override?.colour ?? ""} aria-invalid={missingColour || undefined}
          aria-describedby={missingColour ? "vital-decision-support-required" : undefined}
          onChange={(event) => onOverride(isTriageColour(event.target.value) ? event.target.value : null)}>
          <option value="">{t("mobile.westAutomatic")}</option>
          {definition.assessment.result.overrideAllowed.map((colour) => <option key={colour} value={colour}>{label(colour)}</option>)}
        </select>
      </label>
    </div>
    {missingColour && <p role="alert" id="vital-decision-support-required">{definition.assessment.result.finalization.message[locale]}</p>}
  </div>;
}
