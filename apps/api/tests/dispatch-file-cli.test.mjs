import assert from "node:assert/strict";
import test from "node:test";
import { dispatchCliExitCode, runDispatchFileCli } from "../dist/dispatch/dispatch-file.cli.js";

const argv = [
  "--file", "assignment.json",
  "--organization-id", "30000000-0000-4000-8000-000000000001",
  "--source-id", "vendor-a"
];

test("the file CLI passes explicit file and caller context to ingestion and returns machine status", async () => {
  const bytes = Buffer.from('{"synthetic":true}');
  let observed;
  const outcome = await runDispatchFileCli(argv, {
    readBytes: async (path) => { assert.equal(path, "assignment.json"); return bytes; },
    ingest: async (options, sourceBytes) => {
      observed = { options, sourceBytes };
      return { status: "applied", sourceRecordId: "response-1", revision: 1, findings: [] };
    }
  });
  assert.deepEqual(observed.options, {
    file: "assignment.json",
    organizationId: "30000000-0000-4000-8000-000000000001",
    sourceId: "vendor-a"
  });
  assert.strictEqual(observed.sourceBytes, bytes);
  assert.equal(outcome.exitCode, 0);
  assert.equal(JSON.parse(JSON.stringify(outcome.result)).status, "applied");
});

test("CLI outcomes distinguish every operational and rejection status with meaningful exits", () => {
  for (const status of ["applied", "replayed", "applied_with_findings", "quarantined"]) {
    assert.equal(dispatchCliExitCode(status), 0, status);
  }
  assert.deepEqual(Object.fromEntries(["rejected", "stale", "conflicting", "post_signature"]
    .map((status) => [status, dispatchCliExitCode(status)])), {
    rejected: 2, stale: 3, conflicting: 4, post_signature: 5
  });
});

test("the CLI rejects missing, duplicate, and forged caller context before reading the file", async () => {
  const dependencies = { readBytes: async () => { throw new Error("must not read"); }, ingest: async () => ({}) };
  await assert.rejects(runDispatchFileCli(["--file", "assignment.json"], dependencies), /required|Usage/);
  await assert.rejects(runDispatchFileCli([...argv, "--source-id", "other"], dependencies), /Duplicate/);
  await assert.rejects(runDispatchFileCli([
    "--file", "assignment.json", "--organization-id", "not-a-uuid", "--source-id", "vendor-a"
  ], dependencies), /UUID/);
});
