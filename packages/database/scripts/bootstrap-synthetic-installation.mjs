import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required to bootstrap the synthetic installation");

// Stable UUIDs make this fixture an idempotent installation baseline. Every clinical
// UUID is v4-shaped so the same constraints used for offline-created records apply.
const ids = Object.freeze({
  organization: "32000000-0000-4000-8000-000000000001",
  administrator: "32000000-0000-4000-8000-000000000002",
  clinician: "32000000-0000-4000-8000-000000000003",
  administratorIdentity: "32000000-0000-4000-8000-000000000004",
  clinicianIdentity: "32000000-0000-4000-8000-000000000005",
  agencyVersion: "32000000-0000-4000-8000-000000000006",
  form: "32000000-0000-4000-8000-000000000007",
  formVersion: "32000000-0000-4000-8000-000000000008",
  formSection: "32000000-0000-4000-8000-000000000009",
  dispatchField: "32000000-0000-4000-8000-00000000000a",
  responseField: "32000000-0000-4000-8000-00000000000b",
  incident: "32000000-0000-4000-8000-00000000000c",
  patient: "32000000-0000-4000-8000-00000000000d",
  report: "32000000-0000-4000-8000-00000000000e"
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

const agencyDefinition = {
  fixture: "open-triage-synthetic-installation-v1",
  values: {
    "dAgency.01": "SYNTHETIC-AGENCY-001",
    "dAgency.02": "SYNTHETIC-001",
    "dAgency.04": "00"
  }
};

const formDefinition = {
  schemaVersion: 1,
  locales: [{ locale: "en-US", translations: { title: "Synthetic standard encounter" } }],
  sections: [{
    key: "dispatch",
    presentation: { title: "Dispatch" },
    fields: [
      { key: "dispatch-complaint", source: { kind: "nemsis", elementId: "eDispatch.01" }, required: false },
      { key: "dispatch-priority", source: { kind: "nemsis", elementId: "eDispatch.02" }, required: false }
    ]
  }]
};

async function ensureFoundation(client) {
  const existing = await client.query("select to_regclass('app_identity.organization') as organization");
  if (existing.rows[0].organization) return false;
  const migration = await readFile(
    path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"),
    "utf8"
  );
  await client.query(migration);
  return true;
}

async function ensureCatalog() {
  const loader = path.join(packageRoot, "scripts/load-nemsis-catalog.mjs");
  return execFileAsync(process.execPath, [loader], { env: { ...process.env, DATABASE_URL: databaseUrl } });
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const migrated = await ensureFoundation(client);
  const catalogLoad = await ensureCatalog();

  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('open-triage-synthetic-installation-v1'))");
    const release = await client.query(`
      select id from catalog.release
      where standard = 'NEMSIS' and version = '3.5.1' and dataset = 'EMSDataSet'
    `);
    if (!release.rows[0]) throw new Error("The pinned NEMSIS 3.5.1 EMS catalog was not loaded");
    const releaseId = release.rows[0].id;

    await client.query(`
      insert into app_identity.organization (id, name, deployment_timezone)
      values ($1, 'OpenTriage Synthetic EMS', 'UTC')
      on conflict do nothing
    `, [ids.organization]);

    await client.query(`
      insert into app_identity.app_user (id, organization_id, display_name, synthetic)
      values
        ($1, $3, 'Synthetic Administrator', true),
        ($2, $3, 'Synthetic Clinician', true)
      on conflict do nothing
    `, [ids.administrator, ids.clinician, ids.organization]);

    await client.query(`
      insert into app_identity.external_identity (id, user_id, provider, subject)
      values
        ($1, $3, 'synthetic-bootstrap', 'administrator'),
        ($2, $4, 'synthetic-bootstrap', 'clinician')
      on conflict do nothing
    `, [ids.administratorIdentity, ids.clinicianIdentity, ids.administrator, ids.clinician]);

    await client.query(`
      insert into app_identity.capability (key, description)
      values
        ('forms:publish', 'Publish form versions'),
        ('reports:document', 'Create and document patient care reports'),
        ('installation:administer', 'Administer the installation')
      on conflict do nothing
    `);
    await client.query(`
      insert into app_identity.user_capability (user_id, capability_key, granted_by)
      values
        ($1, 'forms:publish', $1),
        ($1, 'installation:administer', $1),
        ($2, 'reports:document', $1)
      on conflict do nothing
    `, [ids.administrator, ids.clinician]);

    await client.query(`
      insert into app_identity.agency_demographic_version
        (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
         definition_sha256, effective_from, created_by)
      values ($1, $2, $3, 1, $4, $5, $6, $7, now(), $8)
      on conflict do nothing
    `, [ids.agencyVersion, ids.organization, releaseId,
      agencyDefinition.values["dAgency.01"], agencyDefinition.values["dAgency.02"],
      agencyDefinition.values["dAgency.04"], sha256(agencyDefinition), ids.administrator]);

    await client.query(`
      insert into forms.form (id, organization_id, slug, name)
      values ($1, $2, 'synthetic-standard-encounter', 'Synthetic standard encounter')
      on conflict do nothing
    `, [ids.form, ids.organization]);
    const fields = await client.query(`
      select e.element_id, e.element_identity_id, m.analytical_location
      from catalog.element_definition e
      join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = any($2::text[])
    `, [releaseId, ["eDispatch.01", "eDispatch.02"]]);
    if (fields.rowCount !== 2) throw new Error("The synthetic form fields are missing from the pinned catalog");

    const existingFormVersion = await client.query(
      "select id from forms.form_version where id = $1 or (form_id = $2 and version = 1)",
      [ids.formVersion, ids.form]
    );
    if (existingFormVersion.rowCount === 0) {
      // Children are projected while the version is a draft, followed by the one-way
      // transition to published. Replays skip this entire immutable aggregate.
      await client.query(`
        insert into forms.form_version
          (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
        values ($1, $2, $3, 1, $4::jsonb, $5, $6)
      `, [ids.formVersion, ids.form, releaseId, JSON.stringify(formDefinition), sha256(formDefinition), ids.administrator]);
      await client.query(`
        insert into forms.form_section (id, form_version_id, stable_key, position, presentation)
        values ($1, $2, 'dispatch', 0, '{"title":"Dispatch"}')
      `, [ids.formSection, ids.formVersion]);
      for (const [position, field] of formDefinition.sections[0].fields.entries()) {
        const metadata = fields.rows.find((row) => row.element_id === field.source.elementId);
        await client.query(`
          insert into forms.form_field
            (id, form_version_id, section_id, stable_key, position, source_kind,
             catalog_element_identity_id, required, analytical_repeatable)
          values ($1, $2, $3, $4, $5, 'nemsis', $6, $7, $8)
        `, [position === 0 ? ids.dispatchField : ids.responseField, ids.formVersion, ids.formSection,
          field.key, position, metadata.element_identity_id, field.required,
          metadata.analytical_location === "repeatable"]);
      }
      await client.query(`
        insert into forms.form_locale (form_version_id, locale, translations)
        values ($1, 'en-US', '{"title":"Synthetic standard encounter"}')
      `, [ids.formVersion]);
      await client.query(`
        update forms.form_version
        set status = 'published', change_note = 'Synthetic installation baseline', published_by = $2,
            published_at = now(), publication_acknowledgements = '{}'
        where id = $1
      `, [ids.formVersion, ids.administrator]);
    }

    await client.query(`
      insert into clinical.incident
        (id, organization_id, operational_state, dispatch_provenance, synthetic, baseline)
      values ($1, $2, 'created', $3::jsonb, true, true)
      on conflict do nothing
    `, [ids.incident, ids.organization, JSON.stringify({
      fixture: "open-triage-synthetic-installation-v1",
      synthetic: true,
      dispatchedAt: "2020-01-01T12:00:00Z"
    })]);
    await client.query(`
      insert into clinical.patient (id, organization_id, identity_state, pseudonymous_key)
      values ($1, $2, 'unknown', $3)
      on conflict do nothing
    `, [ids.patient, ids.organization, sha256("open-triage-synthetic-patient-v1")]);
    await client.query(`
      insert into clinical.report
        (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
         form_version_id, catalog_release_id, documenting_user_id, synthetic, baseline)
      values ($1, $2, $3, $4, $5, $6, $7, $8, true, true)
      on conflict do nothing
    `, [ids.report, ids.organization, ids.incident, ids.patient, ids.agencyVersion,
      ids.formVersion, releaseId, ids.clinician]);

    const installation = await client.query(`
      select r.id as report_id, r.organization_id, r.agency_demographic_version_id,
             r.form_version_id, r.catalog_release_id, r.synthetic, r.baseline,
             fv.status as form_status, fv.definition_sha256 as form_sha256,
             adv.definition_sha256 as agency_sha256,
             u.organization_id as user_organization_id, u.synthetic as user_is_synthetic
      from clinical.report r
      join forms.form_version fv on fv.id = r.form_version_id
      join app_identity.agency_demographic_version adv on adv.id = r.agency_demographic_version_id
      join app_identity.app_user u on u.id = r.documenting_user_id
      where r.id = $1 and r.organization_id = $2
    `, [ids.report, ids.organization]);
    const expected = installation.rows[0];
    if (!expected || expected.agency_demographic_version_id !== ids.agencyVersion ||
        expected.form_version_id !== ids.formVersion || expected.catalog_release_id !== releaseId ||
        expected.form_status !== "published" || expected.form_sha256 !== sha256(formDefinition) ||
        expected.agency_sha256 !== sha256(agencyDefinition) ||
        expected.user_organization_id !== ids.organization || !expected.synthetic || !expected.baseline ||
        !expected.user_is_synthetic) {
      throw new Error("Existing data conflicts with the deterministic synthetic installation");
    }

    await client.query("commit");
    console.log(JSON.stringify({
      status: "ready",
      migrated,
      catalog: catalogLoad.stdout.trim(),
      organizationId: ids.organization,
      agencyDemographicVersionId: ids.agencyVersion,
      publishedFormVersionId: ids.formVersion,
      catalogReleaseId: releaseId,
      baselineReportId: ids.report
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} finally {
  await client.end();
}
