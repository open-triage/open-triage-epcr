import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { parseInstallationSettings } from "@open-triage/contracts";
import { validateDispatchAssignment } from "../../../apps/api/dist/dispatch/dispatch-assignment.validation.js";
import { projectDispatchAssignment } from "../../../apps/api/dist/dispatch/dispatch-assignment.projection.js";
import { ingestDispatchDelivery } from "../../../apps/api/dist/dispatch/dispatch-ingestion.js";
import { createPasswordVerifier } from "../../../apps/api/dist/identity/password.js";
import { applyMigrations, readMigrations } from "./migrate.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const settingsFlag = process.argv.indexOf("--settings");
if (settingsFlag < 0 || !process.argv[settingsFlag + 1]) {
  throw new Error("--settings <installation-settings.json> is required");
}
const settingsPath = path.resolve(process.cwd(), process.argv[settingsFlag + 1]);
const installationSettings = parseInstallationSettings(JSON.parse(await readFile(settingsPath, "utf8")));
if (!installationSettings.syntheticFixtures.enabled) {
  console.log(JSON.stringify({ status: "skipped", reason: "syntheticFixtures.enabled is false" }));
  process.exit(0);
}
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required to bootstrap the synthetic installation");
const patientKeyConfig = patientKeyConfigFromEnvironment(process.env);
const dispatchSamplePath = path.join(
  repoRoot, "packages/contracts/examples/dispatch/synthetic-assignment-01.json"
);
const dispatchSourceBytes = installationSettings.sampleDispatchAssignment.enabled
  ? await readFile(dispatchSamplePath)
  : null;
