import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { createPasswordVerifier } from "../../../apps/api/dist/identity/password.js";
import { applyMigrations, readMigrations } from "./migrate.mjs";

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

async function baselineDefinition() {
  const profile = JSON.parse(await readFile(path.join(repoRoot, "apps/web/app/data/standard-encounter-form.json"), "utf8"));
  return {
    schemaVersion: 1,
    sections: profile.sections.filter((section) => section.visible).map((section) => ({
      key: section.id,
      presentation: { quickActionLabel: section.quickActionLabel },
      fields: section.elements.map((elementId) => ({
        key: elementId,
        source: { kind: "nemsis", elementId },
        configuration: {
          ...(profile.labels[elementId] ? { label: profile.labels[elementId] } : {}),
          ...(profile.helpText[elementId] ? { helpText: profile.helpText[elementId] } : {}),
        },
      })),
    })),
  };
}

async function ensureBaselineConfiguration(client, actorId) {
  const active = await client.query(
    "select form_version_id from forms.agency_stationary_default where organization_id = $1",
    [SYNTHETIC_DEMO_FIXTURE.organizationId],
  );
  if (active.rows[0]) return { created: false, formVersionId: active.rows[0].form_version_id };

  const release = await client.query(`select id from catalog.release
    where standard = 'NEMSIS' and version = '3.5.1' and dataset = 'EMSDataSet' and sealed
    limit 1`);
  if (!release.rows[0]) throw new Error("Load the sealed NEMSIS 3.5.1 EMSDataSet catalog before bootstrapping the demo configuration");
  const catalogReleaseId = release.rows[0].id;
  const existing = await client.query(`select fv.id
    from forms.form_version fv join forms.form f on f.id = fv.form_id
    where f.organization_id = $1 and fv.status = 'published'
    order by fv.published_at desc, fv.version desc limit 1`, [SYNTHETIC_DEMO_FIXTURE.organizationId]);
  let formVersionId = existing.rows[0]?.id;
  let created = false;

  if (!formVersionId) {
    const definition = await baselineDefinition();
    const definitionSha256 = sha256(definition);
    await client.query(`insert into forms.form (id, organization_id, slug, name)
      values ($1, $2, 'stationary', 'Stationary') on conflict (id) do nothing`,
    [baselineFormId, SYNTHETIC_DEMO_FIXTURE.organizationId]);
    const inserted = await client.query(`insert into forms.form_version
      (id, form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
       created_by, display_name)
      values ($1, $2, $3, 1, 'draft', $4::jsonb, $5, $6, 'Stationary')
      on conflict (id) do nothing returning id`,
    [baselineFormVersionId, baselineFormId, catalogReleaseId, JSON.stringify(definition), definitionSha256, actorId]);
    formVersionId = inserted.rows[0]?.id ?? baselineFormVersionId;
    for (const [sectionPosition, section] of definition.sections.entries()) {
      const sectionId = randomUUID();
      await client.query(`insert into forms.form_section
        (id, form_version_id, stable_key, position, presentation) values ($1, $2, $3, $4, $5::jsonb)`,
      [sectionId, formVersionId, section.key, sectionPosition, JSON.stringify(section.presentation)]);
      for (const [fieldPosition, field] of section.fields.entries()) {
        const metadata = await client.query(`select definition.element_identity_id,
          mapping.analytical_location = 'repeatable' as analytical_repeatable
          from catalog.element_definition definition
          join catalog.analytics_element_mapping mapping
            on mapping.release_id = definition.release_id and mapping.element_id = definition.element_id
          where definition.release_id = $1 and definition.element_id = $2`,
        [catalogReleaseId, field.source.elementId]);
        if (!metadata.rows[0]) throw new Error(`The baseline form element ${field.source.elementId} is unavailable`);
        await client.query(`insert into forms.form_field
          (form_version_id, section_id, stable_key, position, source_kind,
           catalog_element_identity_id, required, analytical_repeatable, configuration)
          values ($1, $2, $3, $4, 'nemsis', $5, false, $6, $7::jsonb)`,
        [formVersionId, sectionId, field.key, fieldPosition, metadata.rows[0].element_identity_id,
          metadata.rows[0].analytical_repeatable, JSON.stringify(field.configuration)]);
      }
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
  await client.query(`insert into forms.agency_stationary_default (organization_id, form_version_id, activated_by)
    values ($1, $2, $3)`, [SYNTHETIC_DEMO_FIXTURE.organizationId, formVersionId, actorId]);
  await client.query(`insert into app_identity.configuration_event
    (organization_id, actor_id, action, result, form_version_id, catalog_release_id, change_note, details)
    values ($1, $2, 'form.activate', 'succeeded', $3, $4,
      'Initial demonstration configuration', jsonb_build_object('source', 'demonstration-fixture'))`,
  [SYNTHETIC_DEMO_FIXTURE.organizationId, actorId, formVersionId, version.rows[0].catalog_release_id]);

  const demographicDefinition = { source: "demonstration-fixture", agency: "Demonstration EMS" };
  await client.query(`insert into app_identity.agency_demographic_version
    (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
     dagency_04_display, definition_sha256, effective_from, created_by)
    values ($1, $2, $3, 1, 'DEMO-EMS', 'Demonstration EMS', '9920003',
      'Emergency Medical Services', $4, now(), $5)
    on conflict (id) do nothing`,
  [baselineDemographicId, SYNTHETIC_DEMO_FIXTURE.organizationId, version.rows[0].catalog_release_id,
    sha256(demographicDefinition), actorId]);
  return { created, formVersionId };
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
