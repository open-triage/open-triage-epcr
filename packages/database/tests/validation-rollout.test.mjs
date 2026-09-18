import assert from "node:assert/strict";
import test from "node:test";
import { migrateFormExpression, rolloutUuid } from "../scripts/seed-initial-validation-versions.mjs";
import { RESET_CONFIRMATION, resetUnsignedClinicalWork } from "../scripts/reset-unsigned-clinical-work.mjs";

test("initial rollout identities and Form migration are deterministic", () => {
  assert.equal(rolloutUuid("organization", "catalog", "rule"), rolloutUuid("organization", "catalog", "rule"));
  assert.match(rolloutUuid("organization", "catalog", "rule"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(migrateFormExpression({ operator: "and", conditions: [
    { operator: "exists", field: "incident" },
    { operator: "not", condition: { operator: "equals", field: "priority", value: "routine" } },
  ] }, new Map([["incident", "eResponse.03"], ["priority", "eDispatch.05"]])),
  'all(present("eResponse.03"), not(equals("eDispatch.05", "routine")))');
});

function resetClient() {
  let deleted = false;
  const queries = [];
  return { queries, async connect() {}, async end() {}, async query(sql) {
    queries.push(sql);
    if (sql.includes("select id from clinical.report")) return { rows: deleted ? [] : [{ id: "report-1" }] };
    if (sql.includes("select assignment.id")) return { rows: deleted ? [] : [{ id: "call-1" }] };
    if (sql.includes("select report.id, snapshot.id")) return { rows: [{ id: "signed-1", snapshot_id: "snapshot-1", canonical_sha256: "a".repeat(64) }] };
    if (sql.includes("clinical.reset_unsigned_rollout")) return { rows: [{ result: { reports: 1, calls: 1 } }] };
    if (sql === "commit") deleted = true;
    return { rows: [] };
  } };
}

test("unsigned reset previews without mutation when confirmation is omitted", async () => {
  const client = resetClient();
  const output = [];
  const preview = await resetUnsignedClinicalWork({ databaseUrl: "postgres://test", Client: class { constructor() { return client; } },
    log: { info: (line) => output.push(JSON.parse(line)) } });
  assert.equal(output[0].event, "unsigned_clinical_reset_preview");
  assert.equal(preview.result, null);
  assert.equal(client.queries.some((sql) => sql.includes("reset_unsigned_rollout")), false);
});

test("confirmed reset uses the migration role and verifies signed preservation", async () => {
  const client = resetClient();
  const output = [];
  const completed = await resetUnsignedClinicalWork({ databaseUrl: "postgres://test", confirmation: RESET_CONFIRMATION,
    Client: class { constructor() { return client; } }, log: { info: (line) => output.push(JSON.parse(line)) } });
  assert.equal(client.queries.includes("set local role open_triage_migration_executor"), true);
  assert.equal(completed.result.signedReportsPreserved, 1);
  assert.equal(output.at(-1).event, "unsigned_clinical_reset_complete");
});
