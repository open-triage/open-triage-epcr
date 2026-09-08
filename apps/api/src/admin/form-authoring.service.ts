import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ClinicianSession, FormCatalogElementPage, FormCloneDiagnostic, FormDraftDefinition, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { canonicalDefinitionSha256, FormPublicationValidationError, validateCanonicalFormDefinition } from "../forms/form-publication.validation.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { FormPublicationService } from "../forms/form-publication.service.js";
import { catalogFieldsConfiguration } from "../forms/clinical-form-configuration.js";

type VersionRow = {
  id: string; form_id: string; catalog_release_id: string; cloned_from_id: string | null;
  revision: number; canonical_definition: FormDraftDefinition; definition_sha256: string;
  updated_at: Date | string;
};

type ElementRow = {
  element_id: string; element_identity_id: string; base_datatype: string; source_datatype: string;
  usage: string; definition: Record<string, unknown>; analytical_location: string | null;
};

@Injectable()
export class FormAuthoringService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly sessions: ClinicianSessionService,
    private readonly publication: FormPublicationService) {}

  async current(token: string): Promise<StationaryFormDraft | null> {
    const session = await this.admin(token);
    const rows = await this.dataSource.query<VersionRow[]>(`
      select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
      where f.organization_id=$1 and fv.status='draft' order by fv.created_at desc limit 1
    `, [session.organization.id]);
    if (!rows[0]) return null;
    return this.result(this.dataSource.manager, rows[0]);
  }

  async clone(token: string, input: unknown): Promise<StationaryFormDraft> {
    const session = await this.admin(token);
    const catalogReleaseId = this.catalogReleaseId(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`form-draft:${session.organization.id}`]);
      const target = await manager.query<Array<{ id: string }>>(`
        select r.id from catalog.release r join catalog.authoring_draft d on d.published_release_id=r.id
        where r.id=$1 and r.sealed and d.organization_id=$2
      `, [catalogReleaseId, session.organization.id]);
      if (!target[0]) throw new NotFoundException("The selected published catalog was not found for this organization");
      const source = await manager.query<Array<VersionRow & { version: number }>>(`
        select fv.* from forms.form_version fv join forms.form f on f.id=fv.form_id
        join forms.agency_stationary_default active on active.organization_id=f.organization_id
          and active.form_version_id=fv.id
        where f.organization_id=$1 and fv.status='published' limit 1
      `, [session.organization.id]);
      if (!source[0]) throw new NotFoundException("No active Stationary form is available to clone");
      const existing = await manager.query<VersionRow[]>(`
        select * from forms.form_version where form_id=$1 and status='draft' for update
      `, [source[0].form_id]);
      if (existing[0]) {
        if (existing[0].catalog_release_id !== catalogReleaseId)
          throw new ConflictException("A Stationary form draft is already pinned to another catalog");
        return this.result(manager, existing[0]);
      }
      const cloned = await this.compatibleClone(manager, source[0].catalog_release_id, catalogReleaseId,
        this.definition(source[0].canonical_definition));
      const digest = canonicalDefinitionSha256(cloned.definition);
      const inserted = await manager.query<VersionRow[]>(`
        insert into forms.form_version
          (form_id,catalog_release_id,version,canonical_definition,definition_sha256,cloned_from_id,created_by)
        select $1,$2,coalesce(max(version),0)+1,$3::jsonb,$4,$5,$6
        from forms.form_version where form_id=$1 returning *
      `, [source[0].form_id, catalogReleaseId, JSON.stringify(cloned.definition), digest, source[0].id, session.user.id]);
      return this.result(manager, inserted[0]!, cloned.diagnostics);
    });
  }

  async searchCatalog(token: string, id: string, input: Record<string, unknown>): Promise<FormCatalogElementPage> {
    const session = await this.admin(token);
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
        and ($2='' or position($2 in lower(element_id || ' ' || name || ' ' || description)) > 0)
      order by section,group_path,element_id
    `, [drafts[0].catalog_release_id, query]);
    return { items: rows.map((row) => ({ elementId: row.element_id, name: row.name,
      description: row.description, baseDatatype: row.base_datatype, groupPath: row.group_path })),
      nextOffset: null };
  }

  async save(token: string, id: string, input: unknown): Promise<StationaryFormDraft> {
    const session = await this.admin(token);
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
            revision=revision+1,updated_at=now()
          where id=$1 and revision=$2 and status='draft' returning *
        )
        select * from updated
      `, [id, body.expectedRevision, JSON.stringify(body.definition), digest]);
      if (!updated[0]) throw new ConflictException("Form draft revision is stale or the form was published");
      return this.result(manager, updated[0]);
    });
  }

  async publish(token: string, id: string, input: unknown): Promise<PublishedStationaryForm> {
    const session = await this.admin(token);
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
      definitionSha256: body.definitionSha256
    }, session.organization.id);
    return { id: published.id, formId: draft.form_id, catalogReleaseId: draft.catalog_release_id,
      version: draft.version, status: "published", definitionSha256: published.definitionSha256,
      publishedAt: published.publishedAt, structuralSummary: published.projections };
  }

  async activate(token: string, id: string, input: unknown): Promise<StationaryFormActivation> {
    const session = await this.admin(token);
    const changeNote = this.changeNote(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`form-activation:${session.organization.id}`]);
      const target = await manager.query<Array<{ form_id: string; catalog_release_id: string; definition_sha256: string }>>(`
        select fv.form_id,fv.catalog_release_id,fv.definition_sha256
        from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.status='published'
      `, [id, session.organization.id]);
      if (!target[0]) throw new NotFoundException(`Published form version ${id} was not found`);
      const previous = await manager.query<Array<{ form_version_id: string; catalog_release_id: string }>>(`
        select d.form_version_id,fv.catalog_release_id
        from forms.agency_stationary_default d join forms.form_version fv on fv.id=d.form_version_id
        where d.organization_id=$1 for update
      `, [session.organization.id]);
      const activated = await manager.query<Array<{ activated_at: Date | string }>>(`
        insert into forms.agency_stationary_default (organization_id,form_version_id,activated_by)
        values ($1,$2,$3)
        on conflict (organization_id) do update set form_version_id=excluded.form_version_id,
          activated_by=excluded.activated_by,activated_at=now()
        returning activated_at
      `, [session.organization.id, id, session.user.id]);
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
        m.analytical_location from catalog.element_definition e
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
    }) }));
    return { definition: { ...definition, sections }, diagnostics };
  }

  private definition(input: unknown): FormDraftDefinition {
    try { return validateCanonicalFormDefinition(input) as unknown as FormDraftDefinition; }
    catch (error) {
      if (error instanceof FormPublicationValidationError)
        throw new UnprocessableEntityException({ message: "Form validation failed", findings: error.findings });
      throw error;
    }
  }

  private saveBody(input: unknown): { expectedRevision: number; definition: FormDraftDefinition } {
    if (!input || typeof input !== "object" || !Number.isInteger((input as Record<string, unknown>).expectedRevision) ||
        Number((input as Record<string, unknown>).expectedRevision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    return { expectedRevision: (input as { expectedRevision: number }).expectedRevision,
      definition: this.definition((input as Record<string, unknown>).definition) };
  }

  private catalogReleaseId(input: unknown): string {
    const id = input && typeof input === "object" ? (input as Record<string, unknown>).catalogReleaseId : undefined;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new UnprocessableEntityException("catalogReleaseId must be a UUID");
    return id;
  }

  private publicationBody(input: unknown): { expectedRevision: number; definitionSha256: string; changeNote: string } {
    if (!input || typeof input !== "object") throw new UnprocessableEntityException("Publication details are required");
    const body = input as Record<string, unknown>;
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    if (typeof body.definitionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.definitionSha256))
      throw new UnprocessableEntityException("definitionSha256 must be a lowercase SHA-256 digest");
    return { expectedRevision: Number(body.expectedRevision), definitionSha256: body.definitionSha256,
      changeNote: this.changeNote(input) };
  }

  private changeNote(input: unknown): string {
    const note = input && typeof input === "object" ? (input as Record<string, unknown>).changeNote : undefined;
    if (typeof note !== "string" || !note.trim()) throw new UnprocessableEntityException("changeNote is required");
    return note.trim().slice(0, 2_000);
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
    const elementIds = [...new Set(row.canonical_definition.sections.flatMap((section) =>
      section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))];
    const catalogFields = await catalogFieldsConfiguration(manager, row.catalog_release_id, elementIds);
    return { id: row.id, formId: row.form_id, catalogReleaseId: row.catalog_release_id,
      clonedFromId: row.cloned_from_id!, revision: row.revision, definitionSha256: row.definition_sha256,
      definition: row.canonical_definition, catalogFields, diagnostics: findings ?? [], updatedAt: new Date(row.updated_at).toISOString() };
  }

  private admin(token: string): Promise<ClinicianSession> {
    return this.sessions.requireCapability(token, "installation:administer");
  }
}