const dispatchCatalog = installationSettings.sampleDispatchAssignment.enabled
  ? JSON.parse(await readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8"))
  : null;
const stationaryLayout = JSON.parse(await readFile(
  path.join(repoRoot, "apps/web/app/data/stationary-layout-1.0.0.json"), "utf8"
));
const validatedDispatch = dispatchSourceBytes && dispatchCatalog
  ? validateDispatchAssignment(JSON.parse(dispatchSourceBytes.toString("utf8")), dispatchCatalog)
  : null;
if (validatedDispatch && !validatedDispatch.canonical) throw new Error("The committed initial dispatch sample is invalid");
const dispatchProjection = validatedDispatch?.canonical ? projectDispatchAssignment(validatedDispatch.canonical) : null;

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
  incident: "32000000-0000-4000-8000-00000000000c",
  patient: "32000000-0000-4000-8000-00000000000d",
  report: "32000000-0000-4000-8000-00000000000e",
  unit: "32000000-0000-4000-8000-000000000010"
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function deterministicUuid(seed) {
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function fullStationaryFormDefinition(layout) {
  const children = new Map();
  for (const group of layout.groups) {
    const siblings = children.get(group.parentId) ?? [];
    siblings.push(group);
    children.set(group.parentId, siblings);
  }
  const roots = [
    ...(children.get("HeaderGroup") ?? []).filter((group) => group.id !== "PatientCareReportGroup"),
    ...(children.get("PatientCareReportGroup") ?? [])
  ].filter((group) => !["DemographicGroup", "eCustomConfigurationSection"].includes(group.id));
  const descendantIds = (group) => {
    const result = new Set([group.id]);
    for (const child of children.get(group.id) ?? []) {
      for (const id of descendantIds(child)) result.add(id);
    }
    return result;
  };
  return {
    schemaVersion: 1,
    locales: [{ locale: "en-US", translations: { title: "Synthetic full stationary encounter" } }],
    sections: roots.map((group) => {
      const groups = descendantIds(group);
      return {
        key: group.id,
        presentation: { title: group.presentation?.label ?? group.id },
        fields: layout.elements.filter((element) => groups.has(element.groupId)).map((element) => ({
          key: element.id,
          source: { kind: "nemsis", elementId: element.id }
        }))
      };
    })
  };
}

const agencyDefinition = {
  fixture: "open-triage-synthetic-installation-v1",
  values: {
    "dAgency.01": "SYNTHETIC-AGENCY-001",
    "dAgency.02": "SYNTHETIC-001",
    "dAgency.04": "00"
  }
};

const formDefinition = fullStationaryFormDefinition(stationaryLayout);

async function ensureFoundation(client) {
  const existing = await client.query("select to_regclass('app_identity.organization') as organization");
  if (existing.rows[0].organization) return false;
  const migrations = await readMigrations(path.join(repoRoot, "supabase/migrations"));
  const applied = await applyMigrations(
    client,
    migrations,
    { info() {} },
  );
  return applied > 0;
}

async function ensureCatalog() {
  const loader = path.join(packageRoot, "scripts/load-nemsis-catalog.mjs");
  return execFileAsync(process.execPath, [loader], { env: { ...process.env, DATABASE_URL: databaseUrl } });
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const dispatchWriter = {
  query: async (sql, parameters) => (await client.query(sql, parameters)).rows
};

try {
  const migrated = await ensureFoundation(client);
  const catalogLoad = await ensureCatalog();
  const demoPasswordVerifier = await createPasswordVerifier("open-triage-demo");

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
      insert into app_identity.organization (id, name, shift_session_duration_hours, deployment_timezone)
      values ($1, 'OpenTriage Synthetic EMS', 14, 'UTC')
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
      insert into app_identity.local_credential
        (user_id, username, password_verifier, must_change_password, password_changed_at)
      values
        ($1, 'demo.admin', $3, false, now()),
        ($2, 'demo.clinician', $3, false, now())
      on conflict (user_id) do update set
        username = excluded.username,
        password_verifier = excluded.password_verifier,
        must_change_password = false,
        password_changed_at = now()
    `, [ids.administrator, ids.clinician, demoPasswordVerifier]);

    await client.query(`
      insert into app_identity.capability (key, description)
      values
        ('forms:publish', 'Publish form versions'),
        ('clinical:document', 'Create and document patient care reports'),
        ('reports:document', 'Create and document patient care reports'),
        ('installation:administer', 'Administer the installation')
      on conflict do nothing
    `);
    await client.query(`
      insert into app_identity.user_capability (user_id, capability_key, granted_by)
      values
        ($1, 'forms:publish', $1),
        ($1, 'installation:administer', $1),
        ($1, 'clinical:document', $1),
        ($1, 'reports:document', $1),
        ($2, 'clinical:document', $1),
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
    const fieldElementIds = formDefinition.sections.flatMap((section) =>
      section.fields.map((field) => field.source.elementId));
    const fields = await client.query(`
      select e.element_id, e.element_identity_id, m.analytical_location
      from catalog.element_definition e
      join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = any($2::text[])
    `, [releaseId, fieldElementIds]);
    if (fields.rowCount !== fieldElementIds.length) {
      throw new Error("The full synthetic Stationary form fields are missing from the pinned catalog");
    }
    const fieldsByElementId = new Map(fields.rows.map((field) => [field.element_id, field]));

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
      for (const [sectionPosition, section] of formDefinition.sections.entries()) {
        const sectionId = deterministicUuid(`synthetic-stationary-section:${section.key}`);
        await client.query(`
          insert into forms.form_section (id, form_version_id, stable_key, position, presentation)
          values ($1, $2, $3, $4, $5::jsonb)
        `, [sectionId, ids.formVersion, section.key, sectionPosition, JSON.stringify(section.presentation ?? {})]);
        for (const [fieldPosition, field] of section.fields.entries()) {
          const metadata = fieldsByElementId.get(field.source.elementId);
          await client.query(`
            insert into forms.form_field
              (id, form_version_id, section_id, stable_key, position, source_kind,
               catalog_element_identity_id, required, analytical_repeatable)
            values ($1, $2, $3, $4, $5, 'nemsis', $6, $7, $8)
          `, [deterministicUuid(`synthetic-stationary-field:${field.source.elementId}`), ids.formVersion,
            sectionId, field.key, fieldPosition, metadata.element_identity_id, field.required ?? false,
            metadata.analytical_location === "repeatable"]);
        }
      }
      await client.query(`
        insert into forms.form_locale (form_version_id, locale, translations)
        values ($1, 'en-US', $2::jsonb)
      `, [ids.formVersion, JSON.stringify(formDefinition.locales[0].translations)]);
      await client.query(`
        update forms.form_version
        set status = 'published', change_note = 'Synthetic installation baseline', published_by = $2,
            published_at = now(), publication_acknowledgements = '{}'
        where id = $1
      `, [ids.formVersion, ids.administrator]);
    }

    await client.query(`
      insert into app_identity.operational_unit
        (id, organization_id, call_sign, name, default_form_id, synthetic)
      values ($1, $2, $3, 'Demo dispatch unit', $4, true)
      on conflict do nothing
    `, [ids.unit, ids.organization, dispatchProjection?.callSign ?? "SYNTHETIC-UNIT-1", ids.form]);
    await client.query(`
      insert into forms.agency_stationary_default (organization_id, form_version_id, activated_by)
      values ($1, $2, $3)
      on conflict (organization_id) do nothing
    `, [ids.organization, ids.formVersion, ids.administrator]);
    await client.query(`
      insert into app_identity.unit_clinician (organization_id, unit_id, user_id)
      values
        ($3, $1, $2),
        ($3, $1, $4)
      on conflict do nothing
    `, [ids.unit, ids.clinician, ids.organization, ids.administrator]);

    let dispatchStatus = "disabled";
    if (dispatchSourceBytes && dispatchCatalog && dispatchProjection) {
      const dispatchIngestion = await ingestDispatchDelivery(dispatchWriter, {
        organizationId: ids.organization,
        sourceId: "synthetic-bootstrap",
        sourceBytes: dispatchSourceBytes
      }, dispatchCatalog);
      if (!["applied", "replayed", "applied_with_findings"].includes(dispatchIngestion.status)) {
        throw new Error(`Initial dispatch sample was not applied: ${dispatchIngestion.status}`);
      }
      dispatchStatus = dispatchIngestion.status;
      const dispatchIncidentId = (await client.query(`
        select id from clinical.incident
        where organization_id = $1
          and dispatch_provenance @> $2::jsonb
        order by created_at limit 1
      `, [ids.organization, JSON.stringify({
        sourceId: "synthetic-bootstrap", sourceRecordId: dispatchProjection.sourceRecordId
      })])).rows[0]?.id ?? deterministicUuid(`synthetic-dispatch-incident:${dispatchProjection.sourceRecordId}`);
      await client.query(`
        insert into clinical.incident
          (id, organization_id, operational_state, dispatch_provenance, synthetic, baseline)
        values ($1, $2, 'assigned', $3::jsonb, true, true)
        on conflict do nothing
      `, [dispatchIncidentId, ids.organization, JSON.stringify({
        sourceId: "synthetic-bootstrap", sourceRecordId: dispatchProjection.sourceRecordId
      })]);
      await client.query(`
        insert into clinical.call_assignment
          (id, organization_id, unit_id, incident_id, call_number, dispatched_at,
           dispatch_reason, status, dispatch_source_id, dispatch_source_record_id,
           dispatch_revision, response_number, vehicle_number, dispatch_receipt_id, synthetic)
        values ($1, $2, $3, $4, $5, $6, $7, 'assigned', 'synthetic-bootstrap',
          $8, $9, $10, $11, $12, true)
        on conflict (organization_id, dispatch_source_id, dispatch_source_record_id) do nothing
      `, [deterministicUuid(`synthetic-dispatch-assignment:${dispatchProjection.sourceRecordId}`),
        ids.organization, ids.unit, dispatchIncidentId, dispatchProjection.incidentNumber,
        dispatchProjection.unitNotifiedAt, dispatchProjection.dispatchReason,
        dispatchProjection.sourceRecordId, dispatchProjection.revision,
        dispatchProjection.responseNumber, dispatchProjection.vehicleNumber,
        dispatchIngestion.receiptId]);
      await client.query(`
        update clinical.call_assignment ca
        set synthetic = true
        where ca.organization_id = $1 and ca.dispatch_source_id = 'synthetic-bootstrap'
          and ca.dispatch_source_record_id = $2
      `, [ids.organization, dispatchProjection.sourceRecordId]);
      await client.query(`
        update clinical.incident i
        set synthetic = true, baseline = true
        where i.id = (
          select ca.incident_id from clinical.call_assignment ca
          where ca.organization_id = $1 and ca.dispatch_source_id = 'synthetic-bootstrap'
            and ca.dispatch_source_record_id = $2
        )
      `, [ids.organization, dispatchProjection.sourceRecordId]);
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
      insert into clinical.patient
        (id, organization_id, identity_state, pseudonymous_key, pseudonymous_key_version)
      values ($1, $2, 'unknown', $3, $4)
      on conflict do nothing
    `, [ids.patient, ids.organization,
      derivePatientKey(patientKeyConfig, ids.organization, ids.patient), patientKeyConfig.keyVersion]);
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
             fv.status as form_status,
             adv.definition_sha256 as agency_sha256,
             u.organization_id as user_organization_id, u.synthetic as user_is_synthetic,
             ou.id as unit_id, ou.default_form_id, ca.id as assignment_id,
             ca.status as assignment_status, ca.synthetic as assignment_is_synthetic,
             ca.call_number, ca.response_number, ca.vehicle_number,
             ca.dispatch_source_record_id
      from clinical.report r
      join forms.form_version fv on fv.id = r.form_version_id
      join app_identity.agency_demographic_version adv on adv.id = r.agency_demographic_version_id
      join app_identity.app_user u on u.id = r.documenting_user_id
      join app_identity.unit_clinician uc on uc.user_id = u.id
      join app_identity.operational_unit ou on ou.id = uc.unit_id
      join clinical.call_assignment ca on ca.unit_id = ou.id
        and ca.dispatch_source_id = 'synthetic-bootstrap'
        and ca.dispatch_source_record_id = $3
      where r.id = $1 and r.organization_id = $2
    `, [ids.report, ids.organization, dispatchProjection.sourceRecordId]);
    const expected = installation.rows[0];
    const conflicts = !expected ? ["installation projection"] : [
      ["agency demographic version", expected.agency_demographic_version_id === ids.agencyVersion],
      ["baseline form version", expected.form_version_id === ids.formVersion],
      ["baseline catalog release", expected.catalog_release_id === releaseId],
      ["baseline form publication", expected.form_status === "published"],
      ["agency demographic content", expected.agency_sha256 === sha256(agencyDefinition)],
      ["user organization", expected.user_organization_id === ids.organization],
      ["baseline report provenance", expected.synthetic && expected.baseline],
      ["user provenance", expected.user_is_synthetic],
      ["unit identity", expected.unit_id === ids.unit],
      ["unit form identity", expected.default_form_id === ids.form],
      ["assignment provenance", expected.assignment_is_synthetic],
      ["assignment call number", expected.call_number === dispatchProjection.incidentNumber],
      ["assignment response number", expected.response_number === dispatchProjection.responseNumber],
      ["assignment vehicle number", expected.vehicle_number === dispatchProjection.vehicleNumber],
      ["assignment source identity", expected.dispatch_source_record_id === dispatchProjection.sourceRecordId],
    ].filter(([, matches]) => !matches).map(([name]) => name);
    if (conflicts.length) {
      throw new Error(`Existing data conflicts with the deterministic synthetic installation: ${conflicts.join(", ")}`);
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
      baselineReportId: ids.report,
      assignmentId: expected.assignment_id,
      dispatchStatus
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} finally {
  await client.end();
}
