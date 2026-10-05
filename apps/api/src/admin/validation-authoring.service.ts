import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  compileValidationRule, compileMetricLibrary, readValidationDefinition, serializeValidationDefinition,
  type MetricSource, type ValidationDefinition,
  filterValidationRuleLibrary,
  validationRuleValidity,
  compiledValidationBundleSha256,
  evaluateValidationBundle,
  explainValidationRule,
  formatOccurrenceSource,
  isNemsisDemographicElementId,
  type ClinicianSession,
  type CatalogDraftCustomElement,
  type CompiledValidationBundle,
  type EncounterDocument,
  type FormDraftDefinition,
  type PublishedValidationVersion,
  type ValidationActivation,
  type ValidationCatalog,
  type ValidationDraft,
  type ValidationDraftResult,
  type ValidationHistoryEvent,
  type ValidationRuleChanges,
  type ValidationRuleSource,
  type ValidationDiagnostic,
  type AuthoringVersionOption, type ValidationRulePage,
  type ValidationRuleProvenance,
  type ValidationRuleSourceKind,
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { validationOccurrenceScope } from "@open-triage/contracts/validation-group-scope";
import { mutationRows } from "../database/mutation-result.js";
import { canonicalDefinitionSha256 } from "../forms/form-publication.validation.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { releaseCustomDefinitions } from "./custom-definition-version.js";

type VersionRow = {
  id: string; organization_id: string; catalog_release_id: string; rule_id: string;
  cloned_from_id: string | null;
  revision: number; display_name: string; source_rule: ValidationRuleSource | ValidationRuleSource[] | ValidationDefinition;
  status: "draft" | "published"; version: number | null; compiled_bundle: CompiledValidationBundle | null;
  source_sha256: string | null; compiled_sha256: string | null; created_at: Date | string;
  updated_at: Date | string; published_at: Date | string | null;
};

type MigratedForm = {
  id: string;
  canonical_definition: {
    sections?: Array<{ fields?: Array<{
      key?: string;
      source?: { kind?: string; elementId?: string };
      required?: boolean;
      rules?: Array<{ kind?: string; expression?: unknown }>;
    }> }>;
  };
};

type FormExpression =
  | { operator: "exists"; field: string }
  | { operator: "equals"; field: string; value: string | number | boolean | null }
  | { operator: "not"; condition: FormExpression }
  | { operator: "and" | "or"; conditions: FormExpression[] };

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

function draft(row: VersionRow, diagnostics?: ValidationDiagnostic[]): ValidationDraft {
  const { rules, metrics } = readValidationDefinition(row.source_rule);
  return { id: row.id, catalogReleaseId: row.catalog_release_id, clonedFromId: row.cloned_from_id ?? null,
    revision: Number(row.revision), displayName: row.display_name, rules, metrics,
    ...(diagnostics ? { diagnostics } : {}), updatedAt: new Date(row.updated_at).toISOString() };
}

