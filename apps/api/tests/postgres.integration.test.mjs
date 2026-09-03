import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import pg from "pg";
import { AppModule } from "../dist/app.module.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";
import {
  DEMO_CLINICIAN_PASSWORD,
  DEMO_CLINICIAN_USERNAME
} from "../dist/sessions/clinician-session.service.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;

if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for the API PostgreSQL integration suite");
}

const integrationTest = databaseUrl ? test : test.skip;

async function ensureFoundation(client) {
  const existing = await client.query("select to_regclass('forms.form_version') as form_version");
  if (!existing.rows[0].form_version) {
    const migration = await readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8");
    await client.query(migration);
  }
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  if (!release.rows[0]) {
    await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/load-nemsis-catalog.mjs")], {
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });
  }
}

async function seedDraft(client, organizationId, userId, definition) {
  const formId = randomUUID();
  const versionId = randomUUID();
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  const digest = canonicalDefinitionSha256(definition);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, $3, 'Publication test')",
    [formId, organizationId, `publication-${formId}`]);
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
    values ($1, $2, $3, 1, $4::jsonb, $5, $6)`,
    [versionId, formId, release.rows[0].id, JSON.stringify(definition), digest, userId]);
  return { formId, versionId, digest };
}

integrationTest("form publication is atomic, catalog-aware, projected, and immutable through the public API", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);

  const organizationId = randomUUID();
  const userId = randomUUID();
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Publication API', 'UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Publisher')", [userId, organizationId]);

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  async function publish(versionId, body) {
    const response = await fetch(`${baseUrl}/form-versions/${versionId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    return { response, payload };
  }

  const catalogElements = await client.query(`
    select element_id from catalog.analytics_element_mapping
    where release_id = (select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1')
    order by element_id limit 2
  `);
  const [firstElement, secondElement] = catalogElements.rows.map((row) => row.element_id);
  const validDefinition = {
    schemaVersion: 1,
    locales: [{ locale: "en-US", translations: { title: "Clinical form" } }],
    sections: [{
      key: "clinical",
      presentation: { title: "Clinical" },
      fields: [
        { key: "first", source: { kind: "nemsis", elementId: firstElement }, required: true },
        {
          key: "second",
          source: { kind: "nemsis", elementId: secondElement },
          rules: [{ kind: "visibility", expression: { operator: "exists", field: "first" } }]
        }
      ]
    }]
  };

  await t.test("publishes canonical content and matching searchable projections", async () => {
    const draft = await seedDraft(client, organizationId, userId, validDefinition);
    const { response, payload } = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Initial publication",
      definitionSha256: draft.digest
    });
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.deepEqual(payload.projections, { sections: 1, fields: 2, rules: 1, locales: 1 });

    const stored = await client.query(`
      select fv.status, fv.catalog_release_id, fv.canonical_definition,
             array_agg(ff.stable_key order by ff.position) as field_keys
      from forms.form_version fv
      join forms.form_section fs on fs.form_version_id = fv.id
      join forms.form_field ff on ff.section_id = fs.id
      where fv.id = $1
      group by fv.id
    `, [draft.versionId]);
    assert.equal(stored.rows[0].status, "published");
    assert.deepEqual(stored.rows[0].canonical_definition, validDefinition);
    assert.deepEqual(stored.rows[0].field_keys, ["first", "second"]);

    await assert.rejects(client.query(
      "update forms.form_version set canonical_definition = '{}' where id = $1", [draft.versionId]),
      (error) => error.code === "P0001");
    await assert.rejects(client.query(
      "update forms.form_field set stable_key = 'changed' where form_version_id = $1", [draft.versionId]),
      (error) => error.code === "P0001");

    const retry = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Retry",
      definitionSha256: draft.digest
    });
    assert.equal(retry.response.status, 201);
    const conflict = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Conflicting retry",
      definitionSha256: "f".repeat(64)
    });
    assert.equal(conflict.response.status, 409);
  });

  await t.test("rejects unknown elements and invalid rules without partial projections", async () => {
    const invalidDefinitions = [
      {
        schemaVersion: 1,
        sections: [{ key: "unknown", fields: [{ key: "missing", source: { kind: "nemsis", elementId: "eUnknown.999" } }] }]
      },
      {
        schemaVersion: 1,
        sections: [{ key: "rules", fields: [{
          key: "known", source: { kind: "nemsis", elementId: firstElement },
          rules: [{ kind: "visibility", expression: { operator: "equals", field: "missing", value: true } }]
        }] }]
      }
    ];
    for (const definition of invalidDefinitions) {
      const draft = await seedDraft(client, organizationId, userId, definition);
      const result = await publish(draft.versionId, {
        publishedBy: userId,
        changeNote: "Must fail",
        definitionSha256: draft.digest
      });
      assert.equal(result.response.status, 422);
      const state = await client.query(`
        select fv.status,
          (select count(*)::integer from forms.form_section where form_version_id = fv.id) as sections,
          (select count(*)::integer from forms.form_field where form_version_id = fv.id) as fields
        from forms.form_version fv where fv.id = $1
      `, [draft.versionId]);
      assert.deepEqual(state.rows[0], { status: "draft", sections: 0, fields: 0 });
    }
  });

  await t.test("rolls back relational projections when the final publication write fails", async () => {
    const draft = await seedDraft(client, organizationId, userId, validDefinition);
    await client.query(`
      create or replace function forms.integration_reject_publication()
      returns trigger language plpgsql as $$
      begin
        if new.change_note = 'force rollback' then raise exception 'forced integration failure'; end if;
        return new;
      end;
      $$;
      create trigger integration_reject_publication
      before update on forms.form_version
      for each row execute function forms.integration_reject_publication();
    `);
    try {
      const result = await publish(draft.versionId, {
        publishedBy: userId,
        changeNote: "force rollback",
        definitionSha256: draft.digest
      });
      assert.equal(result.response.status, 500);
    } finally {
      await client.query("drop trigger integration_reject_publication on forms.form_version");
      await client.query("drop function forms.integration_reject_publication()");
    }
    const state = await client.query(`select status,
      (select count(*)::integer from forms.form_section where form_version_id = $1) as sections,
      (select count(*)::integer from forms.form_field where form_version_id = $1) as fields,
      (select count(*)::integer from forms.form_rule where form_version_id = $1) as rules,
      (select count(*)::integer from forms.form_locale where form_version_id = $1) as locales
      from forms.form_version where id = $1`, [draft.versionId]);
    assert.deepEqual(state.rows[0], { status: "draft", sections: 0, fields: 0, rules: 0, locales: 0 });
  });

  await t.test("rejects a custom clinical repeating group without exactly its one date-time field", async () => {
    const timeElementId = randomUUID();
    const textElementId = randomUUID();
    const groupId = randomUUID();
    await client.query(`insert into catalog.element_identity (id, namespace, canonical_key) values
      ($1, 'integration', $3), ($2, 'integration', $4)`,
      [timeElementId, textElementId, `integration.time-${timeElementId}`, `integration.text-${textElementId}`]);
    await client.query(`insert into forms.custom_element_definition
      (id, organization_id, namespace, slug, title, base_datatype, definition) values
      ($1, $3, 'integration', $4, 'Clinical time', 'dateTime', '{}'),
      ($2, $3, 'integration', $5, 'Clinical text', 'string', '{}')`,
      [timeElementId, textElementId, organizationId, `time-${timeElementId}`, `text-${textElementId}`]);
    await client.query(`insert into forms.custom_group_definition
      (id, organization_id, namespace, slug, temporal_kind, clinical_time_element_id, definition)
      values ($1, $2, 'integration', $3, 'clinical', $4, '{}')`,
      [groupId, organizationId, `group-${groupId}`, timeElementId]);
    const definition = {
      schemaVersion: 1,
      sections: [{ key: "custom", fields: [{
        key: "custom-text",
        source: { kind: "custom", elementDefinitionId: textElementId, groupDefinitionId: groupId }
      }] }]
    };
    const draft = await seedDraft(client, organizationId, userId, definition);
    const result = await publish(draft.versionId, {
      publishedBy: userId,
      changeNote: "Must fail",
      definitionSha256: draft.digest
    });
    assert.equal(result.response.status, 422);
    assert.match(JSON.stringify(result.payload), /exactly its declared clinical date-time element/);
    const state = await client.query(`select status,
      (select count(*)::integer from forms.form_section where form_version_id = $1) as sections
      from forms.form_version where id = $1`, [draft.versionId]);
    assert.deepEqual(state.rows[0], { status: "draft", sections: 0 });
  });
});

