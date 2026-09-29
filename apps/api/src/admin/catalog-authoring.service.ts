import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  AuthoringVersionOption, CatalogDefinitionView, CatalogDraft, CatalogDraftCodeList, CatalogDraftCodeValue, CatalogDraftDefinition, CatalogDraftElement, CatalogDraftCustomTextElement, CatalogValidationResult,
  ClinicianSession, PublishedCatalog
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { mutationRows } from "../database/mutation-result.js";
import { customTextDefinitionFindings } from "./custom-text-definition.js";

type DraftRow = {
  id: string; organization_id: string; source_release_id: string; revision: number;
  display_name: string | null;
  canonical_definition: CatalogDraftDefinition; definition_sha256: string; updated_at: Date | string;
  published_release_id: string | null;
};

type SourceElementRow = {
  hidden_element_ids?: string[]; special_choices?: CatalogDraftElement["specialChoices"];
  element_id: string; name: string; description: string | null; localization: CatalogDraftElement["localization"] | null; element_identity_id: string; base_datatype: string; source_datatype: string;
  group_path: string[]; min_occurs: number; max_occurs: number | null; nillable: boolean;
  supports_not_values: boolean; supports_pertinent_negatives: boolean; usage: string;
  agency_required_severity: "warning" | "error" | null;
  analytical_location: "wide" | "repeatable" | "unmapped"; sql_type: string;
};

type SourceCodeListRow = {
  list_id: string; name: string; classification: "defined" | "suggested" | "agency" | "inline"; element_ids: string[];
  values: Array<{ code: string; codeSystem: string; label: string; sourceLabel: string;
    category: string | null; enabled: boolean; localization?: CatalogDraftCodeValue["localization"] }>;
  default_value: { code: string; codeSystem: string } | null;
  localization?: CatalogDraftCodeList["localization"];
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stable(item)]));
}

export function catalogDefinitionSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

