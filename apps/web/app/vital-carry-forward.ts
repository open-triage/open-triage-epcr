import { recordedVitalValues } from "./canonical-events";
import {
  type ClinicalDecisionSupportConfiguration, type DraftDecisionSupportAssessment, type EncounterDocument,
} from "@open-triage/contracts";
import {
  compareVitalMeasurements, vitalMeasurementOrder, type VitalMeasurementOrder,
} from "./finalized-vital-decision-support";
import { vitalDecisionSupport } from "./vital-decision-support";

type CarriedDecisions = Pick<DraftDecisionSupportAssessment, "findings" | "override" | "scale">;
export type VitalDecisionEdits = Partial<Record<keyof CarriedDecisions, true>>;

export interface VitalDecisionSnapshot {
  readonly history: ReadonlyArray<VitalMeasurementOrder & CarriedDecisions>;
  readonly defaultScale: string;
}

export function vitalDecisionSnapshot(
  document: EncounterDocument, configuration: ClinicalDecisionSupportConfiguration,
): VitalDecisionSnapshot {
  const { definition } = configuration;
  const carried = definition.assessment.carryFromPrecedingMeasurement;
  const group = document.groups.find(({ id }) => id === definition.assessment.group);
  const history = (group?.instances ?? []).flatMap((instance) => {
    const measurement = vitalMeasurementOrder(instance);
    if (!measurement) return [];
    const assessment = vitalDecisionSupport(instance, configuration);
    return [{ ...measurement,
      // The findings selection includes category negatives and an explicit entry-wide absence.
      findings: carried.includes("criteria") ? assessment.findings : undefined,
      scale: carried.includes("newsScale") ? assessment.scale : undefined,
      override: carried.includes("overrideColour") && assessment.override
        ? { ...assessment.override, inheritedFromMeasurement: measurement.instanceId } : null,
    }];
  }).sort((left, right) => compareVitalMeasurements(right, left));
  return { history, defaultScale: definition.assessment.elements.newsScale.defaultValue };
}

export function withCarriedVitalDecisions(
  assessment: DraftDecisionSupportAssessment, snapshot: VitalDecisionSnapshot,
  instanceId: string, measurementInstant: string | undefined, edits: VitalDecisionEdits = {},
): DraftDecisionSupportAssessment {
  const preceding = measurementInstant ? snapshot.history.filter((candidate) =>
    candidate.instanceId !== instanceId && compareVitalMeasurements(candidate, { instanceId, measurementInstant }) < 0) : [];
  const latest = preceding[0];
  return { ...assessment,
    findings: edits.findings ? assessment.findings : latest?.findings,
    override: edits.override ? assessment.override : latest?.override ?? null,
    scale: edits.scale ? assessment.scale : preceding.find(({ scale }) => scale !== undefined)?.scale ?? snapshot.defaultScale,
  };
}

export type VitalReadingHistory = ReadonlyArray<VitalMeasurementOrder & { readings: Record<string, string> }>;

export function vitalReadingHistory(document: EncounterDocument, elements: readonly string[],
  configuration?: ClinicalDecisionSupportConfiguration): VitalReadingHistory {
  const instances = document.groups.find(({ id }) => id === "eVitals.VitalGroup")?.instances ?? [];
  return instances.flatMap(instance => {
    const order = vitalMeasurementOrder(instance);
    if (!order) return [];
    const observations = configuration ? vitalDecisionSupport(instance, configuration).observations : undefined;
    return [{ ...order, readings: { ...recordedVitalValues(document, instance, elements), ...observations } }];
  }).sort(compareVitalMeasurements);
}

export function provisionalVitalReadings(history: VitalReadingHistory | undefined, instanceId: string,
  measurementInstant: string | undefined, entered: Readonly<Record<string, unknown>> = {}): Record<string, string> {
  const previous: Record<string, string> = {};
  // A new row can default to the preceding row's exact timestamp.
  const cutoff = Date.parse(measurementInstant ?? "");
  if (!Number.isFinite(cutoff)) return previous;
  for (const row of history ?? []) {
    if (Date.parse(row.measurementInstant) > cutoff) break;
    if (row.instanceId !== instanceId) Object.assign(previous, row.readings);
  }
  return Object.fromEntries(Object.entries(previous).filter(([key, value]) => value && !Object.hasOwn(entered, key)));
}
