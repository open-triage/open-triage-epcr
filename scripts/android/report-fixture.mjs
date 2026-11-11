import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/** Seed only a harness-owned Android database; reports are created by the real call-open API. */
export async function seedReportFixture(root, fixture, run) {
  const target = new URL(fixture.databaseUrl);
  assert(['127.0.0.1', 'localhost'].includes(target.hostname) &&
    target.pathname === `/android_${fixture.index}` && [1, 2].includes(fixture.index),
  'Report fixtures require a disposable Android harness database.');

  run('npm', ['run', 'load:catalog', '-w', '@open-triage/database'], {
    ...process.env, DATABASE_URL: fixture.databaseUrl,
  });
  // Initialize dependent CJS/ESM modules sequentially on the supported Node runtime.
  const { AccountService } = await import('../../apps/api/dist/identity/account.service.js');
  const { ClinicianSessionService } = await import('../../apps/api/dist/sessions/clinician-session.service.js');
  const { agencyRequest } = await import('../../apps/api/dist/sessions/agency-context.js');
  const { FormPublicationService } = await import('../../apps/api/dist/forms/form-publication.service.js');
  const { canonicalDefinitionSha256 } = await import('../../apps/api/dist/forms/form-publication.validation.js');
  const { ValidationAuthoringService } = await import('../../apps/api/dist/admin/validation-authoring.service.js');
  const { SchedulesService } = await import('../../apps/api/dist/schedules/schedules.service.js');
  const db = new DataSource({ type: 'postgres', url: fixture.databaseUrl });
  await db.initialize();
  try {
    const [organization] = await db.query('select name from app_identity.organization where id=$1', [fixture.organizationId]);
    assert(organization?.name.startsWith('Android synthetic '), 'An Android synthetic agency is required.');
    const [catalog] = await db.query(`select release.id from catalog.release release
      join catalog.element_definition element on element.release_id=release.id and element.element_id='ePatient.03'
      where release.sealed and release.standard='NEMSIS' order by release.loaded_at desc limit 1`);
    assert(catalog, 'The committed first-name catalog must be loaded.');
    const sessions = new ClinicianSessionService(db);
    const scoped = work => agencyRequest.run({ origin: fixture.origin, organizationId: fixture.organizationId }, work);
    const admin = await scoped(() => sessions.create({ username: fixture.administrator.username, password: fixture.administratorPassword }));
    try {
      const formId = randomUUID(), formVersionId = randomUUID(), incidentId = randomUUID(), assignmentId = randomUUID();
      const elementId = 'ePatient.03', fieldKey = 'first-name';
      const definition = { schemaVersion: 1, sections: [{ key: 'patient', fields: [
        { key: fieldKey, source: { kind: 'nemsis', elementId } },
      ] }] };
      const definitionSha256 = canonicalDefinitionSha256(definition);
      await db.transaction(async manager => {
        await manager.query(`insert into forms.form(id,organization_id,slug,name)
          values($1,$2,$3,'Android protected-work fixture')`, [formId, fixture.organizationId, `android-${formId}`]);
        await manager.query(`insert into forms.form_version(id,form_id,catalog_release_id,version,
          canonical_definition,definition_sha256,created_by)
          values($1,$2,$3,1,$4::jsonb,$5,$6)`,
        [formVersionId, formId, catalog.id, JSON.stringify(definition), definitionSha256, fixture.administrator.userId]);
      });
      await new FormPublicationService(db).publish(formVersionId, {
        publishedBy: fixture.administrator.userId, definitionSha256, changeNote: 'Synthetic Android recovery acceptance',
      }, fixture.organizationId);
      const validations = new ValidationAuthoringService(db, sessions);
      const policy = await scoped(() => validations.create(admin.sessionToken, {
        catalogReleaseId: catalog.id, displayName: 'Android protected-work policy',
      }, { importedRules: [{ id: randomUUID(), name: 'Synthetic first name', enabled: false, severity: 'error',
        executionTargets: ['live', 'sign'], primaryTargetElementId: elementId,
        message: 'Synthetic first name required', source: 'require present("ePatient.03")' }] }));
      const published = await scoped(() => validations.publish(admin.sessionToken, policy.id, {
        expectedRevision: policy.revision, displayName: policy.displayName, changeNote: 'Synthetic Android recovery acceptance',
      }));
      await scoped(() => validations.activate(admin.sessionToken, published.id, {
        formVersionId, catalogReleaseId: catalog.id, changeNote: 'Synthetic Android recovery acceptance',
      }));
      const secondClinicianPassword = 'AndroidFixtureSecond123!';
      const secondClinician = await new AccountService(db).provision({
        organizationId: fixture.organizationId, username: 'android.second', displayName: 'Synthetic second clinician',
        role: 'clinician', temporaryPassword: secondClinicianPassword,
      });
      const callNumber = `ANDROID-OFFLINE-${fixture.index}`;
      await db.transaction(async manager => {
        await manager.query(`insert into app_identity.agency_demographic_version
          (id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,
           definition_sha256,effective_from,created_by)
          values($1,$2,$3,1,'ANDROID','ANDROID','36',repeat('a',64),clock_timestamp(),$4)`,
        [randomUUID(), fixture.organizationId, catalog.id, fixture.administrator.userId]);
        await manager.query('update app_identity.operational_unit set default_form_id=$2 where id=$1', [fixture.unitId, formId]);
        await manager.query(`update app_identity.local_credential set must_change_password=false,
          temporary_password_expires_at=null,password_changed_at=clock_timestamp() where user_id=$1`, [secondClinician.userId]);
        await manager.query('update app_identity.app_user set synthetic=true where id=$1', [secondClinician.userId]);
        await manager.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',
          [fixture.organizationId, fixture.unitId, secondClinician.userId]);
        await manager.query(`insert into clinical.incident(id,organization_id,operational_state,synthetic)
          values($1,$2,'assigned',true)`, [incidentId, fixture.organizationId]);
        await manager.query(`insert into clinical.call_assignment
          (id,organization_id,unit_id,incident_id,call_number,dispatched_at,dispatch_reason,status,synthetic)
          values($1,$2,$3,$4,$5,clock_timestamp(),'Synthetic Android recovery','assigned',true)`,
        [assignmentId, fixture.organizationId, fixture.unitId, incidentId, callNumber]);
      });
      const schedules = new SchedulesService(db, sessions);
      const schedule = await scoped(() => schedules.save(admin.sessionToken, null, { name: 'Android acceptance blank schedule', breakpoints: [] }));
      await scoped(() => schedules.select(admin.sessionToken, fixture.unitId, { scheduleId: schedule.id, expectedRevision: 0 }));
      // Test-only rollout setup, using the same enforced-stage fixture as the production gate suites.
      await db.query(`update app_identity.production_workflow_rollout set enabled_at=clock_timestamp(),
        enabled_by=$2,revision=revision+1 where group_id=app_identity.organization_group($1) and enabled_at is null`,
      [fixture.organizationId, fixture.administrator.userId]);
      const [pins] = await db.query(`select form_version_id,catalog_release_id,validation_version_id
        from app_identity.active_configuration_bundle where organization_id=$1`, [fixture.organizationId]);
      assert.equal(pins.form_version_id, formVersionId);
      assert.equal(pins.catalog_release_id, catalog.id);
      return { assignmentId, incidentId, callNumber, formId, formVersionId, catalogReleaseId: catalog.id,
        validationVersionId: pins.validation_version_id, elementId, fieldKey, secondClinician, secondClinicianPassword };
    } finally { await scoped(() => sessions.end(admin.sessionToken, admin.session.csrfToken)); }
  } finally { await db.destroy(); }
}
