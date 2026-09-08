import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DEMO_IMAGE_COMPONENTS,
  validateImageIdentity,
} from "./demo-image-identity.mjs";

export function deploymentValues(manifest, { owner, sha }) {
  if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== sha) {
    throw new Error(`Deployment manifest does not describe source commit ${sha}`);
  }

  const values = {};
  for (const component of DEMO_IMAGE_COMPONENTS) {
    const identity = validateImageIdentity(manifest.images?.[component], { owner, sha });
    const separator = identity.tag.lastIndexOf(":");
    values[`${component}-repository`] = identity.tag.slice(0, separator);
    values[`${component}-tag`] = identity.tag.slice(separator + 1);
  }
  return values;
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
  const args = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const values = deploymentValues(manifest, { owner: args.owner, sha: args.sha });
  await appendFile(
    args.output,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
