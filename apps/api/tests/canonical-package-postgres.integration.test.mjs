import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, copyFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { CanonicalPackageService } from "../dist/admin/canonical-package.service.js";
import { CatalogAuthoringService } from "../dist/admin/catalog-authoring.service.js";
import { FormAuthoringService } from "../dist/admin/form-authoring.service.js";
import { ValidationAuthoringService } from "../dist/admin/validation-authoring.service.js";
import { FormPublicationService } from "../dist/forms/form-publication.service.js";
import { makePackage } from "../dist/admin/canonical-package.js";

test("selected JSON imports publish agency versions, preserve activation, and allocate new numbers for repeated imports", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-import-integration-"));
  const previousRoot = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: [active] } = await client.query("select * from app_identity.active_configuration_bundle limit 1");
    if (!active) { t.skip("An existing agency configuration is required"); return; }
    process.env.OPENTRIAGE_DEFINITIONS_ROOT = root;
    await client.query("begin isolation level serializable");
    const actorId = randomUUID();
    await client.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic)
      values($1,$2,'Rollback import verification',true)`, [actorId, active.organization_id]);
    const query = async (sql, parameters) => (await client.query(sql, parameters)).rows;
    const manager = { query };
    const db = { query, manager, transaction: async (...arguments_) => arguments_.at(-1)(manager) };
    const sessions = { requireCapability: async () => ({ organization: { id: active.organization_id },
      user: { id: actorId }, capabilities: ["catalog:read", "catalog:write", "catalog:publish",
        "forms:read", "forms:write", "forms:publish", "validation:read", "validation:write", "validation:publish"] }) };
    const catalogs = new CatalogAuthoringService(db, sessions);
    const validations = new ValidationAuthoringService(db, sessions);
    const forms = new FormAuthoringService(db, sessions, new FormPublicationService(db), validations);
    const service = new CanonicalPackageService(db, sessions, catalogs, forms, validations);
    // All writes are rolled back; keep export files inside the test's temp root.
    service.persist = async () => {};
    const repoDefinitions = new URL("../../../defines/", import.meta.url);
    for (const folder of ["catalog", "localization", "forms", "validation"]) {
      await mkdir(path.join(root, folder), { recursive: true });
      for (const file of await readdir(new URL(folder + "/", repoDefinitions))) {
        if (file.endsWith(".json")) await copyFile(new URL(folder + "/" + file, repoDefinitions), path.join(root, folder, file));
      }
    }
    const baseFile = "catalog/catalog_nemsis-3.5.1.json";
    assert.equal((await service.list("test", "catalog")).find(({file}) => file === baseFile)?.compatible, true);
    const base = await service.importFile("test", "catalog", { file: baseFile });
    const baseAgain = await service.importFile("test", "catalog", { file: baseFile });
    assert.notEqual(base.id, baseAgain.id);
    assert.equal(Number(baseAgain.version), Number(base.version) + 1);
    const rawBase = JSON.parse(await readFile(new URL(baseFile.slice(8), new URL("catalog/", repoDefinitions)), "utf8"));
    assert.equal(Number((await query("select count(*) from catalog.element_definition where release_id=$1", [base.id]))[0].count), rawBase.elements.length);
    assert.equal(Number((await query("select count(*) from catalog.value_set_option where release_id=$1", [base.id]))[0].count), rawBase.bundledLists.reduce((count,list) => count+list.values.length,0));
    for (const kind of ["validation", "form"]) {
      const folder = kind === "form" ? "forms" : kind;
      for (const file of (await readdir(path.join(root, folder))).filter(file => file.endsWith(".json"))) {
        assert.equal((await service.list("test", kind)).find(entry => entry.file === `${folder}/${file}`)?.compatible, true, file);
        const first = await service.importFile("test", kind, { file: `${folder}/${file}`, catalogReleaseId: base.id });
        const second = await service.importFile("test", kind, { file: `${folder}/${file}`, catalogReleaseId: base.id });
        const binding = (await query(kind === "form" ? "select catalog_release_id from forms.form_version where id=$1" : "select catalog_release_id from validation.version where id=$1", [first.id]))[0];
        assert.equal(binding.catalog_release_id, base.id);
        assert.notEqual(second.id,first.id);
        assert.equal(Number(second.version),Number(first.version)+1,file);
      }
    }
    for (const [kind, versionId] of [["form", active.form_version_id],
      ["validation", active.validation_version_id], ["catalog", active.catalog_release_id]]) {
      const { format: _format, schemaVersion: _schema, sha256: _hash, ...content } = await service.export("test", kind, versionId);
      content.name = `Import verification ${randomUUID()}`;
      content.version = kind === "form" ? 100000 : undefined;
      const folder = kind === "form" ? "forms" : kind;
      await writeFile(path.join(root, folder, "foreign-version.json"), JSON.stringify(makePackage(content)));
      const files = await service.list("test", kind);
      const selected = files.find(({package: p}) => p?.name === content.name);
      assert.equal(selected?.compatible, true);
      const first = await service.importFile("test", kind, { file: selected.file });
      const second = await service.importFile("test", kind, { file: selected.file });
      assert.notEqual(second.id, first.id, `${kind} repeated import must publish a new version`);
      assert.equal(Number(second.version), Number(first.version) + 1);
      const versions = await ({ catalog: catalogs, form: forms, validation: validations }[kind]).versions("test");
      assert.equal(versions.find((version) => version.id === first.id)?.status, "published");
      if (kind === "validation") {
        const [published] = await query("select source_rule from validation.version where id=$1", [first.id]);
        assert.equal(published.source_rule.length, content.definition.length);
        assert.deepEqual(published.source_rule.map(({ name }) => name), content.definition.map(({ name }) => name.trim()));
        assert.equal(published.source_rule.some((rule) => content.definition.some(({ id }) => rule.id === id)), false);
      }
    }
    assert.deepEqual((await client.query("select * from app_identity.active_configuration_bundle where organization_id=$1",
      [active.organization_id])).rows[0], active);
  } finally {
    await client.query("rollback");
    await client.end();
    if (previousRoot === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
