import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  CatalogDraft, CatalogDraftCodeList, CatalogDraftDefinition, CatalogDraftElement, CatalogValidationResult,
  ClinicianSession, PublishedCatalog
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type DraftRow = {
  id: string; organization_id: string; source_release_id: string; revision: number;
  canonical_definition: CatalogDraftDefinition; definition_sha256: string; updated_at: Date | string;
  published_release_id: string | null;
};

type SourceElementRow = {
  element_id: string; element_identity_id: string; base_datatype: string; source_datatype: string;
  group_path: string[]; min_occurs: number; max_occurs: number | null; nillable: boolean;
  supports_not_values: boolean; supports_pertinent_negatives: boolean; usage: string;
  analytical_location: "wide" | "repeatable" | "unmapped"; sql_type: string;
};

type SourceCodeListRow = {
  list_id: string; name: string; classification: "suggested" | "agency";
  values: Array<{ code: string; codeSystem: string; label: string; sourceLabel: string;
    category: string | null; enabled: boolean }>;
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
    const session = await this.admin(sessionToken);
    const rows = await this.dataSource.query<DraftRow[]>(`
      select * from catalog.authoring_draft
      where organization_id = $1 and published_release_id is null
      order by created_at desc limit 1
    `, [session.organization.id]);
    return rows[0] ? this.result(rows[0]) : null;
  }

  async cloneActive(sessionToken: string): Promise<CatalogDraft> {
    const session = await this.admin(sessionToken);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`catalog-draft:${session.organization.id}`]);
      const existing = await manager.query<DraftRow[]>(`
        select * from catalog.authoring_draft
        where organization_id = $1 and published_release_id is null for update
      `, [session.organization.id]);
      if (existing[0]) return this.result(existing[0]);
      const releases = await manager.query<Array<{ id: string }>>(`
        select fv.catalog_release_id as id from forms.form_version fv
        join forms.form f on f.id = fv.form_id
        join forms.agency_stationary_default active on active.organization_id=f.organization_id
          and active.form_version_id=fv.id
        where f.organization_id = $1 and fv.status = 'published' limit 1
      `, [session.organization.id]);
      if (!releases[0]) throw new NotFoundException("No active catalog is available to clone");
      const definition = await this.cloneDefinition(manager, releases[0].id);
      const digest = catalogDefinitionSha256(definition);
      const inserted = await manager.query<DraftRow[]>(`
        insert into catalog.authoring_draft
          (organization_id, source_release_id, canonical_definition, definition_sha256, created_by)
        values ($1, $2, $3::jsonb, $4, $5) returning *
      `, [session.organization.id, releases[0].id, JSON.stringify(definition), digest, session.user.id]);
      return this.result(inserted[0]!);
    });
  }

  async save(sessionToken: string, draftId: string, input: unknown): Promise<CatalogDraft> {
    const session = await this.admin(sessionToken);
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
      const validation = await this.validateDefinition(manager, draft.source_release_id, body.definition);
      if (!validation.valid) throw new UnprocessableEntityException({ message: "Catalog validation failed", findings: validation.findings });
      const updated = await manager.query<DraftRow[]>(`
        with updated as (
          update catalog.authoring_draft set revision = revision + 1, canonical_definition = $3::jsonb,
            definition_sha256 = $4, updated_at = now()
          where id = $1 and organization_id = $2 and revision = $5 and published_release_id is null returning *
        )
        select * from updated
      `, [draftId, session.organization.id, JSON.stringify(body.definition), validation.definitionSha256, body.expectedRevision]);
      if (!updated[0]) throw new ConflictException("Catalog draft revision is stale");
      return this.result(updated[0]);
    });
  }

  async validate(sessionToken: string, draftId: string): Promise<CatalogValidationResult> {
    const session = await this.admin(sessionToken);
    const rows = await this.dataSource.query<DraftRow[]>(`
      select * from catalog.authoring_draft where id = $1 and organization_id = $2
    `, [draftId, session.organization.id]);
    if (!rows[0]) throw new NotFoundException(`Catalog draft ${draftId} was not found`);
    return this.validateDefinition(this.dataSource.manager, rows[0].source_release_id, rows[0].canonical_definition);
  }

  async publish(sessionToken: string, draftId: string, input: unknown): Promise<PublishedCatalog> {
    const session = await this.admin(sessionToken);
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
      const source = (await manager.query<Array<{ standard: string; version: string; dataset: string; artifact_schema_version: string }>>(
        "select standard, version, dataset, artifact_schema_version from catalog.release where id = $1", [draft.source_release_id]
      ))[0]!;
      const releaseId = randomUUID();
      const version = `${source.version}-agency-${draft.id.replaceAll("-", "").slice(0, 12)}`;
      await manager.query(`insert into catalog.release
        (id, standard, version, dataset, artifact_schema_version, artifact_sha256, provenance, sealed)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,false)`, [releaseId, source.standard, version, source.dataset,
        source.artifact_schema_version, validation.definitionSha256, JSON.stringify({ sourceReleaseId: draft.source_release_id,
          organizationId: session.organization.id, changeNote: body.changeNote }),]);
      await this.project(manager, draft, releaseId);
      const editableOptionCount = draft.canonical_definition.codeLists.reduce((total, list) => total + list.values.length, 0);
      const counts = await manager.query<Array<{ source_counts: number[]; published_counts: number[]; expected_option_count: number }>>(`select
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
        ((select count(*)::integer from catalog.value_set_option o join catalog.value_set v
          on v.release_id=o.release_id and v.value_set_id=o.value_set_id
          where o.release_id=$1 and v.classification not in ('suggested', 'agency')) + $3::integer) expected_option_count
      `, [draft.source_release_id, releaseId, editableOptionCount]);
      if (!counts[0] || counts[0].source_counts.some((count, index) => index !== 5 && count !== counts[0]!.published_counts[index]) ||
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
      return { id: releaseId, status: "published", version, definitionSha256: validation.definitionSha256,
        publishedAt: new Date(published[0].published_at).toISOString(), projectionsVerified: true };
    });
  }

  private async admin(token: string): Promise<ClinicianSession> {
    return this.sessions.requireCapability(token, "installation:administer");
  }

  private async sourceElements(manager: Pick<EntityManager, "query">, releaseId: string): Promise<SourceElementRow[]> {
    return manager.query(`select e.element_id, e.element_identity_id, e.base_datatype, e.source_datatype,
      e.group_path, e.min_occurs, e.max_occurs, e.nillable, e.supports_not_values,
      e.supports_pertinent_negatives, e.usage, m.analytical_location, m.sql_type
      from catalog.element_definition e left join catalog.analytics_element_mapping m
        on m.release_id=e.release_id and m.element_id=e.element_id
      where e.release_id=$1 order by e.element_id`, [releaseId]).then((rows: Array<SourceElementRow & { analytical_location: string | null; sql_type: string | null }>) =>
        rows.map((row) => ({ ...row, analytical_location: row.analytical_location ?? "unmapped", sql_type: row.sql_type ?? "" })) as SourceElementRow[]);
  }

  private async sourceCodeLists(manager: Pick<EntityManager, "query">, releaseId: string): Promise<SourceCodeListRow[]> {
    return manager.query(`select v.value_set_id as list_id, v.name, v.classification,
      coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'codeSystem', o.code_system,
        'label', o.display, 'sourceLabel', o.source_display, 'category', o.category,
        'enabled', coalesce(c.enabled, true)) order by c.sort_order nulls last, o.code_system, o.code)
        filter (where o.code is not null), '[]'::jsonb) as values
      from catalog.value_set v left join catalog.value_set_option o
        on o.release_id=v.release_id and o.value_set_id=v.value_set_id
      left join catalog.value_set_option_configuration c
        on c.release_id=o.release_id and c.value_set_id=o.value_set_id and c.code_system=o.code_system and c.code=o.code
      where v.release_id=$1 and v.classification in ('suggested', 'agency')
      group by v.value_set_id, v.name, v.classification order by v.value_set_id`, [releaseId]);
  }

  private async cloneDefinition(manager: EntityManager, sourceReleaseId: string): Promise<CatalogDraftDefinition> {
    const elements = await this.sourceElements(manager, sourceReleaseId);
    const codeLists = await this.sourceCodeLists(manager, sourceReleaseId);
    const defaults = await manager.query<Array<{ list_id: string; code: string; code_system: string }>>(`
      select value_set_id as list_id, code, code_system from catalog.value_set_option_configuration
      where release_id=$1 and is_default order by value_set_id`, [sourceReleaseId]);
    const defaultByList = new Map(defaults.map((item) => [item.list_id, item]));
    return { schemaVersion: 1, sourceReleaseId, elements: elements.map((row) => ({
      elementId: row.element_id, identityId: row.element_identity_id, baseDatatype: row.base_datatype,
      storageSemantics: { sourceDatatype: row.source_datatype, groupPath: row.group_path,
        analyticalLocation: row.analytical_location, sqlType: row.sql_type },
      agencyRequired: ["Mandatory", "Required"].includes(row.usage),
      constraints: { minOccurs: row.min_occurs, maxOccurs: row.max_occurs, nillable: row.nillable,
        supportsNotValues: row.supports_not_values, supportsPertinentNegatives: row.supports_pertinent_negatives }
    })), codeLists: codeLists.map((list) => ({
      listId: list.list_id, name: list.name, classification: list.classification, values: list.values,
      defaultValue: defaultByList.has(list.list_id) ? { code: defaultByList.get(list.list_id)!.code,
        codeSystem: defaultByList.get(list.list_id)!.code_system } : null
    })) };
  }

  private async validateDefinition(
    manager: Pick<EntityManager, "query">, sourceReleaseId: string, definition: unknown
  ): Promise<CatalogValidationResult> {
    const findings: string[] = [];
    if (!isRecord(definition) || definition.schemaVersion !== 1 || definition.sourceReleaseId !== sourceReleaseId ||
        !Array.isArray(definition.elements)) {
      findings.push("The canonical catalog must be schema version 1 and remain pinned to its source release");
    }
    const source = await this.sourceElements(manager, sourceReleaseId);
    const sourceById = new Map(source.map((item) => [item.element_id, item]));
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
      if (typeof element.agencyRequired !== "boolean") findings.push(`${element.elementId}.agencyRequired must be boolean`);
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
        findings.push(`codeLists[${listIndex}].listId is missing, duplicated, or not agency-maintained`); continue;
      }
      seenLists.add(list.listId);
      if (list.name !== baseList.name || list.classification !== baseList.classification)
        findings.push(`${list.listId} identity and classification cannot change`);
      const sourceValues = new Map(baseList.values.map((value) => [`${value.codeSystem}\u0000${value.code}`, value]));
      const seenValues = new Set<string>();
      const enabledByKey = new Map<string, boolean>();
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
        enabledByKey.set(key, unknownValue.enabled === true);
        if (code !== unknownValue.code || codeSystem !== unknownValue.codeSystem ||
            typeof unknownValue.label !== "string" || !unknownValue.label.trim() ||
            typeof unknownValue.sourceLabel !== "string" || !unknownValue.sourceLabel.trim() ||
            !(unknownValue.category === null || typeof unknownValue.category === "string") ||
            typeof unknownValue.enabled !== "boolean") findings.push(`${list.listId} value ${code} is malformed`);
        const baseValue = sourceValues.get(key);
        if (baseValue && (unknownValue.sourceLabel !== baseValue.sourceLabel || unknownValue.category !== baseValue.category))
          findings.push(`${list.listId} published code ${code} identity and source meaning cannot change`);
      }
      for (const key of sourceValues.keys()) if (!seenValues.has(key))
        findings.push(`${list.listId} published code ${key.split("\u0000")[1]} cannot be deleted or changed`);
      const defaultValue = unknownList.defaultValue;
      if (defaultValue !== null) {
        if (!isRecord(defaultValue) || typeof defaultValue.code !== "string" || typeof defaultValue.codeSystem !== "string" ||
            enabledByKey.get(`${defaultValue.codeSystem}\u0000${defaultValue.code}`) !== true)
          findings.push(`${list.listId} default must reference an enabled value`);
      }
    }
    if (seenLists.size !== sourceLists.length)
      findings.push("The draft must retain every agency-maintained or recommended code list");
    const digest = catalogDefinitionSha256(definition);
    return { valid: findings.length === 0, findings, definitionSha256: digest,
      projectionsVerified: findings.length === 0 && seen.size === source.length && seenLists.size === sourceLists.length };
  }

  private async project(manager: EntityManager, draft: DraftRow, releaseId: string): Promise<void> {
    const source = draft.source_release_id;
    await manager.query(`insert into catalog.group_definition select $2, group_id,parent_group_id,name,path,min_occurs,max_occurs,unbounded,repeating,definition
      from catalog.group_definition where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.element_definition
      (release_id,element_id,element_identity_id,section,name,description,national,state,usage,source_datatype,base_datatype,
       group_path,min_occurs,max_occurs,unbounded,nillable,supports_not_values,supports_pertinent_negatives,definition,agency_required)
      select $2,e.element_id,e.element_identity_id,e.section,e.name,e.description,e.national,e.state,e.usage,e.source_datatype,e.base_datatype,
       e.group_path,x.min_occurs,x.max_occurs,e.unbounded,x.nillable,x.supports_not_values,x.supports_pertinent_negatives,e.definition,x.agency_required
      from catalog.element_definition e join jsonb_to_recordset($3::jsonb) x(element_id text,min_occurs integer,max_occurs integer,
        nillable boolean,supports_not_values boolean,supports_pertinent_negatives boolean,agency_required boolean) on x.element_id=e.element_id
      where e.release_id=$1`, [source, releaseId, JSON.stringify(draft.canonical_definition.elements.map((e) => ({
        element_id:e.elementId,min_occurs:e.constraints.minOccurs,max_occurs:e.constraints.maxOccurs,nillable:e.constraints.nillable,
        supports_not_values:e.constraints.supportsNotValues,supports_pertinent_negatives:e.constraints.supportsPertinentNegatives,
        agency_required:e.agencyRequired })))]);
    await manager.query(`insert into catalog.element_option select $2,element_id,source_kind,code,display,code_system from catalog.element_option where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set select $2,value_set_id,name,classification,published_at,exhaustive,definition from catalog.value_set where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set_element select $2,value_set_id,element_id from catalog.value_set_element where release_id=$1`, [source, releaseId]);
    await manager.query(`insert into catalog.value_set_option
      (release_id,value_set_id,code,code_system,display,source_display,category)
      select $2,o.value_set_id,o.code,o.code_system,o.display,o.source_display,o.category
      from catalog.value_set_option o join catalog.value_set v
        on v.release_id=o.release_id and v.value_set_id=o.value_set_id
      where o.release_id=$1 and v.classification not in ('suggested', 'agency')`, [source, releaseId]);
    const projectedValues = draft.canonical_definition.codeLists.flatMap((list) => list.values.map((value, index) => ({
      value_set_id: list.listId, code: value.code, code_system: value.codeSystem, display: value.label,
      source_display: value.sourceLabel, category: value.category, enabled: value.enabled, sort_order: index,
      is_default: list.defaultValue?.code === value.code && list.defaultValue.codeSystem === value.codeSystem
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

  private saveBody(input: unknown): { expectedRevision: number; definition: CatalogDraftDefinition } {
    if (!isRecord(input) || !Number.isInteger(input.expectedRevision) || !isRecord(input.definition))
      throw new UnprocessableEntityException("expectedRevision and definition are required");
    return input as unknown as { expectedRevision: number; definition: CatalogDraftDefinition };
  }

  private publishBody(input: unknown): { expectedRevision: number; definitionSha256: string; changeNote: string } {
    if (!isRecord(input) || !Number.isInteger(input.expectedRevision) || typeof input.definitionSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.definitionSha256) || typeof input.changeNote !== "string" || !input.changeNote.trim())
      throw new UnprocessableEntityException("expectedRevision, validated definitionSha256, and changeNote are required");
    return { expectedRevision: input.expectedRevision as number, definitionSha256: input.definitionSha256,
      changeNote: input.changeNote.trim() };
  }

  private result(row: DraftRow): CatalogDraft {
    return { id: row.id, sourceReleaseId: row.source_release_id, revision: Number(row.revision),
      definitionSha256: row.definition_sha256, definition: row.canonical_definition,
      updatedAt: new Date(row.updated_at).toISOString() };
  }
}
