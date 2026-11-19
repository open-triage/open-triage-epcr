import type { FinalizedVitalDecisionSupport } from "../app/finalized-vital-decision-support";
import { resolveMessage } from "../app/localization";

export function WestLevel({ id, assessment, language, latest = false }: {
  readonly id?: string;
  readonly assessment: FinalizedVitalDecisionSupport;
  readonly language: string;
  readonly latest?: boolean;
}) {
  const colour = resolveMessage(language, `mobile.westColour.${assessment.colour}`);
  const result = assessment.status === "definitive" ? colour
    : resolveMessage(language, assessment.status === "manual" ? "mobile.westManual" : "mobile.westProvisional", { colour });
  return <span id={id} className="west-level" role={latest ? "status" : undefined}
    data-west-colour={assessment.colour} data-west-status={assessment.status} data-west-definition-version={assessment.version}>
    <span className="vital-decision-support-indicator" data-colour={assessment.colour} aria-hidden="true" />
    {resolveMessage(language, latest ? "mobile.westLatestLevel" : "mobile.westRecordedLevel", { result })}
  </span>;
}
