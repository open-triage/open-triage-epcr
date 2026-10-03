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

integrationTest("custom long rows support report level values without new field columns or broad role grants", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const installed = await client.query(`select 1 from information_schema.columns
    where table_schema='analytics_private' and table_name='epcr_repeatable_element'
      and column_name='is_custom'`);
  if (!installed.rowCount) await client.query(await readFile(path.join(root,
    "supabase/migrations/20261002190000_review_custom_scalar_analytics.sql"), "utf8"));
  const before = await client.query(`select column_name from information_schema.columns
    where table_schema='analytics_private' and table_name='epcr_repeatable_element'`);
  const sample = await client.query(`select * from analytics_private.epcr_repeatable_element limit 1`);
  if (!sample.rowCount) { t.skip("no local signed projection fixture"); return; }
  const report = sample.rows[0];
  const values = [
    { kind: "text", datatype: "string", value_text: "stable-category", identifying: false },
    { kind: "boolean", datatype: "boolean", value_boolean: true, identifying: false },
    { kind: "numeric", datatype: "number", value_numeric: 12.5, identifying: true },
    { kind: "coded", datatype: "coded", code: "X", identifying: false },
    { kind: "date", datatype: "date", value_date: "2026-01-02", identifying: false },
    { kind: "null", datatype: "boolean", absence_kind: "null",
      absence_code: "not-applicable", identifying: false },
  ];
  const identities = [];
  for (const [index, value] of values.entries()) {
    const identity = randomUUID();
    identities.push(identity);
    const attributes = { element_occurrence_id: randomUUID(), element_identity_id: identity,
      element_id: `Test.${index}`, custom_definition_id: identity, is_custom: true,
      custom_definition: { id: identity, title: `Custom ${index}`, datatype: value.datatype,
        recurrence: "single", identifying: value.identifying },
      group_id: null, group_instance_id: null, parent_group_instance_id: null,
      group_path: [], instance_path: [], group_ordinal: null,
      is_identifying: value.identifying, value_kind: value.kind,
      value_text: null, value_integer: null, value_numeric: null, value_boolean: null,
      value_date: null, value_datetime: null, value_time: null, value_duration: null,
      value_binary: null, code: null, absence_kind: null, absence_code: null,
      absence_display: null, not_value_code: null, pertinent_negative_code: null, ...value };
    delete attributes.kind;
    delete attributes.datatype;
    delete attributes.identifying;
    await client.query(`insert into analytics_private.epcr_repeatable_element
      select (jsonb_populate_record(null::analytics_private.epcr_repeatable_element,
        to_jsonb(source) || $1::jsonb)).*
      from analytics_private.epcr_repeatable_element source
      where source.report_id=$2 and source.element_occurrence_id=$3 limit 1`,
    [attributes, report.report_id, report.element_occurrence_id]);
  }
  const after = await client.query(`select column_name from information_schema.columns
    where table_schema='analytics_private' and table_name='epcr_repeatable_element'`);
  assert.deepEqual(after.rows, before.rows);
  const projected = await client.query(`select value_kind, group_instance_id, custom_definition->>'datatype' as datatype,
    is_identifying from analytics_private.epcr_repeatable_element
    where custom_definition_id=any($1::uuid[]) order by value_kind`, [identities]);
  assert.equal(projected.rowCount, 6);
  assert.ok(projected.rows.every((row) => row.group_instance_id === null));
  assert.ok(projected.rows.some((row) => row.value_kind === "null"));
  assert.ok(projected.rows.some((row) => row.is_identifying));
  await grantRoleForTesting(client, "open_triage_api_runtime");
  await client.query("set local role open_triage_api_runtime");
  const visible = await client.query(`select count(*)::integer as count from analytics.review_custom_field_source
    where custom_definition_id=any($1::uuid[])`, [identities]);
  assert.equal(visible.rows[0].count, 6);
  await assert.rejects(client.query(`select count(*) from analytics_private.epcr_repeatable_element`),
    /permission denied/);
});
