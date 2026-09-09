import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployed clients immediately adopt a newly published application shell", async () => {
  const worker = await readFile(new URL("../service-worker/service-worker.ts", import.meta.url), "utf8");
  const registration = await readFile(new URL("../components/service-worker-registration.tsx", import.meta.url), "utf8");

  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(registration, /updateViaCache: "none"/);
  assert.match(registration, /controllerchange/);
  assert.match(registration, /window\.location\.reload\(\)/);
});
