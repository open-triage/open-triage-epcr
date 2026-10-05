import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AuthoringVersionOption, CatalogDraftCustomCodedElement, CatalogDraftCustomElement, ClinicalFormConfiguration, ClinicianSession, FormCatalogElementPage, FormCloneDiagnostic, FormDraftDefinition, FormDraftField, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { canonicalDefinitionSha256, FormPublicationValidationError, validateCanonicalFormDefinition, withoutLegacyFormWording } from "../forms/form-publication.validation.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { FormPublicationService } from "../forms/form-publication.service.js";
import { catalogFieldsConfiguration, catalogGroupsConfiguration, customGroupsConfiguration } from "../forms/clinical-form-configuration.js";
import { customCodedPolicies, materializeLegacyChoicePolicies, validateFieldChoicePolicies, validateFieldCompletionRequirements } from "../forms/field-choice-policy.js";
import { mutationRows } from "../database/mutation-result.js";
import { ValidationAuthoringService } from "./validation-authoring.service.js";
import { releaseCustomDefinitions } from "./custom-definition-version.js";

type VersionRow = {
  id: string; form_id: string; catalog_release_id: string; cloned_from_id: string | null;
  display_name: string | null;
  revision: number; canonical_definition: FormDraftDefinition; definition_sha256: string;
  updated_at: Date | string;
};

type ElementRow = {
  element_id: string; element_identity_id: string; base_datatype: string; source_datatype: string;
  usage: string; definition: Record<string, unknown>; analytical_location: string | null; hidden?: boolean;
};

type Choice = NonNullable<FormDraftField["choicePolicy"]>[number];
function choiceIdentity(choice: Choice): string {
  return `${choice.kind}:${choice.kind === "code" ? choice.codeSystem : ""}:${choice.code}`;
}
function catalogChoices(catalog?: ClinicalFormConfiguration["catalogFields"][string]): Choice[] {
  return [...(catalog?.codeChoices ?? []).map(({ code, codeSystem }) => ({ kind: "code" as const, code, codeSystem })),
    ...(catalog?.exceptionalChoices ?? []).filter(({ key }) => key.startsWith("not-value:"))
      .map(({ key }) => ({ kind: "not-value" as const, code: key.slice("not-value:".length) }))];
}
function customChoices(custom?: CatalogDraftCustomElement): Choice[] {
  return custom?.datatype === "coded" ? [
    ...custom.choices.map(({ code }) => ({ kind: "code" as const, code, codeSystem: custom.codeSystem })),
    ...custom.permittedNotValues.map((code) => ({ kind: "not-value" as const, code }))] : [];
}

/** Compare catalog availability, independently for each field's existing policy. */
export function formCatalogAdoptionChoices(definition: FormDraftDefinition,
  sourceCatalog: ClinicalFormConfiguration["catalogFields"], targetCatalog: ClinicalFormConfiguration["catalogFields"],
  sourceCustom: ReadonlyMap<string, CatalogDraftCustomElement> = new Map(),
  targetCustom: ReadonlyMap<string, CatalogDraftCustomElement> = new Map()): Record<string, Choice[]> {
  const result: Record<string, Choice[]> = {};
  for (const field of definition.sections.flatMap((section) => section.fields)) {
    const source = field.source.kind === "nemsis" ? catalogChoices(sourceCatalog[field.source.elementId])
      : customChoices(sourceCustom.get(field.source.elementDefinitionId));
    const target = field.source.kind === "nemsis" ? catalogChoices(targetCatalog[field.source.elementId])
      : customChoices(targetCustom.get(field.source.elementDefinitionId));
    const known = new Set(source.map(choiceIdentity));
    const added = target.filter((choice) => !known.has(choiceIdentity(choice)));
    if (added.length) result[field.key] = added;
  }
  return result;
}