const RULE_SOURCES = new Set<ValidationRuleSourceKind>(["agency", "nemsis", "catalog", "form", "platform"]);
const SMOKE_DOCUMENT: EncounterDocument = {
  $schema: "./encounter-document.schema-1.0.0.json", documentType: "open-triage.encounter", modelVersion: "1.1.0",
  dataModel: { standard: "NEMSIS", version: "smoke", dataset: "EMSDataSet" },
  formProfile: { id: "validation-publication-smoke", version: "1" },
  encounter: { id: "validation-publication-smoke", createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z" }, groups: [],
};

function sourceKind(rule: ValidationRuleSource): ValidationRuleSourceKind {
  return rule.sourceKind ?? (rule.provenance?.length ? "nemsis" : "agency");
}

function canonicalRule(rule: ValidationRuleSource): string {
  return JSON.stringify([rule.enabled, rule.severity, rule.executionTargets.includes("review") ? rule.reviewPriority ?? "medium" : null,
    [...rule.executionTargets].sort(), rule.primaryTargetElementId,
    rule.message.trim(), rule.source.trim().replace(/\s+/g, " ")]);
}

function literal(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Converts the bounded legacy Form predicate language into the Validation rule language. */
export function migrateFormExpression(expression: FormExpression,
  elementByField: ReadonlyMap<string, string>): string | null {
  switch (expression.operator) {
    case "exists": {
      const elementId = elementByField.get(expression.field);
      return elementId ? `present(${JSON.stringify(elementId)})` : null;
    }
    case "equals": {
      const elementId = elementByField.get(expression.field);
      if (!elementId || expression.value === null) return null;
      return `equals(${JSON.stringify(elementId)}, ${literal(expression.value)})`;
    }
    case "not": {
      const condition = migrateFormExpression(expression.condition, elementByField);
      return condition ? `not(${condition})` : null;
    }
    case "and":
    case "or": {
      const conditions = expression.conditions.map((condition) => migrateFormExpression(condition, elementByField));
      if (conditions.some((condition) => condition === null)) return null;
      const operation = expression.operator === "and" ? "all" : "any";
      return `${operation}(${conditions.join(", ")})`;
    }
  }
}

function ruleChanges(before: ValidationRuleSource[], after: ValidationRuleSource[]): ValidationRuleChanges {
  const previous = new Map(before.map((rule) => [rule.id, rule]));
  const currentIds = new Set(after.map(({ id }) => id));
  const additions: ValidationRuleChanges["additions"] = [];
  const modifications: ValidationRuleChanges["modifications"] = [];
  const disablements: ValidationRuleChanges["disablements"] = [];
  const executionTargetChanges: ValidationRuleChanges["executionTargetChanges"] = [];
  for (const rule of after) {
    const prior = previous.get(rule.id);
    if (!prior) { additions.push({ ruleId: rule.id, name: rule.name }); continue; }
    const fields: string[] = (["name", "severity", "reviewPriority", "primaryTargetElementId", "message", "source"] as const)
      .filter((field) => rule[field] !== prior[field]);
    if (prior.enabled !== rule.enabled) fields.push("enabled");
    if (fields.length) modifications.push({ ruleId: rule.id, fields });
    if (prior.enabled && !rule.enabled) disablements.push({ ruleId: rule.id });
    const beforeTargets = [...new Set(prior.executionTargets)].sort();
    const afterTargets = [...new Set(rule.executionTargets)].sort();
    if (JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets)) {
      executionTargetChanges.push({ ruleId: rule.id, before: beforeTargets, after: afterTargets });
    }
  }
  for (const prior of before) {
    if (!currentIds.has(prior.id) && prior.enabled) disablements.push({ ruleId: prior.id });
  }
  return { additions, modifications, disablements, executionTargetChanges };
}

function ruleAdvisories(rules: ValidationRuleSource[]): Map<string, ValidationDiagnostic[]> {
  const diagnostics = new Map<string, ValidationDiagnostic[]>();
  const add = (rule: ValidationRuleSource, code: ValidationDiagnostic["code"], message: string) => {
    const items = diagnostics.get(rule.id) ?? [];
    items.push({ severity: "warning", code, message, ruleId: rule.id });
    diagnostics.set(rule.id, items);
  };
  for (const rule of rules) if (!rule.localization?.sv?.name?.trim() || !rule.localization.sv.message?.trim())
    add(rule, "wording", "Swedish rule name or message is missing; English wording will be used.");
  const duplicates = new Map<string, ValidationRuleSource[]>();
  for (const rule of rules) {
    const key = canonicalRule(rule);
    const matching = duplicates.get(key) ?? [];
    matching.push(rule); duplicates.set(key, matching);
  }
  for (const matching of duplicates.values()) {
    for (let left = 0; left < matching.length; left += 1) for (let right = left + 1; right < matching.length; right += 1) {
      const first = matching[left]!; const second = matching[right]!;
      add(first, "exact-duplicate", `Exact duplicate of ${second.name}; it will execute only once.`);
      add(second, "exact-duplicate", `Exact duplicate of ${first.name}; it will execute only once.`);
    }
  }
  return diagnostics;
}

@Injectable()
export class ValidationAuthoringService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async current(token: string): Promise<ValidationDraft | null> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<VersionRow[]>(`
      select * from validation.version where organization_id=$1 and created_by=$2 and status='draft' limit 1
    `, [session.organization.id, session.user.id]);
    return rows[0] ? draft(rows[0]) : null;
  }

  async versions(token: string): Promise<AuthoringVersionOption[]> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<Array<{ id: string; display_name: string; version: number;
      catalog_release_id: string; active: boolean }>>(`
      select v.id,v.display_name,v.version,v.catalog_release_id,
        exists(select 1 from app_identity.active_configuration_bundle active
          where active.organization_id=$1 and active.validation_version_id=v.id) as active
      from validation.version v where v.organization_id=$1 and v.status='published'
      order by v.version desc,v.id desc
    `, [session.organization.id]);
    return rows.map((row) => ({ id: row.id, displayName: row.display_name, version: row.version,
      catalogReleaseId: row.catalog_release_id, status: row.active ? "active" : "published" }));
  }

  async library(token: string, query: Record<string, unknown>): Promise<ValidationRulePage> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<VersionRow[]>(`select * from validation.version
      where organization_id=$1 and created_by=$2 and status='draft' limit 1`, [session.organization.id, session.user.id]);
    const row = rows[0];
    if (!row) return { items: [], nextCursor: null, total: 0 };
    const catalog = await this.validationCatalog(this.dataSource.manager, row.catalog_release_id);
    const rules = this.rowRules(row);
    const advisories = ruleAdvisories(rules);
    const metrics = compileMetricLibrary(this.rowMetrics(row), row.id, catalog).metrics;
    const analyzed = rules.map((rule) => {
      const result = compileValidationRule(rule, row.id, catalog, metrics);
      const diagnostics = [...result.diagnostics, ...(advisories.get(rule.id) ?? [])];
      return { rule, source: sourceKind(rule), validity: validationRuleValidity(rule, Boolean(result.compiled), diagnostics),
        diagnostics };
    });
    const filtered = filterValidationRuleLibrary(analyzed, query)
      .sort((first, second) => first.rule.name.localeCompare(second.rule.name) || first.rule.id.localeCompare(second.rule.id));
    const requestedLimit = Number(query.limit ?? 25);
    const limit = query.limit === "all" ? filtered.length
      : Number.isSafeInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 25;
    let start = 0;
    if (typeof query.cursor === "string" && query.cursor) {
      try {
        const [name, id] = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as [string, string];
        const following = filtered.findIndex((item) => item.rule.name.localeCompare(name) > 0
          || (item.rule.name === name && item.rule.id.localeCompare(id) > 0));
        start = following < 0 ? filtered.length : following;
      } catch { throw new UnprocessableEntityException("cursor is invalid"); }
    }
    const items = filtered.slice(start, start + limit);
    const last = items.at(-1);
    const nextCursor = start + items.length < filtered.length && last
      ? Buffer.from(JSON.stringify([last.rule.name, last.rule.id])).toString("base64url") : null;
    return { items, nextCursor, total: filtered.length };
  }

  async create(token: string, input: unknown, options: { importedRules?: readonly unknown[]; importedMetrics?: readonly unknown[] } = {}): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    const catalogReleaseId = uuidText(body.catalogReleaseId, "catalogReleaseId");
    const displayName = requiredText(body.displayName, "displayName", 120);
    // Imported NEMSIS definitions have descriptive names longer than the editor
    // limit. Validate their structure, retaining the complete standard wording.
    const importedRules = options.importedRules?.map((rule) => this.rule(rule, 500, true));
    const importedMetrics = options.importedMetrics?.map((metric) => this.metric(metric)) ?? [];
    if (importedRules && !importedRules.length && !importedMetrics.length) throw new UnprocessableEntityException("rules must contain at least one rule");
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`validation-draft:${session.organization.id}:${session.user.id}`]);
      const existing = await manager.query<VersionRow[]>(
        "select * from validation.version where organization_id=$1 and created_by=$2 and status='draft'", [session.organization.id, session.user.id]);
      if (existing[0]) {
        if (importedRules) throw new ConflictException("Publish or discard the existing draft before importing");
        return draft(existing[0]);
      }
      const catalogs = await manager.query<Array<{ id: string; hidden_element_ids?: string[] }>>(`
        select distinct cr.id,cr.provenance->'hiddenElementIds' as hidden_element_ids from catalog.release cr
        where cr.id=$2 and cr.sealed and (
          exists(select 1 from catalog.authoring_draft d
            where d.organization_id=$1 and d.published_release_id=cr.id)
          or exists(select 1 from forms.form_version fv join forms.form f on f.id=fv.form_id
            where f.organization_id=$1 and fv.catalog_release_id=cr.id and fv.status='published'))
      `, [session.organization.id, catalogReleaseId]);
      if (!catalogs[0]) throw new UnprocessableEntityException("Validation drafts must bind to a published catalog available to the organization");
      const hiddenIds = new Set(catalogs[0].hidden_element_ids ?? []);
      const elements = await manager.query<Array<{ element_id: string; name: string; min_occurs: number;
        max_occurs: number | null; group_id: string;
        agency_required: boolean | null; agency_required_severity: "warning" | "error" | null }>>(`
        select e.element_id,e.name,e.min_occurs,e.max_occurs,e.agency_required,e.agency_required_severity,
          e.group_path[array_length(e.group_path,1)] as group_id
        from catalog.element_definition e
        where e.release_id=$1 order by e.element_id`, [catalogReleaseId]);
      if (!elements.length) throw new UnprocessableEntityException("The selected catalog has no elements");
      const groups = await manager.query<Array<{ group_id: string; repeating: boolean; parent_group_id: string | null; min_occurs: number }>>(
        "select group_id,repeating,parent_group_id,min_occurs from catalog.group_definition where release_id=$1", [catalogReleaseId]);
      const groupDefinitions = new Map(groups.map((group) => [group.group_id, { groupId: group.group_id, repeating: group.repeating,
        ...(group.parent_group_id ? { parentGroupId: group.parent_group_id } : {}), intrinsicOccurrence: { min: group.min_occurs } }]));
      const scopeFor = (element: { group_id: string }) => validationOccurrenceScope(element.group_id, groupDefinitions);
      const forms = await manager.query<MigratedForm[]>(`select fv.id,fv.canonical_definition
        from forms.form_version fv join forms.form f on f.id=fv.form_id
        join forms.agency_stationary_default active on active.organization_id=f.organization_id
          and active.form_version_id=fv.id
        where f.organization_id=$1 and fv.catalog_release_id=$2 and fv.status='published' limit 1`,
      [session.organization.id, catalogReleaseId]);
      const versionId = randomUUID();
      let rules: ValidationRuleSource[] = elements.filter((element) =>
        !isNemsisDemographicElementId(element.element_id)).flatMap((element) => {
        const scope = scopeFor(element);
        const required = element.agency_required === true ? [{ id: randomUUID(), name: `${element.name} agency required`, enabled: true,
          severity: element.agency_required_severity ?? "error" as const,
          executionTargets: ["live", "sign"] as ValidationRuleSource["executionTargets"], sourceKind: "catalog" as const,
          primaryTargetElementId: element.element_id, message: `${element.name} is required by agency policy`,
          source: formatOccurrenceSource(element.element_id, "minimum", 1, scope) }] : [];
        const minimum = element.min_occurs > 0 ? [{ id: randomUUID(), name: `${element.name} documented minimum`, enabled: true,
          severity: "error" as const, executionTargets: ["live", "sign"] as ValidationRuleSource["executionTargets"],
          sourceKind: "catalog" as const,
          primaryTargetElementId: element.element_id,
          message: `${element.name} requires at least ${element.min_occurs} documented occurrence(s)`,
          source: formatOccurrenceSource(element.element_id, "minimum", element.min_occurs, scope) }] : [];
        const maximum = element.max_occurs !== null ? [{ id: randomUUID(), name: `${element.name} documented maximum`, enabled: true,
          severity: "error" as const, executionTargets: ["live", "sign"] as ValidationRuleSource["executionTargets"],
          sourceKind: "catalog" as const,
          primaryTargetElementId: element.element_id,
          message: `${element.name} permits at most ${element.max_occurs} documented occurrence(s)`,
          source: formatOccurrenceSource(element.element_id, "maximum", element.max_occurs, scope) }] : [];
        return [...required, ...minimum, ...maximum].map((rule) =>
          hiddenIds.has(element.element_id) ? { ...rule, enabled: false } : rule);
      });
      const form = forms[0];
      if (form) {
        const fields = form.canonical_definition?.sections?.flatMap((section) => section.fields ?? []) ?? [];
        const elementByField = new Map(fields.flatMap((field) => field.key && field.source?.kind === "nemsis" && field.source.elementId
          ? [[field.key, field.source.elementId] as const] : []));
        for (const field of fields) {
          if (!field.key || field.source?.kind !== "nemsis" || !field.source.elementId) continue;
          const element = elements.find(({ element_id }) => element_id === field.source!.elementId);
          if (!element || isNemsisDemographicElementId(element.element_id)) continue;
          if (field.required) rules.push({ id: randomUUID(), name: `${element.name} form required`, enabled: true,
            severity: "error", executionTargets: ["live", "sign"], sourceKind: "form",
            primaryTargetElementId: element.element_id, message: `${element.name} is required by the form`,
            source: formatOccurrenceSource(element.element_id, "minimum", 1, scopeFor(element)) });
          for (const legacyRule of field.rules ?? []) {
            if (legacyRule.kind !== "requiredness" || !legacyRule.expression) continue;
            const condition = migrateFormExpression(legacyRule.expression as FormExpression, elementByField);
            if (!condition) continue;
            rules.push({ id: randomUUID(), name: `${element.name} conditional form requirement`, enabled: true,
              severity: "error", executionTargets: ["live", "sign"], sourceKind: "form",
              primaryTargetElementId: element.element_id,
              message: `${element.name} is required by its current form condition`,
              source: `for each(${JSON.stringify(scopeFor(element))})\nwhen ${condition}\nrequire present(${JSON.stringify(element.element_id)})` });
          }
        }
      }
      if (importedRules) rules = importedRules;
      if (!rules.length && !importedMetrics.length) {
        const element = elements[0]!;
        rules.push({ id: randomUUID(), name: `${element.name} documented minimum`, enabled: false, severity: "error", sourceKind: "catalog",
          executionTargets: ["live", "sign"], primaryTargetElementId: element.element_id,
          message: `${element.name} has no documented minimum`, source: formatOccurrenceSource(element.element_id, "minimum", 0, scopeFor(element)) });
      }
      const anchorId = rules[0]?.id ?? randomUUID();
      await manager.query(`insert into validation.rule_identity(id,organization_id,created_by)
        select x.id,$1,$2 from jsonb_to_recordset($3::jsonb) x(id uuid)`,
      [session.organization.id, session.user.id, JSON.stringify(rules.length ? rules.map(({ id }) => ({ id })) : [{ id: anchorId }])]);
      const inserted = mutationRows<VersionRow>(await manager.query(`insert into validation.version
        (id,organization_id,catalog_release_id,rule_id,display_name,source_rule,created_by)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
      [versionId, session.organization.id, catalogReleaseId, anchorId, displayName, JSON.stringify(serializeValidationDefinition(rules, importedMetrics)), session.user.id]));
      return draft(inserted[0]!);
    });
  }

  async clone(token: string, sourceId: string, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    const catalogReleaseId = uuidText(body.catalogReleaseId, "catalogReleaseId");
    const displayName = requiredText(body.displayName, "displayName", 120);
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`validation-draft:${session.organization.id}:${session.user.id}`]);
      const sources = await manager.query<VersionRow[]>(`select * from validation.version
        where id=$1 and organization_id=$2 and status='published'`, [sourceId, session.organization.id]);
      const source = sources[0];
      if (!source) throw new NotFoundException(`Published validation version ${sourceId} was not found`);
      const existing = await manager.query<VersionRow[]>(`select * from validation.version
        where organization_id=$1 and created_by=$2 and status='draft' for update`, [session.organization.id, session.user.id]);
      if (existing[0]) {
        if (existing[0].cloned_from_id !== sourceId || existing[0].catalog_release_id !== catalogReleaseId) {
          throw new ConflictException("A Validation draft already exists from another version or Catalog");
        }
        const validation = await this.validateRow(manager, existing[0]);
        return draft(existing[0], validation.diagnostics);
      }
      const catalogs = await manager.query<Array<{ id: string; hidden_element_ids?: string[] }>>(`
        select target.id,target.provenance->'hiddenElementIds' as hidden_element_ids from catalog.release target
        join catalog.release source on source.id=$3
        where target.id=$1 and target.sealed and target.loaded_at >= source.loaded_at and (
          exists (select 1 from catalog.authoring_draft d
            where d.organization_id=$2 and d.published_release_id=target.id)
          or exists (select 1 from forms.form_version fv join forms.form f on f.id=fv.form_id
            where f.organization_id=$2 and fv.catalog_release_id=target.id and fv.status='published')
        )
      `, [catalogReleaseId, session.organization.id, source.catalog_release_id]);
      if (!catalogs[0]) {
        throw new UnprocessableEntityException("The selected Catalog must be the same as or newer than the source and published for this organization");
      }
      const hiddenIds = new Set(catalogs[0].hidden_element_ids ?? []);
      const clonedRules = this.rowRules(source).map((rule) => hiddenIds.has(rule.primaryTargetElementId) ||
        [...hiddenIds].some((id) => rule.source.includes(`"${id}"`)) ? { ...rule, enabled: false } : rule);
      const inserted = mutationRows<VersionRow>(await manager.query(`insert into validation.version
        (id,organization_id,catalog_release_id,rule_id,display_name,source_rule,created_by,cloned_from_id)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) returning *`,
      [randomUUID(), session.organization.id, catalogReleaseId, source.rule_id, displayName,
        JSON.stringify(serializeValidationDefinition(clonedRules, this.rowMetrics(source))), session.user.id, source.id]));
      const validation = await this.validateRow(manager, inserted[0]!);
      return draft(inserted[0]!, validation.diagnostics);
    });
  }

  async delete(token: string, id: string, input: unknown): Promise<void> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const expectedRevision = record(input).expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1)
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`validation-draft:${session.organization.id}:${session.user.id}`]);
      const rows = await manager.query<VersionRow[]>(`select * from validation.version
        where id=$1 and organization_id=$2 and created_by=$3 and status='draft' for update`, [id, session.organization.id, session.user.id]);
      if (!rows[0]) throw new NotFoundException(`Validation draft ${id} was not found`);
      if (rows[0].revision !== expectedRevision)
        throw new ConflictException("Validation draft revision is stale");
      const deleted = mutationRows<Array<{ id: string }>[number]>(await manager.query(`delete from validation.version
        where id=$1 and organization_id=$2 and created_by=$4 and status='draft' and revision=$3 returning id`,
      [id, session.organization.id, expectedRevision, session.user.id]));
      if (!deleted[0]) throw new ConflictException("Validation draft revision is stale or the version was published");
    });
  }

  async history(token: string): Promise<ValidationHistoryEvent[]> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<Array<{
      id: string | number; actor_id: string; action: ValidationHistoryEvent["action"];
      source_version_id: string | null; destination_version_id: string; catalog_release_id: string;
      change_note: string; rule_changes: ValidationRuleChanges; source_sha256: string | null;
      compiled_sha256: string; occurred_at: Date | string;
    }>>(`select id,actor_id,action,source_version_id,destination_version_id,catalog_release_id,
      change_note,rule_changes,source_sha256,compiled_sha256,occurred_at
      from validation.change_event where organization_id=$1 order by occurred_at desc,id desc`,
    [session.organization.id]);
    return rows.map((row) => ({ id: String(row.id), actorId: row.actor_id, action: row.action,
      sourceVersionId: row.source_version_id, destinationVersionId: row.destination_version_id,
      catalogReleaseId: row.catalog_release_id, changeNote: row.change_note, ruleChanges: row.rule_changes,
      sourceSha256: row.source_sha256, compiledSha256: row.compiled_sha256,
      occurredAt: new Date(row.occurred_at).toISOString() }));
  }

  async save(token: string, id: string, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    }
    if (!Array.isArray(body.rules)) throw new UnprocessableEntityException("rules must contain at least one rule");
    const existingRows = await this.dataSource.query<VersionRow[]>(`select * from validation.version
      where id=$1 and organization_id=$2 and created_by=$3 and status='draft'`, [id, session.organization.id, session.user.id]);
    const existing = existingRows[0];
    if (!existing) throw new NotFoundException(`Validation draft ${id} was not found`);
    const metrics = body.metrics === undefined ? this.rowMetrics(existing) : this.parseMetrics(body.metrics, this.rowMetrics(existing));
    const existingRules = new Map(this.rowRules(existing).map((rule) => [rule.id, rule]));
    const rules = body.rules.map((value) => {
      const unchanged = value && typeof value === "object" && !Array.isArray(value)
        ? existingRules.get((value as Record<string, unknown>).id as string) : undefined;
      if (unchanged && JSON.stringify(value) === JSON.stringify(unchanged)) return unchanged;
      const parsed = this.rule(value);
      const prior = existingRules.get(parsed.id);
      const { provenance: _provenance, sourceKind: _source, ...editable } = parsed;
      return prior ? { ...editable, sourceKind: sourceKind(prior),
        ...(prior.provenance ? { provenance: prior.provenance } : {}) } : parsed;
    });
    if (new Set(rules.map(({ id }) => id)).size !== rules.length) throw new UnprocessableEntityException("Rule identities must be unique");
    const retainedIds = new Set(rules.map(({ id }) => id));
    if ([...existingRules.keys()].some((ruleId) => !retainedIds.has(ruleId))) {
      throw new UnprocessableEntityException("Existing rules must be disabled rather than removed from Validation history");
    }
    const displayName = requiredText(body.displayName, "displayName", 120);
    const identities = await this.dataSource.query<Array<{ id: string }>>(
      "select id from validation.rule_identity where organization_id=$1 and id=any($2::uuid[])",
      [session.organization.id, rules.map(({ id }) => id)]);
    if (identities.length !== rules.length) throw new UnprocessableEntityException("Rules must retain identities owned by the organization");
    const rows = mutationRows<VersionRow>(await this.dataSource.query(`with updated as (
      update validation.version set revision=revision+1,display_name=$4,source_rule=$5::jsonb,updated_at=now()
      where id=$1 and organization_id=$2 and created_by=$6 and status='draft' and revision=$3 returning *) select * from updated`,
    [id, session.organization.id, body.expectedRevision, displayName, JSON.stringify(serializeValidationDefinition(rules, metrics)), session.user.id]));
    if (!rows[0]) throw new ConflictException({ code: "admin.validationDraftStale", message: "Validation draft revision is stale or the draft is no longer editable" });
    return draft(rows[0]);
  }

  async createRule(token: string, id: string, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const body = record(input);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    }
    const candidate = this.rule({ ...body, provenance: undefined, id: randomUUID(), sourceKind: "agency" });
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(`select * from validation.version
        where id=$1 and organization_id=$2 and created_by=$3 and status='draft' for update`, [id, session.organization.id, session.user.id]);
      const row = rows[0];
      if (!row || Number(row.revision) !== expectedRevision) throw new ConflictException("Validation draft revision is stale or unavailable");
      await manager.query("insert into validation.rule_identity(id,organization_id,created_by) values ($1,$2,$3)",
        [candidate.id, session.organization.id, session.user.id]);
      const rules = [...this.rowRules(row), candidate];
      const updated = mutationRows<VersionRow>(await manager.query(`with updated as (update validation.version
        set revision=revision+1,source_rule=$3::jsonb,updated_at=now() where id=$1 and organization_id=$2 and created_by=$4 and status='draft' returning *) select * from updated`,
      [id, session.organization.id, JSON.stringify(serializeValidationDefinition(rules, this.rowMetrics(row))), session.user.id]));
      return draft(updated[0]!);
    });
  }

  async setRuleEnabled(token: string, id: string, ruleId: string, enabled: boolean, input: unknown): Promise<ValidationDraft> {
    const session = await this.sessions.requireCapability(token, "validation:write");
    const expectedRevision = Number(record(input).expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new UnprocessableEntityException("expectedRevision must be a positive integer");
    }
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const rows = await manager.query<VersionRow[]>(`select * from validation.version
        where id=$1 and organization_id=$2 and created_by=$3 and status='draft' for update`, [id, session.organization.id, session.user.id]);
      const row = rows[0];
      if (!row || Number(row.revision) !== expectedRevision) throw new ConflictException("Validation draft revision is stale or unavailable");
      let found = false;
      const rules = this.rowRules(row).map((rule) => rule.id === ruleId ? (found = true, { ...rule, enabled }) : rule);
      if (!found) throw new NotFoundException(`Validation rule ${ruleId} was not found`);
      const updated = mutationRows<VersionRow>(await manager.query(`with updated as (update validation.version
        set revision=revision+1,source_rule=$3::jsonb,updated_at=now() where id=$1 and organization_id=$2 and created_by=$4 and status='draft' returning *) select * from updated`,
      [id, session.organization.id, JSON.stringify(serializeValidationDefinition(rules, this.rowMetrics(row))), session.user.id]));
      return draft(updated[0]!);
    });
  }

  async validate(token: string, id: string): Promise<ValidationDraftResult> {
    const session = await this.sessions.requireCapability(token, "validation:read");
    const rows = await this.dataSource.query<VersionRow[]>(
      "select * from validation.version where id=$1 and organization_id=$2 and created_by=$3 and status='draft'", [id, session.organization.id, session.user.id]);
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
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`configuration:${session.organization.id}`]);
      const rows = await manager.query<VersionRow[]>(
        "select * from validation.version where id=$1 and organization_id=$2 and created_by=$3 for update", [id, session.organization.id, session.user.id]);
      const row = rows[0];
      if (!row) throw new NotFoundException(`Validation draft ${id} was not found`);
      if (row.status !== "draft") throw new ConflictException("Published validation versions are immutable");
      if (Number(row.revision) !== Number(body.expectedRevision)) throw new ConflictException("Validation draft revision is stale");
      const validation = await this.validateRow(manager, row);
      if (!validation.valid || !validation.compiledBundle || !validation.compiledSha256) {
        throw new UnprocessableEntityException({ message: "Validation publication failed", diagnostics: validation.diagnostics });
      }
      const sourceRules = this.rowRules(row);
      const sourceSha256 = createHash("sha256").update(JSON.stringify(serializeValidationDefinition(sourceRules, this.rowMetrics(row)))).digest("hex");
      const baselines = row.cloned_from_id ? await manager.query<VersionRow[]>(`select * from validation.version
        where id=$1 and organization_id=$2 and status='published'`, [row.cloned_from_id, session.organization.id]) : [];
      const changes = ruleChanges(baselines[0] ? this.rowRules(baselines[0]) : [], sourceRules);
      changes.metrics = metricChanges(baselines[0] ? this.rowMetrics(baselines[0]) : [], this.rowMetrics(row));
      const versions = await manager.query<Array<{ next_version: number }>>(
        "select coalesce(max(version),0)+1 as next_version from validation.version where organization_id=$1", [session.organization.id]);
      const published = mutationRows<VersionRow>(await manager.query(`with updated as (
        update validation.version set status='published',version=$4,display_name=$5,change_note=$6,
          source_sha256=$7,compiled_bundle=$8::jsonb,compiled_sha256=$9,published_by=$10,published_at=now(),updated_at=now()
        where id=$1 and organization_id=$2 and created_by=$11 and status='draft' and revision=$3 returning *) select * from updated`,
      [id, session.organization.id, body.expectedRevision, Number(versions[0]!.next_version), displayName, changeNote,
        sourceSha256, JSON.stringify(validation.compiledBundle), validation.compiledSha256, session.user.id, session.user.id]));
      if (!published[0]) throw new ConflictException("Validation draft changed during publication");
      await manager.query(`insert into validation.change_event
        (organization_id,actor_id,action,source_version_id,destination_version_id,catalog_release_id,
         change_note,rule_changes,source_sha256,compiled_sha256)
        values ($1,$2,'validation.publish',$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [session.organization.id, session.user.id, row.cloned_from_id, id, row.catalog_release_id,
        changeNote, JSON.stringify(changes), sourceSha256, validation.compiledSha256]);
      return { id, organizationId: session.organization.id, catalogReleaseId: row.catalog_release_id,
        version: Number(published[0].version), displayName, status: "published", ruleIds: sourceRules.map(({ id }) => id), metricIds: this.rowMetrics(row).map(({ id }) => id),
        sourceSha256, compiledSha256: validation.compiledSha256,
        publishedAt: new Date(published[0].published_at!).toISOString() };
    });
  }

  async activate(token: string, id: string, input: unknown): Promise<ValidationActivation> {
    const session = await this.sessions.requireCapability(token, "validation:publish");
    const body = record(input);
    const changeNote = requiredText(body.changeNote, "changeNote");
    const formVersionId = uuidText(body.formVersionId, "formVersionId");
    const catalogReleaseId = uuidText(body.catalogReleaseId, "catalogReleaseId");
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`configuration:${session.organization.id}`]);
      const targets = await manager.query<Array<VersionRow & {
        form_id: string; form_definition: FormDraftDefinition; form_definition_sha256: string;
        catalog_artifact_sha256: string; catalog_sealed: boolean;
      }>>(`
        select vv.*,fv.form_id,fv.canonical_definition as form_definition,
          fv.definition_sha256 as form_definition_sha256,
          cr.artifact_sha256 as catalog_artifact_sha256,cr.sealed as catalog_sealed
        from validation.version vv
        join catalog.release cr on cr.id=$4
        join forms.form_version fv on fv.id=$3 and fv.catalog_release_id=cr.id and fv.status='published'
        join forms.form f on f.id=fv.form_id and f.organization_id=vv.organization_id
        where vv.id=$1 and vv.organization_id=$2 and vv.status='published'
          and vv.catalog_release_id=cr.id
      `, [id, session.organization.id, formVersionId, catalogReleaseId]);
      let version = targets[0];
      if (!version) {
        throw new UnprocessableEntityException("Form, Catalog, and Validation must be published and bound to the same Catalog");
      }
      if (!version.catalog_sealed) throw new UnprocessableEntityException("The selected Catalog is not published");
      if (canonicalDefinitionSha256(version.form_definition) !== version.form_definition_sha256) {
        throw new UnprocessableEntityException("The published Form artifact digest does not match its content");
      }
      if (!version.compiled_bundle || !version.compiled_sha256) {
        throw new UnprocessableEntityException("The published Validation artifact is incomplete");
      }
      if (compiledValidationBundleSha256(version.compiled_bundle) !== version.compiled_sha256) {
        throw new UnprocessableEntityException("The published Validation artifact digest does not match its content");
      }
      const ruleElements = [...new Set(version.compiled_bundle!.rules
        .filter((rule) => rule.enabled && rule.executionTargets.some((target) => target === "live" || target === "sign"))
        .flatMap((rule) => [rule.primaryTarget.elementId, ...(rule.references?.elementIds ?? [])])
        .filter((elementId) => elementId !== "*"))];
      const exposed = await manager.query<Array<{ element_id: string }>>(`select distinct e.element_id
        from forms.form_field ff join catalog.element_definition e
          on e.release_id=$2 and e.element_identity_id=ff.catalog_element_identity_id
        where ff.form_version_id=$1 and e.element_id=any($3::text[])
        union
        select ced.namespace || '.' || ced.slug as element_id
        from forms.form_field ff join forms.custom_element_definition ced
          on ced.id=ff.custom_element_definition_id
        where ff.form_version_id=$1 and ced.namespace || '.' || ced.slug=any($3::text[])
        union
        select p.element_id from validation.platform_element_source p
        where p.catalog_release_id=$2 and p.element_id=any($3::text[])`,
      [formVersionId, catalogReleaseId, ruleElements]);
      const exposedIds = new Set(exposed.map(({ element_id }) => element_id));
      const missing = ruleElements.filter((elementId) => !exposedIds.has(elementId));
      if (missing.length) {
        const missingIds = new Set(missing);
        const affectedCompiled = version.compiled_bundle.rules.filter((rule) => rule.enabled
          && rule.executionTargets.some((target) => target === "live" || target === "sign")
          && [rule.primaryTarget.elementId, ...(rule.references?.elementIds ?? [])].some((element) => missingIds.has(element)));
        // Publication deduplicates equivalent rules. Include every matching source rule in consent.
        const sources = this.rowRules(version);
        const affectedKeys = new Set(sources.filter((rule) => affectedCompiled.some(({ ruleId }) => ruleId === rule.id)).map(canonicalRule));
        const impactedRules = sources.filter((rule) => affectedKeys.has(canonicalRule(rule)))
          .map((rule) => ({ id: rule.id, name: rule.name }));
        const approved = body.removeImpactedRuleIds;
        const expected = impactedRules.map(({ id }) => id).sort();
        if (!Array.isArray(approved) || approved.length !== expected.length
          || approved.some((value) => typeof value !== "string")
          || [...approved].sort().some((value, index) => value !== expected[index])) {
          throw new UnprocessableEntityException({ code: "admin.formValidationRemovalRequired",
            impactedRules, params: { count: impactedRules.length },
            message: "Confirm removal of validation rules that the selected form cannot supply" });
        }
        await this.sessions.requireCapability(token, "validation:write", manager);
        const removed = new Set(expected);
        const retainedSources = sources.filter((rule) => !removed.has(rule.id));
        const retainedDefinition = serializeValidationDefinition(retainedSources, this.rowMetrics(version));
        const nextId = randomUUID();
        const bundle: CompiledValidationBundle = { ...version.compiled_bundle, validationVersionId: nextId,
          ...(version.compiled_bundle.metrics ? { metrics: version.compiled_bundle.metrics.map((metric) => ({ ...metric, validationVersionId: nextId,
            ...(metric.applicabilityRule ? { applicabilityRule: { ...metric.applicabilityRule, validationVersionId: nextId } } : {}),
            predicates: Object.fromEntries(Object.entries(metric.predicates).map(([key, rule]) => [key, { ...rule, validationVersionId: nextId }])) })) } : {}),
          rules: version.compiled_bundle.rules.filter((rule) => !removed.has(rule.ruleId))
            .map((rule) => ({ ...rule, validationVersionId: nextId })) };
        const sourceSha256 = createHash("sha256").update(JSON.stringify(retainedDefinition)).digest("hex");
        const compiledSha256 = compiledValidationBundleSha256(bundle);
        const displayName = `${version.display_name.slice(0, 99)} (form compatibility)`;
        const inserted = mutationRows<VersionRow>(await manager.query(`insert into validation.version
          (id,organization_id,catalog_release_id,rule_id,cloned_from_id,version,status,display_name,
           source_rule,source_sha256,compiled_bundle,compiled_sha256,change_note,created_by,published_by,published_at)
          select $1,$2,$3,$4,$5,coalesce(max(version),0)+1,'published',$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$12,now()
          from validation.version where organization_id=$2 returning *`,
        [nextId, session.organization.id, catalogReleaseId, version.rule_id, id, displayName,
          JSON.stringify(retainedDefinition), sourceSha256, JSON.stringify(bundle), compiledSha256, changeNote, session.user.id]));
        await manager.query(`insert into validation.change_event
          (organization_id,actor_id,action,source_version_id,destination_version_id,catalog_release_id,
           change_note,rule_changes,source_sha256,compiled_sha256)
          values ($1,$2,'validation.publish',$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [session.organization.id, session.user.id, id, nextId, catalogReleaseId, changeNote,
          JSON.stringify(ruleChanges(sources, retainedSources)), sourceSha256, compiledSha256]);
        version = { ...version, ...inserted[0]!, compiled_bundle: bundle, compiled_sha256: compiledSha256,
          source_rule: retainedDefinition, source_sha256: sourceSha256 };
        id = nextId;
      } else if (Array.isArray(body.removeImpactedRuleIds) && body.removeImpactedRuleIds.length) {
        throw new ConflictException({ code: "admin.formValidationReviewChanged",
          message: "Validation compatibility changed; review activation again" });
      }
      const previous = await manager.query<Array<{
        form_version_id: string; catalog_release_id: string; validation_version_id: string;
        source_rule: ValidationRuleSource | ValidationRuleSource[] | ValidationDefinition;
      }>>(`select active.form_version_id,active.catalog_release_id,active.validation_version_id,previous.source_rule
        from app_identity.active_configuration_bundle active
        join validation.version previous on previous.id=active.validation_version_id
        where active.organization_id=$1 for update of active`, [session.organization.id]);
      const activated = mutationRows<{ activated_at: Date | string }>(await manager.query(`insert into app_identity.active_configuration_bundle
        (organization_id,form_version_id,catalog_release_id,validation_version_id,
         form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,
         activated_by,change_note)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (organization_id) do update set
          form_version_id=excluded.form_version_id,catalog_release_id=excluded.catalog_release_id,
          validation_version_id=excluded.validation_version_id,
          form_definition_sha256=excluded.form_definition_sha256,
          catalog_artifact_sha256=excluded.catalog_artifact_sha256,
          validation_compiled_sha256=excluded.validation_compiled_sha256,
          activated_by=excluded.activated_by,change_note=excluded.change_note,activated_at=now()
        returning activated_at`, [session.organization.id, formVersionId, catalogReleaseId, id,
        version.form_definition_sha256, version.catalog_artifact_sha256, version.compiled_sha256,
        session.user.id, changeNote]));
      await manager.query(`insert into forms.agency_stationary_default
        (organization_id,form_version_id,activated_by) values ($1,$2,$3)
        on conflict (organization_id) do update set form_version_id=excluded.form_version_id,
          activated_by=excluded.activated_by,activated_at=now()`,
      [session.organization.id, formVersionId, session.user.id]);
      await manager.query(`insert into validation.active_version
        (organization_id,validation_version_id,form_version_id,activated_by,change_note)
        values ($1,$2,$3,$4,$5) on conflict (organization_id) do update set
          validation_version_id=excluded.validation_version_id,form_version_id=excluded.form_version_id,
          activated_by=excluded.activated_by,change_note=excluded.change_note,activated_at=now()
        `, [session.organization.id, id, formVersionId, session.user.id, changeNote]);
      const changes = ruleChanges(previous[0] ? this.rowRules(previous[0]) : [], this.rowRules(version));
      changes.metrics = metricChanges(previous[0] ? this.rowMetrics(previous[0]) : [], this.rowMetrics(version));
      await manager.query(`insert into app_identity.configuration_event
        (organization_id,actor_id,action,result,form_version_id,catalog_release_id,validation_version_id,
         previous_form_version_id,previous_catalog_release_id,previous_validation_version_id,
         change_note,content_sha256,form_definition_sha256,catalog_artifact_sha256,
         validation_compiled_sha256,details)
        values ($1,$2,'configuration.activate','succeeded',$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13::jsonb)`,
      [session.organization.id, session.user.id, formVersionId, catalogReleaseId, id,
        previous[0]?.form_version_id ?? null, previous[0]?.catalog_release_id ?? null,
        previous[0]?.validation_version_id ?? null, changeNote, version.form_definition_sha256,
        version.catalog_artifact_sha256, version.compiled_sha256,
        JSON.stringify({ transition: previous[0] ? "reactivation" : "initial-activation",
          from: previous[0] ? { formVersionId: previous[0].form_version_id,
            catalogReleaseId: previous[0].catalog_release_id,
            validationVersionId: previous[0].validation_version_id } : null,
          to: { formVersionId, catalogReleaseId, validationVersionId: id } })]);
      await manager.query(`insert into validation.change_event
        (organization_id,actor_id,action,source_version_id,destination_version_id,catalog_release_id,
         change_note,rule_changes,source_sha256,compiled_sha256)
        values ($1,$2,'validation.activate',$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [session.organization.id, session.user.id, previous[0]?.validation_version_id ?? null, id,
        version.catalog_release_id, changeNote, JSON.stringify(changes), version.source_sha256, version.compiled_sha256]);
      return { organizationId: session.organization.id, validationVersionId: id,
        catalogReleaseId, formVersionId,
        formDefinitionSha256: version.form_definition_sha256,
        catalogArtifactSha256: version.catalog_artifact_sha256,
        validationCompiledSha256: version.compiled_sha256!,
        activatedAt: new Date(activated[0]!.activated_at).toISOString(),
        previousFormVersionId: previous[0]?.form_version_id ?? null,
        previousCatalogReleaseId: previous[0]?.catalog_release_id ?? null,
        previousValidationVersionId: previous[0]?.validation_version_id ?? null };
    });
  }

  private async validateRow(manager: Pick<EntityManager, "query">, row: VersionRow): Promise<ValidationDraftResult> {
    const catalog = await this.validationCatalog(manager, row.catalog_release_id);
    const rules = this.rowRules(row);
    const library = compileMetricLibrary(this.rowMetrics(row), row.id, catalog);
    const results = rules.map((rule) => {
      try { return compileValidationRule(rule, row.id, catalog, library.metrics); }
      catch (error) {
        return { compiled: undefined, diagnostics: [{ severity: "error" as const, code: "compile" as const, ruleId: rule.id,
          message: error instanceof Error ? `Rule compilation failed: ${error.message}` : "Rule compilation failed" }] };
      }
    });
    const advisories = ruleAdvisories(rules);
    const diagnostics = results.flatMap(({ diagnostics }, index) => diagnostics.map((item) => {
      if (!rules[index]!.enabled) return { ...item, severity: "warning" as const, message: `Disabled rule: ${item.message}` };
      if (item.code === "occurrence-bound") return { ...item, severity: "error" as const };
      return item;
    })).concat([...advisories.values()].flat(), library.diagnostics);
    if (results.some(({ compiled }, index) => rules[index]!.enabled && !compiled)
      || diagnostics.some(({ severity }) => severity === "error")) return { valid: false, diagnostics };
    const seen = new Set<string>();
    const compiledRules = results.flatMap(({ compiled }, index) => {
      if (!compiled) return [];
      const key = canonicalRule(rules[index]!);
      if (seen.has(key)) return [];
      seen.add(key); return [compiled];
    });
    const hasMetrics = this.rowMetrics(row).length > 0;
    const compiledBundle: CompiledValidationBundle = { schemaVersion: hasMetrics ? 2 : 1, languageVersion: hasMetrics ? "2.0.0" : "1.0.0",
      validationVersionId: row.id, catalogReleaseId: row.catalog_release_id, rules: compiledRules,
      ...(hasMetrics ? { metrics: library.metrics } : {}) };
    for (const rule of compiledRules.filter((rule) => rule.enabled && !rule.references.metricIds?.length)) {
      for (const target of rule.executionTargets) {
        try {
          evaluateValidationBundle({ ...compiledBundle, rules: [rule] }, SMOKE_DOCUMENT, target,
            { timestamp: "2000-01-01T00:00:00.000Z" });
        } catch (error) {
          diagnostics.push({ severity: "error", code: "smoke-evaluation", ruleId: rule.ruleId,
            message: error instanceof Error ? `Smoke evaluation failed: ${error.message}` : "Smoke evaluation failed" });
        }
      }
    }
    if (diagnostics.some(({ severity }) => severity === "error")) return { valid: false, diagnostics };
    return { valid: true, diagnostics, explanation: results.flatMap(({ compiled }) => compiled ? [explainValidationRule(compiled, catalog)] : []).join("\n"), compiledBundle,
      compiledSha256: compiledValidationBundleSha256(compiledBundle) };
  }

  private async validationCatalog(manager: Pick<EntityManager, "query">, releaseId: string): Promise<ValidationCatalog> {
    const pinnedCustomElements = await releaseCustomDefinitions(manager, releaseId);
    const customElements = pinnedCustomElements ?? (await manager.query<Array<{ definition: CatalogDraftCustomElement }>>(`
      select ced.definition from forms.custom_element_definition ced
      join catalog.release cr on cr.id=$1
      where ced.id::text in (select jsonb_array_elements_text(coalesce(cr.provenance->'customElementIds','[]'::jsonb)))
    `, [releaseId])).map(({ definition }) => definition);
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
          and c.code_system=o.code_system and c.code=o.code where o.release_id=$1 and o.source_kind='inline'
        union all
        select vse.element_id,o.code,o.code_system,o.display as label,coalesce(c.enabled,true) as enabled
        from catalog.value_set_element vse join catalog.value_set_option o
          on o.release_id=vse.release_id and o.value_set_id=vse.value_set_id
        left join catalog.value_set_option_configuration c
          on c.release_id=o.release_id and c.value_set_id=o.value_set_id and c.code_system=o.code_system and c.code=o.code
        where vse.release_id=$1
      ) e`, [releaseId]);
    return { elements: [...elements.map(({ element_id, name, base_datatype, group_path, min_occurs, max_occurs }) => ({
      elementId: element_id, label: name ?? element_id, baseDatatype: base_datatype ?? "string", groupPath: group_path,
      intrinsicOccurrence: { min: min_occurs, max: max_occurs ?? "unbounded" as const },
    })), ...customElements.filter((element) => !element.retired).map((element) => ({
      elementId: `${element.namespace}.${element.slug}`, label: element.title,
      baseDatatype: element.datatype === "number" ? "decimal" : element.datatype === "other" ? "string" : element.datatype,
      groupPath: [element.correlatesTo ?? "PatientCareReportGroup"],
      intrinsicOccurrence: { min: 0, max: element.recurrence === "single" ? 1 : "unbounded" as const },
    }))], groups: groups.map(({ group_id, name, repeating, parent_group_id, min_occurs, max_occurs }) => ({
      groupId: group_id, label: name, repeating, ...(parent_group_id ? { parentGroupId: parent_group_id } : {}),
      intrinsicOccurrence: { min: min_occurs, max: max_occurs ?? "unbounded" },
    })), codes: [...codes.map(({ element_id, code, code_system, label, enabled }) => ({
      elementId: element_id, code, codeSystem: code_system, label, enabled,
    })), ...customElements.flatMap((element) => element.datatype === "coded" && !element.retired
      ? element.choices.map((choice) => ({ elementId: `${element.namespace}.${element.slug}`,
        code: choice.code, codeSystem: element.codeSystem, label: choice.label, enabled: true })) : [])] };
  }

  private rule(value: unknown, nameMaximum = 120, imported = false): ValidationRuleSource {
    const body = record(value);
    const unresolved = body.unresolved;
    if (unresolved !== undefined && (!Array.isArray(unresolved) || unresolved.length > 50 || unresolved.some((value) => typeof value !== "string" || value.length > 2000)))
      throw new UnprocessableEntityException("Invalid unresolved rule mappings");
    const severity = body.severity;
    const targets = body.executionTargets;
    const reviewPriority = body.reviewPriority;
    if (!["none", "error", "warning", "information"].includes(String(severity))) throw new UnprocessableEntityException("Invalid rule severity");
    if (!Array.isArray(targets) || targets.some((target) => !["live", "sign", "review"].includes(String(target)))) {
      throw new UnprocessableEntityException("Invalid execution target");
    }
    if (reviewPriority !== undefined && !["none", "high", "medium", "low"].includes(String(reviewPriority)))
      throw new UnprocessableEntityException("Invalid review priority");
    if (typeof body.enabled !== "boolean") throw new UnprocessableEntityException("rule.enabled must be a boolean");
    const kind = body.sourceKind === undefined ? undefined : String(body.sourceKind);
    if (kind && !RULE_SOURCES.has(kind as ValidationRuleSourceKind)) throw new UnprocessableEntityException("Invalid rule source");
    let provenance: ValidationRuleProvenance[] | undefined;
    if (body.provenance !== undefined) {
      if (!Array.isArray(body.provenance)) throw new UnprocessableEntityException("rule.provenance must be an array");
      provenance = body.provenance.map((item) => {
        const value = record(item);
        return { ...value, standard: requiredText(value.standard, "rule.provenance.standard", 100),
          sourceIdentity: requiredText(value.sourceIdentity, "rule.provenance.sourceIdentity", 500),
          sourceRelease: requiredText(value.sourceRelease, "rule.provenance.sourceRelease", 100),
          originalExpression: requiredText(value.originalExpression, "rule.provenance.originalExpression", 20_000),
          originalMessage: requiredText(value.originalMessage, "rule.provenance.originalMessage", 20_000) } as ValidationRuleProvenance;
      });
    }
    let localization: ValidationRuleSource["localization"];
    if (body.localization !== undefined) {
      const value = record(body.localization);
      if (value.schemaVersion !== 1 || Object.keys(value).some((key) => !["schemaVersion", "sv"].includes(key)))
        throw new UnprocessableEntityException("rule.localization is malformed");
      const sv = value.sv === undefined ? undefined : record(value.sv);
      if (sv && Object.keys(sv).some((key) => !["name", "message", "reviewedSource"].includes(key)))
        throw new UnprocessableEntityException("rule.localization.sv is malformed");
      const reviewed = sv?.reviewedSource === undefined ? undefined : record(sv.reviewedSource);
      if (reviewed && Object.keys(reviewed).some((key) => !["name", "message"].includes(key)))
        throw new UnprocessableEntityException("rule.localization.sv.reviewedSource is malformed");
      const optional = (value: unknown, name: string, maximum: number) => {
        if (value === undefined || (imported && value === null)) return undefined;
        if (typeof value !== "string" || value.length > maximum) throw new UnprocessableEntityException(`${name} must be text`);
        return value;
      };
      localization = { schemaVersion: 1, ...(sv ? { sv: {
        ...(sv.name !== undefined ? { name: optional(sv.name, "rule.localization.sv.name", nameMaximum) } : {}),
        ...(sv.message !== undefined ? { message: optional(sv.message, "rule.localization.sv.message", 500) } : {}),
        ...(reviewed ? { reviewedSource: {
          ...(reviewed.name !== undefined ? { name: optional(reviewed.name, "rule.localization.sv.reviewedSource.name", nameMaximum) } : {}),
          ...(reviewed.message !== undefined ? { message: optional(reviewed.message, "rule.localization.sv.reviewedSource.message", 500) } : {}),
        } } : {}),
      } } : {}) };
    }
    let messageParameters: ValidationRuleSource["messageParameters"];
    if (body.messageParameters !== undefined) {
      const values = record(body.messageParameters);
      if (Object.keys(values).length > 32 || Object.entries(values).some(([key, value]) =>
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || key.length > 80 ||
        !(typeof value === "string" && value.length <= 500 || typeof value === "number" && Number.isFinite(value))))
        throw new UnprocessableEntityException("rule.messageParameters is malformed");
      messageParameters = values as ValidationRuleSource["messageParameters"];
    }
    return { id: uuidText(body.id, "rule.id"), name: requiredText(body.name, "rule.name", nameMaximum),
      ...(unresolved ? { unresolved: unresolved as string[] } : {}),
      enabled: body.enabled, severity: severity as ValidationRuleSource["severity"],
      ...(targets.includes("review") ? { reviewPriority: (reviewPriority ?? "medium") as ValidationRuleSource["reviewPriority"] } : {}),
      executionTargets: targets as ValidationRuleSource["executionTargets"],
      primaryTargetElementId: requiredText(body.primaryTargetElementId, "rule.primaryTargetElementId", 200),
      message: requiredText(body.message, "rule.message", 500), source: requiredText(body.source, "rule.source", 20_000),
      ...(kind ? { sourceKind: kind as ValidationRuleSourceKind } : {}), ...(provenance ? { provenance } : {}),
      ...(localization ? { localization } : {}), ...(messageParameters ? { messageParameters } : {}) };
  }

  private rowMetrics(row: Pick<VersionRow, "source_rule">): MetricSource[] {
    return readValidationDefinition(row.source_rule).metrics;
  }
  private metric(value: unknown): MetricSource {
    const body = record(value);
    if (typeof body.enabled !== "boolean" || typeof body.reviewEnabled !== "boolean")
      throw new UnprocessableEntityException("Metric enabled and reviewEnabled must be Boolean");
    if (body.unresolved !== undefined && (!Array.isArray(body.unresolved) || body.unresolved.length > 50 ||
      body.unresolved.some((value) => typeof value !== "string" || value.length > 2000)))
      throw new UnprocessableEntityException("Invalid unresolved metric mappings");
    const localization = body.localization === undefined ? undefined : record(body.localization);
    const sv = localization?.sv === undefined ? undefined : record(localization.sv);
    if (localization && (localization.schemaVersion !== 1 || sv && [sv.name, sv.description].some((value) =>
      value !== undefined && (typeof value !== "string" || value.length > 2000)))) throw new UnprocessableEntityException("Invalid metric localization");
    if (body.provenance !== undefined && (!Array.isArray(body.provenance) || body.provenance.length > 20 || body.provenance.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item) ||
      ["standard", "sourceIdentity", "sourceRelease", "originalExpression", "originalMessage"].some((key) => typeof item[key] !== "string" || !item[key].trim()) ||
      Object.values(item).some((value) => typeof value !== "string" || value.length > 20000))))
      throw new UnprocessableEntityException("Invalid metric provenance");
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 4000))
      throw new UnprocessableEntityException("Metric description must contain at most 4,000 characters");
    return { id: uuidText(body.id, "metric.id"), name: requiredText(body.name, "metric.name", 120),
      description: typeof body.description === "string" ? body.description : "",
      enabled: body.enabled, reviewEnabled: body.reviewEnabled, unit: requiredText(body.unit, "metric.unit", 64),
      source: requiredText(body.source, "metric.source", 16384),
      ...(body.applicability ? { applicability: requiredText(body.applicability, "metric.applicability", 16384) } : {}),
      ...(localization ? { localization: localization as unknown as MetricSource["localization"] } : {}),
      ...(body.provenance ? { provenance: body.provenance as MetricSource["provenance"] } : {}),
      ...(body.unresolved ? { unresolved: body.unresolved as string[] } : {}) };
  }
  private parseMetrics(value: unknown, previous: MetricSource[]): MetricSource[] {
    if (!Array.isArray(value) || value.length > 256) throw new UnprocessableEntityException("metrics must contain at most 256 definitions");
    const metrics = value.map((item) => {
      const metric = this.metric(item), prior = previous.find((item) => item.id === metric.id);
      return prior ? { ...metric, provenance: prior.provenance } : metric;
    });
    if (new Set(metrics.map((metric) => metric.id)).size !== metrics.length) throw new UnprocessableEntityException("Metric identities must be unique");
    if (previous.some((metric) => !metrics.some((item) => item.id === metric.id)))
      throw new UnprocessableEntityException("Existing metrics must be disabled rather than removed from Validation history");
    return metrics;
  }

  private rowRules(row: Pick<VersionRow, "source_rule">): ValidationRuleSource[] {
    return readValidationDefinition(row.source_rule).rules;
  }
}

function metricChanges(before: MetricSource[], after: MetricSource[]) {
  return { additions: after.filter((metric) => !before.some((prior) => prior.id === metric.id)).map((metric) => metric.id),
    modifications: after.filter((metric) => before.some((prior) => prior.id === metric.id && JSON.stringify(prior) !== JSON.stringify(metric))).map((metric) => metric.id),
    disablements: after.filter((metric) => !metric.enabled && before.some((prior) => prior.id === metric.id && prior.enabled)).map((metric) => metric.id) };
}
