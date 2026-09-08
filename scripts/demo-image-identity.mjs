import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO_IMAGE_COMPONENTS = ["api", "web"];
export const DEMO_IMAGE_ARCHITECTURE = "linux/amd64";

function requireMatch(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function validateImageIdentity(identity, { owner, sha } = {}) {
  if (!DEMO_IMAGE_COMPONENTS.includes(identity.component)) {
    throw new Error(`Unexpected image component: ${identity.component}`);
  }

  requireMatch(identity.sourceCommit, /^[0-9a-f]{40}$/i, "source commit");
  requireMatch(identity.digest, /^sha256:[0-9a-f]{64}$/i, "image digest");

  if (identity.architecture !== DEMO_IMAGE_ARCHITECTURE) {
    throw new Error(`Unexpected image architecture: ${identity.architecture}`);
  }

  if (sha && identity.sourceCommit !== sha) {
    throw new Error(`Image source commit ${identity.sourceCommit} does not match ${sha}`);
  }

  if (owner) {
    const expectedTag = `ghcr.io/${owner}/open-triage-${identity.component}:${identity.sourceCommit}`;
    if (identity.tag !== expectedTag) {
      throw new Error(`Image tag ${identity.tag} does not match ${expectedTag}`);
    }
  }

  return identity;
}

export async function recordImageIdentity(identity, outputPath) {
  validateImageIdentity(identity, {
    owner: identity.repositoryOwner,
    sha: identity.sourceCommit,
  });
  const record = {
    component: identity.component,
    tag: identity.tag,
    digest: identity.digest,
    architecture: identity.architecture,
    sourceCommit: identity.sourceCommit,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function assembleImageManifest({ inputDirectory, outputPath, owner, sha }) {
  const filenames = (await readdir(inputDirectory)).filter((name) => name.endsWith(".json"));
  const identities = await Promise.all(
    filenames.map(async (filename) =>
      validateImageIdentity(JSON.parse(await readFile(join(inputDirectory, filename), "utf8")), {
        owner,
        sha,
      }),
    ),
  );
  const images = Object.fromEntries(identities.map((identity) => [identity.component, identity]));

  if (identities.length !== DEMO_IMAGE_COMPONENTS.length) {
    throw new Error(`Expected ${DEMO_IMAGE_COMPONENTS.length} image identities, received ${identities.length}`);
  }
  for (const component of DEMO_IMAGE_COMPONENTS) {
    if (!images[component]) throw new Error(`Missing ${component} image identity`);
  }

  const manifest = { schemaVersion: 1, sourceCommit: sha, images };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArguments(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (!key || value === undefined) throw new Error(`Invalid arguments: ${values.join(" ")}`);
    args[key] = value;
  }
  return args;
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArguments(values);
  if (command === "record") {
    await recordImageIdentity(
      {
        component: args.component,
        tag: args.tag,
        digest: args.digest,
        architecture: args.architecture,
        sourceCommit: args.sha,
        repositoryOwner: args.owner,
      },
      args.output,
    );
    return;
  }
  if (command === "assemble") {
    await assembleImageManifest({
      inputDirectory: args.input,
      outputPath: args.output,
      owner: args.owner,
      sha: args.sha,
    });
    return;
  }
  throw new Error(`Unknown command: ${command ?? "(missing)"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
