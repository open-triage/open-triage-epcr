import type { ClinicalFormConfiguration, FormDraftDefinition } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

type FieldRow = {
  element_id: string;
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
): Promise<ClinicalFormConfiguration> {
  const versions = await manager.query<Array<{ canonical_definition: FormDraftDefinition }>>(`
    select canonical_definition from forms.form_version
    where id = $1 and catalog_release_id = $2 and status = 'published'
  `, [formVersionId, catalogReleaseId]);
  if (!versions[0]) throw new Error("The report's pinned form configuration is unavailable");

  const elementIds = [...new Set(versions[0].canonical_definition.sections.flatMap((section) =>
    section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))];

  return {
    definition: versions[0].canonical_definition,
    catalogFields: await catalogFieldsConfiguration(manager, catalogReleaseId, elementIds),
  };
}

/** Loads the immutable catalog behavior needed to preview or document a selected set of fields. */
export async function catalogFieldsConfiguration(
  manager: Pick<EntityManager, "query">,
  catalogReleaseId: string,
  elementIds: readonly string[],
): Promise<ClinicalFormConfiguration["catalogFields"]> {

  const fields = elementIds.length ? await manager.query<FieldRow[]>(`
    select element_id, agency_required, agency_required_severity, min_occurs, max_occurs, nillable,
           supports_not_values, supports_pertinent_negatives
    from catalog.element_definition where release_id = $1 and element_id = any($2::text[])
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
