import { decisionSupportExplicitInputs, decisionSupportScale, type DecisionSupportDefinition,
  type DraftDecisionSupportAssessment } from "@open-triage/contracts";
import { resolveMessage } from "../app/localization";

export function VitalDecisionSupportScale({ definition, assessment, language, onScale }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly language: string;
  readonly onScale: (scale: string) => void;
}) {
  const locale = language === "sv" ? "sv" : "en";
  const selector = definition.assessment.elements.newsScale;
  const scaleKey = decisionSupportScale(definition, assessment.scale);
  const scale = selector.values[scaleKey];
  if (!scale) return null;
  const score = assessment.calculation.physiology?.total;
  const scoreLabel = definition.assessment.elements.physiologyScore.label[locale].replace("{scale}", scale.scoreName);
  return <div className="vital-decision-support-controls vital-decision-support-scoring">
    <label>{selector.label[locale]}
      <select value={scaleKey} onChange={(event) => onScale(event.target.value)}>
        {Object.entries(selector.values).map(([key, option]) =>
          <option key={key} value={key}>{option.label[locale]}</option>)}
      </select>
    </label>
    {score != null && <label>{scoreLabel}<output aria-label={scoreLabel}>{score}</output></label>}
  </div>;
}

export function VitalDecisionSupportObservations({ definition, assessment, language, onObservation }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly language: string;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const t = (key: string) => resolveMessage(language, key);
  const scale = decisionSupportScale(definition, assessment.scale);
  const pulse = Object.values(definition.inputs).find((input) => "element" in input && input.preferMeasuredHeartRateOverPulse);
  return <div className="vital-grid vital-decision-support-observations">
    {decisionSupportExplicitInputs(definition, scale).map(({ key, values }) =>
      <label key={key}>{t(`mobile.westObservation.${key}`)}
        <select value={assessment.observations?.[key] ?? ""} onChange={(event) => onObservation(key, event.target.value)}>
          <option value="">{t("mobile.westObservationUnset")}</option>
          {values.map((value) => <option key={value} value={value}>{t(`mobile.westObservation.${key}.${value}`)}</option>)}
        </select>
      </label>)}
    {pulse && <label>{t("mobile.westObservation.pulse")}
      <input type="number" inputMode="numeric" value={assessment.observations?.pulse ?? ""}
        onChange={(event) => onObservation("pulse", event.target.value)} />
    </label>}
  </div>;
}
