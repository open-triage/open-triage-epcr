import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const compiledModulePath = join(here, "../dist/calls/synthetic-dispatch-payloads.js");

// The module resolves fixtures relative to its own compiled location
// (`resolve(__dirname, "../../../../packages/contracts/examples/dispatch/...")`), which is
// `<repo root>/packages/contracts/examples/dispatch` when the module lives at its normal
// `apps/api/dist/calls/` depth. Reproduce that same depth under a throwaway sandbox that has
// no `packages/contracts/examples/` anywhere in its tree, to stand in for a container image
// that ships only `dist/`.
function copyModuleIntoFixtureLessSandbox() {
  const sandboxRoot = mkdtempSync(join(tmpdir(), "synthetic-dispatch-no-fixtures-"));
  const destDir = join(sandboxRoot, "apps", "api", "dist", "calls");
  mkdirSync(destDir, { recursive: true });
  const destFile = join(destDir, "synthetic-dispatch-payloads.js");
  cpSync(compiledModulePath, destFile);
  return { sandboxRoot, destFile };
}

test("the module can be imported when the fixture directory tree does not exist alongside dist", async () => {
  const { sandboxRoot, destFile } = copyModuleIntoFixtureLessSandbox();
  try {
    const imported = await import(pathToFileURL(destFile).href);

    // Merely loading the module must not touch the filesystem for fixture contents, so the
    // exported constant (computed from the expected file count, not their contents) is safe
    // to read even though `packages/contracts/examples/` does not exist under `sandboxRoot`.
    assert.equal(imported.SYNTHETIC_DISPATCH_PAYLOAD_COUNT, 10);
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test("only a call path that actually needs fixture contents fails when they are missing", async () => {
  const { sandboxRoot, destFile } = copyModuleIntoFixtureLessSandbox();
  try {
    const imported = await import(pathToFileURL(destFile).href);

    assert.throws(() => imported.syntheticDispatchPayloads(), /ENOENT/);
    assert.throws(() => imported.randomSyntheticDispatchPayload(() => 0), /ENOENT/);
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test("the feature still works identically once the fixture files are present", async () => {
  // Importing straight from the real build output, where `packages/contracts/examples/`
  // exists at the expected relative depth, exercises the ordinary in-repo/production path.
  const moduleUrl = pathToFileURL(compiledModulePath).href;
  const { randomSyntheticDispatchPayload, syntheticDispatchPayloads, SYNTHETIC_DISPATCH_PAYLOAD_COUNT } =
    await import(moduleUrl);

  assert.equal(SYNTHETIC_DISPATCH_PAYLOAD_COUNT, 10);
  const payloads = syntheticDispatchPayloads();
  assert.equal(payloads.length, 10);
  assert.equal(randomSyntheticDispatchPayload(() => 0).sourceRecordId, "SYNTHETIC-SOURCE-RECORD-0001");
  assert.equal(randomSyntheticDispatchPayload(() => 0.999999).sourceRecordId, "SYNTHETIC-SOURCE-RECORD-0010");
});
