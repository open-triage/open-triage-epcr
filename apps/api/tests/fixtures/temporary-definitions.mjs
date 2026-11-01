import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Environment overrides are process-wide: use once per serial test file, and
// dispose only after its application servers and test cleanup hooks have closed.
export async function temporaryDefinitions() {
  const previous = process.env.OPENTRIAGE_DEFINITIONS_ROOT;
  const root = await mkdtemp(path.join(tmpdir(), "open-triage-test-definitions-"));
  process.env.OPENTRIAGE_DEFINITIONS_ROOT = root;
  return {
    root,
    async dispose() {
      if (previous === undefined) delete process.env.OPENTRIAGE_DEFINITIONS_ROOT;
      else process.env.OPENTRIAGE_DEFINITIONS_ROOT = previous;
      await rm(root, { recursive: true, force: true });
    },
  };
}
