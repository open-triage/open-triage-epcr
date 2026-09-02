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
    assert.equal(response.status, 201);
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
      ($1, $3, 'integration', $5, 'Clinical time', 'dateTime', '{}'),
      ($2, $3, 'integration', $6, 'Clinical text', 'string', '{}')`,
      [timeElementId, textElementId, organizationId, groupId, `time-${timeElementId}`, `text-${textElementId}`]);
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
