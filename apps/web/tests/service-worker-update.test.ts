import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployed clients immediately adopt a newly published application shell", async () => {
  const worker = await readFile(new URL("../service-worker/service-worker.ts", import.meta.url), "utf8");
  const registration = await readFile(new URL("../components/service-worker-registration.tsx", import.meta.url), "utf8");
  const generator = await readFile(new URL("../scripts/build-service-worker.ts", import.meta.url), "utf8");

  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /open-triage-shell-v5-\$\{__OPEN_TRIAGE_BUILD_SHA__\}/);
  assert.match(generator, /OPEN_TRIAGE_BUILD_SHA/);
  assert.match(generator, /define: \{ __OPEN_TRIAGE_BUILD_SHA__: JSON\.stringify\(buildSha\) \}/);
  assert.match(registration, /updateViaCache: "none"/);
  assert.match(registration, /controllerchange/);
  assert.match(registration, /window\.location\.reload\(\)/);
});

test("offline shell precaches linked language bundles from the installed page", async () => {
  const worker = await readFile(new URL("../service-worker/service-worker.ts", import.meta.url), "utf8");
  const dictionary = await readFile(new URL("../app/localization.ts", import.meta.url), "utf8");
  assert.match(dictionary, /import english from "\.\.\/messages\/en\.json"/);
  assert.match(dictionary, /import swedish from "\.\.\/messages\/sv\.json"/);
  assert.match(worker, /const linkedAssets = \[\.\.\.html\.matchAll/);
  assert.match(worker, /cache\.addAll\(\[\.\.\.new Set\(\[\.\.\.appShell\.slice\(1\), \.\.\.linkedAssets\]\)\]\)/);
});
