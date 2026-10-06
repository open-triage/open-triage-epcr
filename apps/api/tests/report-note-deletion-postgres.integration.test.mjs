import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { DraftReportService } from "../dist/reports/draft-report.service.js";

const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

integration("authorized demo deletion and expiry remove note dependencies while ordinary audit deletion is denied", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("begin");
  try {
    // All generated records and the migration are rolled back. Borrow only the
    // pinned configuration and identity of an existing fictional installation.
    const template = (await client.query(`select r.*, ca.unit_id from clinical.report r
      join clinical.call_assignment ca on ca.report_id=r.id
      where r.synthetic order by r.created_at desc limit 1`)).rows[0];
    assert.ok(template, "seed a synthetic report before running this integration test");
    const installed = (await client.query("select to_regprocedure('clinical.delete_report_note_dependencies()') as name")).rows[0].name;
    await client.query("update app_identity.agency_settings set synthetic_retention_hours=1 where organization_id=$1",
      [template.organization_id]);

    async function fixture(expired = false) {
      const report = randomUUID(), incident = randomUUID(), patient = randomUUID(), assignment = randomUUID();
      const organization = template.organization_id, user = template.documenting_user_id;
      await client.query(`insert into clinical.incident(id,organization_id,operational_state,synthetic)
        values($1,$2,'assigned',true)`, [incident, organization]);
      await client.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key)
        values($1,$2,'unknown',$3)`, [patient, organization, report.replaceAll("-", "").repeat(2)]);
      await client.query(`insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,
        dispatched_at,status,synthetic,synthetic_generated_by)
        values($1,$2,$3,$4,'NOTE-DELETION-TEST',now(),'assigned',true,$5)`,
      [assignment, organization, template.unit_id, incident, user]);
      await client.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,
        agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,
        validation_version_id,synthetic,synthetic_generated_by,synthetic_source_assignment_id,
        form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$8,$10,$11,$12,$13,$14)`,
      [report, organization, incident, patient, template.agency_demographic_version_id,
        template.form_version_id, template.catalog_release_id, user, template.validation_version_id, assignment,
        template.form_definition_sha256, template.catalog_artifact_sha256, template.validation_compiled_sha256,
        new Date(Date.now() - (expired ? 2 * 60 * 60 * 1000 : 0))]);
      await client.query("update clinical.call_assignment set report_id=$2,status='opened' where id=$1", [assignment, report]);
      const command = randomUUID();
      await client.query(`insert into clinical.report_change(report_id,revision,idempotency_key,author_id,changes)
        values($1,1,$2,$3,'[]')`, [report, command, user]);
      for (const kind of ["text", "photo", "audio"]) {
        const note = randomUUID();
        if (kind === "text") {
          await client.query(`insert into clinical.report_note(id,organization_id,report_id,captured_at,
            captured_utc_offset_minutes,content,created_by,updated_by)
            values($1,$2,$3,now(),0,'Fictional deletion regression',$4,$4)`, [note, organization, report, user]);
        } else {
          const metadata = kind === "photo" ? "width,height" : "duration_milliseconds";
          const values = kind === "photo" ? "1,1" : "100";
          await client.query(`insert into clinical.report_${kind}_note(id,organization_id,report_id,captured_at,
            captured_utc_offset_minutes,content_type,byte_size,sha256,created_by,updated_by,${metadata})
            values($1,$2,$3,now(),0,$4,1,$5,$6,$6,${values})`,
          [note, organization, report, kind === "photo" ? "image/jpeg" : "audio/mp4", "a".repeat(64), user]);
          await client.query(`insert into clinical.report_${kind}_blob(organization_id,report_id,note_id,canonical_bytes)
            values($1,$2,$3,$4)`, [organization, report, note, Buffer.from([1])]);
          await client.query(`insert into clinical_audit.report_media_access_event(organization_id,report_id,
            note_id,media_type,actor_id,action,result) values($1,$2,$3,$4,$5,'retrieve','allowed')`,
          [organization, report, note, kind, user]);
        }
        await client.query(`insert into clinical.report_note_target_state(report_id,note_type,note_id,
          revision,command_id,actor_id,action) values($1,$2,$3,1,$4,$5,'create')`, [report, kind, note, command, user]);
        await client.query(`insert into clinical_audit.report_note_mutation_event(organization_id,report_id,
          note_id,note_type,command_id,actor_id,action,result,report_revision)
          values($1,$2,$3,$4,$5,$6,'create','applied',1)`, [organization, report, note, kind, command, user]);
      }
      return report;
    }
    const manual = await fixture();
    const expiring = await fixture(true);
    const session = { user: { id: template.documenting_user_id }, organization: { id: template.organization_id } };
    const manager = { query: async (sql, parameters) => {
      const result = await client.query(sql, parameters);
      return /^\s*delete/i.test(sql) ? [result.rows, result.rowCount] : result.rows;
    } };
    const service = new DraftReportService({ transaction: work => work(manager) }, {
      assertCsrf: async () => {}, requireCapability: async () => session,
    });
    if (!installed) {
      await client.query("savepoint original_failure");
      await client.query("set local role open_triage_api_runtime");
      await assert.rejects(service.deleteSyntheticDraft("fixture-token", manual, "fixture-csrf"),
        error => error.code === "23503", "note lineage must reproduce the original foreign-key failure");
      await client.query("rollback to savepoint original_failure");
      await client.query(await readFile(new URL(
        "../../../supabase/migrations/20261006141416_report_note_deletion_dependencies.sql", import.meta.url), "utf8"));
    }
    await client.query("set local role open_triage_api_runtime");
    await client.query("savepoint denied_audit_delete");
    await assert.rejects(client.query("delete from clinical_audit.report_note_mutation_event where report_id=$1", [manual]),
      error => ["42501", "P0001"].includes(error.code));
    await client.query("rollback to savepoint denied_audit_delete");
    assert.deepEqual(await service.deleteSyntheticDraft("fixture-token", manual, "fixture-csrf"), { deleted: true, reportId: manual });
    await client.query("reset role");
    // A fixture-only expiry in this transaction exercises the scheduled cleanup
    // with the same content and audit dependencies as manual deletion.
    await client.query("select retention.purge_expired_synthetic_records(clock_timestamp())");
    for (const table of ["clinical.report", "clinical.report_change", "clinical.report_note_target_state",
      "clinical.report_note", "clinical.report_photo_note", "clinical.report_photo_blob",
      "clinical.report_audio_note", "clinical.report_audio_blob", "clinical_audit.report_note_mutation_event",
      "clinical_audit.report_media_access_event"]) {
      const key = table === "clinical.report" ? "id" : "report_id";
      assert.equal((await client.query(`select count(*)::integer n from ${table} where ${key}=any($1::uuid[])`,
        [[manual, expiring]])).rows[0].n, 0, table);
    }
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
