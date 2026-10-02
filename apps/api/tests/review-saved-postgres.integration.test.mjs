import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

integrationTest("saved analyses keep ownership and re-evaluate shared results for each current viewer", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  if (!(await client.query("select to_regclass('analytics.review_field_source_with_identity') relation")).rows[0].relation)
    await client.query(migration("20261002180000_review_repeated_field_source"));
  if (!(await client.query("select to_regclass('analytics.review_custom_dictionary') relation")).rows[0].relation)
    await client.query(migration("20261002190000_review_custom_scalar_analytics"));
  if (!(await client.query(`select 1 from information_schema.columns where table_schema='analytics'
    and table_name='review_custom_dictionary' and column_name='grouped'`)).rows[0])
    await client.query(migration("20261002220000_review_custom_grouped_source"));
  if (!(await client.query("select to_regclass('clinical.review_saved_analysis') relation")).rows[0].relation)
    await client.query(migration("20261002300000_review_saved_analyses"));
  const users = (await client.query(`select r.organization_id,r.documenting_user_id owner_id,
      owner.user_id viewer_id from clinical.report r
    join app_identity.installation_owner owner on owner.organization_id=r.organization_id
      and owner.user_id<>r.documenting_user_id
    where r.status='signed' limit 1`)).rows[0];
  if (!users) return t.skip("No organization with two Review users is available");
  await client.query("select analytics_private.ensure_partitions(date '2026-10-01', date '2026-10-03')");
  const fixtureReports = [];
  for (const [index, userId, synthetic] of [
    [0,users.owner_id,false],[1,users.viewer_id,false],[2,users.viewer_id,true],
  ]) {
    const reportId = randomUUID();
    fixtureReports.push(reportId);
    await client.query(`insert into analytics_private.epcr
    (reporting_date,reporting_date_source,report_id,incident_id,organization_id,
     agency_demographic_version_id,patient_key,patient_key_version,form_version_id,
     form_version,catalog_release_id,catalog_version,signed_snapshot_id,
     signed_snapshot_sha256,signed_at,projector_version,projected_at,
     documenting_user_id,synthetic,esituation_11)
    values ('2026-10-01','signing-time',$1,$2,$3,$4,$5,1,$6,1,$7,'3.5.1',$8,
      repeat('a',64),now(),'1.1.0',now(),$9,$10,$11)`,
  [reportId,randomUUID(),users.organization_id,randomUUID(),`saved-fixture-${index}`,
    randomUUID(),randomUUID(),randomUUID(),userId,synthetic,"saved-view-fixture"]);
  }
  const identifyingField = randomUUID();
  await client.query(`insert into analytics_private.epcr_repeatable_element
    (reporting_date,reporting_date_source,report_id,incident_id,organization_id,
     agency_demographic_version_id,patient_key,patient_key_version,form_version_id,
     catalog_release_id,catalog_version,element_identity_id,element_id,element_occurrence_id,
     group_id,group_instance_id,group_path,instance_path,group_ordinal,element_ordinal,
     value_kind,value_text,server_received_time,is_identifying,signed_snapshot_id,
     signed_snapshot_sha256,projector_version,projected_at,is_custom,custom_definition_id,
     custom_definition)
    values ('2026-10-01','signing-time',$1,$2,$3,$4,$5,1,$6,$7,'3.5.1',$8,$9,$10,
      null,null,array[]::text[],array[]::uuid[],null,0,'text','private-value',now(),true,$11,
      repeat('a',64),'1.1.0',now(),true,$8,$12::jsonb)`,
  [fixtureReports[0],randomUUID(),users.organization_id,randomUUID(),"saved-custom-fixture",
    randomUUID(),randomUUID(),identifyingField,`custom:${identifyingField}`,randomUUID(),
    randomUUID(),JSON.stringify({ title: "Private note", datatype: "string", recurrence: "single" })]);
  await client.query("set local role open_triage_api_runtime");
  let session = { capabilities: ["review:all","review:admin","review:identifying"],
    user: { id: users.owner_id }, organization: { id: users.organization_id } };
  const query = async (sql, params) => sql.includes("projection_health")
    ? [{ observed_at: new Date(), oldest_backlog_age_seconds: null,
      persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
      last_run_status: "succeeded", is_read_only_replica: false, replay_lag_seconds: null }]
    : (await client.query(sql, params)).rows;
  const manager = { query };
  const service = new ReviewService({ manager, query,
    transaction: async (level, work) => (typeof level === "function" ? level : work)(manager) },
  { get: async () => session, assertCsrf: async () => {} });
  const definition = { fieldId: "eSituation.11", operation: "distribution",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real",
      field: { id: "eSituation.11", value: "saved-view-fixture" } } };
  const privateCommand = { commandId: randomUUID(), name: "My view", shared: false, definition };
  const personal = await service.saveAnalysis("unused", undefined, privateCommand, "valid");
  assert.equal(personal.version, 1);
  assert.deepEqual(await service.saveAnalysis("unused", undefined, privateCommand, "valid"), personal);
  assert.equal((await client.query(`select count(*)::int n from clinical.review_saved_analysis_history
    where analysis_id=$1`, [personal.id])).rows[0].n, 1);
  const shared = await service.saveAnalysis("unused", undefined,
    { commandId: randomUUID(), name: "Agency view", shared: true, definition }, "valid");
  const privateFieldDefinition = { fieldId: identifyingField, operation: "distribution",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" } };
  const identified = await service.saveAnalysis("unused", undefined,
    { commandId: randomUUID(), name: "Identifying view", shared: true,
      definition: privateFieldDefinition }, "valid");
  const all = await service.openSavedAnalysis("unused", shared.id, "real");
  assert.equal(all.result.population.scope, "all");
  assert.equal(all.result.groups[0].denominator, 2);
  session = { ...session, user: { id: users.viewer_id }, capabilities: ["review:self"] };
  assert.deepEqual(new Set((await service.savedAnalyses("unused")).map((item) => item.id)),
    new Set([identified.id,shared.id]));
  await assert.rejects(service.openSavedAnalysis("unused", personal.id, "real"), { status: 404 });
  await assert.rejects(service.saveAnalysis("unused", personal.id,
    { commandId: randomUUID(), expectedVersion: 1, name: "Trespass",
      shared: false, definition }, "valid"), { status: 404 });
  await assert.rejects(service.saveAnalysis("unused", shared.id,
    { commandId: randomUUID(), expectedVersion: 1, name: "Trespass",
      shared: true, definition }, "valid"), { status: 403 });
  await assert.rejects(service.openSavedAnalysis("unused", identified.id, "real"), { status: 400 });
  await assert.rejects(service.saveAnalysis("unused", undefined,
    { commandId: randomUUID(), name: "Improper shared", shared: true, definition }, "valid"), { status: 403 });
  const own = await service.openSavedAnalysis("unused", shared.id, "real");
  assert.equal(own.result.population.scope, "own");
  assert.equal(own.result.groups[0].denominator, 1);
  const synthetic = await service.openSavedAnalysis("unused", shared.id, "synthetic");
  assert.equal(synthetic.result.definition.filters.dataset, "synthetic");
  assert.equal(synthetic.result.groups[0].denominator, 1);
  await assert.rejects(service.openSavedAnalysis("unused", shared.id, "other"), { status: 400 });
  session = { ...session, capabilities: [] };
  await assert.rejects(service.openSavedAnalysis("unused", shared.id, "real"), { status: 403 });
  session = { ...session, capabilities: ["review:all"],
    organization: { id: randomUUID() } };
  assert.deepEqual(await service.savedAnalyses("unused"), []);
  await assert.rejects(service.openSavedAnalysis("unused", shared.id, "real"), { status: 404 });
  session = { ...session, user: { id: users.owner_id },
    organization: { id: users.organization_id }, capabilities: ["review:all","review:admin"] };
  const updateCommand = { commandId: randomUUID(), expectedVersion: 1,
    name: "Agency view revised", shared: true, definition };
  const updated = await service.saveAnalysis("unused", shared.id, updateCommand, "valid");
  assert.equal(updated.version, 2);
  assert.deepEqual(await service.saveAnalysis("unused", shared.id, updateCommand, "valid"), updated);
  await assert.rejects(service.saveAnalysis("unused", shared.id,
    { ...updateCommand, commandId: randomUUID() }, "valid"), { status: 409 });
  assert.equal((await client.query(`select count(*)::int n from clinical.review_saved_analysis_history
    where analysis_id=$1`, [shared.id])).rows[0].n, 2);
  await client.query(`update clinical.review_saved_analysis
    set definition=jsonb_set(definition,'{fieldId}','"retired.field"'::jsonb) where id=$1`, [shared.id]);
  await assert.rejects(service.openSavedAnalysis("unused", shared.id, "real"), { status: 400 });
  assert.equal((await client.query(`select count(*)::int n from clinical.review_saved_analysis_history
    where analysis_id=$1`, [shared.id])).rows[0].n, 2);
});
