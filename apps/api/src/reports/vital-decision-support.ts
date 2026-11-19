import { isDeepStrictEqual } from "node:util";
import { UnprocessableEntityException } from "@nestjs/common";
import {
  calculateDecisionSupportFindings, decisionSupportElementKey, decisionSupportFindingResult,
  decisionSupportMeasurementLocalTime, decisionSupportObservationAttribute, decisionSupportPhysiology, effectiveDecisionSupportColour, isTriageColour,
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

type RecordedOverride = {
  groupInstanceId: string;
  elementId: string;
  code: string;
  provenance: { enteredBy: string; enteredAt: string; calculatedColourWhenSelected: string | null };
};

export async function validateVitalOverrideProvenance(
  manager: EntityManager, reportId: string, occurrences: readonly DraftOccurrenceMutation[], authorId: string,
): Promise<RecordedOverride[]> {
  const inheritance: Array<RecordedOverride & { source: string }> = [];
  const accepted = occurrences.map((occurrence): RecordedOverride => {
    const { enteredBy, enteredAt, calculatedColourWhenSelected, inheritedFromMeasurement } = occurrence.sourceAttributes ?? {};
    if (!occurrence.groupInstanceId || occurrence.value?.kind !== "coded" || !isTriageColour(occurrence.value.code) ||
        typeof enteredBy !== "string" || typeof enteredAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(enteredAt) ||
        !Number.isFinite(Date.parse(enteredAt)) ||
        (calculatedColourWhenSelected !== null && !isTriageColour(calculatedColourWhenSelected))) {
      throw new UnprocessableEntityException("The manual decision requires its authorized author, selection time, and original calculation");
    }
    const selection = { groupInstanceId: occurrence.groupInstanceId, elementId: occurrence.elementId,
      code: occurrence.value.code, provenance: { enteredBy, enteredAt, calculatedColourWhenSelected } };
    if (inheritedFromMeasurement === undefined) {
      if (enteredBy !== authorId) throw new UnprocessableEntityException("The manual decision requires its authorized author");
    } else {
      if (typeof inheritedFromMeasurement !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inheritedFromMeasurement) ||
          inheritedFromMeasurement.toLowerCase() === occurrence.groupInstanceId.toLowerCase()) {
        throw new UnprocessableEntityException("The inherited override requires a different source measurement in this report");
      }
      inheritance.push({ ...selection, source: inheritedFromMeasurement.toLowerCase() });
    }
    return selection;
  });
  if (!inheritance.length) return accepted;

  // The report lock protects this read. Earlier accepted decisions survive a
  // source edit or removal, so an offline repeat can sync its original snapshot.
  const invalid = await manager.query<Array<{ source: string }>>(`
    select incoming.source::text
    from jsonb_to_recordset($2::jsonb) as incoming(source uuid, "elementId" text, code text, provenance jsonb)
    where not exists (
      select 1 from clinical.element_occurrence saved
      where saved.report_id = $1 and saved.group_instance_id = incoming.source
        and saved.element_id = incoming."elementId" and saved.code = incoming.code
        and saved.source_attributes @> incoming.provenance
    ) and not exists (
      select 1 from clinical.report_change change
      where change.report_id = $1 and change.changes->'acceptedVitalOverrides' @> jsonb_build_array(jsonb_build_object(
        'groupInstanceId', incoming.source::text, 'elementId', incoming."elementId", 'code', incoming.code, 'provenance', incoming.provenance
      ))
    )
    limit 1
  `, [reportId, JSON.stringify(inheritance)]);
  if (invalid.length) {
    throw new UnprocessableEntityException("The inherited override does not match an accepted decision on its source measurement");
  }
  return accepted;
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
  const assessedGroups = groups.filter(({ decisionSupportCalculation, tombstone }) => decisionSupportCalculation && !tombstone);
  if (!configuration) return;
  const { definition, fields } = configuration;
  const measurementKeys = Object.values(definition.inputs).flatMap((input) => "element" in input ? [input.element] : []);
  const measurementElements = new Set(["eVitals.01", ...measurementKeys]);
  const affected = new Set(groups.map(({ id }) => id));
  const changesByGroup = new Set([...assessedGroups.map(({ id }) => id), ...newlyFinalized]);
  for (const occurrence of occurrences) {
    if (isDecisionSupportElement(occurrence.elementId)) {
      if (!occurrence.groupInstanceId) throw new UnprocessableEntityException("Decision support requires a vital occurrence");
      changesByGroup.add(occurrence.groupInstanceId);
    }
    if (occurrence.groupInstanceId && measurementElements.has(occurrence.elementId)) affected.add(occurrence.groupInstanceId);
  }
  if (!affected.size && !changesByGroup.size) return;
  const keys = {
    override: decisionSupportElementKey(fields.overrideColour),
    categories: decisionSupportElementKey(fields.categories),
    criteria: decisionSupportElementKey(fields.criteria),
    noWarning: decisionSupportElementKey(fields.noWarningCriteria),
    scale: decisionSupportElementKey(fields.newsScale),
    score: decisionSupportElementKey(fields.physiologyScore),
  };
  const rows = await manager.query<Array<{
    id: string;
    group_id: string;
    documented_time: string | Date | null;
    recorded_time: string | Date | null;
    recorded_offset: number | null;
    recorded_attributes: Record<string, unknown> | null;
    decision_support_calculation: FinalizedDecisionSupportCalculation | null;
    inputs: Array<{ elementId: string; code: string | null; boolean: boolean | null; integer: number | null; measurement: string | null }>;
  }>>(`
    with recursive ancestors as (
      select id, group_id, parent_group_instance_id from clinical.group_instance
      where report_id = $1 and id = any($2::uuid[])
      union
      select parent.id, parent.group_id, parent.parent_group_instance_id
      from ancestors join clinical.group_instance parent on parent.id = ancestors.parent_group_instance_id
      where parent.report_id = $1
    ), vital_roots as (
      select id from ancestors where group_id = $5
      union
      select unnest($3::uuid[])
    ), vital_tree as (
      select id as root_id, id, ordinal from clinical.group_instance
      where report_id = $1 and id in (select id from vital_roots) and tombstoned_at is null
      union
      select tree.root_id, child.id, child.ordinal
      from vital_tree tree join clinical.group_instance child on child.parent_group_instance_id = tree.id
      where child.report_id = $1 and child.tombstoned_at is null
    )
    select vital.id, vital.group_id, vital.documented_time, vital.decision_support_calculation,
      measurement.value_datetime as recorded_time, measurement.value_utc_offset_minutes as recorded_offset,
      measurement.source_attributes as recorded_attributes, coalesce(inputs.values, '[]'::json) as inputs
    from clinical.group_instance vital
    left join lateral (
      select value_datetime, value_utc_offset_minutes, source_attributes from clinical.element_occurrence
      where report_id = vital.report_id and group_instance_id = vital.id
        and element_id = 'eVitals.01' and tombstoned_at is null
      order by ordinal, id limit 1
    ) measurement on true
    left join lateral (
      select json_agg(json_build_object('elementId', value.element_id, 'code', value.code, 'boolean', value.value_boolean,
        'integer', value.value_integer, 'measurement', case when value.value_kind in ('text', 'integer', 'numeric')
          then coalesce(value.value_text, value.value_integer::text, value.value_numeric::text) end)
        order by tree.ordinal, tree.id, value.ordinal, value.id) as values
      from vital_tree tree join clinical.element_occurrence value on value.group_instance_id = tree.id
      where tree.root_id = vital.id and value.report_id = vital.report_id
        and value.element_id = any($4::text[]) and value.tombstoned_at is null
    ) inputs on true
    where vital.report_id = $1 and vital.id in (select id from vital_roots) and vital.tombstoned_at is null
  `, [report.id, [...affected], [...changesByGroup], [...Object.values(keys), ...measurementKeys], definition.assessment.group]);
  for (const row of rows) {
    const { decision_support_calculation: calculation, inputs } = row;
    const inputCodes = (elementKey: string) => inputs.filter(({ elementId }) => elementId === elementKey).map(({ code }) => code);
    const colours = inputCodes(keys.override);
    if (!calculation && !changesByGroup.has(row.id)) continue;
    const override = colours.length === 1 && isTriageColour(colours[0]) ? colours[0] : null;
    const criteria = inputCodes(keys.criteria);
    const categories = inputCodes(keys.categories);
    const negatives = inputs.filter(({ elementId }) => elementId === keys.noWarning);
    if (criteria.includes(null) || categories.includes(null) || negatives.length > 1 || negatives.some((value) => value.boolean === null)) {
      throw new UnprocessableEntityException("The documented decision support findings are invalid");
    }
    const localTime = row.recorded_time ? decisionSupportMeasurementLocalTime(row.recorded_time, row.recorded_offset ?? 0) : "";
    const findingResult = decisionSupportFindingResult(definition, {
      criteria: criteria.filter((code): code is string => code !== null),
      noWarningCriteria: negatives[0]?.boolean === true,
    }, localTime);
    if (!findingResult.valid || categories.length !== findingResult.categoryCodes.length ||
        new Set(categories).size !== categories.length || findingResult.categoryCodes.some((id) => !categories.includes(id))) {
      throw new UnprocessableEntityException("The documented decision support findings do not match their categories");
    }
    const scales = inputCodes(keys.scale);
    const scale = scales[0];
    const savedScores = inputs.filter(({ elementId }) => elementId === keys.score);
    if (scales.length > 1 || (scales.length === 1 && (scale == null || !Object.hasOwn(definition.assessment.elements.newsScale.values, scale))) ||
        (newlyFinalized.has(row.id) && !scale)) {
      throw new UnprocessableEntityException("The finalized vital assessment requires one configured NEWS scale");
    }
    const observationPrefix = decisionSupportObservationAttribute("");
    const observations = Object.fromEntries(Object.entries(row.recorded_attributes ?? {}).flatMap(([key, value]) =>
      key.startsWith(observationPrefix) && typeof value === "string" ? [[key.slice(observationPrefix.length), value]] : []));
    const measurements = Object.fromEntries(measurementKeys.flatMap((key) => {
      const value = inputs.find(({ elementId }) => elementId === key)?.measurement;
      return value == null ? [] : [[key, value]];
    }));
    const physiology = scale ? decisionSupportPhysiology(definition, scale, measurements, observations) : undefined;
    if (physiology?.total == null ? savedScores.length !== 0 :
        savedScores.length !== 1 || savedScores[0]?.integer !== physiology.total) {
      throw new UnprocessableEntityException("The documented NEWS score does not match the supported observations");
    }
    const expected = calculateDecisionSupportFindings(definition, findingResult, physiology);
    if (calculation && (calculation.status !== expected.status || calculation.colour !== expected.colour ||
        !isDeepStrictEqual(calculation.physiology, expected.physiology) ||
        ("criterionCode" in calculation ? calculation.criterionCode : undefined) !== ("criterionCode" in expected ? expected.criterionCode : undefined))) {
      throw new UnprocessableEntityException("The calculated vital result does not match the supported inputs");
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
