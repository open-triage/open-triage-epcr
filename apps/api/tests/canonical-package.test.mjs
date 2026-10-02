import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { catalogFingerprint, contentDigest, makePackage, parsePackage, writePackage, discoverPackages } from "../dist/admin/canonical-package.js";
import { CanonicalPackageService } from "../dist/admin/canonical-package.service.js";

const snapshot = { schemaVersion: 1, sourceReleaseId: "local-id", elements: [{ elementId: "ePatient.01", constraints: { minOccurs: 0 } }], codeLists: [] };
function artifact(kind = "form") {
  return makePackage({ kind, name: "Portable", version: "7", catalog: { sha256: catalogFingerprint(snapshot) },
    definition: kind === "validation" ? [{ id: "rule", source: 'require minimum("ePatient.01", 1)' }] : { schemaVersion: 1, sections: [] } });
}

test("fingerprints ignore local release UUIDs and key ordering, but pin clinical content", () => {
  assert.equal(catalogFingerprint(snapshot), catalogFingerprint({ codeLists: [], elements: snapshot.elements, sourceReleaseId: "foreign-id", schemaVersion: 1 }));
  assert.notEqual(catalogFingerprint(snapshot), catalogFingerprint({ ...snapshot, elements: [{ elementId: "ePatient.01", constraints: { minOccurs: 1 } }] }));
});

test("rejects corrupted content, wrong kind, and unknown format versions", () => {
  const p = artifact();
  assert.deepEqual(parsePackage(p, "form"), p);
  assert.throws(() => parsePackage({ ...p, name: "Tampered" }, "form"));
  assert.throws(() => parsePackage(p, "validation"));
  const { sha256, ...content } = p;
  const future = { ...content, schemaVersion: 2 };
  assert.throws(() => parsePackage({ ...future, sha256: contentDigest(future) }, "form"));
});

