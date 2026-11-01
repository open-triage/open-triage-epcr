import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { makePackage, writePackage } from "../dist/admin/canonical-package.js";
import { temporaryDefinitions } from "./fixtures/temporary-definitions.mjs";

for (const configured of [false, true]) {
  test(`test exports are isolated and cleaned after failure with ${configured ? "configured" : "unset"} definitions root`, async () => {
    const previous = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    const persistent = await mkdtemp(path.join(tmpdir(), "definitions-sentinel-"));
    await writeFile(path.join(persistent, "keep.json"), "unchanged");
    if (configured) process.env.OPENTRIAGE_DEFINITIONS_ROOT = persistent;
    else delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
    let root;
    try {
      await assert.rejects(async () => {
        const isolated = await temporaryDefinitions();
        root = isolated.root;
        try {
          assert.notEqual(root, persistent);
          for (const kind of ["form", "catalog", "validation", "hospital-mapping"]) {
            await writePackage(makePackage({ kind, name: "Test export", version: "1",
              catalog: { sha256: "a".repeat(64) }, definition: { schemaVersion: 1 } }), "test-agency");
          }
          assert.deepEqual((await readdir(root)).sort(), ["catalog", "forms", "hospital-mapping", "validation"]);
          throw new Error("Simulated test failure");
        } finally { await isolated.dispose(); }
      }, /Simulated test failure/);
      await assert.rejects(access(root), { code: "ENOENT" });
      assert.equal(process.env.OPENTRIAGE_DEFINITIONS_ROOT, configured ? persistent : undefined);
      assert.deepEqual(await readdir(persistent), ["keep.json"]);
    } finally {
      if (previous === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
      else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previous;
      await rm(persistent, { recursive: true, force: true });
    }
  });
}
