import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { CatalogAuthoringService } from '../dist/admin/catalog-authoring.service.js';
import { CanonicalPackageService } from '../dist/admin/canonical-package.service.js';
import { FormAuthoringService } from '../dist/admin/form-authoring.service.js';
import { ValidationAuthoringService } from '../dist/admin/validation-authoring.service.js';
import { FormPublicationService } from '../dist/forms/form-publication.service.js';

test('canonical NEMSIS full validation imports and activates with numeric pain metrics and report-wide rules', {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin isolation level serializable');
    const { rows: [active] } = await client.query(
      'select organization_id,catalog_release_id,form_version_id from app_identity.active_configuration_bundle limit 1');
    if (!active) { t.skip('An existing agency configuration is required'); return; }
    const actorId = randomUUID();
    await client.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic)
      values($1,$2,'Rollback NEMSIS import verification',true)`, [actorId, active.organization_id]);
    const query = async (sql, parameters) => (await client.query(sql, parameters)).rows;
    const manager = { query };
    const db = { query, manager, transaction: async (...args) => args.at(-1)(manager) };
    const sessions = { requireCapability: async () => ({ organization: { id: active.organization_id }, user: { id: actorId } }) };
    const catalogs = new CatalogAuthoringService(db, sessions);
    const validations = new ValidationAuthoringService(db, sessions);
    const boundCatalog = await validations.validationCatalog(manager, active.catalog_release_id);
    assert.deepEqual(boundCatalog.codes.filter(code => code.elementId === 'eVitals.27'), [],
      'absence options must not turn a numeric pain score into a coded category');
    assert.ok(boundCatalog.codes.some(code => code.elementId === 'eVitals.28' && code.code === '3328003'));
    const forms = new FormAuthoringService(db, sessions, new FormPublicationService(db), validations);
    const importer = new CanonicalPackageService(db, sessions, catalogs, forms, validations);
    importer.persist = async () => {};

    const canonical = JSON.parse(await readFile(new URL('../../../defines/validation/validation_nemsis-full.json', import.meta.url)));
    const imported = await importer.import('test', 'validation', canonical, active.catalog_release_id);
    const [{ source_rule: source, compiled_bundle: bundle }] = await query(
      'select source_rule,compiled_bundle from validation.version where id=$1', [imported.id]);
    assert.equal(source.rules.length, canonical.rules.length);
    assert.equal(source.metrics.length, 6);
    assert.equal(bundle.metrics.length, 6);
    assert.ok(bundle.metrics.every(metric => metric.enabled));
    assert.ok(bundle.rules.some(rule => rule.name === 'Pain reduced' && rule.enabled));
    assert.ok(bundle.rules.some(rule => rule.name === 'Pain intervention' && rule.enabled));
    assert.equal(source.rules.find(rule => rule.name === 'Aspirin administered').enabled, false);
    const activationInput = {
      formVersionId: active.form_version_id, catalogReleaseId: active.catalog_release_id,
      changeNote: 'Rollback NEMSIS activation verification',
    };
    let activated;
    try { activated = await validations.activate('test', imported.id, activationInput); }
    catch (error) {
      const response = error.getResponse?.();
      if (response?.code !== 'admin.formValidationRemovalRequired') throw error;
      assert.ok(response.impactedRules.length > 0);
      activated = await validations.activate('test', imported.id, {
        ...activationInput, removeImpactedRuleIds: response.impactedRules.map(rule => rule.id),
      });
    }
    assert.ok(activated.validationVersionId);
    const [{ source_rule: activeSource, compiled_bundle: activeBundle }] = await query(
      'select source_rule,compiled_bundle from validation.version where id=$1', [activated.validationVersionId]);
    assert.equal(activeSource.metrics.length, 6);
    assert.equal(activeBundle.metrics.length, 6);
    assert.ok(activeBundle.rules.some(rule => rule.name === 'Pain reduced' && rule.enabled));
    assert.ok(activeBundle.rules.some(rule => rule.name === 'Pain intervention' && rule.enabled));
    assert.ok(activeBundle.rules.some(rule => rule.primaryTarget.elementId === '*' && rule.enabled));
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
