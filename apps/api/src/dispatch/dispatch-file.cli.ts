import type { DispatchIngestionResult } from "./dispatch-ingestion.js";

type CliOptions = { file: string; organizationId: string; sourceId: string };
type CliDependencies = {
  readBytes(path: string): Promise<Uint8Array>;
  ingest(options: CliOptions, bytes: Uint8Array): Promise<DispatchIngestionResult>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArguments(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !["--file", "--organization-id", "--source-id"].includes(flag) || !value) {
      throw new TypeError("Usage: dispatch-ingest --file <json> --organization-id <uuid> --source-id <id>");
    }
    if (values.has(flag)) throw new TypeError(`Duplicate argument ${flag}`);
    values.set(flag, value);
  }
  const file = values.get("--file");
  const organizationId = values.get("--organization-id");
  const sourceId = values.get("--source-id");
  if (!file || !organizationId || !sourceId || !uuid.test(organizationId) ||
      sourceId.trim().length === 0 || sourceId.trim().length > 200) {
    throw new TypeError("--file, UUID --organization-id, and non-empty --source-id (max 200 characters) are required");
  }
  return { file, organizationId, sourceId };
}

export function dispatchCliExitCode(status: DispatchIngestionResult["status"]): number {
  switch (status) {
    case "applied": case "replayed": case "applied_with_findings": case "quarantined": return 0;
    case "rejected": return 2;
    case "stale": return 3;
    case "conflicting": return 4;
    case "post_signature": return 5;
  }
}

export async function runDispatchFileCli(argv: string[], dependencies: CliDependencies): Promise<{
  exitCode: number;
  result: DispatchIngestionResult;
}> {
  const options = parseArguments(argv);
  const sourceBytes = await dependencies.readBytes(options.file);
  const result = await dependencies.ingest(options, sourceBytes);
  return { exitCode: dispatchCliExitCode(result.status), result };
}
