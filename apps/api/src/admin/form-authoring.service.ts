import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AuthoringVersionOption, ClinicianSession, FormCatalogElementPage, FormCloneDiagnostic, FormDraftDefinition, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { canonicalDefinitionSha256, FormPublicationValidationError, validateCanonicalFormDefinition, withoutLegacyFormWording } from "../forms/form-publication.validation.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { FormPublicationService } from "../forms/form-publication.service.js";
import { catalogFieldsConfiguration, catalogGroupsConfiguration } from "../forms/clinical-form-configuration.js";
import { mutationRows } from "../database/mutation-result.js";
import { ValidationAuthoringService } from "./validation-authoring.service.js";

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

@Injectable()
export class FormAuthoringService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly sessions: ClinicianSessionService,
    private readonly publication: FormPublicationService,
    @Optional() private readonly validations?: ValidationAuthoringService) {}

  async current(token: string): Promise<StationaryFormDraft | null> {
    const session = await this.authorize(token, "forms:read");
    const rows = await this.dataSource.query<VersionRow[]>(`
      select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
      where f.organization_id=$1 and fv.status='draft' order by fv.created_at desc limit 1
    `, [session.organization.id]);
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
        select * from forms.form_version where form_id=$1 and status='draft' for update
      `, [source[0].form_id]);
      if (existing[0]) {
        if (sourceVersionId && existing[0].cloned_from_id !== sourceVersionId)
          throw new ConflictException("A Stationary form draft already exists from another version");
        if (existing[0].catalog_release_id !== catalogReleaseId)
          throw new ConflictException("A Stationary form draft is already pinned to another catalog");
        return this.result(manager, existing[0]);
      }
      const cloned = await this.compatibleClone(manager, source[0].catalog_release_id, catalogReleaseId,
        this.definition(source[0].canonical_definition));
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
      return this.result(manager, inserted[0]!, cloned.diagnostics);
    });
  }

  async searchCatalog(token: string, id: string, input: Record<string, unknown>): Promise<FormCatalogElementPage> {
    const session = await this.authorize(token, "forms:read");
    const query = typeof input.query === "string" ? input.query.trim().slice(0, 100).toLowerCase() : "";
    const drafts = await this.dataSource.query<Array<{ catalog_release_id: string }>>(`
      select fv.catalog_release_id from forms.form_version fv join forms.form f on f.id=fv.form_id
      where fv.id=$1 and f.organization_id=$2 and fv.status='draft'
    `, [id, session.organization.id]);
    if (!drafts[0]) throw new NotFoundException(`Form draft ${id} was not found`);
    const rows = await this.dataSource.query<Array<{
      element_id: string; name: string; description: string; base_datatype: string; group_path: string[];
    }>>(`
      select element_id,name,description,base_datatype,group_path
      from catalog.element_definition
      where release_id=$1 and element_id like 'e%.%'
        and element_id not in (select jsonb_array_elements_text(coalesce(
          (select provenance->'hiddenElementIds' from catalog.release where id=$1),'[]'::jsonb)))
        and ($2='' or position($2 in lower(element_id || ' ' || name || ' ' || description)) > 0)
      order by section,group_path,element_id
    `, [drafts[0].catalog_release_id, query]);
    return { items: rows.map((row) => ({ elementId: row.element_id, name: row.name,
      description: row.description, baseDatatype: row.base_datatype, groupPath: row.group_path })),
      nextOffset: null };
  }

  async save(token: string, id: string, input: unknown): Promise<StationaryFormDraft> {
    const session = await this.authorize(token, "forms:write");
    const body = this.saveBody(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(`
        select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 for update
      `, [id, session.organization.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
      if (draft.revision !== body.expectedRevision) throw new ConflictException({
        message: "Form draft revision is stale", expectedRevision: body.expectedRevision, actualRevision: draft.revision
      });
      const checked = await this.compatibleClone(manager, draft.catalog_release_id, draft.catalog_release_id, body.definition);
      if (checked.diagnostics.length) throw new UnprocessableEntityException({
        message: "Form validation failed", findings: checked.diagnostics
      });
      const digest = canonicalDefinitionSha256(body.definition);
      const updated = await manager.query<VersionRow[]>(`
        with updated as (
          update forms.form_version set canonical_definition=$3::jsonb,definition_sha256=$4,
            display_name=coalesce($5,display_name),revision=revision+1,updated_at=now()
          where id=$1 and revision=$2 and status='draft' returning *
        )
        select * from updated
      `, [id, body.expectedRevision, JSON.stringify(body.definition), digest, body.displayName]);
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
        where fv.id=$1 and f.organization_id=$2 and fv.status='draft' for update
      `, [id, session.organization.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
      if (draft.revision !== expectedRevision) throw new ConflictException({
        message: "Form draft revision is stale", expectedRevision, actualRevision: draft.revision
      });
      await this.auditDraftMutation(manager, session, "form.draft_delete", draft, { deletedFormVersionId: draft.id });
      const deleted = mutationRows<{ id: string }>(await manager.query(
        "delete from forms.form_version where id=$1 and revision=$2 and status='draft' returning id",
        [id, expectedRevision]
      ));
      if (!deleted[0]) throw new ConflictException("Form draft revision is stale or the form was published");
    });
  }

  async publish(token: string, id: string, input: unknown): Promise<PublishedStationaryForm> {
    const session = await this.authorize(token, "forms:publish");
    const body = this.publicationBody(input);
    const rows = await this.dataSource.query<Array<VersionRow & { version: number }>>(`
      select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
      where fv.id=$1 and f.organization_id=$2 and fv.status='draft'
    `, [id, session.organization.id]);
    const draft = rows[0];
    if (!draft) throw new NotFoundException(`Form draft ${id} was not found`);
    if (draft.revision !== body.expectedRevision) throw new ConflictException({
      message: "Form draft revision is stale", expectedRevision: body.expectedRevision, actualRevision: draft.revision
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
        formVersionId: id, catalogReleaseId: targets[0].catalog_release_id, changeNote
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
    const sections = definition.sections.map((section, sectionIndex) => ({ ...section, fields: section.fields.filter((field, fieldIndex) => {
      if (field.source.kind !== "nemsis") return true;
      if (!/^e[^.]+\./.test(field.source.elementId)) return false;
      const path = `sections[${sectionIndex}].fields[${fieldIndex}].source.elementId`;
      const before = oldById.get(field.source.elementId);
      const after = newById.get(field.source.elementId);
      if (after?.hidden) return false;
      if (!after) {
        diagnostics.push({ code: "missing-reference", path, message: `${field.source.elementId} is missing from the selected catalog` });
        return false;
      }
      if (after.usage.toLowerCase() === "not used" || after.definition?.enabled === false) {
        diagnostics.push({ code: "disabled-reference", path, message: `${field.source.elementId} is disabled in the selected catalog` });
        return false;
      }
      if (before && (before.element_identity_id !== after.element_identity_id || before.base_datatype !== after.base_datatype ||
        before.source_datatype !== after.source_datatype || before.analytical_location !== after.analytical_location)) {
        diagnostics.push({ code: "incompatible-reference", path, message: `${field.source.elementId} changed identity, datatype, or storage semantics` });
        return false;
      }
      return true;
    }) })).filter((section) => section.fields.length > 0);
    return { definition: { ...definition, sections }, diagnostics };
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
    diagnostics?: FormCloneDiagnostic[]): Promise<StationaryFormDraft> {
    let findings = diagnostics;
    if (!findings && row.cloned_from_id) {
      const sources = await manager.query<Array<Pick<VersionRow, "catalog_release_id" | "canonical_definition">>>(`
        select catalog_release_id,canonical_definition from forms.form_version where id=$1
      `, [row.cloned_from_id]);
      findings = sources[0] ? (await this.compatibleClone(manager, sources[0].catalog_release_id,
        row.catalog_release_id, sources[0].canonical_definition)).diagnostics : [];
    }
    const definition = this.definition(row.canonical_definition);
    const elementIds = [...new Set(definition.sections.flatMap((section) =>
      section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
    const catalogFields = await catalogFieldsConfiguration(manager, row.catalog_release_id, elementIds);
    return { id: row.id, formId: row.form_id, catalogReleaseId: row.catalog_release_id,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      clonedFromId: row.cloned_from_id!, revision: row.revision, definitionSha256: row.definition_sha256,
      definition, catalogFields,
      catalogGroups: await catalogGroupsConfiguration(manager, row.catalog_release_id), diagnostics: findings ?? [], updatedAt: new Date(row.updated_at).toISOString() };
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
