import { UnprocessableEntityException } from "@nestjs/common";
import {
  decisionSupportElementKey, effectiveDecisionSupportColour, isTriageColour,
  type ClinicalDecisionSupportConfiguration, type FinalizedDecisionSupportCalculation,
} from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { DECISION_SUPPORT_NAMESPACE, loadPinnedDecisionSupport } from "../forms/decision-support.js";
import type { DraftGroupMutation, DraftOccurrenceMutation } from "./draft-report.types.js";

type PinnedReport = {
  id: string;
  organization_id: string;
  decision_support_definition_id?: string | null;
};

export function isDecisionSupportElement(elementId: string): boolean {
  return elementId.startsWith(`${DECISION_SUPPORT_NAMESPACE}.`);
}

export async function loadReportDecisionSupport(
  manager: EntityManager, report: PinnedReport,
): Promise<ClinicalDecisionSupportConfiguration> {
  if (!report.decision_support_definition_id) {
    throw new UnprocessableEntityException("The report has no pinned decision support definition");
  }
  return loadPinnedDecisionSupport(manager, report.organization_id, report.decision_support_definition_id);
}

export function assertNewOverrideProvenance(occurrence: DraftOccurrenceMutation, authorId: string): void {
  const { enteredBy, enteredAt, calculatedColourWhenSelected, inheritedFromMeasurement } = occurrence.sourceAttributes ?? {};
  if (occurrence.value?.kind !== "coded" || !isTriageColour(occurrence.value.code) ||
      enteredBy !== authorId || typeof enteredAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(enteredAt) ||
      !Number.isFinite(Date.parse(enteredAt)) ||
      (calculatedColourWhenSelected !== null && !isTriageColour(calculatedColourWhenSelected)) ||
      inheritedFromMeasurement !== undefined) {
    throw new UnprocessableEntityException("The manual decision requires its authorized author, selection time, and original calculation");
  }
}

/** Older vital groups may predate mandatory WEST finalization on this installation. */
export async function newlyFinalizedVitals(
  manager: EntityManager, report: PinnedReport,
  groups: ReadonlyArray<DraftGroupMutation>, configuration?: ClinicalDecisionSupportConfiguration,
): Promise<Set<string>> {
  if (!configuration) return new Set();
  const ids = groups.filter((group) => group.groupId === configuration.definition.assessment.group && !group.tombstone)
    .map(({ id }) => id);
  if (!ids.length) return new Set();
  const old = await manager.query<Array<{ id: string }>>(`
    select id from clinical.group_instance where report_id = $1 and id = any($2::uuid[]) and tombstoned_at is null
  `, [report.id, ids]);
  const finalized = new Set(ids);
  for (const { id } of old) finalized.delete(id);
  return finalized;
}

/** Validate the persisted winners, since a sync command can lose some targets to a concurrent edit. */
export async function assertFinalizedVitalDecisions(
  manager: EntityManager, report: PinnedReport,
  groups: ReadonlyArray<DraftGroupMutation>, occurrences: ReadonlyArray<DraftOccurrenceMutation>,
  configuration?: ClinicalDecisionSupportConfiguration, newlyFinalized = new Set<string>(),
): Promise<void> {
  const changes = occurrences.filter(({ elementId }) => isDecisionSupportElement(elementId));
  const assessedGroups = groups.filter(({ decisionSupportCalculation, tombstone }) => decisionSupportCalculation && !tombstone);
  if (!configuration) return;
  const { definition, fields } = configuration;
  const correctedTimes = occurrences.filter(({ elementId }) => elementId === "eVitals.01")
    .flatMap(({ groupInstanceId }) => groupInstanceId ? [groupInstanceId] : []);
  const changesByGroup = new Set([...assessedGroups.map(({ id }) => id), ...newlyFinalized]);
  for (const occurrence of changes) {
    if (!occurrence.groupInstanceId) throw new UnprocessableEntityException("Decision support requires a vital occurrence");
    changesByGroup.add(occurrence.groupInstanceId);
  }

  const affected = new Set([...changesByGroup, ...correctedTimes, ...groups
    .filter((group) => group.groupId === definition.assessment.group && !group.tombstone)
    .map(({ id }) => id)]);
  if (!affected.size) return;
  const rows = await manager.query<Array<{
    id: string;
    group_id: string;
    documented_time: string | Date | null;
    recorded_time: string | Date | null;
    decision_support_calculation: FinalizedDecisionSupportCalculation | null;
    override_colours: string[];
  }>>(`
    select vital.id, vital.group_id, vital.documented_time, vital.decision_support_calculation,
      (select measurement.value_datetime from clinical.element_occurrence measurement
        where measurement.report_id = vital.report_id and measurement.group_instance_id = vital.id
          and measurement.element_id = 'eVitals.01' and measurement.tombstoned_at is null
        order by measurement.ordinal, measurement.id limit 1) as recorded_time,
      array(select override.code from clinical.element_occurrence override
        where override.report_id = vital.report_id and override.group_instance_id = vital.id
          and override.element_id = $3 and override.tombstoned_at is null) as override_colours
    from clinical.group_instance vital
    where vital.report_id = $1 and vital.id = any($2::uuid[]) and vital.tombstoned_at is null
  `, [report.id, [...affected], decisionSupportElementKey(fields.overrideColour)]);
  for (const row of rows) {
    const { decision_support_calculation: calculation, override_colours: colours } = row;
    if (!calculation && !changesByGroup.has(row.id)) continue;
    const override = colours.length === 1 && isTriageColour(colours[0]) ? colours[0] : null;
    // This slice has no calculation inputs. A future calculation must be verified
    // against the pinned criteria and physiology before it can support finalization.
    if (calculation && calculation.status !== "unassessed") {
      throw new UnprocessableEntityException("The calculated vital result has no supported inputs");
    }
    if (row.group_id !== definition.assessment.group || !row.documented_time || !row.recorded_time ||
        new Date(row.recorded_time).getTime() !== new Date(row.documented_time).getTime() ||
        calculation?.systemKey !== definition.key || calculation.version !== definition.version ||
        (colours.length > 0 && (!override || !definition.assessment.result.overrideAllowed.includes(override))) ||
        !effectiveDecisionSupportColour(calculation, override)) {
      throw new UnprocessableEntityException("A finalized vital assessment requires a measurement time, pinned definition, and one effective color");
    }
  }
}
