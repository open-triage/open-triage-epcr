import {
  effectiveDecisionSupportColour,
  type ClinicalDecisionSupportConfiguration,
  type DecisionSupportDefinition,
  type EncounterDocument,
  type EncounterGroupInstance,
  type TriageColour,
} from "@open-triage/contracts";
import { vitalDecisionSupport } from "./vital-decision-support";

export interface VitalMeasurementOrder {
  readonly instanceId: string;
  readonly measurementInstant: string;
}

export interface FinalizedVitalDecisionSupport extends VitalMeasurementOrder {
  readonly systemKey: DecisionSupportDefinition["key"];
  readonly version: string;
  readonly colour: TriageColour;
  readonly status: "definitive" | "provisional" | "manual";
}

/** Measurement time first, then the canonical occurrence ID for equal instants. */
export function compareVitalMeasurements(a: VitalMeasurementOrder, b: VitalMeasurementOrder): number {
  return Date.parse(a.measurementInstant) - Date.parse(b.measurementInstant) ||
    (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0);
}

export function vitalMeasurementOrder(instance: EncounterGroupInstance): VitalMeasurementOrder | undefined {
  const measurement = instance.elements.find(({ id }) => id === "eVitals.01")?.values[0];
  const measurementInstant = measurement?.kind === "scalar" && typeof measurement.value === "string"
    ? measurement.value : instance.attributes?.documentedTime;
  if (typeof measurementInstant !== "string" || !Number.isFinite(Date.parse(measurementInstant))) return undefined;
  return { instanceId: instance.instanceId, measurementInstant };
}

export function finalizedVitalDecisionSupport(
  instance: EncounterGroupInstance,
  configuration: ClinicalDecisionSupportConfiguration,
): FinalizedVitalDecisionSupport | undefined {
  const saved = instance.decisionSupportCalculation;
  const measurement = saved && vitalMeasurementOrder(instance);
  if (!saved || !measurement) return undefined;

  const { calculation, override } = vitalDecisionSupport(instance, configuration);
  const colour = effectiveDecisionSupportColour(calculation, override?.colour);
  if (!colour || (!override && calculation.status === "unassessed")) return undefined;
  return {
    ...measurement,
    systemKey: saved.systemKey,
    version: saved.version,
    colour,
    status: override ? "manual" : calculation.status === "provisional" ? "provisional" : "definitive",
  };
}

/** The canonical document contains finalized Vitals even while the editor has an unsaved draft. */
export function latestFinalizedVitalDecisionSupport(
  document: EncounterDocument,
  configuration: ClinicalDecisionSupportConfiguration | undefined,
): FinalizedVitalDecisionSupport | undefined {
  if (!configuration) return undefined;
  const vitals = document.groups.find(({ id }) => id === configuration.definition.assessment.group);
  let latest: FinalizedVitalDecisionSupport | undefined;
  for (const instance of vitals?.instances ?? []) {
    const result = finalizedVitalDecisionSupport(instance, configuration);
    if (result && (!latest || compareVitalMeasurements(result, latest) > 0)) latest = result;
  }
  return latest;
}
