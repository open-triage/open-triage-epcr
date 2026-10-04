import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalValidationCatalog } from "./helpers/canonical-validation-catalog.mjs";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";
import { compiledValidationBundleSha256 } from "@open-triage/contracts";
import { rolloutUuid, seedInitialValidationVersions } from "../scripts/seed-initial-validation-versions.mjs";
import { RESET_CONFIRMATION, resetUnsignedClinicalWork } from "../scripts/reset-unsigned-clinical-work.mjs";

test("initial rollout identities are deterministic", () => {
  assert.equal(rolloutUuid("organization", "catalog", "rule"), rolloutUuid("organization", "catalog", "rule"));
  assert.match(rolloutUuid("organization", "catalog", "rule"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("initial rollout preserves canonical metrics, rule references and publication digests", async () => {
  const catalog = JSON.parse(await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url), "utf8"));
  const { pairs } = await readInstallDefinitions(new URL("../../../defines", import.meta.url).pathname);
  const definition = pairs.find(({ key }) => key === "nemsis-full").validation;
  const writes = [];
  let active = false;
  const client = { async connect() {}, async end() {}, async query(sql, parameters) {
    const result = (rows) => ({ rows, rowCount: rows.length });
    if (sql.includes("from forms.agency_stationary_default")) return result([{
      organization_id: "organization", catalog_release_id: "catalog", form_version_id: "form", actor_id: "actor",
    }]);
    if (sql.includes("select validation_version_id from app_identity.active_configuration_bundle"))
      return result(active ? [{ validation_version_id: "published" }] : []);
    if (sql.includes("from catalog.element_definition e left join")) return result(catalog.elements.map(element => ({
      element_id: element.id, name: element.name, base_datatype: element.datatype.base, group_path: element.groupPath,
      min_occurs: element.occurrence.min, max_occurs: element.occurrence.max === "unbounded" ? null : element.occurrence.max,
    })));
    if (sql.includes("from catalog.group_definition where")) return result(catalog.groups.map(group => ({
      group_id: group.id, name: group.name, repeating: group.repeating, parent_group_id: group.parentId,
      min_occurs: group.occurrence.min, max_occurs: group.occurrence.max === "unbounded" ? null : group.occurrence.max,
    })));
    if (sql.includes("from catalog.element_option o")) return result(canonicalValidationCatalog(catalog).codes.map(code => ({
      element_id: code.elementId, code: code.code, code_system: code.codeSystem, label: code.label, enabled: true,
    })));
    if (sql.includes("from forms.form_field")) return result(catalog.elements.map(({ id }) => ({ element_id: id })));
    if (sql.includes("coalesce(max(version),0)+1")) return result([{ next_version: 1 }]);
    if (sql.startsWith("insert")) writes.push({ sql, parameters });
    if (sql.startsWith("insert into app_identity.active_configuration_bundle")) active = true;
    return result([]);
  } };
  const options = { databaseUrl: "postgres://test", Client: class { constructor() { return client; } }, log: { info() {} } };
  assert.equal((await seedInitialValidationVersions(options)).seeded, 1);
  const published = writes.find(({ sql }) => sql.startsWith("insert into validation.version")).parameters;
  const source = JSON.parse(published[6]), bundle = JSON.parse(published[7]);
  assert.equal(source.schemaVersion, 2);
  assert.deepEqual(source.metrics, definition.metrics);
  assert.equal(source.rules.length, definition.rules.length);
  const pain = source.metrics.find(({ name }) => name === "Pain change (last minus first)");
  assert.equal(source.rules.filter(({ source }) => source.includes(`metricCompare("${pain.id}"`)).length, 1);
  assert.equal(source.rules.filter(({ enabled }) => enabled).length, definition.rules.filter(({ enabled }) => enabled).length);
  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.languageVersion, "2.0.0");
  assert.deepEqual(bundle.metrics.map(metric => metric.id), definition.metrics.map(metric => metric.id));
  assert.ok(bundle.metrics.every(metric => metric.enabled));
  assert.equal(published[8], compiledValidationBundleSha256(bundle));
  assert.equal(published[9], createHash("sha256").update(published[6]).digest("hex"));
  const writeCount = writes.length;
  assert.equal((await seedInitialValidationVersions(options)).outcomes[0].status, "already-active");
  assert.equal(writes.length, writeCount);
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
