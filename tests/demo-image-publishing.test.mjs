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

test("the workflow publishes tested AMD64 images with narrowly scoped registry permission", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const publishing = workflow.slice(workflow.indexOf("  publish-images:"));

  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(publishing, /^    needs: validation-gate$/m);
  assert.match(publishing, /^      packages: write$/m);
  assert.match(publishing, /^          platforms: linux\/amd64$/m);
  assert.match(publishing, /^          push: true$/m);
  assert.match(
    publishing,
    /tags: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/open-triage-\$\{\{ matrix\.component \}\}:\$\{\{ github\.sha \}\}/,
  );
  assert.match(publishing, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("jobs:")), /packages: write/);
  assert.match(publishing, /name: demo-deployment-images-\$\{\{ github\.sha \}\}/);
});
