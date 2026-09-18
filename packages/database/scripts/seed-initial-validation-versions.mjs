import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import {
  NEMSIS_351_EMS_BUILD,
  NEMSIS_351_EMS_NORMALIZATIONS,
  NEMSIS_351_EMS_RELEASE,
  NEMSIS_351_EMS_SOURCE_SHA256,
  compileValidationRule,
  formatOccurrenceSource,
  importNemsisEmsSchematron,
} from "@open-triage/contracts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schematronPath = path.resolve(scriptDirectory,
  "../../contracts/fixtures/nemsis-3.5.1/EMSDataSet.sch.xml");
const lockName = "open-triage-initial-validation-rollout-v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable UUIDv4-shaped identity used to make rollout retries harmless. */
export function rolloutUuid(...parts) {
  const digest = sha256(parts.join("\u001f"));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function literal(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function migrateFormExpression(expression, elementByField) {
  if (!expression || typeof expression !== "object") return null;
  if (expression.operator === "exists") {
    const elementId = elementByField.get(expression.field);
    return elementId ? `present(${JSON.stringify(elementId)})` : null;
  }
  if (expression.operator === "equals") {
    const elementId = elementByField.get(expression.field);
    return !elementId || expression.value === null ? null
      : `equals(${JSON.stringify(elementId)}, ${literal(expression.value)})`;
  }
  if (expression.operator === "not") {
    const condition = migrateFormExpression(expression.condition, elementByField);
    return condition ? `not(${condition})` : null;
  }
  if (expression.operator === "and" || expression.operator === "or") {
    if (!Array.isArray(expression.conditions)) return null;
    const conditions = expression.conditions.map((condition) => migrateFormExpression(condition, elementByField));
    if (conditions.some((condition) => condition === null)) return null;
    return `${expression.operator === "and" ? "all" : "any"}(${conditions.join(", ")})`;
  }
  return null;
}

function versionRules(target, elements, importedRules, availableElements) {
  const stableRule = (kind, key, rule) => ({
    ...rule,
    id: rolloutUuid("initial-validation-rule", target.organization_id, target.catalog_release_id, kind, key),
  });
  const rules = [];
  for (const element of elements) {
    const scope = element.group_repeating ? element.group_id : undefined;
    const enabled = availableElements.has(element.element_id);
    if (element.agency_required === true) rules.push(stableRule("catalog-agency", element.element_id, {
      name: `${element.name} agency required`, enabled,
      severity: element.agency_required_severity ?? "error", executionTargets: ["live", "sign"],
      sourceKind: "catalog", primaryTargetElementId: element.element_id,
      message: `${element.name} is required by agency policy`,
      source: formatOccurrenceSource(element.element_id, "minimum", 1),
    }));
    if (element.min_occurs > 0) rules.push(stableRule("catalog-minimum", element.element_id, {
      name: `${element.name} documented minimum`, enabled, severity: "error", executionTargets: ["live", "sign"],
      sourceKind: "catalog", primaryTargetElementId: element.element_id,
      message: `${element.name} requires at least ${element.min_occurs} documented occurrence(s)`,
      source: formatOccurrenceSource(element.element_id, "minimum", element.min_occurs, scope),
    }));
    if (element.max_occurs !== null) rules.push(stableRule("catalog-maximum", element.element_id, {
      name: `${element.name} documented maximum`, enabled, severity: "error", executionTargets: ["live", "sign"],
      sourceKind: "catalog", primaryTargetElementId: element.element_id,
      message: `${element.name} permits at most ${element.max_occurs} documented occurrence(s)`,
      source: formatOccurrenceSource(element.element_id, "maximum", element.max_occurs, scope),
    }));
  }

  const fields = target.canonical_definition?.sections?.flatMap((section) => section.fields ?? []) ?? [];
  const elementByField = new Map(fields.flatMap((field) => field.key && field.source?.kind === "nemsis"
    && field.source.elementId ? [[field.key, field.source.elementId]] : []));
  const elementById = new Map(elements.map((element) => [element.element_id, element]));
  for (const field of fields) {
    if (!field.key || field.source?.kind !== "nemsis" || !field.source.elementId) continue;
    const element = elementById.get(field.source.elementId);
    if (!element) continue;
    if (field.required) rules.push(stableRule("form-required", field.key, {
      name: `${element.name} form required`, enabled: true, severity: "error", executionTargets: ["live", "sign"],
      sourceKind: "form", primaryTargetElementId: element.element_id,
      message: `${element.name} is required by the form`,
      source: formatOccurrenceSource(element.element_id, "minimum", 1),
    }));
    for (const [position, legacyRule] of (field.rules ?? []).entries()) {
      if (legacyRule.kind !== "requiredness") continue;
      const condition = migrateFormExpression(legacyRule.expression, elementByField);
      if (!condition) continue;
      rules.push(stableRule("form-conditional", `${field.key}:${position}`, {
        name: `${element.name} conditional form requirement`, enabled: true, severity: "error",
        executionTargets: ["live", "sign"], sourceKind: "form", primaryTargetElementId: element.element_id,
        message: `${element.name} is required by its current form condition`,
        source: `when ${condition}\nrequire present(${JSON.stringify(element.element_id)})`,
      }));
    }
  }

  for (const imported of importedRules) {
    rules.push(stableRule("nemsis", imported.id, {
      ...imported,
      sourceKind: "nemsis",
      // Dynamic targets and rules whose inputs are not supplied by the current
      // Form remain visible and traceable, but cannot block live documentation.
      enabled: false,
    }));
  }
  return rules;
}

async function catalogFor(client, releaseId) {
  const elements = await client.query(`select e.element_id,e.name,e.base_datatype,e.group_path,e.min_occurs,e.max_occurs,
      e.agency_required,e.agency_required_severity,
      e.group_path[array_length(e.group_path,1)] as group_id,coalesce(g.repeating,false) as group_repeating
      from catalog.element_definition e left join catalog.group_definition g
        on g.release_id=e.release_id and g.group_id=e.group_path[array_length(e.group_path,1)]
      where e.release_id=$1 order by e.element_id`, [releaseId]);
  const groups = await client.query(`select group_id,name,repeating,parent_group_id,min_occurs,max_occurs
      from catalog.group_definition where release_id=$1`, [releaseId]);
  const codes = await client.query(`select o.element_id,o.code,o.code_system,o.display as label,coalesce(c.enabled,true) enabled
      from catalog.element_option o left join catalog.element_option_configuration c
        on c.release_id=o.release_id and c.element_id=o.element_id and c.source_kind=o.source_kind
       and c.code_system=o.code_system and c.code=o.code where o.release_id=$1
      union all
      select vse.element_id,o.code,o.code_system,o.display,coalesce(c.enabled,true)
      from catalog.value_set_element vse join catalog.value_set_option o
        on o.release_id=vse.release_id and o.value_set_id=vse.value_set_id
      left join catalog.value_set_option_configuration c
        on c.release_id=o.release_id and c.value_set_id=o.value_set_id
       and c.code_system=o.code_system and c.code=o.code where vse.release_id=$1`, [releaseId]);
  return {
    rows: elements.rows,
    catalog: {
      elements: elements.rows.map((element) => ({ elementId: element.element_id, label: element.name,
        baseDatatype: element.base_datatype, groupPath: element.group_path,
        intrinsicOccurrence: { min: element.min_occurs, max: element.max_occurs ?? "unbounded" } })),
      groups: groups.rows.map((group) => ({ groupId: group.group_id, label: group.name, repeating: group.repeating,
        ...(group.parent_group_id ? { parentGroupId: group.parent_group_id } : {}),
        intrinsicOccurrence: { min: group.min_occurs, max: group.max_occurs ?? "unbounded" } })),
      codes: codes.rows.map((code) => ({ elementId: code.element_id, code: code.code,
        codeSystem: code.code_system, label: code.label, enabled: code.enabled })),
    },
  };
}

async function seedTarget(client, target, importedRules) {
  const versionId = rolloutUuid("initial-validation-version", target.organization_id, target.catalog_release_id);
  const existing = await client.query(`select validation_version_id from app_identity.active_configuration_bundle
    where organization_id=$1`, [target.organization_id]);
  if (existing.rowCount) return { organizationId: target.organization_id, status: "already-active",
    validationVersionId: existing.rows[0].validation_version_id ?? versionId };

  const { rows: elements, catalog } = await catalogFor(client, target.catalog_release_id);
  const available = await client.query(`select e.element_id
    from forms.form_field field join catalog.element_definition e
      on e.release_id=$2 and e.element_identity_id=field.catalog_element_identity_id
    where field.form_version_id=$1
    union select element_id from validation.platform_element_source where catalog_release_id=$2`,
  [target.form_version_id, target.catalog_release_id]);
  const availableElements = new Set(available.rows.map(({ element_id }) => element_id));
  const rules = versionRules(target, elements, importedRules, availableElements);
  const compiledRules = [];
  for (const rule of rules) {
    const compiled = compileValidationRule(rule, versionId, catalog);
    if (!compiled.compiled) {
      if (rule.enabled) throw new Error(`Initial rule ${rule.name} cannot compile: ${compiled.diagnostics[0]?.message}`);
      continue;
    }
    const references = [compiled.compiled.primaryTarget.elementId, ...compiled.compiled.references.elementIds]
      .filter((elementId) => elementId !== "*");
    if (rule.sourceKind === "nemsis") {
      const compatible = compiled.compiled.primaryTarget.elementId !== "*"
        && references.every((elementId) => availableElements.has(elementId));
      rule.enabled = compatible;
      compiled.compiled.enabled = compatible;
    }
    compiledRules.push(compiled.compiled);
  }
  const compiledBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
    catalogReleaseId: target.catalog_release_id, rules: compiledRules };
  const sourceSha256 = sha256(JSON.stringify(rules));
  const compiledSha256 = sha256(JSON.stringify(compiledBundle));
  const nextVersion = Number((await client.query(`select coalesce(max(version),0)+1 next_version
    from validation.version where organization_id=$1`, [target.organization_id])).rows[0].next_version);

  await client.query(`insert into validation.rule_identity(id,organization_id,created_by)
    select x.id,$1,$2 from jsonb_to_recordset($3::jsonb) x(id uuid) on conflict (id) do nothing`,
  [target.organization_id, target.actor_id, JSON.stringify(rules.map(({ id }) => ({ id })))]);
  await client.query(`insert into validation.version
    (id,organization_id,catalog_release_id,rule_id,version,status,revision,display_name,source_rule,
     compiled_bundle,compiled_sha256,source_sha256,change_note,created_by,published_by,published_at)
    values ($1,$2,$3,$4,$5,'published',1,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$12,now())`,
  [versionId, target.organization_id, target.catalog_release_id, rules[0].id, nextVersion,
    `Initial Validation for ${target.catalog_version}`, JSON.stringify(rules), JSON.stringify(compiledBundle),
    compiledSha256, sourceSha256, "Initial rollout from current Catalog, Form, and NEMSIS rules", target.actor_id]);
  await client.query(`insert into validation.change_event
    (organization_id,actor_id,action,destination_version_id,catalog_release_id,change_note,rule_changes,source_sha256,compiled_sha256)
    values ($1,$2,'validation.publish',$3,$4,$5,$6::jsonb,$7,$8)`,
  [target.organization_id, target.actor_id, versionId, target.catalog_release_id,
    "Initial rollout from current Catalog, Form, and NEMSIS rules",
    JSON.stringify({ additions: rules.map(({ id, name }) => ({ ruleId: id, name })), modifications: [], disablements: [], executionTargetChanges: [] }),
    sourceSha256, compiledSha256]);
  await client.query(`insert into app_identity.active_configuration_bundle
    (organization_id,form_version_id,catalog_release_id,validation_version_id,form_definition_sha256,
     catalog_artifact_sha256,validation_compiled_sha256,activated_by,change_note)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [target.organization_id, target.form_version_id, target.catalog_release_id, versionId,
    target.form_definition_sha256, target.catalog_artifact_sha256, compiledSha256, target.actor_id,
    "Activate initial Validation rollout"]);
  await client.query(`insert into validation.active_version
    (organization_id,validation_version_id,form_version_id,activated_by,change_note)
    values ($1,$2,$3,$4,$5) on conflict (organization_id) do update set
      validation_version_id=excluded.validation_version_id,form_version_id=excluded.form_version_id,
      activated_by=excluded.activated_by,change_note=excluded.change_note,activated_at=now()`,
  [target.organization_id, versionId, target.form_version_id, target.actor_id, "Activate initial Validation rollout"]);
  await client.query(`insert into validation.change_event
    (organization_id,actor_id,action,destination_version_id,catalog_release_id,change_note,rule_changes,source_sha256,compiled_sha256)
    values ($1,$2,'validation.activate',$3,$4,$5,'{}'::jsonb,$6,$7)`,
  [target.organization_id, target.actor_id, versionId, target.catalog_release_id,
    "Activate initial Validation rollout", sourceSha256, compiledSha256]);
  return { organizationId: target.organization_id, status: "seeded", validationVersionId: versionId,
    rules: rules.length, enabledRules: rules.filter(({ enabled }) => enabled).length };
}

export async function seedInitialValidationVersions({ databaseUrl = process.env.DATABASE_URL,
  Client = pg.Client, log = console } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to seed initial Validation versions");
  const schematron = await readFile(schematronPath, "utf8");
  const imported = importNemsisEmsSchematron(schematron, NEMSIS_351_EMS_NORMALIZATIONS, {
    release: NEMSIS_351_EMS_RELEASE, build: NEMSIS_351_EMS_BUILD, sha256: NEMSIS_351_EMS_SOURCE_SHA256,
  });
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
    const targets = await client.query(`select d.organization_id,d.form_version_id,fv.catalog_release_id,
      fv.canonical_definition,fv.definition_sha256 form_definition_sha256,
      cr.artifact_sha256 catalog_artifact_sha256,cr.version catalog_version,d.activated_by actor_id
      from forms.agency_stationary_default d join forms.form_version fv on fv.id=d.form_version_id
      join catalog.release cr on cr.id=fv.catalog_release_id
      where fv.status='published' and cr.sealed order by d.organization_id`);
    const outcomes = [];
    for (const target of targets.rows) {
      await client.query("begin isolation level serializable");
      try {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`configuration:${target.organization_id}`]);
        outcomes.push(await seedTarget(client, target, imported.rules));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    const result = { event: "initial_validation_rollout", applicableCatalogs: targets.rowCount,
      seeded: outcomes.filter(({ status }) => status === "seeded").length, outcomes };
    log.info(JSON.stringify(result));
    return result;
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]); } finally { await client.end(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedInitialValidationVersions();
}
