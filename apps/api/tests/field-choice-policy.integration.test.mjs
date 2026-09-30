import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { catalogFieldsConfiguration } from "../dist/forms/clinical-form-configuration.js";
import { effectiveCatalogFields, materializeLegacyChoicePolicies } from "../dist/forms/field-choice-policy.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest("a pinned catalog supports independent field choices and a legacy successor snapshot", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const releases = await client.query(`select vse.release_id, array_agg(distinct vse.element_id) as element_ids
      from catalog.value_set_element vse join catalog.release r on r.id=vse.release_id and r.sealed
      group by vse.release_id,vse.value_set_id having count(distinct vse.element_id)>1 limit 1`);
    if (!releases.rows[0]) return t.skip("No shared catalog value set is installed");
    const { release_id: releaseId, element_ids: elementIds } = releases.rows[0];
    const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
    const available = await catalogFieldsConfiguration(manager, releaseId, elementIds, true);
    const legacy = await catalogFieldsConfiguration(manager, releaseId, elementIds);
    const [firstId, secondId] = elementIds;
    const first = available[firstId].codeChoices;
    const second = available[secondId].codeChoices;
    assert.ok(first?.length && second?.length);
    const definition = { schemaVersion: 1, sections: [{ key: "shared", fields: [
      { key: "first", source: { kind: "nemsis", elementId: firstId }, choicePolicy: [
        { kind: "code", code: first.at(-1).code, codeSystem: first.at(-1).codeSystem }] },
      { key: "second", source: { kind: "nemsis", elementId: secondId }, choicePolicy: [
        { kind: "code", code: second[0].code, codeSystem: second[0].codeSystem }] },
    ] }] };
    const resolved = effectiveCatalogFields(definition, legacy, available);
    assert.deepEqual(resolved[firstId].codeChoices.map((choice) => choice.code), [first.at(-1).code]);
    assert.deepEqual(resolved[secondId].codeChoices.map((choice) => choice.code), [second[0].code]);
    assert.ok(available[firstId].codeChoices.length >= resolved[firstId].codeChoices.length);
    const successor = materializeLegacyChoicePolicies({ schemaVersion: 1, sections: [{ key: "legacy", fields: [
      { key: "first", source: { kind: "nemsis", elementId: firstId } }] }] }, legacy);
    assert.deepEqual(successor.sections[0].fields[0].choicePolicy.filter((choice) => choice.kind === "code")
      .map((choice) => choice.code), legacy[firstId].codeChoices.map((choice) => choice.code));
  } finally { await client.end(); }
});
