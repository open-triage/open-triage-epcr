import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { grantRoleForTesting } from "./postgres-role-test-helpers.mjs";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = (name) => readFile(path.join(root, "supabase/migrations", name), "utf8");

integrationTest("grouped custom projection keeps parent identities and pinned history through the API role", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const installed = await client.query(`select 1 from information_schema.columns
    where table_schema='analytics_private' and table_name='epcr_repeatable_element'
      and column_name='is_custom'`);
  if (!installed.rowCount) await client.query(await migration("20261002190000_review_custom_scalar_analytics.sql"));
  await client.query(await migration("20261002220000_review_custom_grouped_source.sql"));
  const sample = (await client.query(`select * from analytics_private.epcr_repeatable_element limit 1`)).rows[0];
  if (!sample) { t.skip("no local signed projection fixture"); return; }
  const identity = randomUUID();
  const parents = [randomUUID(), randomUUID()];
  const groups = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, value] of [10, 90, 15].entries()) {
    const parent = parents[index === 1 ? 1 : 0];
    const attributes = { element_occurrence_id: randomUUID(), element_identity_id: identity,
      custom_definition_id: identity, is_custom: true, element_id: "Test.groupedDose",
      custom_definition: { id: identity, title: "Retired grouped dose", datatype: "number",
        recurrence: "multiple", correlatesTo: "MedicationGroup", identifying: false,
        definition: "Historical dose", retired: true },
      group_id: "CustomGroup", group_instance_id: groups[index],
      parent_group_instance_id: parent, group_path: ["MedicationGroup", "CustomGroup"],
      instance_path: [parent, groups[index]], group_ordinal: index === 1 ? 2 : 1,
      element_ordinal: index, correlation_id: `med-${index === 1 ? 2 : 1}`,
      group_correlation_id: `group-${index === 1 ? 2 : 1}`,
      clinical_time: "2026-10-02T10:00:00Z", documented_time: "2026-10-02T10:01:00Z",
      value_kind: "numeric", value_numeric: value, value_text: null, value_integer: null,
      value_boolean: null, value_date: null, value_datetime: null, value_time: null,
      value_duration: null, value_binary: null, code: null, absence_kind: null,
      absence_code: null, not_value_code: null, pertinent_negative_code: null,
      is_identifying: false, effective_amendment_sequence: 2 };
    await client.query(`insert into analytics_private.epcr_repeatable_element
      select (jsonb_populate_record(null::analytics_private.epcr_repeatable_element,
        to_jsonb(source) || $1::jsonb)).*
      from analytics_private.epcr_repeatable_element source
      where source.report_id=$2 and source.element_occurrence_id=$3 limit 1`,
    [attributes, sample.report_id, sample.element_occurrence_id]);
  }
  await grantRoleForTesting(client, "open_triage_api_runtime");
  await client.query("set local role open_triage_api_runtime");
  const rows = await client.query(`select group_instance_id,parent_group_instance_id,instance_path,
    correlation_id,clinical_time,custom_definition->>'retired' as retired,
    effective_amendment_sequence from analytics.review_custom_field_source
    where custom_definition_id=$1 order by element_ordinal`, [identity]);
  assert.equal(rows.rowCount, 3);
  assert.deepEqual(rows.rows.map((row) => row.parent_group_instance_id),
    [parents[0], parents[1], parents[0]]);
  assert.ok(rows.rows.every((row) => row.instance_path.at(-1) === row.group_instance_id));
  assert.ok(rows.rows.every((row) => row.retired === "true" && row.effective_amendment_sequence === 2));
  const dictionary = await client.query(`select recurrence,grouped,semantic_count
    from analytics.review_custom_dictionary where custom_definition_id=$1`, [identity]);
  assert.deepEqual(dictionary.rows[0], { recurrence: "multiple", grouped: true, semantic_count: "1" });
  await assert.rejects(client.query(`select count(*) from analytics_private.epcr_repeatable_element`),
    /permission denied/);
});
