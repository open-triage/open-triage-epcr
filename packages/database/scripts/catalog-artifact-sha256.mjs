import { createHash } from "node:crypto";

const currentSchemaReference = '"$schema": "./schema_nemsis-3.5.1.json"';
const originalSchemaReference = '"$schema": "./nemsis-data-model.schema-1.0.0.json"';

/** A schema-file rename must not create a different clinical catalog release. */
export function catalogArtifactSha256(catalogText) {
  if (!catalogText.includes(currentSchemaReference)) {
    throw new Error("The NEMSIS catalog has an unexpected schema reference");
  }
  return createHash("sha256")
    .update(catalogText.replace(currentSchemaReference, originalSchemaReference))
    .digest("hex");
}
