import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  compileValidationRule,
  explainValidationRule,
  formatOccurrenceSource,
  type ClinicianSession,
  type CompiledValidationBundle,
  type PublishedValidationVersion,
  type ValidationActivation,
  type ValidationCatalog,
  type ValidationDraft,
  type ValidationDraftResult,
  type ValidationRuleSource,
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type VersionRow = {
  id: string; organization_id: string; catalog_release_id: string; rule_id: string;
  revision: number; display_name: string; source_rule: ValidationRuleSource | ValidationRuleSource[];
  status: "draft" | "published"; version: number | null; compiled_bundle: CompiledValidationBundle | null;
  compiled_sha256: string | null; created_at: Date | string; updated_at: Date | string; published_at: Date | string | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UnprocessableEntityException("Request body must be an object");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, maximum = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new UnprocessableEntityException(`${name} must contain 1-${maximum} characters`);
  }
  return value.trim();
}

function uuidText(value: unknown, name: string): string {
  const text = requiredText(value, name, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new UnprocessableEntityException(`${name} must be a UUIDv4`);
  }
  return text;
}

function draft(row: VersionRow): ValidationDraft {
  const rules = Array.isArray(row.source_rule) ? row.source_rule : [row.source_rule];
  return { id: row.id, catalogReleaseId: row.catalog_release_id, revision: Number(row.revision),
    displayName: row.display_name, rules, updatedAt: new Date(row.updated_at).toISOString() };
}

