import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const ignorePath = new URL("../.gitignore", import.meta.url);
const packagePath = new URL("../apps/web/package.json", import.meta.url);
const generatorPath = new URL("../apps/web/scripts/build-service-worker.ts", import.meta.url);
const sourcePath = new URL("../apps/web/service-worker/service-worker.ts", import.meta.url);
const generatedPath = new URL("../apps/web/public/sw.js", import.meta.url);
const dockerfilePath = new URL("../deploy/docker/web.Dockerfile", import.meta.url);
const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);

test("the service worker is generated from TypeScript and excluded from version control", async () => {
  const [gitignore, packageText, generator, source] = await Promise.all([
    readFile(ignorePath, "utf8"),
    readFile(packagePath, "utf8"),
    readFile(generatorPath, "utf8"),
    readFile(sourcePath, "utf8"),
  ]);
  const webPackage = JSON.parse(packageText);

  await assert.rejects(access(generatedPath), { code: "ENOENT" });
  assert.match(gitignore, /^\/apps\/web\/public\/sw\.js$/m);
  assert.match(webPackage.scripts.predev, /build-service-worker\.ts/);
  assert.match(webPackage.scripts.prebuild, /build-service-worker\.ts/);
  assert.match(generator, /entryPoints: \["service-worker\/service-worker\.ts"\]/);
  assert.match(generator, /outfile: "public\/sw\.js"/);
  assert.doesNotMatch(generator, /SAMPLE_DISPATCH_ASSIGNMENT_ENABLED/);
  assert.doesNotMatch(source, /SAMPLE_DISPATCH_ASSIGNMENT_ENABLED/);
  assert.match(source, /new URL\("demo-assigned-calls\.json"/);
});

test("build and CI require the generated worker in deployable output", async () => {
  const [dockerfile, workflow] = await Promise.all([
    readFile(dockerfilePath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const validation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  helm-validation:"),
  );

  assert.match(dockerfile, /npm run build -w @open-triage\/web/);
  assert.match(dockerfile, /COPY --from=build \/workspace\/apps\/web\/out/);
  assert.match(validation, /npm run build -w @open-triage\/web/);
  assert.match(validation, /test -s apps\/web\/out\/sw\.js/);
  assert.match(validation, /npm run test:deployment -w @open-triage\/web/);
});

test("audited catalog artifacts remain versioned", () => {
  const catalogs = [
    "apps/web/app/data/nemsis-data-model-3.5.1.json",
    "apps/web/app/data/stationary-layout-1.0.0.json",
    "apps/web/app/data/nemsis-3.5.1-sources/Combined_ElementDetails_Full.txt",
  ];
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ...catalogs], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(tracked.status, 0, tracked.stderr);
  assert.deepEqual(tracked.stdout.trim().split("\n"), [...catalogs].sort());
});
