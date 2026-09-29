import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "../../..");

test("pinned grouped values persist with distinct parent, group, element and occurrence identities", {
  skip: process.env.REQUIRE_DATABASE_INTEGRATION !== "1" || !process.env.DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    for (const [trigger, migration] of [
      ["custom_occurrence_target_validate", "20260929210000_bind_repeated_custom_occurrences.sql"],
      ["pinned_custom_group_validate", "20260929220000_pin_custom_group_occurrences.sql"],
    ]) {
      const installed = await client.query("select 1 from pg_trigger where tgname=$1", [trigger]);
      if (!installed.rows.length) await client.query(readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
    }

    const fixture = (await client.query(`
      select r.id as report_id,r.organization_id,r.catalog_release_id,r.form_version_id,
        r.documenting_user_id,gi.id as root_id,fs.id as section_id
      from clinical.report r
      join clinical.group_instance gi on gi.report_id=r.id and gi.group_id='PatientCareReportGroup'
      join forms.form_section fs on fs.form_version_id=r.form_version_id
      where r.synthetic and r.status='draft' order by r.id limit 1
    `)).rows[0];
    assert.ok(fixture, "local development needs a synthetic draft report with a form and root group");

    const groupId = randomUUID();
    const elementId = randomUUID();
    const groupSlug = `Group${groupId.replaceAll("-", "").slice(0, 12)}`;
    const elementSlug = `Value${elementId.replaceAll("-", "").slice(0, 12)}`;
    const namespace = "org.example.ems";
    const definition = { id: groupId, namespace, slug: groupSlug, title: "Synthetic group fixture", recurrence: "multiple" };
    const element = { id: elementId, namespace, slug: elementSlug, title: "Synthetic value fixture",
      definition: "Rollback-only test value", datatype: "string", recurrence: "single", groupDefinitionId: groupId,
      usage: "Optional", identifying: false, constraints: {} };

    await client.query("alter table catalog.release disable trigger catalog_release_immutable");
    await client.query(`update catalog.release set provenance=jsonb_set(provenance,'{customGroupDefinitions}',
      coalesce(provenance->'customGroupDefinitions','[]'::jsonb) || $2::jsonb) where id=$1`,
      [fixture.catalog_release_id, JSON.stringify([definition])]);
    await client.query("alter table catalog.release enable trigger catalog_release_immutable");

    await client.query("insert into catalog.element_identity(id,namespace,canonical_key) values($1,$2,$3)",
      [elementId, namespace, `${namespace}.${elementSlug}`]);
    await client.query(`insert into forms.custom_element_definition
      (id,organization_id,namespace,slug,title,base_datatype,identifying,definition)
      values($1,$2,$3,$4,$5,'string',false,$6::jsonb)`,
      [elementId, fixture.organization_id, namespace, elementSlug, element.title, JSON.stringify(element)]);
    await client.query(`insert into forms.custom_group_definition
      (id,organization_id,namespace,slug,temporal_kind,definition)
      values($1,$2,$3,$4,'non-temporal',$5::jsonb)`,
      [groupId, fixture.organization_id, namespace, groupSlug, JSON.stringify(definition)]);

    const fieldId = randomUUID();
    await client.query("alter table forms.form_field disable trigger form_field_immutable");
    await client.query(`insert into forms.form_field
      (id,form_version_id,section_id,stable_key,position,source_kind,custom_element_definition_id,
       custom_group_definition_id,analytical_repeatable)
      values($1,$2,$3,$4,(select coalesce(max(position),-1)+1 from forms.form_field where section_id=$3),
       'custom',$5,$6,true)`,
      [fieldId, fixture.form_version_id, fixture.section_id, `fixture-${elementId}`, elementId, groupId]);
    await client.query("alter table forms.form_field enable trigger form_field_immutable");

    const groups = [randomUUID(), randomUUID()];
    for (const [ordinal, id] of groups.entries()) await client.query(`insert into clinical.group_instance
      (id,report_id,catalog_release_id,parent_group_instance_id,group_id,source_kind,
       custom_group_definition_id,ordinal,created_by) values($1,$2,$3,$4,$5,'custom',$6,$7,$8)`,
      [id, fixture.report_id, fixture.catalog_release_id, fixture.root_id,
        `${namespace}.${groupSlug}`, groupId, ordinal, fixture.documenting_user_id]);

    const occurrences = [randomUUID(), randomUUID()];
    for (const [ordinal, id] of occurrences.entries()) await client.query(`insert into clinical.element_occurrence
      (id,report_id,catalog_release_id,group_instance_id,element_identity_id,element_id,form_field_id,
       ordinal,analytical_repeatable,identifying,value_kind,value_text,author_id)
      values($1,$2,$3,$4,$5,$6,$7,0,true,false,'text',$8,$9)`,
      [id, fixture.report_id, fixture.catalog_release_id, groups[ordinal], elementId,
        `${namespace}.${elementSlug}`, fieldId, ["Improved", "Unchanged"][ordinal], fixture.documenting_user_id]);

    const saved = (await client.query(`select gi.id as group_id,gi.parent_group_instance_id,
      gi.custom_group_definition_id,eo.id as occurrence_id,eo.element_identity_id,eo.form_field_id,eo.value_text
      from clinical.group_instance gi join clinical.element_occurrence eo on eo.group_instance_id=gi.id
      where eo.id=any($1::uuid[]) order by gi.ordinal`, [occurrences])).rows;
    assert.deepEqual(saved.map((row) => row.group_id), groups);
    assert.deepEqual(saved.map((row) => row.occurrence_id), occurrences);
    assert.deepEqual(saved.map((row) => row.value_text), ["Improved", "Unchanged"]);
    assert.ok(saved.every((row) => row.parent_group_instance_id === fixture.root_id &&
      row.custom_group_definition_id === groupId && row.element_identity_id === elementId && row.form_field_id === fieldId));

    await client.query("savepoint wrong_target");
    await assert.rejects(client.query(`insert into clinical.element_occurrence
      (id,report_id,catalog_release_id,group_instance_id,element_identity_id,element_id,form_field_id,
       ordinal,analytical_repeatable,identifying,value_kind,value_text,author_id)
      values($1,$2,$3,$4,$5,$6,$7,0,true,false,'text','Wrong target',$8)`,
      [randomUUID(), fixture.report_id, fixture.catalog_release_id, fixture.root_id, elementId,
        `${namespace}.${elementSlug}`, fieldId, fixture.documenting_user_id]), /requires pinned custom group/);
    await client.query("rollback to savepoint wrong_target");
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
});
