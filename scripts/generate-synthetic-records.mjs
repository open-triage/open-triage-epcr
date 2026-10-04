#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HELP, parseOptions, seededRandom, serviceTime } from './lib/synthetic-record-options.mjs';
import { documentMutations, generateDocument, loadGenerationModel, validationProblems } from './lib/synthetic-record-generator.mjs';
import { agencyUserContext, eligibleAgencyUsers, selectAgencyUser } from './lib/synthetic-record-users.mjs';

/** Bind existing application services to one outer transaction. All writes made
 * while opening, populating and signing a record commit or roll back together. */
export function transactionDatabase(manager) {
  return { manager, query: manager.query.bind(manager), transaction: async (...args) => args.at(-1)(manager) };
}

export async function generateRecords(database, options, emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  const [{ AssignedCallsService }, { DraftReportService },
    { SignReportService }, { encounterDocument }, { compiledValidationBundleSha256 }] = await Promise.all([
    import('../apps/api/dist/calls/assigned-calls.service.js'),
    import('../apps/api/dist/reports/draft-report.service.js'), import('../apps/api/dist/reports/sign-report.service.js'),
    import('../apps/api/dist/reports/encounter-document.persistence.js'), import('@open-triage/contracts'),
  ]);
  let completed = 0;
  const seed = options.seed ?? randomUUID();
  const random = seededRandom(seed);
  try {
    const selection = { unitId: options.unit, username: options.username, availableOnly: !options.username };
    const users = await eligibleAgencyUsers(database, options.agency, selection);
    if (!users.length) throw new Error('No matching active agency users have Demo and documentation permissions with an available assigned unit');
    const [active] = await database.query('select * from app_identity.active_configuration_bundle where organization_id=$1', [options.agency]);
    if (!active) throw new Error('The agency has no active form/catalog/validation configuration');
    const [version] = await database.query(`select compiled_bundle,compiled_sha256 from validation.version
      where id=$1 and organization_id=$2 and catalog_release_id=$3 and status='published'`,
    [active.validation_version_id, options.agency, active.catalog_release_id]);
    if (!version || version.compiled_sha256 !== active.validation_compiled_sha256 ||
      compiledValidationBundleSha256(version.compiled_bundle) !== active.validation_compiled_sha256) {
      throw new Error('The active validation bundle failed its integrity check');
    }
    emit({ event: 'start', agencyId: options.agency, count: options.count, from: options.from, to: options.to,
      status: options.status, dryRun: options.dryRun, seed, assignment: options.username ? 'fixed-user' : 'random-agency-users',
      formVersionId: active.form_version_id,
      catalogReleaseId: active.catalog_release_id, validationVersionId: active.validation_version_id });
    let model;
    for (let index = 0; index < options.count; index++) {
      const dispatchedAt = serviceTime(options, random);
      let result;
      const rollback = new Error('synthetic dry-run rollback');
      try {
        await database.transaction('SERIALIZABLE', async manager => {
          const db = transactionDatabase(manager);
          const selected = selectAgencyUser(await eligibleAgencyUsers(manager, options.agency, selection), random);
          const { session, sessionToken, sessions: currentSessions } = agencyUserContext(db, options.agency, selected.user);
          const unit = selected.unit;
          const calls = new AssignedCallsService(db, currentSessions);
          // The normal generator returns an existing unopened call. Reject that
          // outcome before any changes to it, and roll back the reuse audit too.
          const generated = await calls.generateSynthetic(sessionToken, session.csrfToken, unit.id, new Date(), { dispatchedAt, random });
          if (generated.reused) throw new Error(`Unit ${unit.callSign} already has an unopened synthetic call. Open it or select another unit.`);
          const { report } = await calls.open(sessionToken, generated.assignment.id);
          if (report.formVersionId !== active.form_version_id || report.catalogReleaseId !== active.catalog_release_id ||
            report.validationVersionId !== active.validation_version_id) throw new Error('The active configuration changed during generation; run a new batch');
          model ??= await loadGenerationModel(manager, report.clinicalForm, report.catalogReleaseId);
          const { document } = generateDocument({ source: report.document, configuration: report.clinicalForm,
            model, bundle: version.compiled_bundle, dispatchedAt, random });
          const mutations = documentMutations(document, report.document, model);
          const drafts = new DraftReportService(db, currentSessions);
          let revision = report.revision;
          if (mutations.removals.length) {
            const saved = await drafts.save(sessionToken, report.id, { commandId: randomUUID(), expectedRevision: revision,
              authorId: session.user.id, occurrences: mutations.removals });
            revision = saved.revision;
          }
          const saved = await drafts.save(sessionToken, report.id, { commandId: randomUUID(), expectedRevision: revision,
            authorId: session.user.id, demoAction: 'populate', groups: mutations.groups, occurrences: mutations.occurrences }, session.csrfToken);
          // Re-read persisted values; conversion and database triggers must not
          // invalidate the values that passed the in-memory generation checks.
          const persisted = await encounterDocument(manager, report.id);
          const problems = validationProblems(version.compiled_bundle, persisted, new Date().toISOString());
          if (problems.length) throw new Error(`Persisted record failed validation: ${JSON.stringify(problems)}`);
          for (const group of persisted.groups) for (const instance of group.instances) for (const element of instance.elements) {
            if (!element.id.startsWith('eTimes.')) continue;
            for (const value of element.values) if (value.kind === 'scalar') {
              const day = new Date(String(value.value)).toISOString().slice(0, 10);
              if (day < options.from || day > options.to) throw new Error(`Validation requires ${element.id} outside the requested date range`);
            }
          }
          // Draft output receives the exact same signing preflight. Roll back
          // the signing savepoint so no signature or signing audit is retained.
          if (options.status === 'draft') await manager.query('savepoint synthetic_signing_preflight');
          const signed = await new SignReportService(db, currentSessions).sign(sessionToken, report.id, {
            commandId: randomUUID(), expectedRevision: saved.revision, signerId: session.user.id,
            attestation: { meaning: 'Fictional synthetic record generated by CLI for testing' },
          });
          if (options.status === 'draft') {
            await manager.query('rollback to savepoint synthetic_signing_preflight');
            await manager.query('release savepoint synthetic_signing_preflight');
          }
          result = { event: 'record', index: index + 1, reportId: report.id, assignmentId: generated.assignment.id,
            userId: session.user.id, unitId: unit.id,
            status: options.status, dispatchedAt: dispatchedAt.toISOString(), reportingDate: signed.reportingDate,
            expiresAt: report.expiresAt ?? null, dryRun: options.dryRun };
          if (options.dryRun) throw rollback;
        });
      } catch (error) { if (error !== rollback) throw error; }
      completed++;
      emit(result);
    }
    const summary = { event: 'complete', generated: options.dryRun ? 0 : completed, validated: completed, dryRun: options.dryRun, seed };
    emit(summary);
    return summary;
  } catch (error) {
    const response = error.getResponse?.();
    const detail = response?.findings ? JSON.stringify(response.findings) : error.message;
    throw new Error(`Generation stopped: ${detail}. ${options.dryRun ? 0 : completed} records committed; ${completed} validated. Current record rolled back.`, { cause: error });
  }
}

async function main() {
  let database;
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) { process.stdout.write(HELP); return; }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const { DataSource } = await import('typeorm');
    database = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
    await generateRecords(database, options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (database?.isInitialized) await database.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
