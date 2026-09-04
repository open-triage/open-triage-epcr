import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import type { DispatchValidationCatalog } from "./dispatch-assignment.validation.js";
import { runDispatchFileCli } from "./dispatch-file.cli.js";
import { ingestDispatchDelivery } from "./dispatch-ingestion.js";

async function main(): Promise<void> {
  let database: DataSource | undefined;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required to ingest a dispatch file");
    const root = resolve(__dirname, "../../../..");
    const catalog = JSON.parse(await readFile(
      resolve(root, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8"
    )) as DispatchValidationCatalog;
    database = await new DataSource({ type: "postgres", url: databaseUrl }).initialize();
    const outcome = await runDispatchFileCli(process.argv.slice(2), {
      readBytes: (path) => readFile(resolve(path)),
      ingest: (options, sourceBytes) => database!.transaction("SERIALIZABLE", (manager) =>
        ingestDispatchDelivery(manager, {
          organizationId: options.organizationId,
          sourceId: options.sourceId,
          sourceBytes
        }, catalog))
    });
    process.stdout.write(`${JSON.stringify(outcome.result)}\n`);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: "rejected",
      error: error instanceof Error ? error.message : "Dispatch ingestion failed"
    })}\n`);
    process.exitCode = 64;
  } finally {
    if (database?.isInitialized) await database.destroy();
  }
}

void main();