@Injectable()
export class FormAuthoringService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly sessions: ClinicianSessionService,
    private readonly publication: FormPublicationService,
    @Optional() private readonly validations?: ValidationAuthoringService) {}

  async current(token: string): Promise<StationaryFormDraft | null> {
    const session = await this.authorize(token, "forms:read");
    const rows = await this.dataSource.query<VersionRow[]>(`
      select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
      where f.organization_id=$1 and fv.created_by=$2 and fv.status='draft' order by fv.created_at desc limit 1
    `, [session.organization.id, session.user.id]);
    if (!rows[0]) return null;
    return this.result(this.dataSource.manager, rows[0]);
  }

  async versions(token: string): Promise<AuthoringVersionOption[]> {
    const session = await this.authorize(token, "forms:read");
    const rows = await this.dataSource.query<Array<{ id: string; display_name: string; version: number;
      catalog_release_id: string; active: boolean }>>(`
      select fv.id,coalesce(fv.display_name,'Version ' || fv.version) as display_name,fv.version,
        fv.catalog_release_id,active.form_version_id is not null as active
      from forms.form_version fv join forms.form f on f.id=fv.form_id
      left join forms.agency_stationary_default active on active.organization_id=f.organization_id
        and active.form_version_id=fv.id
      where f.organization_id=$1 and fv.status='published'
      order by fv.version desc,fv.id desc
    `, [session.organization.id]);
    return rows.map((row) => ({ id: row.id, displayName: row.display_name, version: row.version,
      catalogReleaseId: row.catalog_release_id, status: row.active ? "active" : "published" }));
  }

  async clone(token: string, input: unknown): Promise<StationaryFormDraft> {
    const session = await this.authorize(token, "forms:write");
    const { catalogReleaseId, displayName, sourceVersionId } = this.cloneBody(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`form-draft:${session.organization.id}`]);
      const target = await manager.query<Array<{ id: string }>>(`
        select r.id from catalog.release r
        where r.id=$1 and r.sealed and (
          exists (
            select 1 from catalog.authoring_draft d
            where d.published_release_id=r.id and d.organization_id=$2
          ) or exists (
            select 1 from forms.form_version fv
            join forms.form f on f.id=fv.form_id
            join forms.agency_stationary_default active on active.organization_id=f.organization_id
              and active.form_version_id=fv.id
            where f.organization_id=$2 and fv.status='published' and fv.catalog_release_id=r.id
          )
        )
      `, [catalogReleaseId, session.organization.id]);
      if (!target[0]) throw new NotFoundException("The selected published catalog was not found for this organization");
      const source = await manager.query<Array<VersionRow & { version: number }>>(`
        select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
        left join forms.agency_stationary_default active on active.organization_id=f.organization_id
          and active.form_version_id=fv.id
        where f.organization_id=$1 and fv.status='published' and
          (($2::uuid is null and active.form_version_id is not null) or fv.id=$2::uuid) limit 1
      `, [session.organization.id, sourceVersionId ?? null]);
      if (!source[0]) throw new NotFoundException("The selected Stationary form version is unavailable");
      const existing = await manager.query<VersionRow[]>(`
        select * from forms.form_version where form_id=$1 and created_by=$2 and status='draft' for update
      `, [source[0].form_id, session.user.id]);
      if (existing[0]) {
        if (sourceVersionId && existing[0].cloned_from_id !== sourceVersionId)
          throw new ConflictException("A Stationary form draft already exists from another version");
        if (existing[0].catalog_release_id !== catalogReleaseId)
          throw new ConflictException("A Stationary form draft is already pinned to another catalog");
        return this.result(manager, existing[0]);
      }
      const sourceDefinition = this.definition(source[0].canonical_definition);
      const sourceElementIds = [...new Set(sourceDefinition.sections.flatMap((section) => section.fields.flatMap((field) =>
        field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
      const sourceCatalog = await catalogFieldsConfiguration(manager, source[0].catalog_release_id, sourceElementIds);
      const hasCustom = sourceDefinition.sections.some((section) => section.fields.some((field) => field.source.kind === "custom"));
      const sourceCustomSnapshot = hasCustom ? await releaseCustomDefinitions(manager, source[0].catalog_release_id) : null;
      const sourceCustomPolicies = sourceCustomSnapshot === null ? await customCodedPolicies(manager, sourceDefinition)
        : Object.fromEntries(sourceCustomSnapshot.filter((item): item is CatalogDraftCustomCodedElement =>
          !item.retired && item.datatype === "coded").map((item) => [item.id, item]));
      const cloned = await this.compatibleClone(manager, source[0].catalog_release_id, catalogReleaseId,
        materializeLegacyChoicePolicies(sourceDefinition, sourceCatalog, sourceCustomPolicies));
      const digest = canonicalDefinitionSha256(cloned.definition);
      const inserted = mutationRows<VersionRow>(await manager.query(`
        insert into forms.form_version
          (form_id,catalog_release_id,version,canonical_definition,definition_sha256,cloned_from_id,created_by,display_name)
        select $1,$2,coalesce(max(version),0)+1,$3::jsonb,$4,$5,$6,$7
        from forms.form_version where form_id=$1 returning *
      `, [source[0].form_id, catalogReleaseId, JSON.stringify(cloned.definition), digest, source[0].id, session.user.id, displayName]));
      await this.auditDraftMutation(manager, session, "form.draft_create", inserted[0]!, {
        clonedFromId: source[0].id, diagnostics: cloned.diagnostics
      });
      return this.result(manager, inserted[0]!, cloned.diagnostics, source[0].catalog_release_id);
    });
  }

  async searchCatalog(token: string, id: string, input: Record<string, unknown>): Promise<FormCatalogElementPage> {
    const session = await this.authorize(token, "forms:read");
    const query = typeof input.query === "string" ? input.query.trim().slice(0, 100).toLowerCase() : "";
    const elementId = typeof input.elementId === "string" ? input.elementId.trim().slice(0, 200) : null;
    const drafts = await this.dataSource.query<Array<{ catalog_release_id: string }>>(`
      select fv.catalog_release_id from forms.form_version fv join forms.form f on f.id=fv.form_id
      where fv.id=$1 and f.organization_id=$2 and fv.created_by=$3 and fv.status='draft'
    `, [id, session.organization.id, session.user.id]);
    if (!drafts[0]) throw new NotFoundException(`Form draft ${id} was not found`);
    const rows = await this.dataSource.query<Array<{
      element_id: string; name: string; description: string; base_datatype: string; group_path: string[];
      custom_element_definition_id?: string;
      custom_definition?: NonNullable<ClinicalFormConfiguration["customFields"]>[string];
    }>>(`
      select element_id,name,description,base_datatype,group_path,
        null::uuid as custom_element_definition_id, null::jsonb as custom_definition
      from catalog.element_definition
      where release_id=$1 and element_id like 'e%.%'
        and element_id not in (select jsonb_array_elements_text(coalesce(
          (select provenance->'hiddenElementIds' from catalog.release where id=$1),'[]'::jsonb)))
        and ($4::text is null or element_id=$4)
        and ($2='' or position($2 in lower(element_id || ' ' || name || ' ' || description)) > 0)
      union all
      select ced.namespace || '.' || ced.slug,ced.title,
        coalesce(ced.definition->>'definition',''),ced.base_datatype,array[]::text[],ced.id,ced.definition
      from forms.custom_element_definition ced join catalog.release cr on cr.id=$1
      where ced.organization_id=$3 and ced.retired_at is null
        and ($4::text is null or ced.namespace || '.' || ced.slug=$4)
        and ced.id::text in (select jsonb_array_elements_text(coalesce(cr.provenance->'customElementIds','[]'::jsonb)))
      order by element_id
    `, [drafts[0].catalog_release_id, query, session.organization.id, elementId]);
    const snapshot = rows.some((row) => row.custom_element_definition_id) ?
      await releaseCustomDefinitions(this.dataSource.manager, drafts[0].catalog_release_id) : null;
    const byId = new Map((snapshot ?? []).map((item) => [item.id, item]));
    const items = rows.filter((row) => {
      if (!row.custom_element_definition_id) return true;
      const pinned = byId.get(row.custom_element_definition_id);
      return pinned?.retired !== true && (!query ||
        `${row.element_id} ${pinned?.title ?? row.name} ${pinned?.definition ?? row.description}`.toLowerCase().includes(query));
    }).map((row) => {
      const pinned = row.custom_element_definition_id ? byId.get(row.custom_element_definition_id) : undefined;
      return { elementId: row.element_id, name: pinned?.title ?? row.name,
        description: pinned?.definition ?? row.description, baseDatatype: row.base_datatype, groupPath: row.group_path,
        ...(row.custom_element_definition_id ? { customElementDefinitionId: row.custom_element_definition_id } : {}),
        ...(pinned?.groupDefinitionId ? { customGroupDefinitionId: pinned.groupDefinitionId } : {}) };
    });
    if (elementId && !items.length) throw new NotFoundException("The selected catalog element is unavailable");
    return { items, nextOffset: null,
      ...(elementId ? {
        catalogFields: await catalogFieldsConfiguration(this.dataSource.manager, drafts[0].catalog_release_id,
          rows.filter((row) => !row.custom_element_definition_id).map((row) => row.element_id), true),
        customFields: Object.fromEntries(rows.filter((row) => row.custom_element_definition_id &&
          items.some((item) => item.customElementDefinitionId === row.custom_element_definition_id))
          .flatMap((row) => {
            const definition = byId.get(row.custom_element_definition_id!) ?? row.custom_definition;
            return definition ? [[row.custom_element_definition_id!, definition]] : [];
          })),
      } : {}) };
  }

  async save(token: string, id: string, input: unknown): Promise<StationaryFormDraft> {
    const session = await this.authorize(token, "forms:write");
    const body = this.saveBody(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(`
        select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.created_by=$3 and fv.status='draft' for update
      `, [id, session.organization.id, session.user.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
      if (draft.revision !== body.expectedRevision) throw new ConflictException({
        message: "Form draft revision is stale", expectedRevision: body.expectedRevision, actualRevision: draft.revision
      });
      const checked = await this.compatibleClone(manager, draft.catalog_release_id, draft.catalog_release_id, body.definition);
      if (checked.diagnostics.length) throw new UnprocessableEntityException({
        message: "Form validation failed", findings: checked.diagnostics
      });
      const choiceElementIds = [...new Set(body.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
        field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
      const choiceCatalog = await catalogFieldsConfiguration(manager, draft.catalog_release_id, choiceElementIds, true);
      const customSnapshot = body.definition.sections.some((section) => section.fields.some((field) => field.source.kind === "custom"))
        ? await releaseCustomDefinitions(manager, draft.catalog_release_id) : null;
      const customPolicies = customSnapshot === null ? await customCodedPolicies(manager, body.definition)
        : Object.fromEntries(customSnapshot.filter((item): item is CatalogDraftCustomCodedElement => !item.retired && item.datatype === "coded")
          .map((item) => [item.id, item]));
      const choiceFindings = validateFieldChoicePolicies(body.definition, choiceCatalog, customPolicies);
      const completionFindings = validateFieldCompletionRequirements(body.definition, choiceCatalog,
        Object.fromEntries((customSnapshot ?? []).filter((item) => !item.retired).map((item) => [item.id, item])));
      if (choiceFindings.length || completionFindings.length) throw new UnprocessableEntityException({
        message: "Form validation failed", findings: [...choiceFindings, ...completionFindings] });
      const definition = materializeLegacyChoicePolicies(body.definition, choiceCatalog, customPolicies);
      const digest = canonicalDefinitionSha256(definition);
      const updated = await manager.query<VersionRow[]>(`
        with updated as (
          update forms.form_version set canonical_definition=$3::jsonb,definition_sha256=$4,
            display_name=coalesce($5,display_name),revision=revision+1,updated_at=now()
          where id=$1 and revision=$2 and created_by=$6 and status='draft' returning *
        )
        select * from updated
      `, [id, body.expectedRevision, JSON.stringify(definition), digest, body.displayName, session.user.id]);
      if (!updated[0]) throw new ConflictException("Form draft revision is stale or the form was published");
      await this.auditDraftMutation(manager, session, "form.draft_save", updated[0]!);
      return this.result(manager, updated[0]);
    });
  }

  async delete(token: string, id: string, input: unknown): Promise<void> {
    const session = await this.authorize(token, "forms:write");
    const expectedRevision = this.expectedRevision(input);
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(`
        select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.created_by=$3 and fv.status='draft' for update
      `, [id, session.organization.id, session.user.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
      if (draft.revision !== expectedRevision) throw new ConflictException({
        message: "Form draft revision is stale", expectedRevision, actualRevision: draft.revision
      });
      await this.auditDraftMutation(manager, session, "form.draft_delete", draft, { deletedFormVersionId: draft.id });
      const deleted = mutationRows<{ id: string }>(await manager.query(
        "delete from forms.form_version where id=$1 and revision=$2 and created_by=$3 and status='draft' returning id",
        [id, expectedRevision, session.user.id]
      ));
      if (!deleted[0]) throw new ConflictException("Form draft revision is stale or the form was published");
    });
  }

  async publish(token: string, id: string, input: unknown): Promise<PublishedStationaryForm> {
    const session = await this.authorize(token, "forms:publish");
    const body = this.publicationBody(input);
    const rows = await this.dataSource.query<Array<VersionRow & { version: number }>>(`
      select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
      where fv.id=$1 and f.organization_id=$2 and fv.created_by=$3 and fv.status='draft'
    `, [id, session.organization.id, session.user.id]);
    const draft = rows[0];
    if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
    if (draft.revision !== body.expectedRevision) throw new ConflictException({
      message: "Form draft revision is stale", expectedRevision: body.expectedRevision, actualRevision: draft.revision
    });
    const sources = draft.cloned_from_id ? await this.dataSource.query<Array<{ catalog_release_id: string }>>(`
      select catalog_release_id from forms.form_version where id=$1 and status='published'
    `, [draft.cloned_from_id]) : [];
    const review = await this.compatibleClone(this.dataSource.manager,
      sources[0]?.catalog_release_id ?? draft.catalog_release_id, draft.catalog_release_id,
      this.definition(draft.canonical_definition));
    if (review.diagnostics.length) throw new UnprocessableEntityException({
      message: "Resolve catalog adoption before publishing", findings: review.diagnostics
    });
    const published = await this.publication.publish(id, {
      publishedBy: session.user.id, changeNote: body.changeNote,
      definitionSha256: body.definitionSha256, displayName: body.displayName
    }, session.organization.id);
    return { id: published.id, displayName: body.displayName, formId: draft.form_id, catalogReleaseId: draft.catalog_release_id,
      version: draft.version, status: "published", definitionSha256: published.definitionSha256,
      publishedAt: published.publishedAt, structuralSummary: published.projections };
  }

  async activate(token: string, id: string, input: unknown): Promise<StationaryFormActivation> {
    const session = await this.authorize(token, "forms:publish");
    const changeNote = this.changeNote(input);
    const validationVersionId = input && typeof input === "object"
      ? (input as Record<string, unknown>).validationVersionId : undefined;
    if (validationVersionId !== undefined) {
      if (typeof validationVersionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(validationVersionId)) {
        throw new UnprocessableEntityException("validationVersionId must be a UUID");
      }
      const targets = await this.dataSource.query<Array<{ form_id: string; catalog_release_id: string }>>(`
        select fv.form_id,fv.catalog_release_id from forms.form_version fv
        join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.status='published'
      `, [id, session.organization.id]);
      if (!targets[0]) throw new NotFoundException(`Published form version ${id} was not found`);
      if (!this.validations) throw new UnprocessableEntityException("Complete configuration activation is unavailable");
      const activation = await this.validations.activate(token, validationVersionId, {
        formVersionId: id, catalogReleaseId: targets[0].catalog_release_id, changeNote,
        ...((input as Record<string, unknown>).removeImpactedRuleIds !== undefined
          ? { removeImpactedRuleIds: (input as Record<string, unknown>).removeImpactedRuleIds } : {})
      });
      return { organizationId: activation.organizationId, formVersionId: id, formId: targets[0].form_id,
        catalogReleaseId: activation.catalogReleaseId, activatedAt: activation.activatedAt,
        previousFormVersionId: activation.previousFormVersionId,
        previousCatalogReleaseId: activation.previousCatalogReleaseId };
    }
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`form-activation:${session.organization.id}`]);
      const target = await manager.query<Array<{ form_id: string; catalog_release_id: string; definition_sha256: string }>>(`
        select fv.form_id,fv.catalog_release_id,fv.definition_sha256
        from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.status='published'
      `, [id, session.organization.id]);
      if (!target[0]) throw new NotFoundException(`Published form version ${id} was not found`);
      const active = await manager.query<Array<{ form_version_id: string }>>(`
        select form_version_id from app_identity.active_configuration_bundle
        where organization_id=$1`, [session.organization.id]);
      if (active[0] && active[0].form_version_id !== id) {
        throw new UnprocessableEntityException("Select compatible published Validation rules to activate this Form and Catalog together");
      }
      const previous = await manager.query<Array<{ form_version_id: string; catalog_release_id: string }>>(`
        select d.form_version_id,fv.catalog_release_id
        from forms.agency_stationary_default d join forms.form_version fv on fv.id=d.form_version_id
        where d.organization_id=$1 for update
      `, [session.organization.id]);
      const activated = mutationRows<{ activated_at: Date | string }>(await manager.query(`
        insert into forms.agency_stationary_default (organization_id,form_version_id,activated_by)
        values ($1,$2,$3)
        on conflict (organization_id) do update set form_version_id=excluded.form_version_id,
          activated_by=excluded.activated_by,activated_at=now()
        returning activated_at
      `, [session.organization.id, id, session.user.id]));
      await manager.query(`insert into app_identity.configuration_event
        (organization_id,actor_id,action,result,form_version_id,catalog_release_id,
         previous_form_version_id,previous_catalog_release_id,change_note,content_sha256)
        values ($1,$2,'form.activate','succeeded',$3,$4,$5,$6,$7,$8)`,
      [session.organization.id, session.user.id, id, target[0].catalog_release_id,
        previous[0]?.form_version_id ?? null, previous[0]?.catalog_release_id ?? null,
        changeNote, target[0].definition_sha256]);
      return { organizationId: session.organization.id, formVersionId: id, formId: target[0].form_id,
        catalogReleaseId: target[0].catalog_release_id,
        activatedAt: new Date(activated[0]!.activated_at).toISOString(),
        previousFormVersionId: previous[0]?.form_version_id ?? null,
        previousCatalogReleaseId: previous[0]?.catalog_release_id ?? null };
    });
  }

  private async compatibleClone(manager: Pick<EntityManager, "query">, sourceReleaseId: string, targetReleaseId: string,
    definition: FormDraftDefinition): Promise<{ definition: FormDraftDefinition; diagnostics: FormCloneDiagnostic[] }> {
    definition = this.definition(definition);
    const elementIds = [...new Set(definition.sections.flatMap((section) => section.fields.flatMap((field) =>
      field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
    const rows = elementIds.length ? await manager.query<ElementRow[]>(`
      select e.element_id,e.element_identity_id,e.base_datatype,e.source_datatype,e.usage,e.definition,
        m.analytical_location from catalog.element_definition e
      left join catalog.analytics_element_mapping m on m.release_id=e.release_id and m.element_id=e.element_id
      where e.release_id=$1 and e.element_id=any($2::text[])
    `, [sourceReleaseId, elementIds]) : [];
    const targets = elementIds.length ? await manager.query<ElementRow[]>(`
      select e.element_id,e.element_identity_id,e.base_datatype,e.source_datatype,e.usage,e.definition,
        m.analytical_location,
        e.element_id in (select jsonb_array_elements_text(coalesce(
          (select provenance->'hiddenElementIds' from catalog.release where id=$1),'[]'::jsonb))) as hidden
        from catalog.element_definition e
      left join catalog.analytics_element_mapping m on m.release_id=e.release_id and m.element_id=e.element_id
      where e.release_id=$1 and e.element_id=any($2::text[])
    `, [targetReleaseId, elementIds]) : [];
    const oldById = new Map(rows.map((row) => [row.element_id, row]));
    const newById = new Map(targets.map((row) => [row.element_id, row]));
    const diagnostics: FormCloneDiagnostic[] = [];
    const customIds = [...new Set(definition.sections.flatMap((section) => section.fields.flatMap((field) =>
      field.source.kind === "custom" ? [field.source.elementDefinitionId] : [])))];
    const availableCustom = customIds.length ? await manager.query<Array<{ id: string }>>(`
      select ced.id from forms.custom_element_definition ced join catalog.release cr on cr.id=$1
      where ced.id=any($2::uuid[]) and ced.retired_at is null
        and (ced.definition->>'catalogReleaseId' is null or
          ced.id::text in (select jsonb_array_elements_text(coalesce(cr.provenance->'customElementIds','[]'::jsonb))))
    `, [targetReleaseId, customIds]) : [];
    const customSnapshot = customIds.length ? await releaseCustomDefinitions(manager, targetReleaseId) : null;
    const sourceCustomSnapshot = customIds.length ? await releaseCustomDefinitions(manager, sourceReleaseId) : null;
    const targetCustomById = new Map((customSnapshot ?? []).map((item) => [item.id, item]));
    const sourceCustomById = new Map((sourceCustomSnapshot ?? []).map((item) => [item.id, item]));
    const availableCustomIds = customSnapshot === null
      ? new Set(availableCustom.map(({ id }) => id))
      : new Set(customSnapshot.filter((item) => !item.retired).map((item) => item.id));
    for (const [sectionIndex, section] of definition.sections.entries()) for (const [fieldIndex, field] of section.fields.entries()) {
      if (field.source.kind === "custom") {
        const id = field.source.elementDefinitionId;
        const target = targetCustomById.get(id);
        const source = sourceCustomById.get(id);
        if (!availableCustomIds.has(id)) diagnostics.push({ code: target?.retired ? "retired-reference" : "missing-reference",
          path: `sections[${sectionIndex}].fields[${fieldIndex}].source.elementDefinitionId`,
          message: `Custom element ${id} is ${target?.retired ? "retired" : "missing"} in the selected catalog; remove or replace this field` });
        else if (source && target && (source.datatype !== target.datatype || source.identifying !== target.identifying))
          diagnostics.push({ code: "incompatible-reference", path: `sections[${sectionIndex}].fields[${fieldIndex}].source.elementDefinitionId`,
            message: `Custom element ${id} changed datatype or identifying classification; remove or replace this field` });
        continue;
      }
      if (!/^e[^.]+\./.test(field.source.elementId)) continue;
      const path = `sections[${sectionIndex}].fields[${fieldIndex}].source.elementId`;
      const before = oldById.get(field.source.elementId);
      const after = newById.get(field.source.elementId);
      if (after?.hidden) {
        diagnostics.push({ code: "disabled-reference", path, message: `${field.source.elementId} is hidden in the selected catalog; remove or replace this field` });
        continue;
      }
      if (!after) {
        diagnostics.push({ code: "missing-reference", path, message: `${field.source.elementId} is missing from the selected catalog; remove or replace this field` });
        continue;
      }
      if (after.usage.toLowerCase() === "not used" || after.definition?.enabled === false) {
        diagnostics.push({ code: "disabled-reference", path, message: `${field.source.elementId} is disabled in the selected catalog; remove or replace this field` });
        continue;
      }
      if (before && (before.element_identity_id !== after.element_identity_id || before.base_datatype !== after.base_datatype ||
        before.source_datatype !== after.source_datatype || before.analytical_location !== after.analytical_location)) {
        diagnostics.push({ code: "incompatible-reference", path, message: `${field.source.elementId} changed identity, datatype, or storage semantics; remove or replace this field` });
      }
    }
    // Catalog content is available to every form; each field owns enablement and order.
    const targetCatalog = await catalogFieldsConfiguration(manager, targetReleaseId, elementIds, true);
    const sourceCatalog = sourceReleaseId === targetReleaseId ? targetCatalog
      : await catalogFieldsConfiguration(manager, sourceReleaseId, elementIds, true);
    const customPolicies = customSnapshot === null ? await customCodedPolicies(manager, definition)
      : Object.fromEntries(customSnapshot.filter((item): item is CatalogDraftCustomCodedElement => !item.retired && item.datatype === "coded")
        .map((item) => [item.id, item]));
    for (const [sectionIndex, section] of definition.sections.entries()) for (const [fieldIndex, field] of section.fields.entries()) {
      if (field.choicePolicy === undefined) continue;
      const sourceChoices = field.source.kind === "nemsis" ? catalogChoices(sourceCatalog[field.source.elementId])
        : customChoices(sourceCustomById.get(field.source.elementDefinitionId));
      const targetChoices = field.source.kind === "nemsis" ? catalogChoices(targetCatalog[field.source.elementId])
        : customChoices(targetCustomById.get(field.source.elementDefinitionId));
      const sourceIds = new Set(sourceChoices.map(choiceIdentity));
      const targetIds = new Set(targetChoices.map(choiceIdentity));
      const missing = field.choicePolicy.flatMap((choice, choiceIndex) => targetIds.has(choiceIdentity(choice)) ? [] : [{ choice, choiceIndex }]);
      if (missing.length) {
        for (const { choice, choiceIndex } of missing) {
          const retired = sourceIds.has(choiceIdentity(choice));
          diagnostics.push({ code: retired ? "retired-reference" : "missing-reference",
            path: `sections[${sectionIndex}].fields[${fieldIndex}].choicePolicy[${choiceIndex}]`,
            message: `${field.key} choice ${choice.kind}:${choice.code} is ${retired ? "retired or disabled" : "missing"} in the selected catalog; uncheck or replace it` });
        }
        continue;
      }
      const candidate = { schemaVersion: 1 as const, sections: [{ key: section.key, fields: [field] }] };
      for (const message of validateFieldChoicePolicies(candidate, targetCatalog, customPolicies)) diagnostics.push({
        code: "incompatible-reference", path: `sections[${sectionIndex}].fields[${fieldIndex}].choicePolicy`, message
      });
    }
    return { definition, diagnostics };
  }

  private definition(input: unknown): FormDraftDefinition {
    try { return validateCanonicalFormDefinition(withoutLegacyFormWording(input)) as unknown as FormDraftDefinition; }
    catch (error) {
      if (error instanceof FormPublicationValidationError)
        throw new UnprocessableEntityException({ message: "Form validation failed", findings: error.findings });
      throw error;
    }
  }

  private saveBody(input: unknown): { expectedRevision: number; displayName: string | null; definition: FormDraftDefinition } {
    const expectedRevision = this.expectedRevision(input);
    return { expectedRevision,
      displayName: (input as Record<string, unknown>).displayName === undefined ? null : this.displayName(input),
      definition: this.definition((input as Record<string, unknown>).definition) };
  }

  private cloneBody(input: unknown): { catalogReleaseId: string; displayName: string; sourceVersionId?: string } {
    const id = input && typeof input === "object" ? (input as Record<string, unknown>).catalogReleaseId : undefined;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new UnprocessableEntityException("catalogReleaseId must be a UUID");
    const sourceVersionId = (input as Record<string, unknown>).sourceVersionId;
    if (sourceVersionId !== undefined && (typeof sourceVersionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceVersionId)))
      throw new UnprocessableEntityException("sourceVersionId must be a UUID");
    return { catalogReleaseId: id, displayName: this.displayName(input), ...(sourceVersionId ? { sourceVersionId } : {}) };
  }

  private publicationBody(input: unknown): { expectedRevision: number; definitionSha256: string; displayName: string; changeNote: string } {
    if (!input || typeof input !== "object") throw new UnprocessableEntityException("Publication details are required");
    const body = input as Record<string, unknown>;
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    if (typeof body.definitionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.definitionSha256))
      throw new UnprocessableEntityException("definitionSha256 must be a lowercase SHA-256 digest");
    if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.trim().length > 120)
      throw new UnprocessableEntityException("displayName must contain 1 to 120 characters");
    return { expectedRevision: Number(body.expectedRevision), definitionSha256: body.definitionSha256,
      displayName: body.displayName.trim(), changeNote: this.changeNote(input) };
  }

  private changeNote(input: unknown): string {
    const note = input && typeof input === "object" ? (input as Record<string, unknown>).changeNote : undefined;
    if (typeof note !== "string" || !note.trim()) throw new UnprocessableEntityException("changeNote is required");
    return note.trim().slice(0, 2_000);
  }

  private expectedRevision(input: unknown): number {
    const revision = input && typeof input === "object" ? (input as Record<string, unknown>).expectedRevision : undefined;
    if (!Number.isInteger(revision) || Number(revision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    return Number(revision);
  }

  private async auditDraftMutation(manager: Pick<EntityManager, "query">, session: ClinicianSession,
    action: "form.draft_create" | "form.draft_save" | "form.draft_delete", row: VersionRow,
    details: Record<string, unknown> = {}): Promise<void> {
    await manager.query(`insert into app_identity.configuration_event
      (organization_id,actor_id,action,result,form_version_id,catalog_release_id,
       change_note,content_sha256,details)
      values ($1,$2,$3,'succeeded',null,$4,$5,$6,$7::jsonb)`,
    [session.organization.id, session.user.id, action, row.catalog_release_id,
      action === "form.draft_create" ? "Form draft created" : action === "form.draft_save"
        ? `Form draft revision ${row.revision} saved` : "Form draft deleted",
      row.definition_sha256, JSON.stringify({ formVersionId: row.id, formId: row.form_id, revision: row.revision, ...details })]);
  }

  private async result(manager: Pick<EntityManager, "query">, row: VersionRow,
    diagnostics?: FormCloneDiagnostic[], sourceReleaseId?: string): Promise<StationaryFormDraft> {
    let findings = diagnostics;
    let sourceCatalogReleaseId = sourceReleaseId;
    if (!findings && row.cloned_from_id) {
      const sources = await manager.query<Array<Pick<VersionRow, "catalog_release_id" | "canonical_definition">>>(`
        select catalog_release_id,canonical_definition from forms.form_version where id=$1
      `, [row.cloned_from_id]);
      sourceCatalogReleaseId = sources[0]?.catalog_release_id;
      findings = sourceCatalogReleaseId ? (await this.compatibleClone(manager, sourceCatalogReleaseId,
        row.catalog_release_id, row.canonical_definition)).diagnostics : [];
    }
    if (row.cloned_from_id && !sourceCatalogReleaseId) {
      const sources = await manager.query<Array<{ catalog_release_id: string }>>(`
        select catalog_release_id from forms.form_version where id=$1
      `, [row.cloned_from_id]);
      sourceCatalogReleaseId = sources[0]?.catalog_release_id;
    }
    const definition = this.definition(row.canonical_definition);
    const elementIds = [...new Set(definition.sections.flatMap((section) =>
      section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
    const catalogFields = await catalogFieldsConfiguration(manager, row.catalog_release_id, elementIds, true);
    const customIds = [...new Set(definition.sections.flatMap((section) => section.fields.flatMap((field) =>
      field.source.kind === "custom" ? [field.source.elementDefinitionId] : [])))];
    const custom = customIds.length ? await manager.query<Array<{ id: string; definition: NonNullable<StationaryFormDraft["customFields"]>[string] }>>(`
      select id,definition from forms.custom_element_definition where id=any($1::uuid[])`, [customIds]) : [];
    const snapshot = customIds.length ? await releaseCustomDefinitions(manager, row.catalog_release_id) : null;
    const snapshotById = new Map((snapshot ?? []).map((item) => [item.id, item]));
    let newChoicesByField: Record<string, Choice[]> = {};
    if (sourceCatalogReleaseId && sourceCatalogReleaseId !== row.catalog_release_id) {
      const sourceCatalog = await catalogFieldsConfiguration(manager, sourceCatalogReleaseId, elementIds, true);
      const sourceSnapshot = customIds.length ? await releaseCustomDefinitions(manager, sourceCatalogReleaseId) : null;
      const sourceById = new Map((sourceSnapshot ?? []).map((item) => [item.id, item]));
      newChoicesByField = formCatalogAdoptionChoices(definition, sourceCatalog, catalogFields, sourceById, snapshotById);
    }
    return { id: row.id, formId: row.form_id, catalogReleaseId: row.catalog_release_id,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      clonedFromId: row.cloned_from_id!, revision: row.revision, definitionSha256: row.definition_sha256,
      definition, catalogFields, customFields: Object.fromEntries(custom.map((item) => [item.id, snapshotById.get(item.id) ?? item.definition])),
      customGroups: await customGroupsConfiguration(manager, row.catalog_release_id),
      catalogGroups: await catalogGroupsConfiguration(manager, row.catalog_release_id), diagnostics: findings ?? [],
      ...(sourceCatalogReleaseId && sourceCatalogReleaseId !== row.catalog_release_id
        ? { adoption: { sourceCatalogReleaseId, newChoicesByField } } : {}),
      updatedAt: new Date(row.updated_at).toISOString() };
  }

  private authorize(token: string, capability: string): Promise<ClinicianSession> {
    return this.sessions.requireCapability(token, capability).then((session) => {
      const prerequisites = capability === "forms:publish" ? ["forms:read", "forms:write"]
        : capability === "forms:write" ? ["forms:read"] : [];
      if (prerequisites.some((required) => !session.capabilities?.includes(required)))
        throw new UnauthorizedException("The requested capability prerequisites are required");
      return session;
    });
  }

  private displayName(input: unknown): string {
    const value = input && typeof input === "object" ? (input as Record<string, unknown>).displayName : undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
      throw new UnprocessableEntityException("displayName must contain 1 to 120 characters");
    return value.trim();
  }
}
