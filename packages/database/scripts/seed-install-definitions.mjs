import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { FormAuthoringService } from "../../../apps/api/dist/admin/form-authoring.service.js";
import { ValidationAuthoringService } from "../../../apps/api/dist/admin/validation-authoring.service.js";
import { FormPublicationService } from "../../../apps/api/dist/forms/form-publication.service.js";
import { canonicalDefinitionSha256, validateCanonicalFormDefinition } from "../../../apps/api/dist/forms/form-publication.validation.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const definitionsRoot = path.join(repository, "defines");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stable(item)]));
}

function ruleFingerprint(rules) {
  return createHash("sha256").update(JSON.stringify(stable(rules.map(({ id: _id, ...rule }) => rule)))).digest("hex");
}

function templateRules(template, organizationId) {
  return template.validationRules.map((rule) => ({ ...rule,
    id: versionedUuid("install-rule", template.key, organizationId, rule.id) }));
}

function versionedUuid(...parts) {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function dataSource(client) {
  const query = async (sql, parameters) => (await client.query(sql, parameters)).rows;
  return {
    query,
    manager: { query },
    async transaction(isolation, work) {
      if (isolation !== "SERIALIZABLE") throw new Error(`Unexpected isolation level ${isolation}`);
      await client.query("begin isolation level serializable");
      try {
        const value = await work({ query });
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    },
  };
}

async function publishedPair(source, organizationId, catalogReleaseId, templateName) {
  const rows = await source.query(`select fv.id as form_id,fv.catalog_release_id,fv.canonical_definition,
      vv.id as validation_id,vv.source_rule
    from forms.form_version fv join forms.form f on f.id=fv.form_id
    join validation.version vv on vv.organization_id=f.organization_id
      and vv.catalog_release_id=fv.catalog_release_id and vv.status='published'
    where f.organization_id=$1 and fv.status='published' and fv.catalog_release_id=$2
      and fv.display_name=$3 and vv.display_name=$3
    order by fv.published_at desc,vv.published_at desc limit 1`, [organizationId, catalogReleaseId, templateName]);
  return rows[0];
}

async function seedOne(source, template, target) {
  const templateName = template.name;
  const note = `Install ${template.name} as an inactive configuration option`;
  const organizationId = target.organization_id;
  const expectedFormHash = canonicalDefinitionSha256(template.formDefinition);
  const expectedRuleHash = ruleFingerprint(template.validationRules);
  const catalogReleaseId = target.catalog_release_id;
  const existingPair = await publishedPair(source, organizationId, catalogReleaseId, templateName);
  if (existingPair) {
    if (canonicalDefinitionSha256(existingPair.canonical_definition) !== expectedFormHash
        || ruleFingerprint(existingPair.source_rule) !== expectedRuleHash) {
      throw new Error(`A different ${templateName} published pair exists for organization ${organizationId}`);
    }
    return { organizationId, status: "already-available", formVersionId: existingPair.form_id,
      validationVersionId: existingPair.validation_id };
  }
  if (template.catalogKey !== "nemsis-3.5.1"
      || target.catalog_standard !== "NEMSIS" || target.catalog_version !== "3.5.1") {
    return { organizationId, status: "requires-base-nemsis-configuration" };
  }
  try {
    validateCanonicalFormDefinition(target.form_definition);
  } catch {
    return { organizationId, status: "requires-valid-baseline-form" };
  }
  const demographics = await source.query(`select exists(select 1 from app_identity.agency_demographic_version
    where organization_id=$1 and catalog_release_id=$2 and effective_from<=now()) as available`,
  [organizationId, target.catalog_release_id]);
  if (!demographics[0]?.available) return { organizationId, status: "requires-agency-demographics" };
  const drafts = await source.query(`select
      exists(select 1 from forms.form_version fv join forms.form f on f.id=fv.form_id
        where f.organization_id=$1 and fv.status='draft') as form,
      exists(select 1 from validation.version where organization_id=$1 and status='draft') as validation`,
  [organizationId]);
  if (Object.values(drafts[0]).some(Boolean)) {
    return { organizationId, status: "draft-in-progress", drafts: drafts[0] };
  }

  const sessions = { requireCapability: async () => ({ organization: { id: organizationId },
    user: { id: target.actor_id }, capabilities: ["forms:read", "forms:write", "forms:publish", "validation:read", "validation:write",
      "validation:publish"] }) };
  const forms = new FormAuthoringService(source, sessions, new FormPublicationService(source));
  const validations = new ValidationAuthoringService(source, sessions);
  const token = "installation-template";
  const formRows = await source.query(`select fv.id,fv.canonical_definition
    from forms.form_version fv join forms.form f on f.id=fv.form_id
    where f.organization_id=$1 and fv.status='published' and fv.display_name=$2
      and fv.catalog_release_id=$3 order by fv.published_at desc limit 1`,
  [organizationId, templateName, catalogReleaseId]);
  let formVersionId = formRows[0]?.id;
  if (formVersionId) {
    if (canonicalDefinitionSha256(formRows[0].canonical_definition) !== expectedFormHash)
      throw new Error(`A different ${templateName} form exists for organization ${organizationId}`);
  } else {
    const draft = await forms.clone(token, { catalogReleaseId, sourceVersionId: target.form_version_id,
      displayName: templateName });
    const saved = await forms.save(token, draft.id, { expectedRevision: draft.revision,
      displayName: templateName, definition: template.formDefinition });
    const published = await forms.publish(token, saved.id, { expectedRevision: saved.revision,
      definitionSha256: saved.definitionSha256, displayName: templateName, changeNote: note });
    formVersionId = published.id;
  }

  const validationRows = await source.query(`select id,source_rule from validation.version
    where organization_id=$1 and catalog_release_id=$2 and status='published' and display_name=$3
    order by published_at desc limit 1`, [organizationId, catalogReleaseId, templateName]);
  let validationVersionId = validationRows[0]?.id;
  if (validationVersionId) {
    if (ruleFingerprint(validationRows[0].source_rule) !== expectedRuleHash)
      throw new Error(`Different ${templateName} rules exist for organization ${organizationId}`);
  } else {
    const rules = templateRules(template, organizationId);
    validationVersionId = randomUUID();
    await source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`validation-draft:${organizationId}`]);
      const existing = await manager.query(`select id from validation.version where organization_id=$1 and status='draft'`,
        [organizationId]);
      if (existing.length) throw new Error(`Validation draft appeared for organization ${organizationId}`);
      await manager.query(`insert into validation.rule_identity(id,organization_id,created_by)
        select x.id,$1,$2 from jsonb_to_recordset($3::jsonb) x(id uuid)
        on conflict (id) do nothing`, [organizationId, target.actor_id,
        JSON.stringify(rules.map(({ id }) => ({ id })))]);
      await manager.query(`insert into validation.version
        (id,organization_id,catalog_release_id,rule_id,display_name,source_rule,created_by)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [validationVersionId, organizationId,
        catalogReleaseId, rules[0].id, templateName, JSON.stringify(rules), target.actor_id]);
    });
    await validations.publish(token, validationVersionId, { expectedRevision: 1,
      displayName: templateName, changeNote: note });
  }
  return { organizationId, status: "available", catalogReleaseId, formVersionId,
    validationVersionId, activated: false };
}

export async function readInstallOptions(root = definitionsRoot) {
  const catalog = JSON.parse(await readFile(path.join(root, "catalog", "catalog_nemsis-3.5.1.json"), "utf8"));
  if (catalog.schemaVersion !== "1.0.0" || catalog.release !== "3.5.1"
      || catalog.dataset !== "EMSDataSet" || !Array.isArray(catalog.elements)) {
    throw new Error("The NEMSIS 3.5.1 catalog definition is invalid");
  }
  const files = (await readdir(path.join(root, "forms"))).filter((file) => /^form_.+\.json$/.test(file)).sort();
  const options = [];
  let defaultCount = 0;
  for (const file of files) {
    const key = file.slice("form_".length, -".json".length);
    const form = JSON.parse(await readFile(path.join(root, "forms", file), "utf8"));
    const validation = JSON.parse(await readFile(path.join(root, "validation", `validation_${key}.json`), "utf8"));
    if (form.schemaVersion !== 1 || validation.schemaVersion !== 1 || form.key !== validation.key
        || form.catalogKey !== validation.catalogKey || validation.formKey !== form.key
        || form.catalogKey !== "nemsis-3.5.1"
        || !Array.isArray(form.definition?.sections) || !Array.isArray(validation.rules)) {
      throw new Error(`Invalid installation definition pair: ${file}`);
    }
    if (form.default) {
      defaultCount += 1;
      if (form.key !== "nemsis-full" || form.catalogKey !== "nemsis-3.5.1") {
        throw new Error("NEMSIS full must be the default installation definition");
      }
      continue;
    }
    options.push({ key: form.key, name: form.name, catalogKey: form.catalogKey,
      formDefinition: form.definition, validationRules: validation.rules });
  }
  if (defaultCount !== 1) throw new Error("Exactly one NEMSIS full default form is required");
  return options;
}

export async function seedInstallDefinitions({ databaseUrl = process.env.DATABASE_URL,
  organizationId, Client = pg.Client, log = console } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const options = await readInstallOptions();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const source = dataSource(client);
    const targets = await source.query(`select active.organization_id,active.form_version_id,
        active.catalog_release_id,active.activated_by as actor_id,cr.standard as catalog_standard,
        cr.version as catalog_version,fv.canonical_definition as form_definition
      from app_identity.active_configuration_bundle active
      join catalog.release cr on cr.id=active.catalog_release_id and cr.sealed
      join forms.form_version fv on fv.id=active.form_version_id and fv.status='published'
      where ($1::uuid is null or active.organization_id=$1)
      order by active.organization_id`, [organizationId ?? null]);
    const outcomes = [];
    for (const target of targets) for (const option of options) {
      outcomes.push({ key: option.key, ...await seedOne(source, option, target) });
    }
    log.info(JSON.stringify({ event: "install_definitions", outcomes }));
    return outcomes;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const idArgument = process.argv.indexOf("--organization-id");
  if (idArgument >= 0 && !process.argv[idArgument + 1]) throw new Error("--organization-id requires a UUID");
  await seedInstallDefinitions({ organizationId: idArgument >= 0 ? process.argv[idArgument + 1] : undefined });
}
