import { compiledValidationBundleSha256, isNemsisDemographicElementId, type ClinicalFormConfiguration, type CompiledValidationBundle, type FormDraftDefinition } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { effectiveCatalogFields } from "./field-choice-policy.js";
import { releaseCustomDefinitions } from "../admin/custom-definition-version.js";

type FieldRow = {
  element_id: string;
  name: string;
  description: string | null;
  localization: ClinicalFormConfiguration["catalogFields"][string]["localization"] | null;
  exceptional_choices?: ClinicalFormConfiguration["catalogFields"][string]["exceptionalChoices"];
  agency_required: boolean | null;
  agency_required_severity: "warning" | "error" | null;
  min_occurs: number;
  max_occurs: number | null;
  nillable: boolean;
  supports_not_values: boolean;
  supports_pertinent_negatives: boolean;
};

type ChoiceRow = {
  element_id: string;
  code: string;
  code_system: string;
  label: string;
  source_label?: string;
  localization: ClinicalFormConfiguration["catalogFields"][string]["codeChoices"] extends Array<infer T> ? T extends { localization?: infer L } ? L : never : never;
  terminology_version: Date | string | null;
  sort_order: number | null;
};

/** Loads only immutable, report-pinned configuration; the current agency default is deliberately irrelevant. */
export async function clinicalFormConfiguration(
  manager: Pick<EntityManager, "query">,
  formVersionId: string,
  catalogReleaseId: string,
  validationVersionId?: string | null,
  validationCompiledSha256?: string | null,
): Promise<ClinicalFormConfiguration> {
  const versions = await manager.query<Array<{ canonical_definition: FormDraftDefinition }>>(`
    select canonical_definition from forms.form_version
    where id = $1 and catalog_release_id = $2 and status = 'published'
  `, [formVersionId, catalogReleaseId]);
  if (!versions[0]) throw new Error("The report's pinned form configuration is unavailable");

  const elementIds = [...new Set(versions[0].canonical_definition.sections.flatMap((section) =>
    section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
  const customIds = [...new Set(versions[0].canonical_definition.sections.flatMap((section) =>
    section.fields.flatMap((field) => field.source.kind === "custom" ? [field.source.elementDefinitionId] : [])))];
  const custom = customIds.length ? await manager.query<Array<{ id: string; definition: NonNullable<ClinicalFormConfiguration["customFields"]>[string] }>>(`
    select id,definition from forms.custom_element_definition where id=any($1::uuid[])`, [customIds]) : [];
  const customSnapshot = customIds.length ? await releaseCustomDefinitions(manager, catalogReleaseId) : null;
  const snapshotById = new Map((customSnapshot ?? []).map((item) => [item.id, item]));

  const validation = validationVersionId ? await manager.query<Array<{ compiled_bundle: CompiledValidationBundle; compiled_sha256: string }>>(`
    select compiled_bundle,compiled_sha256 from validation.version
    where id=$1 and catalog_release_id=$2 and status='published'
  `, [validationVersionId, catalogReleaseId]) : [];
  if (validationVersionId && !validation[0]) throw new Error("The report's pinned validation configuration is unavailable");
  if (validation[0] && (!validationCompiledSha256 || validation[0].compiled_sha256 !== validationCompiledSha256
    || compiledValidationBundleSha256(validation[0].compiled_bundle) !== validationCompiledSha256)) {
    throw new Error("The report's pinned validation configuration failed its integrity check");
  }
  const liveBundle = validation[0] ? { ...validation[0].compiled_bundle,
    rules: validation[0].compiled_bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes("live")
      && !isNemsisDemographicElementId(rule.primaryTarget.elementId)
      && !rule.references?.elementIds?.some(isNemsisDemographicElementId)) } : undefined;
  return {
    definition: versions[0].canonical_definition,
    customFields: Object.fromEntries(custom.map((row) => [row.id, snapshotById.get(row.id) ?? row.definition])),
    customGroups: await customGroupsConfiguration(manager, catalogReleaseId),
    catalogFields: effectiveCatalogFields(versions[0].canonical_definition,
      await catalogFieldsConfiguration(manager, catalogReleaseId, elementIds),
      await catalogFieldsConfiguration(manager, catalogReleaseId, elementIds, true)),
    catalogGroups: await catalogGroupsConfiguration(manager, catalogReleaseId),
    ...(liveBundle ? { validation: { versionId: validationVersionId!,
      compiledSha256: compiledValidationBundleSha256(liveBundle), bundle: liveBundle } } : {}),
  };
}

export async function customGroupsConfiguration(manager: Pick<EntityManager, "query">, catalogReleaseId: string): Promise<NonNullable<ClinicalFormConfiguration["customGroups"]>> {
  const rows = await manager.query<Array<{ definition: import("@open-triage/contracts").CatalogDraftCustomGroup }>>(`
    select jsonb_array_elements(coalesce(provenance->'customGroupDefinitions','[]'::jsonb)) as definition
    from catalog.release where id=$1`, [catalogReleaseId]);
  return Object.fromEntries(rows.map((row) => [row.definition.id, row.definition]));
}

/** Loads the immutable catalog behavior needed to preview or document a selected set of fields. */
export async function catalogFieldsConfiguration(
  manager: Pick<EntityManager, "query">,
  catalogReleaseId: string,
  elementIds: readonly string[],
  includeLegacyDisabled = false,
): Promise<ClinicalFormConfiguration["catalogFields"]> {

  // Extract each translation map once. Re-reading the large, compressed provenance
  // document for every field/choice made a full form take seconds to assemble.
  const fields = elementIds.length ? await manager.query<FieldRow[]>(`
    with wording as materialized (
      select provenance->'elementLocalization' as elements,
             provenance->'specialChoiceLocalization' as special_choices
      from catalog.release where id=$1
    )
    select e.element_id, e.name, e.description,
           cr.elements->e.element_id as localization,
           (select coalesce(jsonb_agg(jsonb_build_object('key', o.source_kind || ':' || o.code,
             'localization', cr.special_choices->e.element_id->o.source_kind->o.code)
             order by configured.sort_order nulls last, o.source_kind, o.code), '[]'::jsonb)
             from catalog.element_option o
             left join catalog.element_option_configuration configured on configured.release_id=o.release_id
               and configured.element_id=o.element_id and configured.source_kind=o.source_kind
               and configured.code_system=o.code_system and configured.code=o.code
             where o.release_id=e.release_id and o.element_id=e.element_id
             and o.source_kind in ('not-value', 'pertinent-negative')) as exceptional_choices,
           e.agency_required, e.agency_required_severity, e.min_occurs, e.max_occurs, e.nillable,
           e.supports_not_values, e.supports_pertinent_negatives
    from catalog.element_definition e cross join wording cr
    where e.release_id = $1 and e.element_id = any($2::text[])
  `, [catalogReleaseId, elementIds]) : [];
  const choices = elementIds.length ? await manager.query<ChoiceRow[]>(`
    with wording as materialized (
      select provenance->'codeListLocalization' as lists from catalog.release where id=$1
    )
    select * from (select vse.element_id, option.code, option.code_system, option.display as label, option.source_display as source_label,
           cr.lists->value_set.value_set_id->'values'->option.code_system->option.code as localization,
           value_set.published_at as terminology_version, configured.sort_order
    from catalog.value_set_element vse
    cross join wording cr
    join catalog.value_set value_set on value_set.release_id = vse.release_id
      and value_set.value_set_id = vse.value_set_id
    join catalog.value_set_option option on option.release_id = vse.release_id
      and option.value_set_id = vse.value_set_id
    left join catalog.value_set_option_configuration configured
      on configured.release_id = option.release_id and configured.value_set_id = option.value_set_id
      and configured.code_system = option.code_system and configured.code = option.code
    where vse.release_id = $1 and vse.element_id = any($2::text[])
      and ($3::boolean or coalesce(configured.enabled, true))
    union all
    select option.element_id, option.code, option.code_system, option.display as label, option.display as source_label,
           cr.lists->('inline:' || option.element_id)->'values'->option.code_system->option.code as localization,
           null::text as terminology_version, configured.sort_order
    from catalog.element_option option
    cross join wording cr
    left join catalog.element_option_configuration configured
      on configured.release_id=option.release_id and configured.element_id=option.element_id
      and configured.source_kind=option.source_kind and configured.code_system=option.code_system
      and configured.code=option.code
    where option.release_id=$1 and option.element_id=any($2::text[])
      and option.source_kind='inline' and ($3::boolean or coalesce(configured.enabled, true))) choices
    order by element_id, sort_order nulls last, label, code_system, code
  `, [catalogReleaseId, elementIds, includeLegacyDisabled]) : [];
  const choicesByElement = new Map<string, ClinicalFormConfiguration["catalogFields"][string]["codeChoices"]>();
  for (const choice of choices) {
    const current = choicesByElement.get(choice.element_id) ?? [];
    current.push({ code: choice.code, codeSystem: choice.code_system, label: choice.label,
      ...(choice.source_label && choice.source_label !== choice.label ? { sourceLabel: choice.source_label } : {}),
      ...(choice.localization ? { localization: choice.localization } : {}),
      ...(choice.terminology_version ? { terminologyVersion: new Date(choice.terminology_version).toISOString() } : {}) });
    choicesByElement.set(choice.element_id, current);
  }
  return Object.fromEntries(fields.map((field) => [field.element_id, {
      name: field.name,
      description: field.description ?? "",
      ...(field.localization ? { localization: field.localization } : {}),
      ...(field.exceptional_choices ? { exceptionalChoices: field.exceptional_choices } : {}),
      agencyRequired: field.agency_required === true,
      requirednessSeverity: field.agency_required_severity,
      minOccurs: Number(field.min_occurs),
      maxOccurs: field.max_occurs === null ? null : Number(field.max_occurs),
      nillable: field.nillable,
      supportsNotValues: field.supports_not_values,
      supportsPertinentNegatives: field.supports_pertinent_negatives,
      ...(choicesByElement.has(field.element_id) ? { codeChoices: choicesByElement.get(field.element_id) } : {}),
    }]));
}

/** Group wording is loaded from the report or preview's pinned catalog release. */
export async function catalogGroupsConfiguration(
  manager: Pick<EntityManager, "query">,
  catalogReleaseId: string,
): Promise<NonNullable<ClinicalFormConfiguration["catalogGroups"]>> {
  const groups = await manager.query<Array<{
    group_id: string; name: string;
    localization: NonNullable<ClinicalFormConfiguration["catalogGroups"]>[string]["localization"];
  }>>(`with wording as materialized (
      select provenance->'groupLocalization' as groups from catalog.release where id=$1
    )
    select g.group_id, g.name, r.groups->g.group_id as localization
    from catalog.group_definition g cross join wording r
    where g.release_id=$1`, [catalogReleaseId]);
  return Object.fromEntries(groups.map(({ group_id, name, localization }) =>
    [group_id, { name, ...(localization ? { localization } : {}) }]));
}