integrationTest("the seeded clinician retrieves the server-authoritative demo unit assignment", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/bootstrap-synthetic-installation.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const signIn = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DEMO_CLINICIAN_USERNAME, password: DEMO_CLINICIAN_PASSWORD })
  });
  assert.equal(signIn.status, 201);
  const session = await signIn.json();
  const response = await fetch(`${baseUrl}/calls/assigned`, {
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.assignedCalls, [{
    id: "32000000-0000-4000-8000-000000000011",
    callNumber: "SYN-2026-0903-001",
    unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
    dispatchedAt: "2026-09-03T12:00:00.000Z",
    dispatchReason: "Medical assistance requested",
    chiefComplaint: null,
    status: "assigned"
  }]);
  assert.deepEqual(payload.canceledAssignmentIds, []);

  try {
    await client.query("update clinical.call_assignment set status = 'canceled' where id = $1", [payload.assignedCalls[0].id]);
    const canceled = await fetch(`${baseUrl}/calls/assigned`, {
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    const canceledPayload = await canceled.json();
    assert.deepEqual(canceledPayload.assignedCalls, []);
    assert.deepEqual(canceledPayload.canceledAssignmentIds, [payload.assignedCalls[0].id]);
  } finally {
    await client.query("update clinical.call_assignment set status = 'assigned' where id = $1", [payload.assignedCalls[0].id]);
  }
});

integrationTest("assignment opening is idempotent, creator-owned, form-pinned, and advances the demo", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);
  await execFileAsync(process.execPath, [path.join(repoRoot, "packages/database/scripts/bootstrap-synthetic-installation.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const signIn = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DEMO_CLINICIAN_USERNAME, password: DEMO_CLINICIAN_PASSWORD })
  });
  const session = await signIn.json();
  const assignmentId = "32000000-0000-4000-8000-000000000011";
  const latestBeforeOpen = (await client.query(`
    select fv.id from forms.form_version fv
    join app_identity.operational_unit ou on ou.default_form_id = fv.form_id
    where ou.id = '32000000-0000-4000-8000-000000000010' and fv.status = 'published'
    order by fv.version desc limit 1
  `)).rows[0].id;
  let opened;
  try {
    const requestOpen = async () => {
      const response = await fetch(`${baseUrl}/calls/${assignmentId}/open`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` }
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    opened = await requestOpen();
    const retry = await requestOpen();
    assert.equal(retry.report.id, opened.report.id);
    assert.equal(retry.replacementAssignment, null);
    assert.equal(opened.report.documentingUserId, session.user.id);
    assert.equal(opened.report.formVersionId, latestBeforeOpen);
    assert.equal(opened.replacementAssignment.callNumber, "SYN-2026-0903-002");
    assert.equal(opened.replacementAssignment.dispatchedAt, "2026-09-03T12:15:00.000Z");

    const state = (await client.query(`
      select ca.status, ca.report_id, r.documenting_user_id, r.form_version_id,
        (select count(*)::integer from clinical.report where incident_id = ca.incident_id) as reports,
        (select count(*)::integer from clinical.patient where id = r.patient_id) as patients
      from clinical.call_assignment ca join clinical.report r on r.id = ca.report_id
      where ca.id = $1
    `, [assignmentId])).rows[0];
    assert.deepEqual(state, {
      status: "opened", report_id: opened.report.id, documenting_user_id: session.user.id,
      form_version_id: latestBeforeOpen, reports: 1, patients: 1
    });

    const laterVersionId = randomUUID();
    await client.query(`
      insert into forms.form_version
        (id, form_id, catalog_release_id, version, status, canonical_definition,
         definition_sha256, change_note, created_by, published_by, published_at,
         publication_acknowledgements)
      select $1, fv.form_id, fv.catalog_release_id,
             (select max(version) + 1 from forms.form_version where form_id = fv.form_id),
             'published', fv.canonical_definition, fv.definition_sha256,
             'Published after assignment opening', fv.created_by, fv.created_by, now(), '{}'
      from forms.form_version fv where fv.id = $2
    `, [laterVersionId, latestBeforeOpen]);
    assert.equal((await client.query("select form_version_id from clinical.report where id = $1", [opened.report.id])).rows[0].form_version_id,
      latestBeforeOpen);
  } finally {
    if (opened) {
      await client.query("begin");
      try {
        const replacement = await client.query("select incident_id from clinical.call_assignment where id = $1", [opened.replacementAssignment.id]);
        await client.query("update clinical.call_assignment set status = 'assigned', report_id = null where id = $1", [assignmentId]);
        await client.query("delete from clinical.call_assignment where id = $1", [opened.replacementAssignment.id]);
        const patient = await client.query("select patient_id from clinical.report where id = $1", [opened.report.id]);
        await client.query("delete from clinical.report where id = $1", [opened.report.id]);
        if (patient.rows[0]) await client.query("delete from clinical.patient where id = $1", [patient.rows[0].patient_id]);
        if (replacement.rows[0]) await client.query("delete from clinical.incident where id = $1", [replacement.rows[0].incident_id]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  }
});

integrationTest("draft report commands create, incrementally save, retrieve, and replay through the public API", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await ensureFoundation(client);

  const organizationId = randomUUID();
  const userId = randomUUID();
  const formId = randomUUID();
  const formVersionId = randomUUID();
  const agencyVersionId = randomUUID();
  const release = await client.query("select id from catalog.release where standard = 'NEMSIS' and version = '3.5.1'");
  const releaseId = release.rows[0].id;
  await client.query("insert into app_identity.organization (id, name, deployment_timezone) values ($1, 'Draft API', 'UTC')", [organizationId]);
  await client.query("insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, 'Clinician')", [userId, organizationId]);
  await client.query(`insert into app_identity.agency_demographic_version
    (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
     definition_sha256, effective_from, created_by)
    values ($1, $2, $3, 1, 'DRAFT-AGENCY', 'DRAFT-UNIT', '00', $4, now() - interval '1 day', $5)`,
  [agencyVersionId, organizationId, releaseId, "a".repeat(64), userId]);
  await client.query("insert into forms.form (id, organization_id, slug, name) values ($1, $2, $3, 'Draft command form')",
    [formId, organizationId, `draft-${formId}`]);
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, status, canonical_definition, definition_sha256,
     change_note, created_by, published_by, published_at)
    values ($1, $2, $3, 1, 'published', '{"schemaVersion":1,"sections":[]}', $4,
            'Draft API integration fixture', $5, $5, now())`,
  [formVersionId, formId, releaseId, "b".repeat(64), userId]);

  const selected = await client.query(`
    select
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
        where e.release_id = $1 and e.base_datatype = 'string' order by e.element_id limit 1) as text_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
        where e.release_id = $1 and e.base_datatype = 'dateTime' order by e.element_id limit 1) as datetime_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1
        and e.definition #>> '{valueSource,kind}' = 'inline-enumerated'
        and (e.definition #>> '{valueSource,exhaustive}')::boolean
        order by e.element_id limit 1) as coded_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1 and exists
        (select 1 from catalog.element_option o where o.release_id = e.release_id and o.element_id = e.element_id and o.source_kind = 'not-value') order by e.element_id limit 1) as null_id,
      (select e.element_id from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1 and exists
        (select 1 from catalog.element_option o where o.release_id = e.release_id and o.element_id = e.element_id and o.source_kind = 'pertinent-negative') order by e.element_id limit 1) as negative_id,
      (select group_id from catalog.group_definition where release_id = $1 order by cardinality(path), group_id limit 1) as group_id
  `, [releaseId]);
  const ids = selected.rows[0];
  for (const [key, value] of Object.entries(ids)) assert.ok(value, `catalog fixture requires ${key}`);
  const option = async (elementId, sourceKind) => (await client.query(`select code, display, code_system from catalog.element_option
    where release_id = $1 and element_id = $2 and source_kind = $3 order by code limit 1`,
  [releaseId, elementId, sourceKind])).rows[0];
  const coded = await option(ids.coded_id, "inline");
  assert.ok(coded, "catalog fixture requires an inline coded value");
  const notValue = await option(ids.null_id, "not-value");
  const negative = await option(ids.negative_id, "pertinent-negative");

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const request = async (path, method, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
  };

  const reportId = randomUUID();
  const createCommand = {
    commandId: randomUUID(), reportId, incidentId: randomUUID(), patientId: randomUUID(),
    organizationId, documentingUserId: userId, formId, patientIdentityState: "unknown",
    patientPseudonymousKey: "c".repeat(64)
  };
  const created = await request("/reports", "POST", createCommand);
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.revision, 0);
  assert.equal(created.payload.formVersionId, formVersionId);
  assert.equal(created.payload.agencyDemographicVersionId, agencyVersionId);
  assert.equal(created.payload.catalogReleaseId, releaseId);

  const createRetry = await request("/reports", "POST", createCommand);
  assert.equal(createRetry.response.status, 201);
  assert.deepEqual(createRetry.payload, created.payload);
  const changedRetry = await request("/reports", "POST", { ...createCommand, patientIdentityState: "temporary" });
  assert.equal(changedRetry.response.status, 409);
  const secondCreate = await request("/reports", "POST", { ...createCommand, commandId: randomUUID() });
  assert.equal(secondCreate.response.status, 201);
  assert.equal(secondCreate.payload.id, reportId);
  assert.equal((await client.query("select count(*)::integer as count from clinical.report where id = $1", [reportId])).rows[0].count, 1);

  const groupInstanceId = randomUUID();
  const textOccurrenceId = randomUUID();
  const ordinals = new Map();
  const nextOrdinal = (elementId) => {
    const ordinal = ordinals.get(elementId) ?? 0;
    ordinals.set(elementId, ordinal + 1);
    return ordinal;
  };
  const firstSave = {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, deviceId: "offline-unit-7",
    clientTime: "2026-08-30T14:00:00-04:00",
    groups: [{ id: groupInstanceId, groupId: ids.group_id, ordinal: 0, correlationId: "offline-group-1" }],
    occurrences: [
      { id: textOccurrenceId, elementId: ids.text_id, ordinal: nextOrdinal(ids.text_id), value: { kind: "text", value: "initial" } },
      { id: randomUUID(), elementId: ids.datetime_id, ordinal: nextOrdinal(ids.datetime_id), value: {
        kind: "datetime", value: "2026-08-30T14:03:04-04:00", utcOffsetMinutes: -240, precision: "second"
      } },
      { id: randomUUID(), elementId: ids.coded_id, ordinal: nextOrdinal(ids.coded_id), value: {
        kind: "coded", code: coded.code, ...(coded.code_system ? { codeSystem: coded.code_system } : {}), display: coded.display
      } },
      { id: randomUUID(), elementId: ids.null_id, ordinal: nextOrdinal(ids.null_id), value: {
        kind: "null", absenceCode: notValue.code, display: notValue.display
      } },
      { id: randomUUID(), elementId: ids.negative_id, ordinal: nextOrdinal(ids.negative_id), value: {
        kind: "pertinent-negative", absenceCode: negative.code, display: negative.display
      } },
      { id: randomUUID(), elementId: ids.text_id, ordinal: 1, groupInstanceId, value: { kind: "absent" } }
    ]
  };
  const saved = await request(`/reports/${reportId}/draft-changes`, "POST", firstSave);
  assert.equal(saved.response.status, 201, JSON.stringify(saved.payload));
  assert.equal(saved.payload.revision, 1);
  const saveRetry = await request(`/reports/${reportId}/draft-changes`, "POST", firstSave);
  assert.equal(saveRetry.response.status, 201);
  assert.equal(saveRetry.payload.revision, 1);

  const retrieved = await request(`/reports/${reportId}`, "GET");
  assert.equal(retrieved.response.status, 200);
  assert.equal(retrieved.payload.revision, 1);
  assert.equal(retrieved.payload.groups.length, 1);
  assert.deepEqual(new Set(retrieved.payload.occurrences.map((row) => row.valueKind)),
    new Set(["text", "datetime", "coded", "null", "pertinent-negative", "absent"]));
  assert.equal(retrieved.payload.occurrences.find((row) => row.valueKind === "datetime").valueUtcOffsetMinutes, -240);

  const secondSave = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 1, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "updated" } }]
  });
  assert.equal(secondSave.response.status, 201, JSON.stringify(secondSave.payload));
  assert.equal(secondSave.payload.revision, 2);
  const stored = await client.query(`select
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where report_id = $1) as occurrences,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`, [reportId, textOccurrenceId]);
  assert.deepEqual(stored.rows[0], { changes: 2, occurrences: 6, current_text: "updated" });

  const stale = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "stale" } }]
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.currentRevision, 2);
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`,
  [reportId, textOccurrenceId])).rows[0], { revision: "2", changes: 2, current_text: "updated" });

  const concurrentCommands = ["device-a", "device-b"].map((value) => ({
    commandId: randomUUID(), expectedRevision: 2, authorId: userId, deviceId: value,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value } }]
  }));
  const concurrent = await Promise.all(concurrentCommands.map((command) =>
    request(`/reports/${reportId}/draft-changes`, "POST", command)));
  assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [201, 409]);
  const acceptedIndex = concurrent.findIndex(({ response }) => response.status === 201);
  assert.equal(concurrent[acceptedIndex].payload.revision, 3);
  const concurrentState = (await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select value_text from clinical.element_occurrence where id = $2) as current_text`,
  [reportId, textOccurrenceId])).rows[0];
  assert.deepEqual(concurrentState, {
    revision: "3", changes: 3,
    current_text: concurrentCommands[acceptedIndex].occurrences[0].value.value
  });

  const deleteCommand = {
    commandId: randomUUID(), expectedRevision: 3, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, tombstone: true }]
  };
  const deleted = await request(`/reports/${reportId}/draft-changes`, "POST", deleteCommand);
  assert.equal(deleted.response.status, 201, JSON.stringify(deleted.payload));
  assert.equal(deleted.payload.revision, 4);
  const deleteRetry = await request(`/reports/${reportId}/draft-changes`, "POST", deleteCommand);
  assert.equal(deleteRetry.response.status, 201);
  assert.deepEqual(deleteRetry.payload, deleted.payload);
  const deletedState = (await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as identities,
    (select tombstoned_at is not null from clinical.element_occurrence where id = $2) as tombstoned`,
  [reportId, textOccurrenceId])).rows[0];
  assert.deepEqual(deletedState, { revision: "4", changes: 4, identities: 1, tombstoned: true });

  const resurrection = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 4, authorId: userId,
    occurrences: [{ id: textOccurrenceId, elementId: ids.text_id, value: { kind: "text", value: "resurrected" } }]
  });
  assert.equal(resurrection.response.status, 409);
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select tombstoned_at is not null from clinical.element_occurrence where id = $2) as tombstoned`,
  [reportId, textOccurrenceId])).rows[0], { revision: "4", changes: 4, tombstoned: true });

  await client.query(`
    create function clinical.integration_reject_draft_change()
    returns trigger language plpgsql as $$
    begin
      if new.device_id = 'force-rollback' then raise exception 'forced draft rollback'; end if;
      return new;
    end;
    $$;
    create trigger integration_reject_draft_change
    before insert on clinical.report_change
    for each row execute function clinical.integration_reject_draft_change();
  `);
  const rollbackOccurrenceId = randomUUID();
  const rollbackCommand = {
    commandId: randomUUID(), expectedRevision: 4, authorId: userId, deviceId: "force-rollback",
    occurrences: [{ id: rollbackOccurrenceId, elementId: ids.text_id, ordinal: 6,
      value: { kind: "text", value: "must roll back" } }]
  };
  try {
    const rolledBack = await request(`/reports/${reportId}/draft-changes`, "POST", rollbackCommand);
    assert.equal(rolledBack.response.status, 500);
  } finally {
    await client.query("drop trigger integration_reject_draft_change on clinical.report_change");
    await client.query("drop function clinical.integration_reject_draft_change()");
  }
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as occurrences,
    (select count(*)::integer from clinical.command_receipt where idempotency_key = $3) as receipts`,
  [reportId, rollbackOccurrenceId, rollbackCommand.commandId])).rows[0],
  { revision: "4", changes: 4, occurrences: 0, receipts: 0 });

  const retriedAfterRollback = await request(`/reports/${reportId}/draft-changes`, "POST", rollbackCommand);
  assert.equal(retriedAfterRollback.response.status, 201, JSON.stringify(retriedAfterRollback.payload));
  assert.equal(retriedAfterRollback.payload.revision, 5);
  assert.deepEqual((await client.query(`select
    (select revision from clinical.report where id = $1) as revision,
    (select count(*)::integer from clinical.report_change where report_id = $1) as changes,
    (select count(*)::integer from clinical.element_occurrence where id = $2) as occurrences,
    (select count(*)::integer from clinical.command_receipt where idempotency_key = $3) as receipts`,
  [reportId, rollbackOccurrenceId, rollbackCommand.commandId])).rows[0],
  { revision: "5", changes: 5, occurrences: 1, receipts: 1 });

  const signingFormVersionId = randomUUID();
  const signingSectionId = randomUUID();
  const presentFieldId = randomUUID();
  const requiredFieldId = randomUUID();
  const requiredElement = (await client.query(`select e.element_id, e.element_identity_id,
      (m.analytical_location = 'repeatable') as analytical_repeatable
    from catalog.element_definition e join catalog.analytics_element_mapping m
      on m.release_id = e.release_id and m.element_id = e.element_id
    where e.release_id = $1 and e.base_datatype = 'string' and e.max_occurs = 1
      and e.element_id <> $2 order by e.element_id limit 1`, [releaseId, ids.text_id])).rows[0];
  assert.ok(requiredElement, "catalog fixture requires a second singleton text element");
  const presentIdentity = (await client.query(`select element_identity_id,
      (analytical_location = 'repeatable') as analytical_repeatable
    from catalog.analytics_element_mapping where release_id = $1 and element_id = $2`,
  [releaseId, ids.text_id])).rows[0];
  await client.query(`insert into forms.form_version
    (id, form_id, catalog_release_id, version, canonical_definition, definition_sha256, created_by)
    values ($1, $2, $3, 2, '{"schemaVersion":1,"sections":[]}', $4, $5)`,
  [signingFormVersionId, formId, releaseId, "d".repeat(64), userId]);
  await client.query(`insert into forms.form_section (id, form_version_id, stable_key, position)
    values ($1, $2, 'signing', 0)`, [signingSectionId, signingFormVersionId]);
  await client.query(`insert into forms.form_field
    (id, form_version_id, section_id, stable_key, position, source_kind,
     catalog_element_identity_id, required, analytical_repeatable)
    values ($1, $3, $4, 'present', 0, 'nemsis', $5, false, $6),
           ($2, $3, $4, 'required-when-present', 1, 'nemsis', $7, true, $8)`,
  [presentFieldId, requiredFieldId, signingFormVersionId, signingSectionId,
    presentIdentity.element_identity_id, presentIdentity.analytical_repeatable,
    requiredElement.element_identity_id, requiredElement.analytical_repeatable]);
  await client.query(`insert into forms.form_rule
    (form_version_id, target_field_id, rule_kind, expression)
    values ($1, $2, 'requiredness', '{"operator":"exists","field":"present"}')`,
  [signingFormVersionId, requiredFieldId]);
  await client.query(`update forms.form_version set status = 'published', change_note = 'Signing fixture',
    published_by = $2, published_at = now() where id = $1`, [signingFormVersionId, userId]);
  await client.query("update clinical.report set form_version_id = $2 where id = $1", [reportId, signingFormVersionId]);

  const sign = (body) => request(`/reports/${reportId}/sign`, "POST", body);
  const missingRequired = await sign({
    commandId: randomUUID(), expectedRevision: 5, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(missingRequired.response.status, 422, JSON.stringify(missingRequired.payload));
  assert.ok(missingRequired.payload.findings.some((finding) => finding.code === "form.required"));
  assert.ok(missingRequired.payload.findings.some((finding) => finding.code === "form.conditional-required"));
  const rejectedState = (await client.query(`select status, revision,
      (select count(*)::integer from clinical.signed_snapshot where report_id = $1) as snapshots,
      (select count(*)::integer from clinical.validation_finding where report_id = $1) as findings
    from clinical.report where id = $1`, [reportId])).rows[0];
  assert.deepEqual({ status: rejectedState.status, revision: rejectedState.revision, snapshots: rejectedState.snapshots },
    { status: "draft", revision: "5", snapshots: 0 });
  assert.ok(rejectedState.findings >= 2);

  const requiredOccurrenceId = randomUUID();
  const secondRequiredOccurrenceId = randomUUID();
  const requiredSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 5, authorId: userId,
    occurrences: [{ id: requiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, ordinal: 0, value: { kind: "text", value: "required" } }]
  });
  assert.equal(requiredSaved.response.status, 201, JSON.stringify(requiredSaved.payload));
  const duplicateSaved = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 6, authorId: userId,
    occurrences: [{ id: secondRequiredOccurrenceId, elementId: requiredElement.element_id,
      formFieldId: requiredFieldId, ordinal: 1, value: { kind: "text", value: "duplicate" } }]
  });
  assert.equal(duplicateSaved.response.status, 201, JSON.stringify(duplicateSaved.payload));
  const invalidCardinality = await sign({
    commandId: randomUUID(), expectedRevision: 7, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidCardinality.response.status, 422, JSON.stringify(invalidCardinality.payload));
  assert.ok(invalidCardinality.payload.findings.some((finding) => finding.code === "catalog.cardinality"));
  const removedDuplicate = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 7, authorId: userId,
    occurrences: [{ id: secondRequiredOccurrenceId, elementId: requiredElement.element_id, tombstone: true }]
  });
  assert.equal(removedDuplicate.response.status, 201, JSON.stringify(removedDuplicate.payload));

  await client.query(`update clinical.element_occurrence set
    value_kind = 'integer', value_text = null, value_integer = 42, value_lexical = '42'
    where id = $1`, [requiredOccurrenceId]);
  const invalidCatalog = await sign({
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidCatalog.response.status, 422, JSON.stringify(invalidCatalog.payload));
  assert.ok(invalidCatalog.payload.findings.some((finding) => finding.code === "catalog.datatype"));
  assert.deepEqual((await client.query("select status, revision from clinical.report where id = $1", [reportId])).rows[0],
    { status: "draft", revision: "8" });
  await client.query(`update clinical.element_occurrence set
    value_kind = 'text', value_text = 'required', value_integer = null, value_lexical = null
    where id = $1`, [requiredOccurrenceId]);

  const codedOccurrence = (await client.query(`select id, code from clinical.element_occurrence
    where report_id = $1 and element_id = $2 and tombstoned_at is null`, [reportId, ids.coded_id])).rows[0];
  await client.query("update clinical.element_occurrence set code = 'INVALID-VALUE-SET-CODE' where id = $1", [codedOccurrence.id]);
  const invalidValueSet = await sign({
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval" }
  });
  assert.equal(invalidValueSet.response.status, 422, JSON.stringify(invalidValueSet.payload));
  assert.ok(invalidValueSet.payload.findings.some((finding) => finding.code === "catalog.value-set"));
  assert.deepEqual((await client.query("select status, revision from clinical.report where id = $1", [reportId])).rows[0],
    { status: "draft", revision: "8" });
  await client.query("update clinical.element_occurrence set code = $2 where id = $1", [codedOccurrence.id, codedOccurrence.code]);

  await client.query(`create function clinical.integration_reject_signature_audit()
    returns trigger language plpgsql as $$ begin
      if new.device_id = 'force-sign-rollback' then raise exception 'forced signing rollback'; end if;
      return new;
    end; $$;
    create trigger integration_reject_signature_audit before insert on clinical_audit.event
    for each row execute function clinical.integration_reject_signature_audit()`);
  const signCommand = {
    commandId: randomUUID(), expectedRevision: 8, signerId: userId,
    attestation: { meaning: "author approval", version: 1 },
    actorPersona: "clinician", sessionId: "integration-signing", deviceId: "force-sign-rollback",
    clientTime: "2026-08-30T14:30:00-04:00"
  };
  try {
    const rolledBackSign = await sign(signCommand);
    assert.equal(rolledBackSign.response.status, 500);
  } finally {
    await client.query("drop trigger integration_reject_signature_audit on clinical_audit.event");
    await client.query("drop function clinical.integration_reject_signature_audit()");
  }
  assert.deepEqual((await client.query(`select status,
      (select count(*)::integer from clinical.signed_snapshot where report_id = $1) as snapshots,
      (select count(*)::integer from clinical_audit.event where report_id = $1 and action = 'sign') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = $1 and event_type = 'signed_snapshot') as events,
      (select count(*)::integer from clinical.command_receipt where idempotency_key = $2) as receipts
    from clinical.report where id = $1`, [reportId, signCommand.commandId])).rows[0],
  { status: "draft", snapshots: 0, audits: 0, events: 0, receipts: 0 });

  signCommand.deviceId = "unit-7";
  const signed = await sign(signCommand);
  assert.equal(signed.response.status, 201, JSON.stringify(signed.payload));
  assert.equal(signed.payload.status, "signed");
  assert.equal(signed.payload.signedRevision, 8);
  assert.match(signed.payload.canonicalSha256, /^[a-f0-9]{64}$/);
  const signedState = (await client.query(`select r.status, r.revision, s.signed_revision,
      s.canonical_sha256, s.signer_id, s.attestation,
      (select count(*)::integer from clinical.validation_finding where report_id = r.id) as findings,
      (select count(*)::integer from clinical_audit.event where report_id = r.id and action = 'sign') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = r.id and event_type = 'signed_snapshot') as events
    from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id where r.id = $1`, [reportId])).rows[0];
  assert.deepEqual({ ...signedState, canonical_sha256: undefined }, {
    status: "signed", revision: "8", signed_revision: "8", canonical_sha256: undefined,
    signer_id: userId, attestation: signCommand.attestation, findings: 0, audits: 1, events: 1
  });
  assert.equal(signedState.canonical_sha256, signed.payload.canonicalSha256);
  const signRetry = await sign(signCommand);
  assert.equal(signRetry.response.status, 201);
  assert.deepEqual(signRetry.payload, signed.payload);

  const postSignSave = await request(`/reports/${reportId}/draft-changes`, "POST", {
    commandId: randomUUID(), expectedRevision: 8, authorId: userId,
    occurrences: [{ id: requiredOccurrenceId, elementId: requiredElement.element_id,
      value: { kind: "text", value: "forbidden" } }]
  });
  assert.equal(postSignSave.response.status, 409);
  await assert.rejects(client.query("update clinical.element_occurrence set value_text = 'forbidden' where id = $1", [requiredOccurrenceId]),
    (error) => error.code === "P0001");
  await assert.rejects(client.query("delete from clinical.report where id = $1", [reportId]),
    (error) => error.code === "P0001");

  const signedHash = signed.payload.canonicalSha256;
  const codedBeforeAmendment = (await client.query(`select id, element_id, group_instance_id, ordinal,
      code, code_system, code_display, terminology_version
    from clinical.element_occurrence where id = $1`, [codedOccurrence.id])).rows[0];
  const replacementOccurrenceId = randomUUID();
  const amendmentCommand = {
    commandId: randomUUID(), expectedSequence: 1, authorId: userId,
    reason: "Correct the required response and replace a coded occurrence",
    attestation: { meaning: "author approval of amendment", version: 1 },
    actorPersona: "clinician", sessionId: "integration-amendment", deviceId: "force-amendment-rollback",
    clientTime: "2026-08-30T15:00:00-04:00",
    changes: [
      { action: "replace", targetElementOccurrenceId: requiredOccurrenceId,
        value: { kind: "text", value: "corrected by amendment" } },
      { action: "remove", targetElementOccurrenceId: codedOccurrence.id },
      { action: "add", occurrence: {
        id: replacementOccurrenceId, elementId: codedBeforeAmendment.element_id,
        groupInstanceId: codedBeforeAmendment.group_instance_id, ordinal: codedBeforeAmendment.ordinal,
        value: { kind: "coded", code: codedBeforeAmendment.code,
          codeSystem: codedBeforeAmendment.code_system, display: codedBeforeAmendment.code_display,
          terminologyVersion: codedBeforeAmendment.terminology_version }
      } }
    ]
  };
  await client.query(`create function clinical.integration_reject_amendment_audit()
    returns trigger language plpgsql as $$ begin
      if new.device_id = 'force-amendment-rollback' then raise exception 'forced amendment rollback'; end if;
      return new;
    end; $$;
    create trigger integration_reject_amendment_audit before insert on clinical_audit.event
    for each row execute function clinical.integration_reject_amendment_audit()`);
  try {
    const rolledBackAmendment = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
    assert.equal(rolledBackAmendment.response.status, 500);
  } finally {
    await client.query("drop trigger integration_reject_amendment_audit on clinical_audit.event");
    await client.query("drop function clinical.integration_reject_amendment_audit()");
  }
  assert.deepEqual((await client.query(`select
      (select count(*)::integer from clinical.amendment where report_id = $1) as amendments,
      (select count(*)::integer from clinical.amendment_change ac join clinical.amendment a on a.id = ac.amendment_id where a.report_id = $1) as changes,
      (select count(*)::integer from clinical_audit.event where report_id = $1 and action = 'amend') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = $1 and event_type = 'amendment') as events,
      (select count(*)::integer from clinical.command_receipt where idempotency_key = $2) as receipts`,
  [reportId, amendmentCommand.commandId])).rows[0],
  { amendments: 0, changes: 0, audits: 0, events: 0, receipts: 0 });

  amendmentCommand.deviceId = "unit-7";
  const amended = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
  assert.equal(amended.response.status, 201, JSON.stringify(amended.payload));
  assert.equal(amended.payload.amendmentSequence, 1);
  assert.equal(amended.payload.changeCount, 3);
  assert.equal(amended.payload.reason, amendmentCommand.reason);
  assert.match(amended.payload.canonicalSha256, /^[a-f0-9]{64}$/);
  const amendmentState = (await client.query(`select a.sequence, a.author_id, a.reason, a.attestation,
      count(ac.id)::integer as changes,
      (select canonical_sha256 from clinical.signed_snapshot where report_id = a.report_id) as signed_hash,
      (select value_text from clinical.element_occurrence where id = $2) as original_value,
      (select count(*)::integer from clinical.element_occurrence where id = $3) as added_in_original,
      (select count(*)::integer from clinical_audit.event where report_id = a.report_id and action = 'amend') as audits,
      (select count(*)::integer from integration.outbox_event where aggregate_id = a.report_id and event_type = 'amendment') as events
    from clinical.amendment a join clinical.amendment_change ac on ac.amendment_id = a.id
    where a.report_id = $1 group by a.id`, [reportId, requiredOccurrenceId, replacementOccurrenceId])).rows[0];
  assert.deepEqual(amendmentState, {
    sequence: 1, author_id: userId, reason: amendmentCommand.reason,
    attestation: amendmentCommand.attestation, changes: 3, signed_hash: signedHash,
    original_value: "required", added_in_original: 0, audits: 1, events: 1
  });
  const replayedAmendment = await request(`/reports/${reportId}/amendments`, "POST", amendmentCommand);
  assert.equal(replayedAmendment.response.status, 201);
  assert.deepEqual(replayedAmendment.payload, amended.payload);
  const staleAmendment = await request(`/reports/${reportId}/amendments`, "POST", {
    ...amendmentCommand, commandId: randomUUID(), changes: [
      { action: "replace", targetElementOccurrenceId: requiredOccurrenceId, value: { kind: "text", value: "stale" } }
    ]
  });
  assert.equal(staleAmendment.response.status, 409);
  assert.equal((await client.query("select count(*)::integer as count from clinical.amendment where report_id = $1", [reportId])).rows[0].count, 1);
  await assert.rejects(client.query("update clinical.amendment set reason = 'mutated' where id = $1", [amended.payload.amendmentId]),
    (error) => error.code === "P0001");

  const history = await client.query(`select event_type, report_revision, amendment_sequence,
      actor_id, actor_name, actor_persona, session_id, device_id, client_time, history_timestamp,
      target_type, previous_hash, event_hash
    from clinical_history.report_history where report_id = $1
    order by history_timestamp, history_id`, [reportId]);
  assert.equal(history.rows.filter((row) => row.event_type === "draft-change").length, 8);
  const signHistory = history.rows.find((row) => row.event_type === "sign");
  const amendmentHistory = history.rows.find((row) => row.event_type === "amend");
  assert.deepEqual({
    report_revision: signHistory.report_revision,
    actor_id: signHistory.actor_id,
    actor_name: signHistory.actor_name,
    actor_persona: signHistory.actor_persona,
    session_id: signHistory.session_id,
    device_id: signHistory.device_id,
    target_type: signHistory.target_type,
    previous_hash: signHistory.previous_hash
  }, {
    report_revision: "8",
    actor_id: userId,
    actor_name: "Clinician",
    actor_persona: "clinician",
    session_id: "integration-signing",
    device_id: "unit-7",
    target_type: "signed_snapshot",
    previous_hash: null
  });
  assert.deepEqual({
    report_revision: amendmentHistory.report_revision,
    amendment_sequence: amendmentHistory.amendment_sequence,
    actor_id: amendmentHistory.actor_id,
    target_type: amendmentHistory.target_type,
    previous_hash: amendmentHistory.previous_hash
  }, {
    report_revision: "8",
    amendment_sequence: 1,
    actor_id: userId,
    target_type: "amendment",
    previous_hash: signHistory.event_hash
  });
  assert.ok(signHistory.client_time instanceof Date);
  assert.ok(signHistory.history_timestamp instanceof Date);
  assert.ok(amendmentHistory.history_timestamp instanceof Date);
});
