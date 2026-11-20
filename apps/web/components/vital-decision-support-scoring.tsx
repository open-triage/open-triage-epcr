import { provisionalVitalProps } from "./provisional-vital";
import { decisionSupportExplicitInputs, decisionSupportScale, type DecisionSupportDefinition,
  type DraftDecisionSupportAssessment } from "@open-triage/contracts";
import { resolveMessage } from "../app/localization";
import { useId } from "react";
import { VitalField, vitalPointsLabel } from "./vital-field";

export function VitalDecisionSupportScale({ definition, assessment, language, suggestions = {}, showPendingScore, onScale, onObservation }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly suggestions?: Readonly<Record<string, string>>;
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
  const provisionalScore = Object.keys(scale.tablesByInput ?? {}).some(key => {
    const input = definition.inputs[key];
    return input && suggestions["element" in input ? input.element : key];
  });
  const scoreLabel = resolveMessage(language, provisionalScore ? "mobile.provisionalScore" : "mobile.westScoreTotal", { scale: scale.scoreName });
  const oxygen = decisionSupportExplicitInputs(definition, scaleKey).find(({ key }) => key === "oxygen");
  return <div className="vital-decision-support-controls vital-decision-support-scoring">
    {(score != null || showPendingScore) && <div className="vital-decision-support-total">
      <span id={`${id}-score-label`}>{scoreLabel}</span>
      <output aria-labelledby={`${id}-score-label`}>
        {score ?? resolveMessage(language, "mobile.westScoreIncomplete", {
          points: Object.values(physiology?.points ?? {}).reduce((sum, points) => sum + points, 0),
        })}
      </output>
    </div>}
    <VitalField id={id} label={resolveMessage(language, "mobile.westNewsScale")}>
      {() => <select id={id} value={scaleKey} onChange={(event) => onScale(event.target.value)}>
        {Object.entries(selector.values).map(([key, option]) => {
          const messageKey = `mobile.westScale.${key}`;
          const label = resolveMessage(language, messageKey);
          return <option key={key} value={key}>{label === messageKey ? option.label[locale] : label}</option>;
        })}
      </select>}
    </VitalField>
    {oxygen && <VitalDecisionSupportObservation input={oxygen.key} suggestion={suggestions.oxygen} values={oxygen.values} value={assessment.observations?.oxygen ?? ""}
      language={language} points={showPendingScore ? physiology?.points.oxygen ?? null : undefined}
      onObservation={onObservation} />}
  </div>;
}

export function VitalDecisionSupportObservations({ definition, assessment, language, suggestions = {}, points, onObservation }: {
  readonly definition: DecisionSupportDefinition;
  readonly assessment: DraftDecisionSupportAssessment;
  readonly suggestions?: Readonly<Record<string, string>>;
  readonly language: string;
  readonly points?: Readonly<Record<string, number>>;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const scale = decisionSupportScale(definition, assessment.scale);
  return <>
    {decisionSupportExplicitInputs(definition, scale).filter(({ key }) => key !== "oxygen").map(({ key, values }) =>
      <VitalDecisionSupportObservation key={key} input={key} suggestion={suggestions[key]} values={values} value={assessment.observations?.[key] ?? ""}
        language={language} points={points ? points[key] ?? null : undefined} onObservation={onObservation} />)}
  </>;
}

function VitalDecisionSupportObservation({ input, suggestion, values, value, language, points, onObservation }: {
  readonly input: string;
  readonly suggestion?: string;
  readonly values: readonly string[];
  readonly value: string;
  readonly language: string;
  readonly points?: number | null;
  readonly onObservation: (key: string, value: string) => void;
}) {
  const id = useId();
  const t = (key: string) => resolveMessage(language, key);
  return <VitalField id={id} label={t(`mobile.westObservation.${input}`)} pointsLabel={vitalPointsLabel(language, points)}>
    {(describedBy) => <select id={id} {...provisionalVitalProps(suggestion, language, candidate => onObservation(input, candidate))} aria-describedby={describedBy} value={suggestion ?? value} onChange={(event) => onObservation(input, event.target.value)}>
      <option value="">{t("mobile.westObservationUnset")}</option>
      {values.map((option) => <option key={option} value={option}>{t(`mobile.westObservation.${input}.${option}`)}</option>)}
    </select>}
  </VitalField>;
}
