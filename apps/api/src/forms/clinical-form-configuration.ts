import { compiledValidationBundleSha256, isNemsisDemographicElementId, type ClinicalFormConfiguration, type CompiledValidationBundle, type FormDraftDefinition } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

type FieldRow = {
  element_id: string;
  name: string;
  description: string | null;
  localization: ClinicalFormConfiguration["catalogFields"][string]["localization"] | null;
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
  terminology_version: Date | string | null;
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
    catalogFields: await catalogFieldsConfiguration(manager, catalogReleaseId, elementIds),
    ...(liveBundle ? { validation: { versionId: validationVersionId!,
      compiledSha256: compiledValidationBundleSha256(liveBundle), bundle: liveBundle } } : {}),
  };
}

/** Loads the immutable catalog behavior needed to preview or document a selected set of fields. */
export async function catalogFieldsConfiguration(
  manager: Pick<EntityManager, "query">,
  catalogReleaseId: string,
  elementIds: readonly string[],
): Promise<ClinicalFormConfiguration["catalogFields"]> {

  const fields = elementIds.length ? await manager.query<FieldRow[]>(`
    select e.element_id, e.name, e.description,
           cr.provenance->'elementLocalization'->e.element_id as localization,
           e.agency_required, e.agency_required_severity, e.min_occurs, e.max_occurs, e.nillable,
           e.supports_not_values, e.supports_pertinent_negatives
    from catalog.element_definition e join catalog.release cr on cr.id=e.release_id
    where e.release_id = $1 and e.element_id = any($2::text[])
  `, [catalogReleaseId, elementIds]) : [];
  const choices = elementIds.length ? await manager.query<ChoiceRow[]>(`
    select * from (select vse.element_id, option.code, option.code_system, option.display as label,
           value_set.published_at as terminology_version
    from catalog.value_set_element vse
    join catalog.value_set value_set on value_set.release_id = vse.release_id
      and value_set.value_set_id = vse.value_set_id
    join catalog.value_set_option option on option.release_id = vse.release_id
      and option.value_set_id = vse.value_set_id
    left join catalog.value_set_option_configuration configured
      on configured.release_id = option.release_id and configured.value_set_id = option.value_set_id
      and configured.code_system = option.code_system and configured.code = option.code
    where vse.release_id = $1 and vse.element_id = any($2::text[]) and coalesce(configured.enabled, true)
    union all
    select option.element_id, option.code, option.code_system, option.display as label,
           null::text as terminology_version
    from catalog.element_option option
    left join catalog.element_option_configuration configured
      on configured.release_id=option.release_id and configured.element_id=option.element_id
      and configured.source_kind=option.source_kind and configured.code_system=option.code_system
      and configured.code=option.code
    where option.release_id=$1 and option.element_id=any($2::text[])
      and option.source_kind='inline' and coalesce(configured.enabled, true)) choices
    order by element_id, label, code_system, code
  `, [catalogReleaseId, elementIds]) : [];
  const choicesByElement = new Map<string, ClinicalFormConfiguration["catalogFields"][string]["codeChoices"]>();
  for (const choice of choices) {
    const current = choicesByElement.get(choice.element_id) ?? [];
    current.push({ code: choice.code, codeSystem: choice.code_system, label: choice.label,
      ...(choice.terminology_version ? { terminologyVersion: new Date(choice.terminology_version).toISOString() } : {}) });
    choicesByElement.set(choice.element_id, current);
  }
  return Object.fromEntries(fields.map((field) => [field.element_id, {
      name: field.name,
      description: field.description ?? "",
      ...(field.localization ? { localization: field.localization } : {}),
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
