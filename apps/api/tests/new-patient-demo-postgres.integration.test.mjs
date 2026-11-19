import {enableProductionWorkflowForTesting} from './fixtures/production-workflow-rollout.mjs';
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { decisionSupportElementKey, SYNTHETIC_DEMO_FIXTURE, WEST_A_DECISION_SUPPORT_KEY } from "@open-triage/contracts";
import { AgencySettingsService } from "../dist/admin/agency-settings.service.js";
import { CatalogAuthoringService } from "../dist/admin/catalog-authoring.service.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import { canonicalDefinitionSha256 } from "../dist/forms/form-publication.validation.js";

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
    await client.query("update app_identity.agency_settings set synthetic_retention_hours=24,decision_support_system=null where organization_id=$1",
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
    const configAdmin = randomUUID();
    {
      // Publish a fresh, minimal Form and Validation bundle in the rollback
      // transaction so coverage does not depend on local or legacy configuration.
      const baseline = (await manager.query(`select fv.id,fv.catalog_release_id
        from forms.agency_stationary_default d join forms.form_version fv on fv.id=d.form_version_id
        where d.organization_id=$1`, [organizationId]))[0];
      assert.ok(baseline, "seed the published demonstration form first");
      actorId = configAdmin;
      await manager.query(`insert into app_identity.app_user(id,organization_id,display_name)
        values($1,$2,'Rollback configuration author')`, [actorId, organizationId]);
      await manager.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by,note)
        select $1,$2,id,$3,'Rollback configuration author' from app_identity.role
        where organization_id=$1 and system_key='administrator'`, [organizationId, actorId, userId]);
      const formId = randomUUID();
      const formVersionId = randomUUID();
      const definition = { schemaVersion: 1, sections: [{ key: "narrative", fields: [
        { key: "narrative", source: { kind: "nemsis", elementId: "eNarrative.01" } },
      ] }] };
      const definitionSha256 = canonicalDefinitionSha256(definition);
      await manager.query(`insert into forms.form(id,organization_id,slug,name)
        values($1,$2,$3,'Rollback new patient form')`, [formId, organizationId, `rollback-${formId}`]);
      await manager.query(`insert into forms.form_version(id,form_id,catalog_release_id,version,
        canonical_definition,definition_sha256,created_by)
        values($1,$2,$3,1,$4::jsonb,$5,$6)`, [formVersionId, formId, baseline.catalog_release_id,
        JSON.stringify(definition), definitionSha256, actorId]);
      await new FormPublicationService(db).publish(formVersionId, {
        publishedBy: actorId, definitionSha256, changeNote: "Rollback regression fixture",
      }, organizationId);
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
        formVersionId, catalogReleaseId: baseline.catalog_release_id, changeNote: "Rollback regression fixture",
      });
      actorId = userId;
    }
    const command = () => ({ commandId: randomUUID(), reportId: randomUUID(), incidentId: randomUUID(),
      patientId: randomUUID(), organizationId, documentingUserId: actorId, patientIdentityState: "unknown" });
    // Synthetic creation still requires a live personal session during preparation.
    await client.query(`insert into app_identity.app_session(user_id,organization_id,token_sha256,csrf_sha256,credential_version,expires_at)
      select user_id,$2,$3,$4,credential_version,clock_timestamp()+interval '1 hour'
      from app_identity.local_credential where user_id=$1`,
      [userId,organizationId,createHash('sha256').update('demo').digest('hex'),createHash('sha256').update('proof').digest('hex')]);
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

    assert.equal(opened.report.clinicalForm.decisionSupport, undefined);
    const settingsService = new AgencySettingsService(db, sessions);
    const catalogs = new CatalogAuthoringService(db, sessions);
    const setDecisionSupport = async (decisionSupportSystem) => {
      const settings = await settingsService.get("fixture-owner");
      const { revision, language, appearance, demographics, reportMediaAllowanceBytes, imageMediaLimitBytes } = settings;
      return settingsService.update("fixture-owner", { expectedRevision: revision, language, appearance, demographics,
        reportMediaAllowanceBytes, imageMediaLimitBytes, decisionSupportSystem });
    };
    actorId = configAdmin;
    assert.equal((await settingsService.get("fixture-owner")).decisionSupportSystem, null);
    assert.equal((await setDecisionSupport(WEST_A_DECISION_SUPPORT_KEY)).decisionSupportSystem, WEST_A_DECISION_SUPPORT_KEY);
    const registered = await catalogs.decisionSupportElements("fixture-owner");
    assert.equal(registered.length, 6);
    assert.ok(registered.every(({ correlatesTo }) => correlatesTo === "eVitals.VitalGroup"));
    assert.ok(registered.find(({ decisionSupportField }) => decisionSupportField === "criteria").choices
      .some(({ code }) => code === "allergy.none"));
    assert.deepEqual(await manager.query(`select base_datatype from forms.custom_element_definition where id=$1`,
      [registered.find(({ decisionSupportField }) => decisionSupportField === "physiologyScore").id]), [{ base_datatype: "integer" }]);

    actorId = ordinaryUserId;
    await assert.rejects(settingsService.update("ordinary", { decisionSupportSystem: null }), UnauthorizedException);
    actorId = userId;
    const westReport = command();
    await service.create("demo", westReport);
    const westOpened = await service.reopen("demo", westReport.reportId);
    const west = westOpened.report.clinicalForm.decisionSupport;
    assert.equal(west.definition.key, WEST_A_DECISION_SUPPORT_KEY);
    assert.equal(west.definition.version, "1.0.0-draft.4");
    assert.deepEqual(Object.keys(west.definition.assessment.elements.newsScale.values), ["standard", "obstetric", "copd"]);
    assert.equal(west.fields.overrideColour.id, registered.find(({ decisionSupportField }) =>
      decisionSupportField === "overrideColour").id);
    assert.equal((await service.reopen("demo", demo.reportId)).report.clinicalForm.decisionSupport, undefined);
    await assert.rejects(db.transaction(() => manager.query(
      "update clinical.report set decision_support_definition_id=null where id=$1", [westReport.reportId])),
    /decision support pin is immutable/);

    const override = west.fields.overrideColour;
    const vitalGroupId = randomUUID();
    const sectionId = randomUUID();
    const overrideId = randomUUID();
    const measuredAt = "2026-10-20T12:00:00+02:00";
    const enteredAt = "2026-10-20T12:01:00+02:00";
    const root = westOpened.report.document.groups.find(({ id }) => id === "PatientCareReportGroup").instances[0];
    const calculation = { status: "unassessed", colour: null, systemKey: west.definition.key, version: west.definition.version,
      physiology: { total: null, colour: null, points: {} } };
    const scaleField = west.fields.newsScale;
    const scale = { id: randomUUID(), groupInstanceId: vitalGroupId, elementId: decisionSupportElementKey(scaleField),
      value: { kind: "coded", code: "standard", codeSystem: scaleField.codeSystem } };
    const groups = [
      { id: sectionId, groupId: "eVitalsSection", ordinal: 0, parentGroupInstanceId: root.instanceId },
      { id: vitalGroupId, groupId: "eVitals.VitalGroup", ordinal: 0, parentGroupInstanceId: sectionId,
        documentedTime: measuredAt, decisionSupportCalculation: calculation },
    ];
    const measurement = { id: randomUUID(), groupInstanceId: vitalGroupId, elementId: "eVitals.01",
      value: { kind: "datetime", value: measuredAt } };
    const manual = { id: overrideId, groupInstanceId: vitalGroupId, elementId: decisionSupportElementKey(override),
      value: { kind: "coded", code: "red", codeSystem: override.codeSystem },
      sourceAttributes: { enteredBy: userId, enteredAt, calculatedColourWhenSelected: null } };
    const saveVital = (expectedRevision, groups, occurrences) => service.save("demo", westReport.reportId, {
      commandId: randomUUID(), expectedRevision, authorId: userId, groups, occurrences,
    });

    await assert.rejects(saveVital(westOpened.report.revision, [groups[0], {
      id: vitalGroupId, groupId: "eVitals.VitalGroup", ordinal: 0, parentGroupInstanceId: sectionId, documentedTime: measuredAt,
    }], [measurement, scale]), /one effective color/);
    await assert.rejects(saveVital(westOpened.report.revision, groups, [measurement]), /one configured NEWS scale/);
    await assert.rejects(saveVital(westOpened.report.revision, groups, [measurement, scale]), /one effective color/);
    await assert.rejects(saveVital(westOpened.report.revision, groups, [measurement, {
      ...manual, sourceAttributes: { ...manual.sourceAttributes, enteredBy: ordinaryUserId },
    }]), /authorized author/);
    await assert.rejects(saveVital(westOpened.report.revision, [
      groups[0], { ...groups[1], decisionSupportCalculation: { ...calculation, colour: "green", status: "definitive" } },
    ], [measurement, scale]), /does not match the supported inputs/);
    const saved = await saveVital(westOpened.report.revision, groups, [measurement, scale, manual]);
    const downgraded = await saveVital(saved.revision, [], [{ ...manual, value: { ...manual.value, code: "green" },
      sourceAttributes: { ...manual.sourceAttributes, enteredAt: "2026-10-20T12:02:00+02:00" } }]);
    const reloaded = (await service.reopen("demo", westReport.reportId)).report.document.groups
      .find(({ id }) => id === "eVitals.VitalGroup").instances.find(({ instanceId }) => instanceId === vitalGroupId);
    assert.deepEqual(reloaded.decisionSupportCalculation, calculation);
    assert.equal(Date.parse(reloaded.attributes.documentedTime), Date.parse(measuredAt));
    const [storedOverride] = reloaded.elements.find(({ id }) => id === manual.elementId).values;
    assert.equal(storedOverride.occurrenceId, overrideId);
    assert.equal(storedOverride.code, "green");
    assert.deepEqual(storedOverride.attributes, { ...manual.sourceAttributes, enteredAt: "2026-10-20T12:02:00+02:00",
      "x-open-triage-owner": "clinician" });

    await assert.rejects(saveVital(downgraded.revision, [], [{
      ...measurement, value: { kind: "datetime", value: "2026-10-20T15:00:00+02:00" },
    }]), /measurement time/);
    await assert.rejects(saveVital(downgraded.revision, [{ ...groups[1], decisionSupportCalculation: undefined, documentedTime: null }], []),
      /measurement time/);
    await assert.rejects(saveVital(downgraded.revision, [], [{
      id: overrideId, groupInstanceId: vitalGroupId, elementId: manual.elementId, tombstone: true,
    }]), /one effective color/);
    assert.equal((await service.reopen("demo", westReport.reportId)).report.revision, downgraded.revision);

    const westCode = (field, code, ordinal = 0) => ({
      id: randomUUID(), groupInstanceId: vitalGroupId, ordinal, elementId: decisionSupportElementKey(west.fields[field]),
      value: { kind: "coded", code, codeSystem: west.fields[field].codeSystem },
    });
    const bleeding = westCode("criteria", "bleeding.07");
    const category = westCode("categories", "bleeding");
    const assessment = { ...groups[1], decisionSupportCalculation: {
      ...calculation, status: "provisional", colour: "orange", criterionCode: "bleeding.07",
    } };
    await assert.rejects(saveVital(downgraded.revision, [assessment], [bleeding]), /do not match their categories/);
    await assert.rejects(saveVital(downgraded.revision, [assessment], [
      bleeding, category, westCode("criteria", "bleeding.none", 1),
    ]), /do not match their categories/);
    const findingsSaved = await saveVital(downgraded.revision, [assessment], [
      bleeding, category, { ...manual, value: undefined, tombstone: true },
    ]);
    const automatic = (await service.reopen("demo", westReport.reportId)).report.document.groups
      .find(({ id }) => id === "eVitals.VitalGroup").instances.find(({ instanceId }) => instanceId === vitalGroupId);
    assert.deepEqual(automatic.decisionSupportCalculation, assessment.decisionSupportCalculation);
    assert.equal(automatic.elements.find(({ id }) => id === bleeding.elementId).values[0].code, "bleeding.07");
    assert.equal(automatic.elements.find(({ id }) => id === category.elementId).values[0].code, "bleeding");
    await assert.rejects(saveVital(findingsSaved.revision, [], [
      { ...bleeding, value: undefined, tombstone: true }, { ...category, value: undefined, tombstone: true },
    ]), /does not match the supported inputs/);

    const observation = {
      ...measurement, sourceAttributes: {
        "decisionSupportObservation:oxygen": "air", "decisionSupportObservation:consciousness": "A",
        "decisionSupportObservation:pulse": "70",
      },
    };
    const childGroup = (groupId) => ({ id: randomUUID(), groupId, ordinal: 0, parentGroupInstanceId: vitalGroupId });
    const pressure = childGroup("eVitals.BloodPressureGroup");
    const temperature = childGroup("eVitals.TemperatureGroup");
    const numeric = (elementId, groupInstanceId, value, kind = "integer") => ({
      id: randomUUID(), elementId, groupInstanceId, value: { kind, value },
    });
    const sbp = numeric("eVitals.06", pressure.id, 120);
    const dbp = numeric("eVitals.07", pressure.id, "90", "text");
    const temp = numeric("eVitals.24", temperature.id, 37, "numeric");
    const spo2 = numeric("eVitals.12", vitalGroupId, 97);
    const respiration = numeric("eVitals.14", vitalGroupId, 15);
    const score = numeric(decisionSupportElementKey(west.fields.physiologyScore), vitalGroupId, 1);
    const obstetric = { ...scale, value: { ...scale.value, code: "obstetric" } };
    const complete = { ...assessment, decisionSupportCalculation: { ...assessment.decisionSupportCalculation, status: "definitive",
      physiology: { total: 1, colour: "yellow", points: { respiratoryRate: 0, spo2: 0, oxygen: 0, systolic: 0,
        diastolic: 1, heartRate: 0, consciousness: 0, temperature: 0 } } } };
    const measured = [observation, obstetric, sbp, dbp, temp, spo2, respiration];
    await assert.rejects(saveVital(findingsSaved.revision, [complete, pressure, temperature], [...measured,
      { ...score, value: { ...score.value, value: 2 } },
    ]), /NEWS score does not match/);
    const completeSaved = await saveVital(findingsSaved.revision, [complete, pressure, temperature], [...measured, score]);
    const scored = (await service.reopen("demo", westReport.reportId)).report.document.groups
      .find(({ id }) => id === "eVitals.VitalGroup").instances.find(({ instanceId }) => instanceId === vitalGroupId);
    assert.deepEqual(scored.decisionSupportCalculation, complete.decisionSupportCalculation);
    assert.equal(scored.elements.find(({ id }) => id === score.elementId).values[0].value, 1);
    await assert.rejects(saveVital(completeSaved.revision, [], [{ ...dbp, value: { ...dbp.value, value: "P" } }]), /NEWS score does not match/);
    const partial = { ...assessment, decisionSupportCalculation: { ...assessment.decisionSupportCalculation,
      physiology: { total: null, colour: "green", points: { respiratoryRate: 0, spo2: 0, oxygen: 0, systolic: 0,
        heartRate: 0, consciousness: 0, temperature: 0 } } } };
    const partialSaved = await saveVital(completeSaved.revision, [partial], [
      { ...dbp, value: { ...dbp.value, value: "P" } }, { ...score, tombstone: true, value: undefined },
    ]);
    const unscored = (await service.reopen("demo", westReport.reportId)).report.document.groups
      .find(({ id }) => id === "eVitals.VitalGroup").instances.find(({ instanceId }) => instanceId === vitalGroupId);
    assert.equal(unscored.elements.some(({ id }) => id === score.elementId), false);
    assert.deepEqual(unscored.decisionSupportCalculation, partial.decisionSupportCalculation);
    assert.ok(partialSaved.revision > completeSaved.revision);

    // An offline repeat can still cite the original red override after the
    // source has been downgraded and then returned to Automatic.
    const repeatId = randomUUID();
    const repeatTime = "2026-10-20T12:15:00+02:00";
    const repeatGroup = { ...groups[1], id: repeatId, ordinal: 1, documentedTime: repeatTime };
    const repeatMeasurement = { ...measurement, id: randomUUID(), groupInstanceId: repeatId,
      value: { kind: "datetime", value: repeatTime } };
    const repeatScale = { ...scale, id: randomUUID(), groupInstanceId: repeatId };
    const inherited = { ...manual, id: randomUUID(), groupInstanceId: repeatId,
      sourceAttributes: { ...manual.sourceAttributes, inheritedFromMeasurement: vitalGroupId } };
    for (const impostor of [
      { ...inherited, sourceAttributes: { ...inherited.sourceAttributes, enteredBy: ordinaryUserId } },
      { ...inherited, sourceAttributes: { ...inherited.sourceAttributes, inheritedFromMeasurement: randomUUID() } },
      { ...inherited, value: { ...inherited.value, code: "yellow" } },
    ]) {
      await assert.rejects(saveVital(partialSaved.revision, [repeatGroup], [repeatMeasurement, repeatScale, impostor]),
        /does not match an accepted decision/);
    }
    await assert.rejects(saveVital(partialSaved.revision, [repeatGroup], [repeatMeasurement, repeatScale, {
      ...inherited, sourceAttributes: { ...inherited.sourceAttributes, inheritedFromMeasurement: repeatId },
    }]), /different source measurement/);
    await saveVital(partialSaved.revision, [repeatGroup], [repeatMeasurement, repeatScale, inherited]);
    const repeat = (await service.reopen("demo", westReport.reportId)).report.document.groups
      .find(({ id }) => id === "eVitals.VitalGroup").instances.find(({ instanceId }) => instanceId === repeatId);
    const reopenedOverride = repeat.elements.find(({ id }) => id === inherited.elementId).values[0];
    assert.equal(reopenedOverride.code, "red");
    assert.deepEqual(reopenedOverride.attributes, { ...inherited.sourceAttributes, "x-open-triage-owner": "clinician" });

    // Simulate an encounter pinned before deployment of the current shipped version.
    const previousDefinition = { ...west.definition, version: `1.0.0-test.${randomUUID()}`, name: "WEST-A previous version" };
    const [{ id: priorPin }] = await manager.query(`with inserted as (
      insert into catalog.decision_support_definition(system_key, version, definition) values ($1,$2,$3::json) returning id
      ) select id from inserted`, [WEST_A_DECISION_SUPPORT_KEY, previousDefinition.version, JSON.stringify(previousDefinition)]);
    const previousReport = randomUUID();
    await manager.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,
      form_version_id,catalog_release_id,validation_version_id,documenting_user_id,form_definition_sha256,catalog_artifact_sha256,
      validation_compiled_sha256,synthetic,synthetic_generated_by,decision_support_definition_id)
      select $1,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,
        validation_version_id,documenting_user_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,
        synthetic,synthetic_generated_by,$3 from clinical.report where id=$2`, [previousReport, westReport.reportId, priorPin]);
    const previous = (await service.reopen("demo", previousReport)).report.clinicalForm.decisionSupport;
    assert.equal(previous.definition.version, previousDefinition.version);
    assert.equal(previous.definition.name, previousDefinition.name);

    actorId = configAdmin;
    assert.equal((await setDecisionSupport(null)).decisionSupportSystem, null);
    actorId = userId;
    const disabledReport = command();
    await service.create("demo", disabledReport);
    assert.equal((await service.reopen("demo", disabledReport.reportId)).report.clinicalForm.decisionSupport, undefined);
    assert.deepEqual((await service.reopen("demo", westReport.reportId)).report.clinicalForm.decisionSupport, west);
    actorId = configAdmin;
    await setDecisionSupport(WEST_A_DECISION_SUPPORT_KEY);
    assert.deepEqual(await catalogs.decisionSupportElements("fixture-owner"), registered);
    await setDecisionSupport(null);
    actorId = userId;

    const syntheticFollow={...demo,commandId:randomUUID(),reportId:randomUUID(),patientId:randomUUID()};
    await service.create("demo",syntheticFollow);
    const syntheticFollowStored=(await manager.query("select synthetic,form_version_id,catalog_release_id from clinical.report where id=$1",[syntheticFollow.reportId]))[0];
    const originalPins=(await manager.query("select form_version_id,catalog_release_id from clinical.report where id=$1",[demo.reportId]))[0];
    assert.deepEqual(syntheticFollowStored,{synthetic:true,...originalPins});
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

    await enableProductionWorkflowForTesting(client,organizationId,userId);
    actorId = ordinaryUserId;
    const ordinary = command();
    // Ordinary standalone production jobs use the shared device gate. An owned
    // existing incident may add a patient unpaired and retains its original form.
    await assert.rejects(service.create("ordinary", ordinary), error => error.getResponse().code === "calls.enrollmentRequired");
    await manager.query("insert into clinical.incident(id,organization_id,synthetic) values($1,$2,false)", [ordinary.incidentId, organizationId]);
    const realParentPatient=randomUUID();
    await manager.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key,pseudonymous_key_version)
      values($1,$2,'unknown',$3,1)`,[realParentPatient,organizationId,realParentPatient.replaceAll('-','').repeat(2)]);
    await manager.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,
      form_version_id,catalog_release_id,validation_version_id,documenting_user_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,synthetic)
      select $1,organization_id,$2,$5,agency_demographic_version_id,form_version_id,catalog_release_id,validation_version_id,$3,
        form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,false from clinical.report where id=$4`,
      [randomUUID(),ordinary.incidentId,ordinaryUserId,demo.reportId,realParentPatient]);
    // Client-supplied synthetic fields cannot relabel a production incident.
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
