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
        on m.release_id = e.release_id and m.element_id = e.element_id where e.release_id = $1 and exists
        (select 1 from catalog.element_option o where o.release_id = e.release_id and o.element_id = e.element_id and o.source_kind = 'inline') order by e.element_id limit 1) as coded_id,
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
});
