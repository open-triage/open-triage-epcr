import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { createPasswordVerifier } from "../../../apps/api/dist/identity/password.js";
import { applyMigrations, readMigrations } from "./migrate.mjs";
import { syntheticStationaryDefinition } from "./synthetic-stationary-definition.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to bootstrap demonstration fixture accounts");

const accounts = Object.freeze([
  {
    id: SYNTHETIC_DEMO_FIXTURE.userId,
    username: SYNTHETIC_DEMO_FIXTURE.username,
    displayName: "Demo",
    roles: ["demo"],
  },
]);

const baselineFormId = "33000000-0000-4000-8000-000000000001";
const baselineFormVersionId = "34000000-0000-4000-8000-000000000001";
const completeBaselineFormId = "33000000-0000-4000-8000-000000000002";
const completeBaselineFormVersionId = "34000000-0000-4000-8000-000000000002";
const baselineDemographicId = "35000000-0000-4000-8000-000000000001";
const baselineUnitId = "36000000-0000-4000-8000-000000000001";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

async function ensureBaselineConfiguration(client, actorId) {
  const definition = await syntheticStationaryDefinition();
  const definitionSha256 = sha256(definition);
  const active = await client.query(`select active.form_version_id, version.form_id, version.definition_sha256,
      version.catalog_release_id
    from forms.agency_stationary_default active
    join forms.form_version version on version.id = active.form_version_id
    where active.organization_id = $1`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId],
  );
  if (active.rows[0]?.definition_sha256 === definitionSha256) {
    return { created: false, upgraded: false, formVersionId: active.rows[0].form_version_id };
  }
  if (active.rows[0] && active.rows[0].form_version_id !== baselineFormVersionId) {
    return { created: false, upgraded: false, formVersionId: active.rows[0].form_version_id };
  }

  const release = await client.query(`select id from catalog.release
    where standard = 'NEMSIS' and version = '3.5.1' and dataset = 'EMSDataSet' and sealed
    limit 1`);
  if (!release.rows[0]) throw new Error("Load the sealed NEMSIS 3.5.1 EMSDataSet catalog before bootstrapping the demo configuration");
  const catalogReleaseId = release.rows[0].id;
  const existing = await client.query(`select fv.id, fv.definition_sha256
    from forms.form_version fv join forms.form f on f.id = fv.form_id
    where f.organization_id = $1 and fv.status = 'published' and fv.definition_sha256 = $2
    order by fv.published_at desc, fv.version desc limit 1`,
  [SYNTHETIC_DEMO_FIXTURE.organizationId, definitionSha256]);
  let formVersionId = existing.rows[0]?.id;
  let created = false;
  const upgraded = Boolean(active.rows[0]);

  if (!formVersionId) {
    const formId = upgraded ? completeBaselineFormId : baselineFormId;
    formVersionId = upgraded ? completeBaselineFormVersionId : baselineFormVersionId;
    await client.query(`insert into forms.form (id, organization_id, slug, name)
      values ($1, $2, $3, 'Stationary') on conflict (id) do nothing`,
    [formId, SYNTHETIC_DEMO_FIXTURE.organizationId, upgraded ? "stationary-complete" : "stationary"]);
    const inserted = await client.query(`insert into forms.form_version
      (id, form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
       created_by, display_name)
      values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, $6, 'Stationary')
      on conflict (id) do nothing returning id`,
    [formVersionId, formId, catalogReleaseId, JSON.stringify(definition), definitionSha256, actorId]);
    if (!inserted.rows[0]) throw new Error("The reserved complete Stationary form version is unavailable");
    const sectionRows = definition.sections.map((section, position) => ({
      id: randomUUID(), stableKey: section.key, position, presentation: section.presentation,
    }));
    await client.query(`insert into forms.form_section
      (id, form_version_id, stable_key, position, presentation)
      select section.id, $1, section.stable_key, section.position, section.presentation
      from jsonb_to_recordset($2::jsonb) as section(
        id uuid, stable_key text, position integer, presentation jsonb)`,
    [formVersionId, JSON.stringify(sectionRows.map((section) => ({
      id: section.id, stable_key: section.stableKey, position: section.position, presentation: section.presentation,
    })))]);
    const fieldRows = definition.sections.flatMap((section, sectionPosition) => section.fields.map((field, position) => ({
      sectionId: sectionRows[sectionPosition].id, stableKey: field.key, position,
      elementId: field.source.elementId, configuration: field.configuration,
    })));
    const insertedFields = await client.query(`insert into forms.form_field
      (form_version_id, section_id, stable_key, position, source_kind,
       catalog_element_identity_id, required, analytical_repeatable, configuration)
      select $1, field.section_id, field.stable_key, field.position, 'nemsis',
        definition.element_identity_id, false,
        coalesce(mapping.analytical_location = 'repeatable', false), field.configuration
      from jsonb_to_recordset($3::jsonb) as field(
        section_id uuid, stable_key text, position integer, element_id text, configuration jsonb)
      join catalog.element_definition definition
        on definition.release_id = $2 and definition.element_id = field.element_id
      left join catalog.analytics_element_mapping mapping
        on mapping.release_id = definition.release_id and mapping.element_id = definition.element_id
      returning id`, [formVersionId, catalogReleaseId, JSON.stringify(fieldRows.map((field) => ({
        section_id: field.sectionId, stable_key: field.stableKey, position: field.position,
        element_id: field.elementId, configuration: field.configuration,
      })))]);
    if (insertedFields.rowCount !== fieldRows.length) {
      throw new Error(`The complete Stationary form projected ${insertedFields.rowCount} of ${fieldRows.length} fields`);
    }
    await client.query(`update forms.form_version
      set status = 'published', change_note = 'Initial demonstration configuration',
          published_by = $2, published_at = now(), publication_acknowledgements = '{}'::jsonb
      where id = $1 and status = 'draft'`, [formVersionId, actorId]);
    await client.query(`insert into app_identity.configuration_event
      (organization_id, actor_id, action, result, form_version_id, catalog_release_id,
       change_note, content_sha256, details)
      values ($1, $2, 'form.publish', 'succeeded', $3, $4,
        'Initial demonstration configuration', $5, jsonb_build_object('source', 'demonstration-fixture'))`,
    [SYNTHETIC_DEMO_FIXTURE.organizationId, actorId, formVersionId, catalogReleaseId, definitionSha256]);
    created = true;
  }

  const version = await client.query("select catalog_release_id from forms.form_version where id = $1", [formVersionId]);
  if (active.rows[0]) {
    await client.query(`update forms.agency_stationary_default
      set form_version_id = $2, activated_by = $3, activated_at = now()
      where organization_id = $1`, [SYNTHETIC_DEMO_FIXTURE.organizationId, formVersionId, actorId]);
  } else {
    await client.query(`insert into forms.agency_stationary_default (organization_id, form_version_id, activated_by)
      values ($1, $2, $3)`, [SYNTHETIC_DEMO_FIXTURE.organizationId, formVersionId, actorId]);
  }
  await client.query(`insert into app_identity.configuration_event
    (organization_id, actor_id, action, result, form_version_id, catalog_release_id, change_note, details)
    values ($1, $2, 'form.activate', 'succeeded', $3, $4,
      'Initial demonstration configuration', jsonb_build_object('source', 'demonstration-fixture'))`,
  [SYNTHETIC_DEMO_FIXTURE.organizationId, actorId, formVersionId, version.rows[0].catalog_release_id]);

  const demographicDefinition = { source: "demonstration-fixture", agency: "Demonstration EMS" };
  const demographics = await client.query(`select id from app_identity.agency_demographic_version
    where organization_id = $1 order by version desc limit 1`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
  if (!demographics.rows[0]) {
    await client.query(`insert into app_identity.agency_demographic_version
      (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
       dagency_04_display, definition_sha256, effective_from, created_by)
      values ($1, $2, $3, 1, 'DEMO-EMS', 'Demonstration EMS', '9920003',
        'Emergency Medical Services', $4, now(), $5)
      on conflict do nothing`,
    [baselineDemographicId, SYNTHETIC_DEMO_FIXTURE.organizationId, version.rows[0].catalog_release_id,
      sha256(demographicDefinition), actorId]);
    const createdDemographic = await client.query(`select id from app_identity.agency_demographic_version
      where organization_id = $1 limit 1`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
    if (!createdDemographic.rows[0]) throw new Error("The demonstration agency demographic is unavailable");
  }
  return { created, upgraded, formVersionId };
}

async function ensureDemoUnit(client, userId, formVersionId) {
  const form = await client.query("select form_id from forms.form_version where id = $1", [formVersionId]);
  if (!form.rows[0]) throw new Error("The active demonstration form is unavailable");
  await client.query(`insert into app_identity.operational_unit
    (id, organization_id, call_sign, name, default_form_id, active, synthetic)
    values ($1, $2, 'DEMO-1', 'Demo Unit', $3, true, true)
    on conflict (id) do nothing`,
  [baselineUnitId, SYNTHETIC_DEMO_FIXTURE.organizationId, form.rows[0].form_id]);
  const unit = await client.query(`select id from app_identity.operational_unit
    where id = $1 and organization_id = $2 and active and synthetic`,
  [baselineUnitId, SYNTHETIC_DEMO_FIXTURE.organizationId]);
  if (!unit.rows[0]) throw new Error("The reserved demonstration unit exists but is not eligible");
  await client.query(`insert into app_identity.unit_clinician (organization_id, unit_id, user_id)
    values ($1, $2, $3) on conflict (unit_id, user_id) do nothing`,
  [SYNTHETIC_DEMO_FIXTURE.organizationId, baselineUnitId, userId]);
  return { unitId: baselineUnitId, callSign: "DEMO-1" };
}

async function ensureFoundation(client) {
  const migrations = await readMigrations(path.join(repoRoot, "supabase/migrations"));
  return (await applyMigrations(client, migrations, { info() {} })) > 0;
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const migrated = await ensureFoundation(client);
  const passwordVerifier = await createPasswordVerifier(SYNTHETIC_DEMO_FIXTURE.password);
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('open-triage-demo-fixture-accounts-v4'))");
    const organization = await client.query(
      "select id from app_identity.organization where id = $1 for update",
      [SYNTHETIC_DEMO_FIXTURE.organizationId],
    );
    if (!organization.rows[0]) {
      throw new Error(`Create the demonstration organization ${SYNTHETIC_DEMO_FIXTURE.organizationId} before seeding fixture accounts`);
    }

    const created = [];
    for (const account of accounts) {
      const inserted = await client.query(`
        insert into app_identity.app_user (id, organization_id, display_name)
        values ($1, $2, $3)
        on conflict (id) do nothing
        returning id
      `, [account.id, SYNTHETIC_DEMO_FIXTURE.organizationId, account.displayName]);
      if (!inserted.rows[0]) continue;

      await client.query(`
        insert into app_identity.local_credential
          (user_id, username, password_verifier, must_change_password,
           temporary_password_expires_at, password_changed_at)
        values ($1, $2, $3, false, null, now())
      `, [account.id, account.username, passwordVerifier]);

      const assignments = await client.query(`
        insert into app_identity.user_role_assignment
          (organization_id, user_id, role_id, assigned_by, note)
        select $1, $2, role.id, $2, 'Initial demonstration fixture assignment'
        from app_identity.role role
        where role.organization_id = $1 and role.system_key = any($3::text[])
          and role.protected and role.active and role.assignable
        returning role_id
      `, [SYNTHETIC_DEMO_FIXTURE.organizationId, account.id, account.roles]);
      if (assignments.rowCount !== account.roles.length) {
        throw new Error(`The protected roles for ${account.username} are unavailable`);
      }
      await client.query(`
        insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id, details)
        values ($1, $2, 'account.provision', 'succeeded', $2,
          jsonb_build_object('source', 'demonstration-fixture', 'roleKeys', $3::text[]))
      `, [SYNTHETIC_DEMO_FIXTURE.organizationId, account.id, account.roles]);
      created.push(account.username);
    }

    const baselineConfiguration = await ensureBaselineConfiguration(client, SYNTHETIC_DEMO_FIXTURE.userId);
    const demoUnit = await ensureDemoUnit(client, SYNTHETIC_DEMO_FIXTURE.userId,
      baselineConfiguration.formVersionId);

    const owner = await client.query(
      "select exists (select 1 from app_identity.installation_owner where organization_id = $1) as configured",
      [SYNTHETIC_DEMO_FIXTURE.organizationId],
    );
    await client.query("commit");
    console.log(JSON.stringify({
      status: "ready",
      fixture: SYNTHETIC_DEMO_FIXTURE.id,
      revision: SYNTHETIC_DEMO_FIXTURE.revision,
      migrated,
      organizationId: SYNTHETIC_DEMO_FIXTURE.organizationId,
      createdAccounts: created,
      baselineConfiguration,
      demoUnit,
      ownerConfigured: Boolean(owner.rows[0]?.configured),
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} finally {
  await client.end();
}
