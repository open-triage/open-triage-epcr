import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ClinicianSession, FormCloneDiagnostic, FormDraftDefinition, StationaryFormDraft } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { canonicalDefinitionSha256, FormPublicationValidationError, validateCanonicalFormDefinition } from "../forms/form-publication.validation.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

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
  constructor(@InjectDataSource() private readonly dataSource: DataSource, private readonly sessions: ClinicianSessionService) {}

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
        where f.organization_id=$1 and fv.status='published'
          and exists (select 1 from app_identity.operational_unit ou
            where ou.organization_id=f.organization_id and ou.default_form_id=f.id and ou.active)
        order by fv.published_at desc, fv.version desc limit 1
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
        update forms.form_version set canonical_definition=$3::jsonb,definition_sha256=$4,
          revision=revision+1,updated_at=now()
        where id=$1 and revision=$2 and status='draft' returning *
      `, [id, body.expectedRevision, JSON.stringify(body.definition), digest]);
      if (!updated[0]) throw new ConflictException("Form draft revision is stale or the form was published");
      return this.result(manager, updated[0]);
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
    return { id: row.id, formId: row.form_id, catalogReleaseId: row.catalog_release_id,
      clonedFromId: row.cloned_from_id!, revision: row.revision, definitionSha256: row.definition_sha256,
      definition: row.canonical_definition, diagnostics: findings ?? [], updatedAt: new Date(row.updated_at).toISOString() };
  }

  private admin(token: string): Promise<ClinicianSession> {
    return this.sessions.requireCapability(token, "installation:administer");
  }
}