@Injectable()
export class ValidationAuthoringService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async current(token: string): Promise<ValidationDraft | null> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<VersionRow[]>(`
      select * from validation.version where organization_id=$1 and status='draft' limit 1
    `, [session.organization.id]);
    return rows[0] ? draft(rows[0]) : null;
  }

  async create(token: string, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    const catalogReleaseId = uuidText(body.catalogReleaseId, "catalogReleaseId");
    const displayName = requiredText(body.displayName, "displayName", 120);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`validation-draft:${session.organization.id}`]);
      const existing = await manager.query<VersionRow[]>(
        "select * from validation.version where organization_id=$1 and status='draft'", [session.organization.id]);
      if (existing[0]) return draft(existing[0]);
      const catalogs = await manager.query<Array<{ id: string }>>(`
        select distinct cr.id from catalog.release cr
        join forms.form_version fv on fv.catalog_release_id=cr.id and fv.status='published'
        join forms.form f on f.id=fv.form_id and f.organization_id=$1
        where cr.id=$2 and cr.sealed
      `, [session.organization.id, catalogReleaseId]);
      if (!catalogs[0]) throw new UnprocessableEntityException("Validation drafts must bind to a published catalog available to the organization");
      const elements = await manager.query<Array<{ element_id: string; name: string; min_occurs: number;
        max_occurs: number | null; group_id: string; group_repeating: boolean }>>(`
        select e.element_id,e.name,e.min_occurs,e.max_occurs,e.group_path[array_length(e.group_path,1)] as group_id,
          coalesce(g.repeating,false) as group_repeating
        from catalog.element_definition e left join catalog.group_definition g
          on g.release_id=e.release_id and g.group_id=e.group_path[array_length(e.group_path,1)]
        where e.release_id=$1 order by e.element_id`, [catalogReleaseId]);
      if (!elements.length) throw new UnprocessableEntityException("The selected catalog has no elements");
      const versionId = randomUUID();
      const rules: ValidationRuleSource[] = elements.flatMap((element) => {
        const scope = element.group_repeating ? element.group_id : undefined;
        const minimum = element.min_occurs > 0 ? [{ id: randomUUID(), name: `${element.name} documented minimum`, enabled: true,
          severity: "error" as const, executionTargets: ["live", "sign"] as ValidationRuleSource["executionTargets"],
          primaryTargetElementId: element.element_id,
          message: `${element.name} requires at least ${element.min_occurs} documented occurrence(s)`,
          source: formatOccurrenceSource(element.element_id, "minimum", element.min_occurs, scope) }] : [];
        const maximum = element.max_occurs !== null ? [{ id: randomUUID(), name: `${element.name} documented maximum`, enabled: true,
          severity: "error" as const, executionTargets: ["live", "sign"] as ValidationRuleSource["executionTargets"],
          primaryTargetElementId: element.element_id,
          message: `${element.name} permits at most ${element.max_occurs} documented occurrence(s)`,
          source: formatOccurrenceSource(element.element_id, "maximum", element.max_occurs, scope) }] : [];
        return [...minimum, ...maximum];
      });
      if (!rules.length) {
        const element = elements[0]!;
        rules.push({ id: randomUUID(), name: `${element.name} documented minimum`, enabled: false, severity: "error",
          executionTargets: ["live", "sign"], primaryTargetElementId: element.element_id,
          message: `${element.name} has no documented minimum`, source: formatOccurrenceSource(element.element_id, "minimum", 0) });
      }
      await manager.query(`insert into validation.rule_identity(id,organization_id,created_by)
        select x.id,$1,$2 from jsonb_to_recordset($3::jsonb) x(id uuid)`,
      [session.organization.id, session.user.id, JSON.stringify(rules.map(({ id }) => ({ id })))]);
      const inserted = mutationRows<VersionRow>(await manager.query(`insert into validation.version
        (id,organization_id,catalog_release_id,rule_id,display_name,source_rule,created_by)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
      [versionId, session.organization.id, catalogReleaseId, rules[0]!.id, displayName, JSON.stringify(rules), session.user.id]));
      return draft(inserted[0]!);
    });
  }

  async save(token: string, id: string, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    }
    if (!Array.isArray(body.rules) || !body.rules.length) throw new UnprocessableEntityException("rules must contain at least one rule");
    const rules = body.rules.map((rule) => this.rule(rule));
    if (new Set(rules.map(({ id }) => id)).size !== rules.length) throw new UnprocessableEntityException("Rule identities must be unique");
    const displayName = requiredText(body.displayName, "displayName", 120);
    const identities = await this.dataSource.query<Array<{ id: string }>>(
      "select id from validation.rule_identity where organization_id=$1 and id=any($2::uuid[])",
      [session.organization.id, rules.map(({ id }) => id)]);
    if (identities.length !== rules.length) throw new UnprocessableEntityException("Rules must retain identities owned by the organization");
    const rows = mutationRows<VersionRow>(await this.dataSource.query(`with updated as (
      update validation.version set revision=revision+1,display_name=$4,source_rule=$5::jsonb,updated_at=now()
      where id=$1 and organization_id=$2 and status='draft' and revision=$3 returning *) select * from updated`,
    [id, session.organization.id, body.expectedRevision, displayName, JSON.stringify(rules)]));
    if (!rows[0]) throw new ConflictException("Validation draft revision is stale or the draft is no longer editable");
    return draft(rows[0]);
  }

  async validate(token: string, id: string): Promise<ValidationDraftResult> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<VersionRow[]>(
      "select * from validation.version where id=$1 and organization_id=$2", [id, session.organization.id]);
    if (!rows[0]) throw new NotFoundException(`Validation draft ${id} was not found`);
    return this.validateRow(this.dataSource.manager, rows[0]);
  }

  async publish(token: string, id: string, input: unknown): Promise<PublishedValidationVersion> {
    const session = await this.sessions.requireCapability(token, "validation:publish");
    const body = record(input);
    const changeNote = requiredText(body.changeNote, "changeNote");
    const displayName = requiredText(body.displayName, "displayName", 120);
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    }
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(
        "select * from validation.version where id=$1 and organization_id=$2 for update", [id, session.organization.id]);
      const row = rows[0];
      if (!row) throw new NotFoundException(`Validation draft ${id} was not found`);
      if (row.status !== "draft") throw new ConflictException("Published validation versions are immutable");
      if (Number(row.revision) !== Number(body.expectedRevision)) throw new ConflictException("Validation draft revision is stale");
      const validation = await this.validateRow(manager, row);
      if (!validation.valid || !validation.compiledBundle || !validation.compiledSha256) {
        throw new UnprocessableEntityException({ message: "Validation publication failed", diagnostics: validation.diagnostics });
      }
      const versions = await manager.query<Array<{ next_version: number }>>(
        "select coalesce(max(version),0)+1 as next_version from validation.version where organization_id=$1", [session.organization.id]);
      const published = mutationRows<VersionRow>(await manager.query(`with updated as (
        update validation.version set status='published',version=$4,display_name=$5,change_note=$6,
          compiled_bundle=$7::jsonb,compiled_sha256=$8,published_by=$9,published_at=now(),updated_at=now()
        where id=$1 and organization_id=$2 and status='draft' and revision=$3 returning *) select * from updated`,
      [id, session.organization.id, body.expectedRevision, Number(versions[0]!.next_version), displayName, changeNote,
        JSON.stringify(validation.compiledBundle), validation.compiledSha256, session.user.id]));
      if (!published[0]) throw new ConflictException("Validation draft changed during publication");
      return { id, organizationId: session.organization.id, catalogReleaseId: row.catalog_release_id,
        version: Number(published[0].version), displayName, status: "published", ruleIds: this.rowRules(row).map(({ id }) => id),
        compiledSha256: validation.compiledSha256, publishedAt: new Date(published[0].published_at!).toISOString() };
    });
  }

  async activate(token: string, id: string, input: unknown): Promise<ValidationActivation> {
    const session = await this.sessions.requireCapability(token, "validation:publish");
    const changeNote = requiredText(record(input).changeNote, "changeNote");
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`configuration:${session.organization.id}`]);
      const versions = await manager.query<VersionRow[]>(
        "select * from validation.version where id=$1 and organization_id=$2 and status='published'", [id, session.organization.id]);
      const version = versions[0];
      if (!version) throw new NotFoundException(`Published validation version ${id} was not found`);
      const active = await manager.query<Array<{ form_version_id: string; catalog_release_id: string }>>(`
        select d.form_version_id,fv.catalog_release_id from forms.agency_stationary_default d
        join forms.form_version fv on fv.id=d.form_version_id and fv.status='published'
        join forms.form f on f.id=fv.form_id and f.organization_id=d.organization_id
        where d.organization_id=$1 for update of d
      `, [session.organization.id]);
      if (!active[0] || active[0].catalog_release_id !== version.catalog_release_id) {
        throw new UnprocessableEntityException("The published validation version must bind to the active form's catalog");
      }
      const ruleElements = [...new Set(version.compiled_bundle!.rules.flatMap((rule) =>
        [rule.primaryTarget.elementId, ...(rule.references?.elementIds ?? [])]))];
      const exposed = await manager.query<Array<{ element_id: string }>>(`select distinct e.element_id
        from forms.form_field ff join catalog.element_definition e
          on e.release_id=$2 and e.element_identity_id=ff.catalog_element_identity_id
        where ff.form_version_id=$1 and e.element_id=any($3::text[])`,
      [active[0].form_version_id, version.catalog_release_id, ruleElements]);
      const exposedIds = new Set(exposed.map(({ element_id }) => element_id));
      const missing = ruleElements.filter((elementId) => !exposedIds.has(elementId));
      if (missing.length) throw new UnprocessableEntityException(`Active form does not expose referenced element${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`);
      const previous = await manager.query<Array<{ validation_version_id: string }>>(
        "select validation_version_id from validation.active_version where organization_id=$1", [session.organization.id]);
      const activated = mutationRows<{ activated_at: Date | string }>(await manager.query(`insert into validation.active_version
        (organization_id,validation_version_id,form_version_id,activated_by,change_note)
        values ($1,$2,$3,$4,$5) on conflict (organization_id) do update set
          validation_version_id=excluded.validation_version_id,form_version_id=excluded.form_version_id,
          activated_by=excluded.activated_by,change_note=excluded.change_note,activated_at=now()
        returning activated_at`, [session.organization.id, id, active[0].form_version_id, session.user.id, changeNote]));
      return { organizationId: session.organization.id, validationVersionId: id,
        catalogReleaseId: version.catalog_release_id, formVersionId: active[0].form_version_id,
        activatedAt: new Date(activated[0]!.activated_at).toISOString(),
        previousValidationVersionId: previous[0]?.validation_version_id ?? null };
    });
  }

  private async validateRow(manager: Pick<EntityManager, "query">, row: VersionRow): Promise<ValidationDraftResult> {
    const catalog = await this.validationCatalog(manager, row.catalog_release_id);
    const results = this.rowRules(row).map((rule) => compileValidationRule(rule, row.id, catalog));
    const diagnostics = results.flatMap(({ diagnostics }) => diagnostics);
    if (results.some(({ compiled }) => !compiled)) return { valid: false, diagnostics };
    const compiledBundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
      validationVersionId: row.id, catalogReleaseId: row.catalog_release_id, rules: results.map(({ compiled }) => compiled!) };
    return { valid: true, diagnostics, explanation: results.map(({ compiled }) => explainValidationRule(compiled!, catalog)).join("\n"), compiledBundle,
      compiledSha256: createHash("sha256").update(JSON.stringify(compiledBundle)).digest("hex") };
  }

  private async validationCatalog(manager: Pick<EntityManager, "query">, releaseId: string): Promise<ValidationCatalog> {
    const elements = await manager.query<Array<{ element_id: string; name?: string; base_datatype?: string; group_path: string[];
      min_occurs: number; max_occurs: number | null }>>(
      "select element_id,name,base_datatype,group_path,min_occurs,max_occurs from catalog.element_definition where release_id=$1", [releaseId]);
    const groups = await manager.query<Array<{ group_id: string; name: string; repeating: boolean; parent_group_id: string | null;
      min_occurs: number; max_occurs: number | null }>>(
      "select group_id,name,repeating,parent_group_id,min_occurs,max_occurs from catalog.group_definition where release_id=$1", [releaseId]);
    const codes = await manager.query<Array<{ element_id: string; code: string; code_system: string; label: string; enabled: boolean }>>(`
      select e.element_id,e.code,e.code_system,e.label,e.enabled from (
        select o.element_id,o.code,o.code_system,o.display as label,coalesce(c.enabled,true) as enabled
        from catalog.element_option o left join catalog.element_option_configuration c
          on c.release_id=o.release_id and c.element_id=o.element_id and c.source_kind=o.source_kind
          and c.code_system=o.code_system and c.code=o.code where o.release_id=$1
        union all
        select vse.element_id,o.code,o.code_system,o.display as label,coalesce(c.enabled,true) as enabled
        from catalog.value_set_element vse join catalog.value_set_option o
          on o.release_id=vse.release_id and o.value_set_id=vse.value_set_id
        left join catalog.value_set_option_configuration c
          on c.release_id=o.release_id and c.value_set_id=o.value_set_id and c.code_system=o.code_system and c.code=o.code
        where vse.release_id=$1
      ) e`, [releaseId]);
    return { elements: elements.map(({ element_id, name, base_datatype, group_path, min_occurs, max_occurs }) => ({
      elementId: element_id, label: name ?? element_id, baseDatatype: base_datatype ?? "string", groupPath: group_path,
      intrinsicOccurrence: { min: min_occurs, max: max_occurs ?? "unbounded" },
    })), groups: groups.map(({ group_id, name, repeating, parent_group_id, min_occurs, max_occurs }) => ({
      groupId: group_id, label: name, repeating, ...(parent_group_id ? { parentGroupId: parent_group_id } : {}),
      intrinsicOccurrence: { min: min_occurs, max: max_occurs ?? "unbounded" },
    })), codes: codes.map(({ element_id, code, code_system, label, enabled }) => ({
      elementId: element_id, code, codeSystem: code_system, label, enabled,
    })) };
  }

  private rule(value: unknown): ValidationRuleSource {
    const body = record(value);
    const severity = body.severity;
    const targets = body.executionTargets;
    if (!["error", "warning", "information"].includes(String(severity))) throw new UnprocessableEntityException("Invalid rule severity");
    if (!Array.isArray(targets) || targets.some((target) => !["live", "sign", "review"].includes(String(target)))) {
      throw new UnprocessableEntityException("Invalid execution target");
    }
    if (typeof body.enabled !== "boolean") throw new UnprocessableEntityException("rule.enabled must be a boolean");
    return { id: uuidText(body.id, "rule.id"), name: requiredText(body.name, "rule.name", 120),
      enabled: body.enabled, severity: severity as ValidationRuleSource["severity"],
      executionTargets: targets as ValidationRuleSource["executionTargets"],
      primaryTargetElementId: requiredText(body.primaryTargetElementId, "rule.primaryTargetElementId", 200),
      message: requiredText(body.message, "rule.message", 500), source: requiredText(body.source, "rule.source", 20_000) };
  }

  private rowRules(row: Pick<VersionRow, "source_rule">): ValidationRuleSource[] {
    return Array.isArray(row.source_rule) ? row.source_rule : [row.source_rule];
  }
}