@Injectable()
export class CatalogAuthoringService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async current(sessionToken: string): Promise<CatalogDraft | null> {
    const session = await this.authorize(sessionToken, "catalog:read");
    const rows = await this.dataSource.query<DraftRow[]>(`
      select * from catalog.authoring_draft
      where organization_id = $1 and published_release_id is null
      order by created_at desc limit 1
    `, [session.organization.id]);
    if (!rows[0]) return null;
    return this.result({ ...rows[0], canonical_definition:
      await this.upgradeDefinition(this.dataSource.manager, rows[0].source_release_id, rows[0].canonical_definition) });
  }

  async inspectActive(sessionToken: string): Promise<CatalogDefinitionView | null> {
    const session = await this.authorize(sessionToken, "catalog:read");
    const rows = await this.dataSource.query<Array<{ id: string; display_name: string; version: string }>>(`
      select cr.id, coalesce(cr.display_name, cr.standard || ' ' || cr.version) as display_name, cr.version
      from forms.agency_stationary_default active
      join forms.form_version fv on fv.id = active.form_version_id and fv.status = 'published'
      join forms.form f on f.id = fv.form_id and f.organization_id = active.organization_id
      join catalog.release cr on cr.id = fv.catalog_release_id and cr.sealed
      where active.organization_id = $1 limit 1
    `, [session.organization.id]);
    const release = rows[0];
    if (!release) return null;
    return { id: release.id, displayName: release.display_name, version: release.version, status: "active",
      definition: await this.cloneDefinition(this.dataSource.manager, release.id) };
  }

  async versions(sessionToken: string): Promise<AuthoringVersionOption[]> {
    const session = await this.authorize(sessionToken, "catalog:read");
    const rows = await this.dataSource.query<Array<{ id: string; display_name: string; version: string; active: boolean }>>(`
      select cr.id,coalesce(cr.display_name,cr.standard || ' ' || cr.version) as display_name,cr.version,
        exists(select 1 from app_identity.active_configuration_bundle active
          where active.organization_id=$1 and active.catalog_release_id=cr.id) as active
      from catalog.release cr where cr.sealed and (
        exists(select 1 from catalog.authoring_draft d
          where d.organization_id=$1 and d.published_release_id=cr.id)
        or exists(select 1 from forms.form_version fv join forms.form f on f.id=fv.form_id
          where f.organization_id=$1 and fv.catalog_release_id=cr.id and fv.status='published'))
      order by cr.loaded_at desc,cr.id desc
    `, [session.organization.id]);
    return rows.map((row) => ({ id: row.id, displayName: row.display_name, version: row.version,
      status: row.active ? "active" : "published" }));
  }

  async inspectVersion(sessionToken: string, id: string): Promise<CatalogDefinitionView> {
    const versions = await this.versions(sessionToken);
    const version = versions.find((item) => item.id === id);
    if (!version) throw new NotFoundException("The selected catalog version is unavailable");
    return { id: version.id, displayName: version.displayName, version: String(version.version),
      status: version.status, definition: await this.cloneDefinition(this.dataSource.manager, id) };
  }

  async cloneActive(sessionToken: string, input: unknown): Promise<CatalogDraft> {
    const session = await this.authorize(sessionToken, "catalog:write");
    const displayName = this.displayName(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`catalog-draft:${session.organization.id}`]);
      const existing = await manager.query<DraftRow[]>(`
        select * from catalog.authoring_draft
        where organization_id = $1 and published_release_id is null for update
      `, [session.organization.id]);
      if (existing[0]) {
        const requestedSourceId = input && typeof input === "object" ? (input as Record<string, unknown>).sourceVersionId : undefined;
        if (requestedSourceId && existing[0].source_release_id !== requestedSourceId)
          throw new ConflictException("A catalog draft already exists from another version");
        return this.result({ ...existing[0], canonical_definition:
          await this.upgradeDefinition(manager, existing[0].source_release_id, existing[0].canonical_definition) });
      }
      const requestedSourceId = input && typeof input === "object" ? (input as Record<string, unknown>).sourceVersionId : undefined;
      if (requestedSourceId !== undefined && (typeof requestedSourceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedSourceId))) {
        throw new UnprocessableEntityException("sourceVersionId must be a UUID");
      }
      const releases = await manager.query<Array<{ id: string }>>(`
        select cr.id from catalog.release cr where cr.sealed and
          (($2::uuid is null and exists(select 1 from app_identity.active_configuration_bundle active
            where active.organization_id=$1 and active.catalog_release_id=cr.id)) or
          (cr.id=$2::uuid and (exists(select 1 from catalog.authoring_draft d
            where d.organization_id=$1 and d.published_release_id=cr.id)
            or exists(select 1 from forms.form_version fv join forms.form f on f.id=fv.form_id
              where f.organization_id=$1 and fv.catalog_release_id=cr.id and fv.status='published')))) limit 1
      `, [session.organization.id, requestedSourceId ?? null]);
      if (!releases[0]) throw new NotFoundException("The selected catalog version is unavailable");
      const definition = await this.cloneDefinition(manager, releases[0].id);
      const digest = catalogDefinitionSha256(definition);
      const inserted = mutationRows<DraftRow>(await manager.query(`
        insert into catalog.authoring_draft
          (organization_id, source_release_id, canonical_definition, definition_sha256, created_by, display_name)
        values ($1, $2, $3::jsonb, $4, $5, $6) returning *
      `, [session.organization.id, releases[0].id, JSON.stringify(definition), digest, session.user.id, displayName]));
      return this.result(inserted[0]!);
    });
  }

  async save(sessionToken: string, draftId: string, input: unknown): Promise<CatalogDraft> {
    const session = await this.authorize(sessionToken, "catalog:write");
    const body = this.saveBody(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<DraftRow[]>(`
        select * from catalog.authoring_draft where id = $1 and organization_id = $2 for update
      `, [draftId, session.organization.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Catalog draft ${draftId} was not found`);
      if (draft.published_release_id) throw new ConflictException("Published catalog drafts are immutable");
      if (draft.revision !== body.expectedRevision) throw new ConflictException({
        message: "Catalog draft revision is stale", expectedRevision: body.expectedRevision, actualRevision: draft.revision
      });
      const definition = await this.upgradeDefinition(manager, draft.source_release_id, body.definition);
      // Upgrade both sides so older drafts also retain metadata inherited from their pinned source.
      const previousDefinition = await this.upgradeDefinition(manager, draft.source_release_id, draft.canonical_definition);
      // Legacy metadata may round-trip unchanged, but clients cannot author defaults.
      for (const list of definition.codeLists) {
        const previous = previousDefinition.codeLists.find((candidate) => candidate.listId === list.listId);
        if (list.defaultValue != null && catalogDefinitionSha256(list.defaultValue) !==
            catalogDefinitionSha256(previous?.defaultValue ?? null)) {
          throw new UnprocessableEntityException("Default-value authoring is no longer supported");
        }
      }
      const validation = await this.validateDefinition(manager, draft.source_release_id, definition);
      if (!validation.valid) throw new UnprocessableEntityException({ message: "Catalog validation failed", findings: validation.findings });
      const updated = await manager.query<DraftRow[]>(`
        with updated as (
          update catalog.authoring_draft set revision = revision + 1, canonical_definition = $3::jsonb,
            definition_sha256 = $4, display_name = coalesce($6, display_name), updated_at = now()
          where id = $1 and organization_id = $2 and revision = $5 and published_release_id is null returning *
        )
        select * from updated
      `, [draftId, session.organization.id, JSON.stringify(definition), validation.definitionSha256, body.expectedRevision, body.displayName]);
      if (!updated[0]) throw new ConflictException("Catalog draft revision is stale");
      return this.result(updated[0]);
    });
  }

  async delete(sessionToken: string, draftId: string, input: unknown): Promise<void> {
    const session = await this.authorize(sessionToken, "catalog:write");
    const expectedRevision = this.expectedRevision(input);
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`catalog-draft:${session.organization.id}`]);
      const rows = await manager.query<DraftRow[]>(`
        select * from catalog.authoring_draft
        where id=$1 and organization_id=$2 and published_release_id is null for update
      `, [draftId, session.organization.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Catalog draft ${draftId} was not found`);
      if (draft.revision !== expectedRevision) throw new ConflictException({
        message: "Catalog draft revision is stale", expectedRevision, actualRevision: draft.revision
      });
      await manager.query(`insert into app_identity.configuration_event
        (organization_id,actor_id,action,result,form_version_id,catalog_release_id,
         change_note,content_sha256,details)
        values ($1,$2,'catalog.draft_delete','succeeded',null,$3,'Catalog draft deleted',$4,$5::jsonb)`,
      [session.organization.id, session.user.id, draft.source_release_id, draft.definition_sha256,
        JSON.stringify({ catalogDraftId: draft.id, sourceReleaseId: draft.source_release_id, revision: draft.revision })]);
      const deleted = mutationRows<{ id: string }>(await manager.query(`
        delete from catalog.authoring_draft
        where id=$1 and organization_id=$2 and revision=$3 and published_release_id is null returning id
      `, [draftId, session.organization.id, expectedRevision]));
      if (!deleted[0]) throw new ConflictException("Catalog draft revision is stale or the catalog was published");
    });
  }

  async validate(sessionToken: string, draftId: string): Promise<CatalogValidationResult> {
    const session = await this.authorize(sessionToken, "catalog:read");
    const rows = await this.dataSource.query<DraftRow[]>(`
      select * from catalog.authoring_draft where id = $1 and organization_id = $2
    `, [draftId, session.organization.id]);
    if (!rows[0]) throw new NotFoundException(`Catalog draft ${draftId} was not found`);
    const definition = await this.upgradeDefinition(this.dataSource.manager, rows[0].source_release_id,
      rows[0].canonical_definition);
    return this.validateDefinition(this.dataSource.manager, rows[0].source_release_id, definition);
  }

  async publish(sessionToken: string, draftId: string, input: unknown): Promise<PublishedCatalog> {
    const session = await this.authorize(sessionToken, "catalog:publish");
    const body = this.publishBody(input);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<DraftRow[]>(`
        select * from catalog.authoring_draft where id = $1 and organization_id = $2 for update
      `, [draftId, session.organization.id]);
      const draft = rows[0];
      if (!draft) throw new NotFoundException(`Catalog draft ${draftId} was not found`);
      if (draft.published_release_id) throw new ConflictException("This catalog draft has already been published");
      if (draft.revision !== body.expectedRevision) throw new ConflictException("Catalog draft revision is stale");
      if (draft.definition_sha256 !== body.definitionSha256) throw new ConflictException("Catalog draft content has changed since validation");
      const validation = await this.validateDefinition(manager, draft.source_release_id, draft.canonical_definition);
      if (!validation.valid || !validation.projectionsVerified) {
        throw new UnprocessableEntityException({ message: "Catalog validation failed", findings: validation.findings });
      }
      if (validation.definitionSha256 !== draft.definition_sha256) {
        throw new ConflictException("Catalog draft canonical content does not match its stored digest");
      }
      const source = (await manager.query<Array<{ standard: string; version: string; dataset: string;
        artifact_schema_version: string; data_model_version: string }>>(`
        select source.standard,source.version,source.dataset,source.artifact_schema_version,
          coalesce(nullif(source.provenance->>'dataModelVersion',''),
            nullif(parent.provenance->>'dataModelVersion',''),parent.version,source.version) as data_model_version
        from catalog.release source
        left join catalog.release parent on parent.id::text=source.provenance->>'sourceReleaseId'
        where source.id=$1
      `, [draft.source_release_id]))[0]!;
      const releaseId = randomUUID();
      const version = `${source.version}-agency-${draft.id.replaceAll("-", "").slice(0, 12)}`;
      await manager.query(`insert into catalog.release
        (id, standard, version, dataset, artifact_schema_version, artifact_sha256, provenance, sealed, display_name)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,false,$8)`, [releaseId, source.standard, version, source.dataset,
        source.artifact_schema_version, validation.definitionSha256, JSON.stringify({ sourceReleaseId: draft.source_release_id,
          dataModelVersion: source.data_model_version,
          organizationId: session.organization.id, changeNote: body.changeNote,
          hiddenElementIds: draft.canonical_definition.hiddenElementIds ?? [],
          customElementIds: (draft.canonical_definition.customElements ?? []).map((element) => element.id),
          specialChoiceLocalization: Object.fromEntries(draft.canonical_definition.elements
            .filter((element) => element.specialChoices?.some((choice) => choice.localization?.sv))
            .map((element) => [element.elementId, Object.fromEntries([...new Set(element.specialChoices!.map((choice) => choice.kind))]
              .map((kind) => [kind, Object.fromEntries(element.specialChoices!
                .filter((choice) => choice.kind === kind && choice.localization?.sv)
                .map((choice) => [choice.code, choice.localization]))]))])),
          elementLocalization: Object.fromEntries(draft.canonical_definition.elements
            .filter((element) => element.localization?.sv)
            .map((element) => [element.elementId, element.localization])),
          codeListLocalization: Object.fromEntries(draft.canonical_definition.codeLists.map((list) => [list.listId, {
            ...(list.localization ? { localization: list.localization } : {}),
            values: Object.fromEntries([...new Set(list.values.map((value) => value.codeSystem))].map((system) =>
              [system, Object.fromEntries(list.values.filter((value) => value.codeSystem === system && value.localization?.sv)
                .map((value) => [value.code, value.localization]))]))
          }])) }), body.displayName]);
      await this.project(manager, draft, releaseId);
      for (const element of draft.canonical_definition.customElements ?? []) {
        const inherited = await manager.query<Array<{ id: string }>>(`select id from forms.custom_element_definition where id=$1`, [element.id]);
        if (inherited[0]) continue;
        await manager.query(`insert into catalog.element_identity (id,namespace,canonical_key) values ($1,$2,$3)`,
          [element.id, element.namespace, `${element.namespace}.${element.slug}`]);
        await manager.query(`insert into forms.custom_element_definition
          (id,organization_id,namespace,slug,title,base_datatype,identifying,definition)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [element.id, session.organization.id, element.namespace, element.slug, element.title,
            element.datatype === "number" ? "decimal" : element.datatype === "other" ? "string" : element.datatype, element.identifying,
            JSON.stringify({ ...element, catalogReleaseId: releaseId })]);
      }
      await this.cloneAgencyDemographics(manager, session.organization.id, draft.source_release_id,
        releaseId, session.user.id);
      const editableValueSetOptionCount = draft.canonical_definition.codeLists
        .filter((list) => list.classification !== "inline")
        .reduce((total, list) => total + list.values.length, 0);
      const editableInlineOptionCount = draft.canonical_definition.codeLists
        .filter((list) => list.classification === "inline")
        .reduce((total, list) => total + list.values.length, 0);
      const counts = await manager.query<Array<{ source_counts: number[]; published_counts: number[];
        expected_option_count: number; expected_element_option_count: number }>>(`select
        array[
          (select count(*)::integer from catalog.group_definition where release_id=$1),
          (select count(*)::integer from catalog.element_definition where release_id=$1),
          (select count(*)::integer from catalog.element_option where release_id=$1),
          (select count(*)::integer from catalog.value_set where release_id=$1),
          (select count(*)::integer from catalog.value_set_element where release_id=$1),
          (select count(*)::integer from catalog.value_set_option where release_id=$1),
          (select count(*)::integer from catalog.repeating_group_time_mapping where release_id=$1),
          (select count(*)::integer from catalog.analytics_element_mapping where release_id=$1)
        ] source_counts,
        array[
          (select count(*)::integer from catalog.group_definition where release_id=$2),
          (select count(*)::integer from catalog.element_definition where release_id=$2),
          (select count(*)::integer from catalog.element_option where release_id=$2),
          (select count(*)::integer from catalog.value_set where release_id=$2),
          (select count(*)::integer from catalog.value_set_element where release_id=$2),
          (select count(*)::integer from catalog.value_set_option where release_id=$2),
          (select count(*)::integer from catalog.repeating_group_time_mapping where release_id=$2),
          (select count(*)::integer from catalog.analytics_element_mapping where release_id=$2)
        ] published_counts,
        ((select count(*)::integer from catalog.element_option
          where release_id=$1 and source_kind <> 'inline') + $4::integer) expected_element_option_count,
        ((select count(*)::integer from catalog.value_set_option o join catalog.value_set v
          on v.release_id=o.release_id and v.value_set_id=o.value_set_id
          where o.release_id=$1 and v.classification not in ('defined', 'suggested', 'agency')) + $3::integer) expected_option_count
      `, [draft.source_release_id, releaseId, editableValueSetOptionCount, editableInlineOptionCount]);
      if (!counts[0] || counts[0].source_counts.some((count, index) => ![2, 5].includes(index) && count !== counts[0]!.published_counts[index]) ||
          counts[0].published_counts[2] !== Number(counts[0].expected_element_option_count) ||
          counts[0].published_counts[5] !== Number(counts[0].expected_option_count) ||
          counts[0].published_counts[1] !== draft.canonical_definition.elements.length) {
        throw new UnprocessableEntityException("Catalog projections could not be verified");
      }
      await manager.query("update catalog.release set sealed = true where id = $1", [releaseId]);
      const published = await manager.query<Array<{ published_at: Date | string }>>(`
        with updated as (
          update catalog.authoring_draft set published_release_id = $2, published_at = now(), updated_at = now()
          where id = $1 and revision = $3 and published_release_id is null returning published_at
        )
        select published_at from updated
      `, [draft.id, releaseId, body.expectedRevision]);
      if (!published[0]) throw new ConflictException("Catalog draft revision is stale");
      await manager.query(`insert into catalog.publication_event
        (organization_id, actor_id, draft_id, release_id, result, change_note, definition_sha256)
        values ($1,$2,$3,$4,'succeeded',$5,$6)`, [session.organization.id, session.user.id, draft.id, releaseId,
        body.changeNote, validation.definitionSha256]);
      return { id: releaseId, displayName: body.displayName, status: "published", version, definitionSha256: validation.definitionSha256,
        publishedAt: new Date(published[0].published_at).toISOString(), projectionsVerified: true };
    });
  }

  private async authorize(token: string, capability: string): Promise<ClinicianSession> {
    return this.sessions.requireCapability(token, capability);
  }

  private async cloneAgencyDemographics(manager: Pick<EntityManager, "query">, organizationId: string,
    sourceReleaseId: string, targetReleaseId: string, createdBy: string): Promise<void> {
    const cloned = mutationRows<{ id: string }>(await manager.query(`
      insert into app_identity.agency_demographic_version
        (organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,
         dagency_04_display,dagency_04_system,dagency_04_terminology_version,
         definition_sha256,effective_from,created_by)
      select $1,$3,
        (select coalesce(max(version),0)+1 from app_identity.agency_demographic_version where organization_id=$1),
        source.dagency_01,source.dagency_02,source.dagency_04,source.dagency_04_display,
        source.dagency_04_system,source.dagency_04_terminology_version,
        source.definition_sha256,now(),$4
      from app_identity.agency_demographic_version source
      where source.organization_id=$1 and source.catalog_release_id=$2 and source.effective_from<=now()
      order by source.effective_from desc,source.version desc limit 1
      returning id
    `, [organizationId, sourceReleaseId, targetReleaseId, createdBy]));
    if (!cloned[0]) {
      throw new UnprocessableEntityException("No effective agency demographics match the source catalog");
    }
  }

  private async sourceElements(manager: Pick<EntityManager, "query">, releaseId: string): Promise<SourceElementRow[]> {
    return manager.query(`select e.element_id, e.name, e.description, cr.provenance->'elementLocalization'->e.element_id as localization,
      (select coalesce(jsonb_agg(jsonb_build_object('kind', o.source_kind, 'code', o.code, 'label', o.display,
        'localization', cr.provenance->'specialChoiceLocalization'->e.element_id->o.source_kind->o.code)
        order by o.source_kind, o.code), '[]'::jsonb) from catalog.element_option o
        where o.release_id=e.release_id and o.element_id=e.element_id and o.source_kind in ('not-value', 'pertinent-negative')) as special_choices,
      e.element_identity_id, e.base_datatype, e.source_datatype,
      e.group_path, e.min_occurs, e.max_occurs, e.nillable, e.supports_not_values,
      e.supports_pertinent_negatives, e.usage, e.agency_required_severity, m.analytical_location, m.sql_type,
      (select coalesce(array_agg(value),array[]::text[]) from jsonb_array_elements_text(
        coalesce((select provenance->'hiddenElementIds' from catalog.release where id=$1),'[]'::jsonb)) value) as hidden_element_ids
      from catalog.element_definition e left join catalog.analytics_element_mapping m
        on m.release_id=e.release_id and m.element_id=e.element_id
      join catalog.release cr on cr.id=e.release_id
      where e.release_id=$1 order by e.element_id`, [releaseId]).then((rows: Array<SourceElementRow & { analytical_location: string | null; sql_type: string | null }>) =>
        rows.map((row) => ({ ...row, analytical_location: row.analytical_location ?? "unmapped", sql_type: row.sql_type ?? "" })) as SourceElementRow[]);
  }

  private async sourceCodeLists(manager: Pick<EntityManager, "query">, releaseId: string): Promise<SourceCodeListRow[]> {
    const valueSets = await manager.query<SourceCodeListRow[]>(`select v.value_set_id as list_id, v.name, v.classification,
      cr.provenance->'codeListLocalization'->v.value_set_id->'localization' as localization,
      coalesce((select array_agg(vse.element_id order by vse.element_id)
        from catalog.value_set_element vse where vse.release_id=v.release_id
          and vse.value_set_id=v.value_set_id), array[]::text[]) as element_ids,
      coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'codeSystem', o.code_system,
        'label', o.display, 'sourceLabel', o.source_display, 'category', o.category,
        'enabled', coalesce(c.enabled, true), 'localization',
        cr.provenance->'codeListLocalization'->v.value_set_id->'values'->o.code_system->o.code) order by c.sort_order nulls last, o.code_system, o.code)
        filter (where o.code is not null), '[]'::jsonb) as values,
      (jsonb_agg(jsonb_build_object('code', o.code, 'codeSystem', o.code_system))
        filter (where c.is_default))->0 as default_value
      from catalog.value_set v left join catalog.value_set_option o
        on o.release_id=v.release_id and o.value_set_id=v.value_set_id
      join catalog.release cr on cr.id=v.release_id
      left join catalog.value_set_option_configuration c
        on c.release_id=o.release_id and c.value_set_id=o.value_set_id and c.code_system=o.code_system and c.code=o.code
      where v.release_id=$1 and v.classification in ('defined', 'suggested', 'agency')
      group by v.release_id, v.value_set_id, v.name, v.classification, cr.id order by v.value_set_id`, [releaseId]);
    const inline = await manager.query<SourceCodeListRow[]>(`select 'inline:' || e.element_id as list_id,
      e.name, 'inline'::text as classification, array[e.element_id] as element_ids,
      cr.provenance->'codeListLocalization'->('inline:' || e.element_id)->'localization' as localization,
      coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'codeSystem', o.code_system,
        'label', o.display, 'sourceLabel', o.display, 'category', null,
        'enabled', coalesce(c.enabled, true), 'localization',
        cr.provenance->'codeListLocalization'->('inline:' || e.element_id)->'values'->o.code_system->o.code) order by c.sort_order nulls last, o.code_system, o.code)
        filter (where o.code is not null), '[]'::jsonb) as values,
      (jsonb_agg(jsonb_build_object('code', o.code, 'codeSystem', o.code_system))
        filter (where c.is_default))->0 as default_value
      from catalog.element_definition e join catalog.release cr on cr.id=e.release_id join catalog.element_option o
        on o.release_id=e.release_id and o.element_id=e.element_id and o.source_kind='inline'
      left join catalog.element_option_configuration c
        on c.release_id=o.release_id and c.element_id=o.element_id and c.source_kind=o.source_kind
        and c.code_system=o.code_system and c.code=o.code
      where e.release_id=$1
      group by e.element_id, e.name, cr.id order by e.element_id`, [releaseId]);
    return [...inline, ...valueSets];
  }

  private async cloneDefinition(manager: EntityManager, sourceReleaseId: string): Promise<CatalogDraftDefinition> {
    const elements = await this.sourceElements(manager, sourceReleaseId);
    const codeLists = await this.sourceCodeLists(manager, sourceReleaseId);
    const customElements = await manager.query<Array<{ definition: CatalogDraftCustomTextElement }>>(`
      select ced.definition from forms.custom_element_definition ced
      join catalog.release cr on cr.id=$1
      where ced.id::text in (select jsonb_array_elements_text(coalesce(cr.provenance->'customElementIds','[]'::jsonb)))
      order by ced.namespace, ced.slug`, [sourceReleaseId]);
    return { schemaVersion: 1, sourceReleaseId,
      ...(customElements.length ? { customElements: customElements.map((row) => {
        const { catalogReleaseId: _release, ...definition } = row.definition as CatalogDraftCustomTextElement & { catalogReleaseId?: string };
        return definition;
      }) } : {}),
      ...(elements[0]?.hidden_element_ids?.length ? { hiddenElementIds: elements[0].hidden_element_ids } : {}),
      elements: elements.map((row) => ({
      elementId: row.element_id, label: row.name, description: row.description ?? "",
      ...(row.localization ? { localization: row.localization } : {}), ...(row.special_choices?.length ? { specialChoices: row.special_choices } : {}), identityId: row.element_identity_id, baseDatatype: row.base_datatype,
      storageSemantics: { sourceDatatype: row.source_datatype, groupPath: row.group_path,
        analyticalLocation: row.analytical_location, sqlType: row.sql_type },
      requirednessSeverity: row.agency_required_severity ??
        (["Mandatory", "Required"].includes(row.usage) ? "error" : null),
      constraints: { minOccurs: row.min_occurs, maxOccurs: row.max_occurs, nillable: row.nillable,
        supportsNotValues: row.supports_not_values, supportsPertinentNegatives: row.supports_pertinent_negatives }
    })), codeLists: codeLists.map((list) => ({
      listId: list.list_id, name: list.name, classification: list.classification,
      ...(list.localization ? { localization: list.localization } : {}),
      elementIds: list.element_ids, values: list.values, defaultValue: list.default_value
    })) };
  }

  /** Adds newly authorable projections to drafts created by an earlier admin release without discarding their edits. */
  private async upgradeDefinition(manager: EntityManager, sourceReleaseId: string,
    existing: CatalogDraftDefinition): Promise<CatalogDraftDefinition> {
    const baseline = await this.cloneDefinition(manager, sourceReleaseId);
    const existingElements = Array.isArray(existing?.elements) ? new Map(existing.elements.map((element) => [element.elementId, element])) : new Map();
    const existingLists = Array.isArray(existing?.codeLists) ? new Map(existing.codeLists.map((list) => [list.listId, list])) : new Map();
    return { ...baseline,
      ...(existing.hiddenElementIds ? { hiddenElementIds: existing.hiddenElementIds } : {}),
      ...(Array.isArray(existing.customElements) || baseline.customElements ?
        { customElements: Array.isArray(existing.customElements) ? existing.customElements : baseline.customElements } : {}),
      elements: baseline.elements.map((element) => {
        const prior = existingElements.get(element.elementId) as CatalogDraftElement & { agencyRequired?: boolean } | undefined;
        if (!prior) return element;
        // Catalog authoring owns labels and vocabulary. Requiredness and documented
        // occurrence policy are migrated to Validation and cannot be changed here.
        return { ...prior,
          label: typeof prior.label === "string" ? prior.label : element.label,
          description: typeof prior.description === "string" ? prior.description : element.description,
          ...(prior.localization ? { localization: prior.localization } : {}),
          ...(prior.specialChoices?.length || element.specialChoices?.length ? { specialChoices: prior.specialChoices ?? element.specialChoices } : {}),
          requirednessSeverity: element.requirednessSeverity,
          constraints: { ...prior.constraints, minOccurs: element.constraints.minOccurs, maxOccurs: element.constraints.maxOccurs } };
      }),
      codeLists: baseline.codeLists.map((list) => {
        const prior = existingLists.get(list.listId);
        return prior ? { ...prior, classification: list.classification, elementIds: list.elementIds } : list;
      })
    };
  }

  private async validateDefinition(
    manager: Pick<EntityManager, "query">, sourceReleaseId: string, definition: unknown
  ): Promise<CatalogValidationResult> {
    const findings: string[] = [];
    const warnings: string[] = [];
    if (!isRecord(definition) || definition.schemaVersion !== 1 || definition.sourceReleaseId !== sourceReleaseId ||
        !Array.isArray(definition.elements)) {
      findings.push("The canonical catalog must be schema version 1 and remain pinned to its source release");
    }
    const source = await this.sourceElements(manager, sourceReleaseId);
    const sourceById = new Map(source.map((item) => [item.element_id, item]));
    const hiddenIds = isRecord(definition) ? definition.hiddenElementIds : undefined;
    if (hiddenIds !== undefined && (!Array.isArray(hiddenIds) ||
      hiddenIds.some((id) => typeof id !== "string" || !id.startsWith("ePayment.") || !sourceById.has(id)) ||
      new Set(hiddenIds).size !== hiddenIds.length)) {
      findings.push("Hidden elements must be unique ePayment IDs retained in the source catalog");
    }
    const elements = isRecord(definition) && Array.isArray(definition.elements) ? definition.elements : [];
    const seen = new Set<string>();
    for (const [index, unknownElement] of elements.entries()) {
      if (!isRecord(unknownElement) || typeof unknownElement.elementId !== "string") {
        findings.push(`elements[${index}] is invalid`); continue;
      }
      const element = unknownElement as unknown as CatalogDraftElement;
      const base = sourceById.get(element.elementId);
      if (!base || seen.has(element.elementId)) { findings.push(`elements[${index}].elementId is missing or duplicated`); continue; }
      seen.add(element.elementId);
      const storage = element.storageSemantics;
      const immutable = element.identityId === base.element_identity_id && element.baseDatatype === base.base_datatype &&
        storage?.sourceDatatype === base.source_datatype && storage?.analyticalLocation === base.analytical_location &&
        storage?.sqlType === base.sql_type && Array.isArray(storage?.groupPath) &&
        storage.groupPath.length === base.group_path.length && storage.groupPath.every((part, i) => part === base.group_path[i]);
      if (!immutable) findings.push(`${element.elementId} identity, datatype, and storage semantics cannot change`);
      if (typeof element.label !== "string") findings.push(`${element.elementId}.label must be text`);
      else if (!element.label.trim()) warnings.push(`${element.elementId}.label is missing English text`);
      if (element.description !== undefined && typeof element.description !== "string")
        findings.push(`${element.elementId}.description must be text`);
      const localization = element.localization;
      if (localization !== undefined) {
        if (!isRecord(localization) || localization.schemaVersion !== 1 ||
            Object.keys(localization).some((key) => !["schemaVersion", "sv"].includes(key)) ||
            localization.sv !== undefined && (!isRecord(localization.sv) ||
              Object.keys(localization.sv).some((key) => !["label", "description", "reviewedSource"].includes(key)) ||
              [localization.sv.label, localization.sv.description].some((value) => value !== undefined && typeof value !== "string") ||
              localization.sv.reviewedSource !== undefined && (!isRecord(localization.sv.reviewedSource) ||
                Object.keys(localization.sv.reviewedSource).some((key) => !["label", "description"].includes(key)) ||
                Object.values(localization.sv.reviewedSource).some((value) => typeof value !== "string"))))
          findings.push(`${element.elementId}.localization is malformed`);
        else if (isRecord(localization.sv)) {
          if (typeof localization.sv.label !== "string" || !localization.sv.label.trim())
            warnings.push(`${element.elementId}.label is missing Swedish text`);
          if (localization.sv.label && localization.sv.reviewedSource &&
              isRecord(localization.sv.reviewedSource) && localization.sv.reviewedSource.label !== element.label)
            warnings.push(`${element.elementId}.label Swedish text needs English source review`);
          if (localization.sv.description && localization.sv.reviewedSource &&
              isRecord(localization.sv.reviewedSource) && localization.sv.reviewedSource.description !== element.description)
            warnings.push(`${element.elementId}.description Swedish text needs English source review`);
        }
      } else warnings.push(`${element.elementId}.label is missing Swedish text`);
      const baseChoices = base.special_choices ?? [];
      if (!Array.isArray(element.specialChoices ?? []) || (element.specialChoices ?? []).length !== baseChoices.length) {
        findings.push(`${element.elementId} special choices must preserve source identities`);
      } else {
        const sourceChoices = new Map(baseChoices.map((choice) => [`${choice.kind}\u0000${choice.code}`, choice]));
        const seenChoices = new Set<string>();
        for (const choice of element.specialChoices ?? []) {
          const key = `${choice.kind}\u0000${choice.code}`;
          if (!sourceChoices.has(key) || seenChoices.has(key) || sourceChoices.get(key)!.label !== choice.label)
            findings.push(`${element.elementId} special choice identity ${key} is unknown, duplicate, or changed`);
          seenChoices.add(key);
          if (choice.localization?.sv?.label !== undefined && typeof choice.localization.sv.label !== "string")
            findings.push(`${element.elementId} special choice ${key} translation is malformed`);
          if (choice.localization?.sv?.reviewedSource?.label && choice.localization.sv.reviewedSource.label !== choice.label)
            warnings.push(`${element.elementId} special choice ${key} needs source review`);
        }
      }
      const constraints = element.constraints;
      if (!constraints || !Number.isInteger(constraints.minOccurs) || constraints.minOccurs < 0 ||
          !(constraints.maxOccurs === null || Number.isInteger(constraints.maxOccurs) && constraints.maxOccurs >= 1) ||
          constraints.maxOccurs !== null && constraints.minOccurs > constraints.maxOccurs) {
        findings.push(`${element.elementId} has invalid occurrence constraints`);
      }
      if (base.max_occurs !== null && (constraints?.maxOccurs === null || constraints.maxOccurs > base.max_occurs))
        findings.push(`${element.elementId} cannot broaden its supported maximum`);
      if (constraints && ((!base.nillable && constraints.nillable) || (!base.supports_not_values && constraints.supportsNotValues) ||
          (!base.supports_pertinent_negatives && constraints.supportsPertinentNegatives)))
        findings.push(`${element.elementId} cannot enable unsupported null or absence semantics`);
      if (element.requirednessSeverity !== (base.agency_required_severity ??
          (["Mandatory", "Required"].includes(base.usage) ? "error" : null)) ||
          constraints?.minOccurs !== base.min_occurs || constraints?.maxOccurs !== base.max_occurs)
        findings.push(`${element.elementId} requiredness and documented occurrence policy must be authored in Validation`);
    }
    if (seen.size !== source.length) findings.push("The draft must retain every stable element identity from the source catalog");
    const sourceLists = await this.sourceCodeLists(manager, sourceReleaseId);
    const sourceListById = new Map(sourceLists.map((item) => [item.list_id, item]));
    const codeLists = isRecord(definition) && Array.isArray(definition.codeLists) ? definition.codeLists : [];
    if (!isRecord(definition) || !Array.isArray(definition.codeLists)) findings.push("The canonical catalog must include code lists");
    const seenLists = new Set<string>();
    for (const [listIndex, unknownList] of codeLists.entries()) {
      if (!isRecord(unknownList) || typeof unknownList.listId !== "string" || !Array.isArray(unknownList.values)) {
        findings.push(`codeLists[${listIndex}] is invalid`); continue;
      }
      const list = unknownList as unknown as CatalogDraftCodeList;
      const baseList = sourceListById.get(list.listId);
      if (!baseList || seenLists.has(list.listId)) {
        findings.push(`codeLists[${listIndex}].listId is missing, duplicated, or not editable`); continue;
      }
      seenLists.add(list.listId);
      if (list.name !== baseList.name || list.classification !== baseList.classification ||
          !Array.isArray(list.elementIds) || list.elementIds.length !== baseList.element_ids.length ||
          list.elementIds.some((elementId, index) => elementId !== baseList.element_ids[index]))
        findings.push(`${list.listId} identity and classification cannot change`);
      const listTranslation = list.localization?.sv;
      if (list.localization !== undefined && (list.localization.schemaVersion !== 1 ||
          (listTranslation !== undefined && (typeof listTranslation.name !== "string" ||
            (listTranslation.reviewedSource !== undefined && typeof listTranslation.reviewedSource.name !== "string")))))
        findings.push(`${list.listId} localized list name is malformed`);
      else if (listTranslation?.reviewedSource && listTranslation.reviewedSource.name !== list.name)
        warnings.push(`${list.listId} localized list name needs source review`);
      const sourceValues = new Map(baseList.values.map((value) => [`${value.codeSystem}\u0000${value.code}`, value]));
      const seenValues = new Set<string>();
      for (const [valueIndex, unknownValue] of list.values.entries()) {
        if (!isRecord(unknownValue) || typeof unknownValue.code !== "string" || typeof unknownValue.codeSystem !== "string") {
          findings.push(`${list.listId}.values[${valueIndex}] is invalid`); continue;
        }
        const code = unknownValue.code.trim();
        const codeSystem = unknownValue.codeSystem.trim();
        const key = `${codeSystem}\u0000${code}`;
        if (!code || seenValues.has(key)) {
          findings.push(`${list.listId} contains a blank or duplicate code`); continue;
        }
        seenValues.add(key);
        if (code !== unknownValue.code || codeSystem !== unknownValue.codeSystem ||
            typeof unknownValue.label !== "string" || !unknownValue.label.trim() ||
            typeof unknownValue.sourceLabel !== "string" || !unknownValue.sourceLabel.trim() ||
            !(unknownValue.category === null || typeof unknownValue.category === "string") ||
            typeof unknownValue.enabled !== "boolean") findings.push(`${list.listId} value ${code} is malformed`);
        const translation = (unknownValue as CatalogDraftCodeValue).localization?.sv;
        if ((unknownValue as CatalogDraftCodeValue).localization != null &&
            ((unknownValue as CatalogDraftCodeValue).localization?.schemaVersion !== 1 ||
              (translation !== undefined && (typeof translation.label !== "string" ||
                (translation.reviewedSource !== undefined && typeof translation.reviewedSource.label !== "string")))))
          findings.push(`${list.listId} value ${code} localization is malformed`);
        else if (translation?.reviewedSource && translation.reviewedSource.label !== unknownValue.label)
          warnings.push(`${list.listId} value ${code} needs source review`);
        const baseValue = sourceValues.get(key);
        if (baseValue && (unknownValue.sourceLabel !== baseValue.sourceLabel || unknownValue.category !== baseValue.category))
          findings.push(`${list.listId} published code ${code} identity and source meaning cannot change`);
      }
      for (const key of sourceValues.keys()) if (!seenValues.has(key))
        findings.push(`${list.listId} published code ${key.split("\u0000")[1]} cannot be deleted or changed`);
    }
    if (seenLists.size !== sourceLists.length)
      findings.push("The draft must retain every inline, agency-maintained, or recommended code list");
    const custom = isRecord(definition) ? definition.customElements : undefined;
    if (custom !== undefined && !Array.isArray(custom)) findings.push("customElements must be an array");
    const customIds = new Set<string>();
    const customKeys = new Set<string>();
    const inherited = await manager.query<Array<{ id: string; namespace: string; slug: string; definition: CatalogDraftCustomTextElement }>>(`
      select ced.id,ced.namespace,ced.slug,ced.definition from forms.custom_element_definition ced
      join catalog.release cr on cr.id=$1
      where ced.id::text in (select jsonb_array_elements_text(coalesce(cr.provenance->'customElementIds','[]'::jsonb)))`, [sourceReleaseId]);
    for (const [index, candidate] of (Array.isArray(custom) ? custom : []).entries()) {
      const item = candidate as CatalogDraftCustomTextElement;
      const itemFindings = customTextDefinitionFindings(item);
      findings.push(...itemFindings.map((message) => `customElements[${index}]: ${message}`));
      if (itemFindings.length) continue;
      const key = `${item.namespace}.${item.slug}`;
      if (customIds.has(item.id) || customKeys.has(key) || sourceById.has(key)) findings.push(`Duplicate custom identity ${key}`);
      customIds.add(item.id); customKeys.add(key);
      const old = inherited.find((row) => row.id === item.id);
      if (old && (old.namespace !== item.namespace || old.slug !== item.slug ||
        old.definition.title !== item.title || old.definition.definition !== item.definition || old.definition.datatype !== item.datatype ||
        old.definition.usage !== item.usage || old.definition.identifying !== item.identifying ||
        ["minLength", "maxLength", "pattern", "minimum", "maximum"].some((key) =>
          old.definition.constraints?.[key as keyof typeof item.constraints] !== item.constraints?.[key as keyof typeof item.constraints])))
        findings.push(`Published custom identity ${key} cannot change its meaning or classification`);
    }
    for (const old of inherited) if (!customIds.has(old.id)) findings.push(`Published custom identity ${old.namespace}.${old.slug} must be retained`);
    if (customIds.size) {
      const collisions = await manager.query<Array<{ id: string; namespace: string; canonical_key: string }>>(`
        select id,namespace,canonical_key from catalog.element_identity
        where id=any($1::uuid[]) or canonical_key=any($2::text[])`, [[...customIds], [...customKeys]]);
      for (const collision of collisions) if (!inherited.some((old) => old.id === collision.id &&
        `${old.namespace}.${old.slug}` === collision.canonical_key))
        findings.push(`Custom identity ${collision.canonical_key} is already published`);
    }
    const digest = catalogDefinitionSha256(definition);
    return { valid: findings.length === 0, findings, warnings, definitionSha256: digest,
      projectionsVerified: findings.length === 0 && seen.size === source.length && seenLists.size === sourceLists.length };
  }

  private async project(manager: EntityManager, draft: DraftRow, releaseId: string): Promise<void> {
    const source = draft.source_release_id;
    await manager.query(`insert into catalog.group_definition select $2, group_id,parent_group_id,name,path,min_occurs,max_occurs,unbounded,repeating,definition
      from catalog.group_definition where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.element_definition
      (release_id,element_id,element_identity_id,section,name,description,national,state,usage,source_datatype,base_datatype,
       group_path,min_occurs,max_occurs,unbounded,nillable,supports_not_values,supports_pertinent_negatives,definition,
       agency_required,agency_required_severity)
      select $2,e.element_id,e.element_identity_id,e.section,x.label,x.description,e.national,e.state,e.usage,e.source_datatype,e.base_datatype,
       e.group_path,x.min_occurs,x.max_occurs,e.unbounded,x.nillable,x.supports_not_values,x.supports_pertinent_negatives,e.definition,
       x.requiredness_severity is not null,x.requiredness_severity
      from catalog.element_definition e join jsonb_to_recordset($3::jsonb) x(element_id text,label text,description text,min_occurs integer,max_occurs integer,
        nillable boolean,supports_not_values boolean,supports_pertinent_negatives boolean,requiredness_severity text) on x.element_id=e.element_id
      where e.release_id=$1`, [source, releaseId, JSON.stringify(draft.canonical_definition.elements.map((e) => ({
        element_id:e.elementId,label:e.label,description:e.description ?? "",min_occurs:e.constraints.minOccurs,max_occurs:e.constraints.maxOccurs,nillable:e.constraints.nillable,
        supports_not_values:e.constraints.supportsNotValues,supports_pertinent_negatives:e.constraints.supportsPertinentNegatives,
        requiredness_severity:e.requirednessSeverity })))]);
    await manager.query(`insert into catalog.element_option
      select $2,element_id,source_kind,code,display,code_system from catalog.element_option
      where release_id=$1 and source_kind <> 'inline'`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set select $2,value_set_id,name,classification,published_at,exhaustive,definition from catalog.value_set where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set_element select $2,value_set_id,element_id from catalog.value_set_element where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set_option
      (release_id,value_set_id,code,code_system,display,source_display,category)
      select $2,o.value_set_id,o.code,o.code_system,o.display,o.source_display,o.category
      from catalog.value_set_option o join catalog.value_set v
        on v.release_id=o.release_id and v.value_set_id=o.value_set_id
      where o.release_id=$1 and v.classification not in ('defined', 'suggested', 'agency')`, [source, releaseId]);
    const inlineValues = draft.canonical_definition.codeLists.filter((list) => list.classification === "inline")
      .flatMap((list) => list.values.map((value, index) => ({ element_id: list.elementIds[0]!, source_kind: "inline",
        code: value.code, code_system: value.codeSystem, display: value.label, enabled: value.enabled, sort_order: index,
        is_default: false })));
    if (inlineValues.length) await manager.query(`insert into catalog.element_option
      (release_id,element_id,source_kind,code,display,code_system)
      select $1,x.element_id,x.source_kind,x.code,x.display,x.code_system
      from jsonb_to_recordset($2::jsonb) x(element_id text,source_kind text,code text,code_system text,
        display text,enabled boolean,sort_order integer,is_default boolean)`, [releaseId, JSON.stringify(inlineValues)]);
    if (inlineValues.length) await manager.query(`insert into catalog.element_option_configuration
      (release_id,element_id,source_kind,code,code_system,enabled,sort_order,is_default)
      select $1,x.element_id,x.source_kind,x.code,x.code_system,x.enabled,x.sort_order,x.is_default
      from jsonb_to_recordset($2::jsonb) x(element_id text,source_kind text,code text,code_system text,
        display text,enabled boolean,sort_order integer,is_default boolean)`, [releaseId, JSON.stringify(inlineValues)]);
    const projectedValues = draft.canonical_definition.codeLists.filter((list) => list.classification !== "inline")
      .flatMap((list) => list.values.map((value, index) => ({
      value_set_id: list.listId, code: value.code, code_system: value.codeSystem, display: value.label,
      source_display: value.sourceLabel, category: value.category, enabled: value.enabled, sort_order: index,
      is_default: false
    })));
    if (projectedValues.length) await manager.query(`insert into catalog.value_set_option
      (release_id,value_set_id,code,code_system,display,source_display,category)
      select $1,x.value_set_id,x.code,x.code_system,x.display,x.source_display,x.category
      from jsonb_to_recordset($2::jsonb) x(value_set_id text,code text,code_system text,display text,
        source_display text,category text,enabled boolean,sort_order integer,is_default boolean)`,
      [releaseId, JSON.stringify(projectedValues)]);
    if (projectedValues.length) await manager.query(`insert into catalog.value_set_option_configuration
      (release_id,value_set_id,code,code_system,enabled,sort_order,is_default)
      select $1,x.value_set_id,x.code,x.code_system,x.enabled,x.sort_order,x.is_default
      from jsonb_to_recordset($2::jsonb) x(value_set_id text,code text,code_system text,display text,
        source_display text,category text,enabled boolean,sort_order integer,is_default boolean)`,
      [releaseId, JSON.stringify(projectedValues)]);
    await manager.query(`insert into catalog.repeating_group_time_mapping select $2,group_id,resolution,time_element_id,inherited_from_group_id,candidate_time_element_ids,note from catalog.repeating_group_time_mapping where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.analytics_element_mapping select $2,element_id,element_identity_id,analytical_location,sql_column,sql_type,identifying,mapping from catalog.analytics_element_mapping where release_id=$1`, [source, releaseId]);
  }

  private expectedRevision(input: unknown): number {
    const revision = isRecord(input) ? input.expectedRevision : undefined;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    return Number(revision);
  }

  private saveBody(input: unknown): { expectedRevision: number; displayName: string | null; definition: CatalogDraftDefinition } {
    if (!isRecord(input) || !Number.isInteger(input.expectedRevision) || !isRecord(input.definition))
      throw new UnprocessableEntityException("expectedRevision, displayName, and definition are required");
    return { expectedRevision: input.expectedRevision as number,
      displayName: input.displayName === undefined ? null : this.displayName(input),
      definition: input.definition as unknown as CatalogDraftDefinition };
  }

  private publishBody(input: unknown): { expectedRevision: number; definitionSha256: string; displayName: string; changeNote: string } {
    if (!isRecord(input) || !Number.isInteger(input.expectedRevision) || typeof input.definitionSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.definitionSha256) || typeof input.displayName !== "string" || !input.displayName.trim() ||
        input.displayName.trim().length > 120 || typeof input.changeNote !== "string" || !input.changeNote.trim())
      throw new UnprocessableEntityException("expectedRevision, validated definitionSha256, displayName, and changeNote are required");
    return { expectedRevision: input.expectedRevision as number, definitionSha256: input.definitionSha256,
      displayName: input.displayName.trim(), changeNote: input.changeNote.trim() };
  }

  private result(row: DraftRow): CatalogDraft {
    return { id: row.id, ...(row.display_name ? { displayName: row.display_name } : {}), sourceReleaseId: row.source_release_id, revision: Number(row.revision),
      definitionSha256: row.definition_sha256, definition: row.canonical_definition,
      updatedAt: new Date(row.updated_at).toISOString() };
  }

  private displayName(input: unknown): string {
    const value = isRecord(input) ? input.displayName : undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
      throw new UnprocessableEntityException("displayName must contain 1 to 120 characters");
    return value.trim();
  }
}
