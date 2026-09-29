import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { compileValidationRule, compiledValidationBundleSha256 } from "@open-triage/contracts";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) throw Error("DATABASE_URL is required");
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("runtime note deletion removes content while signed notes and retention remain protected", async (t) => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const fixture = (await client.query(`select a.*,
      u.id as user_id,d.id as demographic_id from app_identity.active_configuration_bundle a
      join app_identity.app_user u on u.organization_id=a.organization_id and u.active
      join app_identity.agency_demographic_version d on d.organization_id=a.organization_id
        and d.catalog_release_id=a.catalog_release_id limit 1`)).rows[0];
    assert.ok(fixture, "Seed a local demonstration organization before integration tests");
    const { organization_id: organizationId, user_id: userId } = fixture;
    const incidentId = randomUUID(), patientId = randomUUID(), reportId = randomUUID(), noteId = randomUUID();
    await client.query("insert into clinical.incident(id,organization_id) values ($1,$2)", [incidentId, organizationId]);
    await client.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key)
      values ($1,$2,'unknown',$3)`, [patientId, organizationId, createHash("sha256").update(patientId).digest("hex")]);
    await client.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,
      agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,
      validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [reportId, organizationId, incidentId, patientId,
      fixture.demographic_id, fixture.form_version_id, fixture.catalog_release_id, userId,
      fixture.validation_version_id, fixture.form_definition_sha256, fixture.catalog_artifact_sha256, fixture.validation_compiled_sha256]);
    await client.query("set local role open_triage_api_runtime");
    assert.equal((await client.query("select has_function_privilege(current_user,'retention.deletion_is_authorized(uuid)','EXECUTE') as allowed")).rows[0].allowed, false);
    for (const kind of ["text", "photo", "audio"]) await t.test(kind, async () => {
      const table = kind === "text" ? "clinical.report_note" : `clinical.report_${kind}_note`;
      const blobTable = kind === "text" ? null : `clinical.report_${kind}_blob`;
      const bytes = Buffer.from(`synthetic-${kind}`);
      async function createNote() {
        if (kind === "text") {
          await client.query(`insert into clinical.report_note(id,organization_id,report_id,captured_at,
            captured_utc_offset_minutes,content,created_by,updated_by)
            values ($1,$2,$3,now(),0,'Synthetic note',$4,$4)`, [noteId, organizationId, reportId, userId]);
          return;
        }
        await client.query(`insert into ${table}(id,organization_id,report_id,captured_at,
          captured_utc_offset_minutes,content_type,byte_size,sha256,${kind === "photo" ? "width,height" : "duration_milliseconds"},created_by,updated_by)
          values ($1,$2,$3,now(),0,$4,$5,$6,${kind === "photo" ? "1,1" : "1000"},$7,$7)`,
        [noteId, organizationId, reportId, kind === "photo" ? "image/jpeg" : "audio/mp4",
          bytes.length, createHash("sha256").update(bytes).digest("hex"), userId]);
        await client.query(`insert into ${blobTable}(organization_id,report_id,note_id,canonical_bytes)
          values ($1,$2,$3,$4)`, [organizationId, reportId, noteId, bytes]);
      }
      await createNote();
      assert.equal((await client.query(`delete from ${table} where id=$1 returning id`, [noteId])).rowCount, 1);
      assert.equal((await client.query(`select 1 from ${table} where id=$1`, [noteId])).rowCount, 0);
      if (blobTable) assert.equal((await client.query(`select 1 from ${blobTable} where note_id=$1`, [noteId])).rowCount, 0);
      assert.equal((await client.query(`delete from ${table} where id=$1`, [noteId])).rowCount, 0);
      await createNote();
      await client.query("savepoint signed_note");
      await client.query(`update clinical.report set status='signed',reporting_date=current_date,
        reporting_date_source='signing-time' where id=$1`, [reportId]);
      await assert.rejects(client.query(`delete from ${table} where id=$1`, [noteId]), /signed report.*immutable/);
      await client.query("rollback to savepoint signed_note");
      if (kind === "photo") {
        await client.query("savepoint protected_bytes");
        await assert.rejects(client.query(`delete from ${blobTable} where note_id=$1`, [noteId]), /permission denied/);
        await client.query("rollback to savepoint protected_bytes");
      }
    });
  } finally { await client.query("rollback"); await client.end(); }
});

integrationTest("form activation requires exact consent and atomically publishes compatible rules with immutable history", async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const fixture = (await client.query(`select a.*,u.id as user_id from app_identity.active_configuration_bundle a
      join app_identity.app_user u on u.organization_id=a.organization_id and u.active limit 1`)).rows[0];
    assert.ok(fixture, "Seed a local demonstration organization before integration tests");
    const org = fixture.organization_id, actor = fixture.user_id, catalog = fixture.catalog_release_id;
    let savepoint = 0;
    const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
    const database = { manager, query: manager.query, transaction: async (_isolation, work) => {
      const name = `activation_${++savepoint}`;
      await client.query(`savepoint ${name}`);
      try { const result = await work(manager); await client.query(`release savepoint ${name}`); return result; }
      catch (error) { await client.query(`rollback to savepoint ${name}`); throw error; }
    } };
    const sessions = { requireCapability: async () => ({ organization: { id: org }, user: { id: actor },
      capabilities: ["forms:read", "forms:write", "forms:publish", "validation:write", "validation:publish"] }) };
    const service = new ValidationAuthoringService(database, sessions);
    const forms = new FormAuthoringService(database, sessions, new FormPublicationService(database), service);
    const formId = randomUUID(), formVersion = randomUUID(), versionId = randomUUID(), identityId = randomUUID();
    const definition = { schemaVersion: 1, sections: [{ key: "response", fields: [
      { key: "incident", source: { kind: "nemsis", elementId: "eResponse.03" } },
    ] }] };
    await client.query("insert into forms.form(id,organization_id,slug,name) values ($1,$2,$3,'Feedback regression')", [formId, org, `feedback-${formId}`]);
    await client.query(`insert into forms.form_version(id,form_id,catalog_release_id,version,status,canonical_definition,
      definition_sha256,created_by) values ($1,$2,$3,1,'draft',$4::jsonb,$5,$6)`,
    [formVersion, formId, catalog, JSON.stringify(definition), canonicalDefinitionSha256(definition), actor]);
    // Save a removal and reload it through the same API service used by the editor.
    const removedDefinition = { ...definition, sections: [{ key: "response", fields: [] }] };
    const saved = await forms.save("session", formVersion, { expectedRevision: 1, definition: removedDefinition, displayName: "Reduced form" });
    assert.deepEqual(saved.definition, removedDefinition);
    assert.deepEqual((await forms.current("session")).definition, removedDefinition);
    await forms.publish("session", formVersion, { expectedRevision: saved.revision,
      definitionSha256: saved.definitionSha256, displayName: "Reduced form", changeNote: "Remove fields" });
    const sourceRules = [
      { id: randomUUID(), name: "Removed field", primaryTargetElementId: "ePatient.02", source: 'require present("ePatient.02")' },
      { id: randomUUID(), name: "Removed dependency", primaryTargetElementId: "eResponse.03", source: 'when present("ePatient.02")\nrequire present("eResponse.03")' },
      { id: randomUUID(), name: "Retained review", primaryTargetElementId: "ePatient.02", source: 'require present("ePatient.02")', executionTargets: ["review"] },
    ].map((rule) => ({ enabled: true, severity: "error", executionTargets: ["live", "sign"], message: rule.name, ...rule }));
    sourceRules.push({ ...sourceRules[0], id: randomUUID(), name: "Duplicate removed field" });
    const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId, catalogReleaseId: catalog,
      rules: sourceRules.slice(0, 3).map((rule) => { const result = compileValidationRule(rule, versionId, new Set(["ePatient.02", "eResponse.03"]));
        assert.ok(result.compiled, JSON.stringify(result.diagnostics)); return result.compiled; }) };
    await client.query("insert into validation.rule_identity(id,organization_id,created_by) values ($1,$2,$3)", [identityId, org, actor]);
    await client.query(`insert into validation.version(id,organization_id,catalog_release_id,rule_id,status,version,display_name,
      source_rule,compiled_bundle,compiled_sha256,source_sha256,change_note,created_by,published_by,published_at)
      select $1,$2,$3,$4,'published',coalesce(max(version),0)+1,'Feedback rules',$5::jsonb,$6::jsonb,$7,$8,'Regression',$9,$9,now()
      from validation.version where organization_id=$2`, [versionId, org, catalog, identityId, JSON.stringify(sourceRules), JSON.stringify(bundle),
      compiledValidationBundleSha256(bundle), createHash("sha256").update(JSON.stringify(sourceRules)).digest("hex"), actor]);
    await client.query("set local role open_triage_api_runtime");
    const command = { formVersionId: formVersion, catalogReleaseId: catalog, changeNote: "Approved removal" };
    let impacted;
    await assert.rejects(service.activate("session", versionId, command), (error) => {
      impacted = error.getResponse().impactedRules;
      return error.getResponse().code === "admin.formValidationRemovalRequired";
    });
    assert.deepEqual(impacted.map(({ id }) => id), [sourceRules[0], sourceRules[1], sourceRules[3]].map(({ id }) => id));
    const countBefore = (await client.query("select count(*) from validation.version where organization_id=$1", [org])).rows[0].count;
    await assert.rejects(service.activate("session", versionId, { ...command, removeImpactedRuleIds: [impacted[0].id] }));
    assert.equal((await client.query("select validation_version_id from app_identity.active_configuration_bundle where organization_id=$1", [org])).rows[0].validation_version_id, fixture.validation_version_id);
    assert.equal((await client.query("select count(*) from validation.version where organization_id=$1", [org])).rows[0].count, countBefore);
    const deniedService = new ValidationAuthoringService(database, { requireCapability: async (token, capability) => {
      if (capability === "validation:write") throw Error("Missing validation write authority");
      return sessions.requireCapability(token, capability);
    } });
    await assert.rejects(deniedService.activate("session", versionId, { ...command,
      removeImpactedRuleIds: impacted.map(({ id }) => id) }), /Missing validation write authority/);
    assert.equal((await client.query("select count(*) from validation.version where organization_id=$1", [org])).rows[0].count, countBefore);
    const failingDatabase = { ...database, transaction: async (isolation, work) => database.transaction(isolation, (transaction) => work({
      query: async (sql, params) => {
        if (sql.includes("insert into app_identity.active_configuration_bundle")) throw Error("Injected activation failure");
        return transaction.query(sql, params);
      },
    })) };
    const failingService = new ValidationAuthoringService(failingDatabase, sessions);
    await assert.rejects(failingService.activate("session", versionId, { ...command,
      removeImpactedRuleIds: impacted.map(({ id }) => id) }), /Injected activation failure/);
    assert.equal((await client.query("select count(*) from validation.version where organization_id=$1", [org])).rows[0].count, countBefore);
    const result = await service.activate("session", versionId, { ...command, removeImpactedRuleIds: impacted.map(({ id }) => id) });
    assert.notEqual(result.validationVersionId, versionId);
    const derived = (await client.query("select * from validation.version where id=$1", [result.validationVersionId])).rows[0];
    assert.equal(derived.cloned_from_id, versionId);
    assert.deepEqual(derived.source_rule, [sourceRules[2]]);
    assert.equal(derived.compiled_bundle.rules.length, 1);
    assert.equal(derived.compiled_bundle.rules[0].validationVersionId, derived.id);
    assert.equal(derived.compiled_sha256, compiledValidationBundleSha256(derived.compiled_bundle));
    assert.deepEqual((await client.query("select source_rule from validation.version where id=$1", [versionId])).rows[0].source_rule, sourceRules);
    assert.equal((await client.query("select count(*) from validation.change_event where destination_version_id=$1", [derived.id])).rows[0].count, "2");
    assert.equal((await client.query("select validation_version_id from app_identity.active_configuration_bundle where organization_id=$1", [org])).rows[0].validation_version_id, derived.id);
  } finally { await client.query("rollback"); await client.end(); }
});
