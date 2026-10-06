import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";

const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
process.env.PATIENT_KEY_INSTALLATION_ID ??= "91000000-0000-4000-8000-000000000001";
process.env.PATIENT_KEY_VERSION ??= "1";
process.env.PATIENT_KEY_SECRET_BASE64 ??= Buffer.alloc(32, 0x31).toString("base64");

integration("new demo patients support the generated-report lifecycle without a call assignment", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("begin");
  try {
    // Exercise the migration and all fixtures in a transaction that is rolled back.
    await client.query(await readFile(new URL(
      "../../../supabase/migrations/20261006173104_synthetic_new_patient_reports.sql", import.meta.url), "utf8"));
    const organizationId = SYNTHETIC_DEMO_FIXTURE.organizationId;
    const userId = SYNTHETIC_DEMO_FIXTURE.userId;
    assert.equal((await client.query("select app_identity.user_has_capability($1,$2,'clinical:demo') allowed",
      [userId, organizationId])).rows[0].allowed, true, "seed the ordinary demo account first");
    await client.query("update app_identity.agency_settings set synthetic_retention_hours=24 where organization_id=$1",
      [organizationId]);
    const ordinaryUserId = randomUUID();
    await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
      values($1,$2,'Rollback new patient clinician')`, [ordinaryUserId, organizationId]);
    await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by,note)
      select $1,$2,id,$3,'Rollback new patient regression' from app_identity.role
      where organization_id=$1 and system_key='clinician'`, [organizationId, ordinaryUserId, userId]);

    let actorId = userId;
    const manager = { query: async (sql, parameters) => {
      const result = await client.query(sql, parameters);
      return /^\s*(insert|update|delete)/i.test(sql) ? [result.rows, result.rowCount] : result.rows;
    } };
    let transactionId = 0;
    const db = { ...manager, manager, transaction: async (first, second) => {
      const work = typeof first === "function" ? first : second;
      const name = `new_patient_${++transactionId}`;
      await client.query(`savepoint ${name}`);
      try {
        const result = await work(manager);
        await client.query(`release savepoint ${name}`);
        return result;
      } catch (error) {
        await client.query(`rollback to savepoint ${name}`);
        await client.query(`release savepoint ${name}`);
        throw error;
      }
    } };
    const sessions = {
      requireCapability: async (_token, capability) => {
        const rows = await manager.query(`select key from app_identity.capability
          where app_identity.user_has_capability($1,$2,key)`, [actorId, organizationId]);
        const capabilities = rows.map(row => row.key);
        if (!capabilities.includes(capability)) throw new UnauthorizedException();
        return { user: { id: actorId }, organization: { id: organizationId }, capabilities };
      },
      assertCsrf: async (_token, csrf) => { if (csrf !== "proof") throw new UnauthorizedException(); },
    };
    const service = new DraftReportService(db, sessions);
    if (!(await manager.query("select organization_id from app_identity.active_configuration_bundle where organization_id=$1",
      [organizationId])).length) {
      // Fresh CI databases have the published fixture form but have not activated
      // a validation bundle. Prepare one through the ordinary authoring workflow.
      const baseline = (await manager.query(`select fv.id,fv.catalog_release_id
        from forms.agency_stationary_default d join forms.form_version fv on fv.id=d.form_version_id
        where d.organization_id=$1`, [organizationId]))[0];
      assert.ok(baseline, "seed the published demonstration form first");
      actorId = randomUUID();
      await manager.query(`insert into app_identity.app_user(id,organization_id,display_name)
        values($1,$2,'Rollback configuration author')`, [actorId, organizationId]);
      await manager.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by,note)
        select $1,$2,id,$3,'Rollback configuration author' from app_identity.role
        where organization_id=$1 and system_key='administrator'`, [organizationId, actorId, userId]);
      const validations = new ValidationAuthoringService(db, sessions);
      const draft = await validations.create("fixture-owner", {
        catalogReleaseId: baseline.catalog_release_id, displayName: "Rollback new patient policy",
      }, { importedRules: [{ id: randomUUID(), name: "Fictional narrative", enabled: false, severity: "error",
        executionTargets: ["live", "sign"], primaryTargetElementId: "eNarrative.01",
        message: "Fictional narrative required", source: 'require present("eNarrative.01")' }] });
      const published = await validations.publish("fixture-owner", draft.id, {
        expectedRevision: draft.revision, displayName: draft.displayName, changeNote: "Rollback regression fixture",
      });
      await validations.activate("fixture-owner", published.id, {
        formVersionId: baseline.id, catalogReleaseId: baseline.catalog_release_id, changeNote: "Rollback regression fixture",
      });
      actorId = userId;
    }
    const command = () => ({ commandId: randomUUID(), reportId: randomUUID(), incidentId: randomUUID(),
      patientId: randomUUID(), organizationId, documentingUserId: actorId, patientIdentityState: "unknown" });
    await client.query("set local role open_triage_api_runtime");

    const demo = command();
    const created = await service.create("demo", demo);
    assert.equal(created.id, demo.reportId);
    assert.deepEqual(await service.create("demo", demo), created, "creation replays without changing provenance");
    const stored = (await manager.query(`select r.synthetic,r.synthetic_generated_by,r.synthetic_source_assignment_id,
      r.expires_at,extract(epoch from(r.expires_at-r.created_at))/3600 hours,i.synthetic incident_synthetic
      from clinical.report r join clinical.incident i on i.id=r.incident_id where r.id=$1`, [demo.reportId]))[0];
    assert.equal(stored.synthetic, true);
    assert.equal(stored.incident_synthetic, true);
    assert.equal(stored.synthetic_generated_by, userId);
    assert.equal(stored.synthetic_source_assignment_id, null);
    assert.equal(Number(stored.hours), 24);
    assert.equal((await manager.query("select id from clinical.call_assignment where report_id=$1", [demo.reportId])).length, 0);
    const opened = await service.reopen("demo", demo.reportId);
    assert.equal(opened.report.demoMutable, true);
    assert.equal(opened.report.expiresAt, stored.expires_at.toISOString());
    assert.equal((await service.listOpen("demo")).openCalls.find(row => row.reportId === demo.reportId).demoMutable, true);

    const parent = (await manager.query(`select id from clinical.group_instance
      where report_id=$1 and group_id='PatientCareReportGroup'`, [demo.reportId]))[0].id;
    const group = { id: randomUUID(), groupId: "eNarrativeSection", parentGroupInstanceId: parent, ordinal: 0,
      correlationId: "demo:stationary-populate-v1:new-patient" };
    const occurrence = { id: randomUUID(), groupInstanceId: group.id, elementId: "eNarrative.01", ordinal: 0,
      provenanceKind: "demo", provenanceDetail: { generator: "stationary-populate-v1" },
      sourceAttributes: { "x-open-triage-demo": "stationary-populate-v1" },
      value: { kind: "text", value: "Fictional new patient demonstration" } };
    const populate = { commandId: randomUUID(), expectedRevision: created.revision, authorId: userId,
      demoAction: "populate", groups: [group], occurrences: [occurrence] };
    await assert.rejects(service.save("demo", demo.reportId, populate, "incorrect"), UnauthorizedException);
    const populated = await service.save("demo", demo.reportId, populate, "proof");
    const reopened = await service.reopen("demo", demo.reportId);
    assert.equal(reopened.report.demoMutable, true);
    assert.equal(reopened.report.document.groups.find(row => row.id === "eNarrativeSection")
      .instances[0].elements[0].values[0].value, occurrence.value.value);
    await service.save("demo", demo.reportId, {
      commandId: randomUUID(), expectedRevision: populated.revision, authorId: userId, demoAction: "clear",
      groups: [{ id: group.id, groupId: group.groupId, ordinal: 0, tombstone: true }],
      occurrences: [{ id: occurrence.id, groupInstanceId: group.id, elementId: occurrence.elementId, tombstone: true }],
    }, "proof");
    assert.equal((await manager.query("select tombstoned_at is not null cleared from clinical.element_occurrence where id=$1",
      [occurrence.id]))[0].cleared, true);

    actorId = ordinaryUserId;
    const ordinary = command();
    // Client-supplied synthetic fields cannot grant access to the demo tools.
    await service.create("ordinary", { ...ordinary, synthetic: true, synthetic_generated_by: ordinaryUserId });
    const ordinaryStored = (await manager.query(`select synthetic,synthetic_generated_by,expires_at
      from clinical.report where id=$1`, [ordinary.reportId]))[0];
    assert.deepEqual(ordinaryStored, { synthetic: false, synthetic_generated_by: null, expires_at: null });
    assert.equal((await service.reopen("ordinary", ordinary.reportId)).report.demoMutable, undefined);
    await assert.rejects(service.deleteSyntheticDraft("ordinary", ordinary.reportId, "proof"), UnauthorizedException);
    await assert.rejects(service.reopen("ordinary", demo.reportId), NotFoundException);

    actorId = userId;
    await assert.rejects(service.deleteSyntheticDraft("demo", ordinary.reportId, "proof"), ConflictException);
    await assert.rejects(db.transaction(() => manager.query(
      "update clinical.report set synthetic_generated_by=$2 where id=$1", [demo.reportId, ordinaryUserId])),
    /provenance and expiry are immutable/);
    assert.deepEqual(await service.deleteSyntheticDraft("demo", demo.reportId, "proof"),
      { deleted: true, reportId: demo.reportId });
    assert.equal((await manager.query("select id from clinical.report where id=$1", [demo.reportId])).length, 0);
    assert.equal((await manager.query("select id from clinical.patient where id=$1", [demo.patientId])).length, 0);

    // The existing purge also covers standalone reports and blocks replay afterwards.
    const expiring = command();
    await service.create("demo", expiring);
    assert.equal((await manager.query("select status from clinical.report where id=$1", [expiring.reportId]))[0].status, "draft");
    const expiry = (await manager.query("select expires_at from clinical.report where id=$1", [expiring.reportId]))[0].expires_at;
    await client.query("reset role");
    await client.query("select retention.purge_expired_synthetic_records($1)", [new Date(expiry.getTime() + 1)]);
    assert.equal((await manager.query("select id from clinical.report where id=$1", [expiring.reportId])).length, 0);
    await assert.rejects(service.create("demo", expiring), ConflictException);

    await client.query("update app_identity.agency_settings set synthetic_retention_hours=null where organization_id=$1",
      [organizationId]);
    const retained = command();
    await service.create("demo", retained);
    assert.equal((await manager.query("select expires_at from clinical.report where id=$1", [retained.reportId]))[0].expires_at, null);
    assert.equal((await service.reopen("demo", retained.reportId)).report.demoMutable, true);
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
