import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateApiRuntime } from "../deploy/docker/generate-api-runtime.mjs";

const dockerfilePath = new URL("../deploy/docker/api.Dockerfile", import.meta.url);
const manifestPath = new URL("../deploy/docker/api-runtime-manifest.json", import.meta.url);
const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);

test("the API container installs production dependencies around one generated runtime artifact", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime"));

  assert.equal((dockerfile.match(/^FROM /gm) ?? []).length, 2);
  assert.match(dockerfile, /generate-api-runtime\.mjs deploy\/docker\/api-runtime-manifest\.json \/api-runtime/);
  assert.match(runtime, /npm ci --omit=dev/);
  for (const workspace of ["api", "contracts", "database"]) {
    assert.match(runtime, new RegExp(`--workspace @open-triage/${workspace}`));
  }
  assert.match(runtime, /COPY --from=build \/api-runtime\/ \.\//);
  assert.doesNotMatch(runtime, /COPY packages\/database\/scripts/);
  assert.doesNotMatch(runtime, /COPY packages\/database packages\/database/);
  assert.doesNotMatch(runtime, /COPY apps\/api apps\/api/);
  assert.match(runtime, /^USER node$/m);
  assert.match(runtime, /^HEALTHCHECK /m);
  assert.match(runtime, /127\.0\.0\.1:3001\/api\/health/);
  assert.match(runtime, /^CMD \["node", "apps\/api\/dist\/main\.js"\]$/m);
});

test("one manifest declares the application, operational commands, and runtime assets", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.application.entrypoint, "apps/api/dist/main.js");
  assert.deepEqual(manifest.operations.map(({ name }) => name), [
    "migrate:runtime",
    "load:catalog",
    "bootstrap:synthetic:runtime",
    "seed:validation",
    "seed:install-definitions",
    "provision:workload-logins",
    "project",
    "project:health",
    "retention",
    "purge:synthetic",
    "rotate:patient-keys",
    "rotate:offline-recovery-keys",
    "verify:recovery",
    "verify:replica",
  ]);
  for (const asset of [
    "supabase/migrations",
    "packages/database/generated",
    "packages/database/config/database-operations-policy.json",
    "packages/database/config/retention-policy.json",
    "defines",
    "packages/contracts/examples/dispatch",
  ]) {
    assert.ok(manifest.assets.includes(asset), `runtime manifest is missing ${asset}`);
  }
});

test("runtime generation follows transitive local imports and fails when one is absent", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "api-runtime-fixture-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const outputRoot = join(fixtureRoot, "output");
  await Promise.all([
    mkdir(join(fixtureRoot, "apps/api/dist"), { recursive: true }),
    mkdir(join(fixtureRoot, "packages/database/scripts/lib"), { recursive: true }),
    mkdir(join(fixtureRoot, "asset"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(fixtureRoot, "apps/api/dist/main.js"), "require('./health.js');\n"),
    writeFile(join(fixtureRoot, "apps/api/dist/health.js"), "export const healthy = true;\n"),
    writeFile(join(fixtureRoot, "packages/database/scripts/operation.mjs"), "import './lib/helper.mjs';\n"),
    writeFile(join(fixtureRoot, "packages/database/scripts/lib/helper.mjs"), "export const value = 1;\n"),
    writeFile(join(fixtureRoot, "packages/database/package.json"), JSON.stringify({
      name: "@open-triage/database", version: "1.0.0", license: "AGPL-3.0-only",
      private: true, type: "module", dependencies: { pg: "1.0.0" },
    })),
    writeFile(join(fixtureRoot, "asset/value.json"), "{}\n"),
  ]);
  const fixtureManifest = join(fixtureRoot, "manifest.json");
  await writeFile(fixtureManifest, JSON.stringify({
    schemaVersion: 1,
    application: { entrypoint: "apps/api/dist/main.js" },
    operations: [{ name: "operate", entrypoint: "packages/database/scripts/operation.mjs" }],
    assets: ["asset/value.json"],
  }));

  const generated = await generateApiRuntime({
    repositoryRoot: fixtureRoot,
    manifestPath: fixtureManifest,
    outputRoot,
  });
  assert.deepEqual(generated.moduleClosure, [
    "apps/api/dist/health.js",
    "apps/api/dist/main.js",
    "packages/database/scripts/lib/helper.mjs",
    "packages/database/scripts/operation.mjs",
  ]);
  assert.equal(
    JSON.parse(await readFile(join(outputRoot, "packages/database/package.json"), "utf8")).scripts.operate,
    "node scripts/operation.mjs",
  );

  await rm(join(fixtureRoot, "packages/database/scripts/lib/helper.mjs"));
  await assert.rejects(
    generateApiRuntime({ repositoryRoot: fixtureRoot, manifestPath: fixtureManifest, outputRoot }),
    /ENOENT/,
  );
});

test("CI executes core flows and validates every remaining declared runtime command in the image", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const validation = workflow.slice(
    workflow.indexOf("  api-runtime-image-validation:"),
    workflow.indexOf("  helm-validation:"),
  );
  const gate = workflow.slice(workflow.indexOf("  validation-gate:"), workflow.indexOf("  promote-api-image:"));

  assert.match(validation, /--file deploy\/docker\/api\.Dockerfile/);
  assert.match(validation, /npm run migrate:runtime -w @open-triage\/database/);
  assert.match(validation, /npm run load:catalog -w @open-triage\/database/);
  assert.match(validation, /insert into app_identity\.organization/);
  assert.match(validation, /npm run bootstrap:synthetic:runtime -w @open-triage\/database/);
  assert.match(validation, /curl --fail --silent http:\/\/127\.0\.0\.1:3001\/api\/health/);
  assert.match(validation, /node deploy\/docker\/validate-api-runtime\.mjs/);
  assert.match(validation, /for package in typescript @nestjs\/cli next react concurrently tsx eslint/);
  assert.match(validation, /test ! -e \/workspace\/apps\/api\/src/);
  assert.match(gate, /^      - api-runtime-image-validation$/m);
});

test("the exact validated API image is published after authorization without another build", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const validation = workflow.slice(
    workflow.indexOf("  api-runtime-image-validation:"),
    workflow.indexOf("  helm-validation:"),
  );
  const promotion = workflow.slice(
    workflow.indexOf("  promote-api-image:"),
    workflow.indexOf("  promote-web-image:"),
  );

  assert.match(validation, /docker save "\$API_RUNTIME_IMAGE" \| gzip/);
  assert.doesNotMatch(validation, /docker push|docker\/login-action|packages: write/);
  assert.match(promotion, /^    needs: deployment-authorization$/m);
  assert.match(promotion, /gunzip --stdout .* \| docker load/);
  assert.match(promotion, /docker image inspect --format .*org\.opencontainers\.image\.revision/);
  assert.match(promotion, /docker push "\$API_RELEASE_IMAGE"/);
  assert.match(promotion, /--output image-identities\/api\.json/);
  assert.doesNotMatch(promotion, /docker build(?:\s|$)|docker\/build-push-action/);
});
