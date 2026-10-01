import { createHash } from "node:crypto";

const currentSchemaReference = '"$schema": "../../packages/contracts/catalog.schema-1.0.0.json"';
const originalSchemaReference = '"$schema": "./nemsis-data-model.schema-1.0.0.json"';

/** A schema-file rename must not create a different clinical catalog release. */
export function catalogArtifactSha256(catalogText) {
  const schemaReference = [currentSchemaReference, '"$schema": "./schema_nemsis-3.5.1.json"', originalSchemaReference]
    .find((reference) => catalogText.includes(reference));
  if (!schemaReference) {
    throw new Error("The NEMSIS catalog has an unexpected schema reference");
  }
  return createHash("sha256")
    .update(catalogText.replace(schemaReference, originalSchemaReference))
    .digest("hex");
}
