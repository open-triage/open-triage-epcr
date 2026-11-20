import { decisionSupportExplicitInputs, decisionSupportScale, type DecisionSupportDefinition,
  type DraftDecisionSupportAssessment } from "@open-triage/contracts";
import { resolveMessage } from "../app/localization";
import { useId } from "react";
import { VitalField, vitalPointsLabel } from "./vital-field";

export function VitalDecisionSupportScale({ definition, assessment, language, showPendingScore, onScale, onObservation }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly language: string;
  readonly showPendingScore?: boolean;
  readonly onScale: (scale: string) => void;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const id = useId();
  const locale = language === "sv" ? "sv" : "en";
  const selector = definition.assessment.elements.newsScale;
  const scaleKey = decisionSupportScale(definition, assessment.scale);
  const scale = selector.values[scaleKey];
  if (!scale) return null;
  const physiology = assessment.calculation.physiology;
  const score = physiology?.total;
  const scoreLabel = resolveMessage(language, "mobile.westScoreTotal", { scale: scale.scoreName });
  const oxygen = decisionSupportExplicitInputs(definition, scaleKey).find(({ key }) => key === "oxygen");
  return <div className="vital-decision-support-controls vital-decision-support-scoring">
    <VitalField id={id} label={resolveMessage(language, "mobile.westNewsScale")}>
      {() => <select id={id} value={scaleKey} onChange={(event) => onScale(event.target.value)}>
        {Object.entries(selector.values).map(([key, option]) => {
          const messageKey = `mobile.westScale.${key}`;
          const label = resolveMessage(language, messageKey);
          return <option key={key} value={key}>{label === messageKey ? option.label[locale] : label}</option>;
        })}
      </select>}
    </VitalField>
    {oxygen && <VitalDecisionSupportObservation input={oxygen.key} values={oxygen.values} value={assessment.observations?.oxygen ?? ""}
      language={language} points={showPendingScore ? physiology?.points.oxygen ?? null : undefined}
      onObservation={onObservation} />}
    {(score != null || showPendingScore) && <div className="vital-decision-support-total">
      <span id={`${id}-score-label`}>{scoreLabel}</span>
      <output aria-labelledby={`${id}-score-label`}>
        {score ?? resolveMessage(language, "mobile.westScoreIncomplete", {
          points: Object.values(physiology?.points ?? {}).reduce((sum, points) => sum + points, 0),
        })}
      </output>
    </div>}
  </div>;
}

export function VitalDecisionSupportObservations({ definition, assessment, language, points, pulsePoints, onObservation }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly language: string;
  readonly points?: Readonly<Record<string, number>>;
  readonly pulsePoints?: number | null;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const id = useId();
  const t = (key: string) => resolveMessage(language, key);
  const scale = decisionSupportScale(definition, assessment.scale);
  const pulse = Object.values(definition.inputs).find((input) => "element" in input && input.preferMeasuredHeartRateOverPulse);
  return <>
    {decisionSupportExplicitInputs(definition, scale).filter(({ key }) => key !== "oxygen").map(({ key, values }) =>
      <VitalDecisionSupportObservation key={key} input={key} values={values} value={assessment.observations?.[key] ?? ""}
        language={language} points={points ? points[key] ?? null : undefined} onObservation={onObservation} />)}
    {pulse && "element" in pulse && <VitalField id={`${id}-pulse`} label={t("mobile.westObservation.pulse")} unit={pulse.unit}
      pointsLabel={vitalPointsLabel(language, pulsePoints)}>
      {(describedBy) => <input id={`${id}-pulse`} aria-describedby={describedBy} inputMode={pulse.precision === 0 ? "numeric" : "decimal"}
        placeholder={`${pulse.minValue}–${pulse.maxValue}`} value={assessment.observations?.pulse ?? ""}
        onChange={(event) => onObservation("pulse", event.target.value)} />}
    </VitalField>}
  </>;
}

function VitalDecisionSupportObservation({ input, values, value, language, points, onObservation }: {
  readonly input: string;
  readonly values: readonly string[];
  readonly value: string;
  readonly language: string;
  readonly points?: number | null;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const id = useId();
  const t = (key: string) => resolveMessage(language, key);
  return <VitalField id={id} label={t(`mobile.westObservation.${input}`)} pointsLabel={vitalPointsLabel(language, points)}>
    {(describedBy) => <select id={id} aria-describedby={describedBy} value={value} onChange={(event) => onObservation(input, event.target.value)}>
      <option value="">{t("mobile.westObservationUnset")}</option>
      {values.map((option) => <option key={option} value={option}>{t(`mobile.westObservation.${input}.${option}`)}</option>)}
    </select>}
  </VitalField>;
}
