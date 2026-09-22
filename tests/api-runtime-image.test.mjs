import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfilePath = new URL("../deploy/docker/api.Dockerfile", import.meta.url);
const databasePackagePath = new URL("../packages/database/package.json", import.meta.url);
const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);

test("the API container separates its build toolchain from the production runtime", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime"));

  assert.equal((dockerfile.match(/^FROM /gm) ?? []).length, 2);
  assert.match(runtime, /npm ci --omit=dev/);
  for (const workspace of ["api", "contracts", "database"]) {
    assert.match(runtime, new RegExp(`--workspace @open-triage/${workspace}`));
  }
  assert.doesNotMatch(runtime, /COPY apps\/web\/package\.json/);
  assert.doesNotMatch(runtime, /COPY apps\/api apps\/api/);
  assert.doesNotMatch(runtime, /COPY packages\/database packages\/database/);
  assert.match(runtime, /COPY --from=build \/workspace\/apps\/api\/dist apps\/api\/dist/);
  assert.match(runtime, /^USER node$/m);
  assert.match(runtime, /^HEALTHCHECK /m);
  assert.match(runtime, /127\.0\.0\.1:3001\/api\/health/);
  assert.match(runtime, /^CMD \["node", "apps\/api\/dist\/main\.js"\]$/m);
});

test("the pruned runtime explicitly retains approved database operations and their assets", async () => {
  const [dockerfile, databasePackageText] = await Promise.all([
    readFile(dockerfilePath, "utf8"),
    readFile(databasePackagePath, "utf8"),
  ]);
  const databasePackage = JSON.parse(databasePackageText);

  for (const script of [
    "bootstrap-synthetic-installation",
    "synthetic-stationary-definition",
    "load-nemsis-catalog",
    "migrate",
    "provision-workload-logins",
    "project-analytics",
    "projection-health",
    "retention",
    "rotate-patient-keys",
    "verify-recovery",
    "verify-reporting-replica",
  ]) {
    assert.match(dockerfile, new RegExp(`COPY packages/database/scripts/${script}\\.mjs`));
  }
  assert.equal(
    databasePackage.scripts["bootstrap:synthetic:runtime"],
    "node scripts/bootstrap-synthetic-installation.mjs",
  );
  assert.equal(
    databasePackage.scripts["provision:workload-logins"],
    "node scripts/provision-workload-logins.mjs",
  );
  for (const asset of [
    "supabase/migrations",
    "packages/database/generated",
    "database-operations-policy.json",
    "retention-policy.json",
    "COPY defines defines",
    "seed-initial-validation-versions.mjs",
    "seed-install-definitions.mjs",
    "packages/contracts/examples/dispatch",
  ]) {
    assert.ok(dockerfile.includes(asset), `runtime is missing ${asset}`);
  }
});

test("CI boots and inspects the pruned image before it can pass the deployment gate", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const validation = workflow.slice(
    workflow.indexOf("  api-runtime-image-validation:"),
    workflow.indexOf("  helm-validation:"),
  );
  const gate = workflow.slice(workflow.indexOf("  validation-gate:"), workflow.indexOf("  publish-images:"));

  assert.match(validation, /docker build -f deploy\/docker\/api\.Dockerfile/);
  assert.match(validation, /npm run migrate -w @open-triage\/database/);
  assert.match(validation, /npm run load:catalog -w @open-triage\/database/);
  assert.match(validation, /insert into app_identity\.organization/);
  assert.match(validation, /npm run bootstrap:synthetic:runtime -w @open-triage\/database/);
  assert.match(validation, /curl --fail --silent http:\/\/127\.0\.0\.1:3001\/api\/health/);
  assert.match(validation, /for package in typescript @nestjs\/cli next react concurrently tsx eslint/);
  assert.match(validation, /node --check/);
  assert.match(gate, /^      - api-runtime-image-validation$/m);
});
