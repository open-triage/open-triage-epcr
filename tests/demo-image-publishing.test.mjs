import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assembleImageManifest,
  validateImageIdentity,
} from "../scripts/demo-image-identity.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const webDockerfilePath = new URL("../deploy/docker/web.Dockerfile", import.meta.url);
const sha = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"a".repeat(64)}`;

function identity(component) {
  return {
    component,
    tag: `ghcr.io/open-triage/open-triage-${component}:${sha}`,
    digest,
    architecture: "linux/amd64",
    sourceCommit: sha,
  };
}

test("image identities require an immutable SHA tag, digest, and AMD64 architecture", () => {
  assert.deepEqual(validateImageIdentity(identity("api"), { owner: "open-triage", sha }), identity("api"));
  assert.throws(
    () => validateImageIdentity({ ...identity("api"), architecture: "linux/arm64" }, { owner: "open-triage", sha }),
    /architecture/,
  );
  assert.throws(
    () => validateImageIdentity({ ...identity("api"), tag: "ghcr.io/open-triage/open-triage-api:latest" }, { owner: "open-triage", sha }),
    /tag/,
  );
});

test("the deployment artifact contains the exact API and web tags and digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-images-"));
  await Promise.all(
    ["api", "web"].map((component) =>
      writeFile(join(directory, `${component}.json`), JSON.stringify(identity(component))),
    ),
  );
  const output = join(directory, "output", "demo-images.json");
  const manifest = await assembleImageManifest({
    inputDirectory: directory,
    outputPath: output,
    owner: "open-triage",
    sha,
  });

  assert.equal(manifest.sourceCommit, sha);
  assert.equal(manifest.images.api.tag, identity("api").tag);
  assert.equal(manifest.images.web.digest, digest);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), manifest);
});

test("the workflow promotes the validated web digest and separately publishes the API image", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const publishing = workflow.slice(workflow.indexOf("  publish-images:"));
  const webValidation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  api-runtime-image-validation:"),
  );
  const webPromotion = workflow.slice(
    workflow.indexOf("  promote-web-image:"),
    workflow.indexOf("  publish-image-manifest:"),
  );

  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(publishing, /^    needs: \[validation-gate, browser-e2e-validation\]$/m);
  assert.match(publishing, /needs\.browser-e2e-validation\.result == 'success'/);
  assert.match(publishing, /^      packages: write$/m);
  assert.match(publishing, /^          platforms: linux\/amd64$/m);
  assert.match(publishing, /^          push: true$/m);
  assert.match(
    publishing,
    /tags: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/open-triage-api:\$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/,
  );
  assert.doesNotMatch(publishing, /file: deploy\/docker\/web\.Dockerfile/);
  assert.match(publishing, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("jobs:")), /packages: write/);
  assert.match(webValidation, /docker build\n\s+--file deploy\/docker\/web\.Dockerfile/);
  assert.match(webValidation, /--platform linux\/amd64/);
  assert.match(webValidation, /docker push "\$WEB_CANDIDATE_IMAGE"/);
  assert.match(webValidation, /--output image-identities\/web\.json/);
  assert.match(webPromotion, /node scripts\/demo-image-identity\.mjs verify/);
  assert.match(webPromotion, /needs\.browser-e2e-validation\.result == 'success'/);
  assert.match(webPromotion, /^      - browser-e2e-validation$/m);
  assert.match(webPromotion, /docker buildx imagetools create/);
  assert.match(webPromotion, /test "\$promoted_digest" = "\$image_digest"/);
  assert.doesNotMatch(webPromotion, /docker build(?:\s|$)|docker\/build-push-action/);
  assert.match(
    publishing,
    /name: demo-deployment-images-\$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/,
  );
});

test("the web image includes the privacy policy consumed by its client build", async () => {
  const dockerfile = await readFile(webDockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /COPY packages\/database\/config\/identifying-elements\.json packages\/database\/config\/identifying-elements\.json/,
  );
});

test("validation rejects a fixture with a missing Docker-context dependency before the gate", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const validation = workflow.slice(
    workflow.indexOf("  web-deployment-validation:"),
    workflow.indexOf("  validation-gate:"),
  );

  assert.match(validation, /git archive HEAD \| tar -x --directory "\$fixture"/);
  assert.match(validation, /rm "\$fixture\/packages\/database\/config\/identifying-elements\.json"/);
  assert.match(validation, /if docker build[\s\S]*"\$fixture"; then/);
});