test("writes only per-type local folders, discovers parent and local, and preserves conflicting files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-packages-"));
  const previous = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
  process.env.OPENTRIAGE_DEFINITIONS_ROOT = root;
  try {
    const p = artifact();
    await Promise.all([writePackage(p), writePackage(p)]);
    const parent = path.join(root, "forms");
    const destination = path.join(parent, "local", "portable-v7.json");
    assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), p);
    await writeFile(path.join(parent, "shared.json"), JSON.stringify(p));
    await writeFile(path.join(parent, "broken.json"), "not JSON");
    const files = await discoverPackages("form");
    assert.deepEqual(files.map(({ file }) => file), ["forms/broken.json", "forms/shared.json", "forms/local/portable-v7.json"]);
    assert.ok(files[0].error);
    assert.equal(files.filter((file) => file.package).length, 2);
    await writeFile(destination, '{"changed":true}');
    await assert.rejects(writePackage(p), /different canonical file/);
    assert.equal(await readFile(destination, "utf8"), '{"changed":true}');
    assert.equal((await readdir(path.join(parent, "local"))).length, 1);
    assert.deepEqual(await discoverPackages("validation"), []);
  } finally {
    if (previous === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("export names use safe interface names and versions while retaining internal digests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-names-"));
  const previous = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
  process.env.OPENTRIAGE_DEFINITIONS_ROOT = root;
  try {
    for (const kind of ["form", "catalog", "validation"]) {
      const { sha256: _digest, ...content } = artifact(kind);
      const p = makePackage({ ...content, name: "../Åland / Emergency Form", version: "2" });
      await writePackage(p);
      await writePackage(makePackage({ ...content, name: p.name, version: "3" }));
      const folder = path.join(root, kind === "form" ? "forms" : kind, "local");
      assert.deepEqual((await readdir(folder)).sort(), ["aland-emergency-form-v2.json", "aland-emergency-form-v3.json"]);
      const saved = JSON.parse(await readFile(path.join(folder, "aland-emergency-form-v2.json"), "utf8"));
      assert.equal(saved.name, p.name);
      assert.equal(saved.sha256, p.sha256);
      assert.deepEqual(parsePackage(saved, kind), p);
      const collision = makePackage({ ...content, name: "Aland Emergency Form", version: "2" });
      await assert.rejects(writePackage(collision), /already uses this name and version/);
      assert.deepEqual(JSON.parse(await readFile(path.join(folder, "aland-emergency-form-v2.json"), "utf8")), p);
      // Legacy exports remain discoverable; the digest is never inferred from the filename.
      await writeFile(path.join(folder, `${p.sha256}.json`), JSON.stringify(p));
      assert.equal((await discoverPackages(kind)).filter(({ package: entry }) => entry?.sha256 === p.sha256).length, 2);
    }
  } finally {
    if (previous === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

function serviceFixture({ compatible = true, existingDraft = false } = {}) {
  const calls = [];
  const sessions = { requireCapability: async (_token, capability) => { calls.push(capability); return { organization: { id: "org" }, user: { id: "user" } }; } };
  const catalogs = { versions: async () => [{ id: "destination-catalog" }], inspectVersion: async () => ({ definition: compatible ? snapshot : { ...snapshot, codeLists: ["different"] } }) };
  const authoring = {
    current: async () => existingDraft ? { id: "existing" } : null,
    clone: async (_token, body) => { calls.push(["clone", body]); return { id: "draft", revision: 1 }; },
    create: async (_token, body) => { calls.push(["create", body]); return { id: "draft", revision: 1 }; },
    save: async (_token, _id, body) => { calls.push(["save", body]); return { id: "draft", revision: 2, definitionSha256: "validated-digest" }; },
    publish: async (_token, _id, body) => { calls.push(["publish", body]); return { id: "published", version: 12 }; }
  };
  return { service: new CanonicalPackageService({ query: async () => [] }, sessions, catalogs, authoring, authoring), calls };
}

for (const kind of ["form", "validation"]) {
  test(`${kind} import rejects incompatible catalogs before mutation`, async () => {
    const { service, calls } = serviceFixture({ compatible: false });
    await assert.rejects(service.importPublished("token", kind, artifact(kind)), /exact compatible published catalog/);
    assert.equal(calls.some(Array.isArray), false);
  });
  test(`${kind} import produces a published version and retains source version provenance`, async () => {
    const { service, calls } = serviceFixture();
    assert.deepEqual(await service.importPublished("token", kind, artifact(kind)), { id: "published", version: 12 });
    assert.equal(calls.find((call) => Array.isArray(call) && ["clone", "create"].includes(call[0]))[1].catalogReleaseId, "destination-catalog");
    const command = calls.find((call) => Array.isArray(call) && call[0] === "publish")[1];
    assert.match(command.changeNote, /source version 7/);
    assert.match(command.changeNote, new RegExp(artifact(kind).sha256));
    assert.equal(command.expectedRevision, 2);
  });
}

test("import never overwrites an existing draft", async () => {
  const { service, calls } = serviceFixture({ existingDraft: true });
  await assert.rejects(service.importPublished("token", "form", artifact()), /existing draft/);
  assert.equal(calls.some(Array.isArray), false);
});

test("already imported package reuses publication under the import lock", async () => {
  const queries = [];
  const db = { transaction: async (_isolation, callback) => callback({ query: async (sql) => {
    queries.push(sql); return sql.includes("fv.change_note") ? [{ id: "existing-publication" }] : [];
  } }) };
  const sessions = { requireCapability: async () => ({ organization: { id: "org" } }) };
  const service = new CanonicalPackageService(db, sessions, {}, {}, {});
  service.persist = async (_token, kind, id) => { assert.equal(kind, "form"); assert.equal(id, "existing-publication"); };
  assert.deepEqual(await service.import("token", "form", artifact()), { id: "existing-publication" });
  assert.match(queries[0], /pg_advisory_xact_lock/);
  assert.equal(queries.length, 2);
});

test("relocating the catalog schema preserves historical artifact checksums", async () => {
  const { catalogArtifactSha256 } = await import("../../../packages/database/scripts/catalog-artifact-sha256.mjs");
  const text = await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url), "utf8");
  const previous = text.replace("../../packages/contracts/catalog.schema-1.0.0.json", "./schema_nemsis-3.5.1.json");
  const original = text.replace("../../packages/contracts/catalog.schema-1.0.0.json", "./nemsis-data-model.schema-1.0.0.json");
  assert.equal(catalogArtifactSha256(text), catalogArtifactSha256(previous));
  assert.equal(catalogArtifactSha256(text), catalogArtifactSha256(original));
});

test("editor synchronization imports every file, continues after errors, and exports published versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canonical-sync-"));
  const previous = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
  process.env.OPENTRIAGE_DEFINITIONS_ROOT = root;
  try {
    await writePackage(artifact("validation"));
    await writeFile(path.join(root, "validation", "broken.json"), "not JSON");
    const calls = [];
    const authoring = { versions: async () => [{ id: "published" }] };
    const sessions = { requireCapability: async (_token, capability) => { calls.push(capability); } };
    const service = new CanonicalPackageService({}, sessions, authoring, authoring, authoring);
    service.import = async (_token, kind, content) => { calls.push(["import", kind, content.sha256]); return { id: "published" }; };
    service.persist = async (_token, kind, id) => { calls.push(["export", kind, id]); };
    const result = await service.synchronize("token", "validation");
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /broken.json/);
    assert.deepEqual(calls, ["validation:publish", ["import", "validation", artifact("validation").sha256],
      ["export", "validation", "published"]]);
  } finally {
    if (previous === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
