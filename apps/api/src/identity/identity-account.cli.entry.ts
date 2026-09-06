import "dotenv/config";
import { DataSource } from "typeorm";
import { runIdentityAccountCli } from "./identity-account.cli.js";

async function main(): Promise<void> {
  let database: DataSource | undefined;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    database = await new DataSource({ type: "postgres", url: databaseUrl }).initialize();
    const result = await runIdentityAccountCli(database, process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Identity account operation failed"}\n`);
    process.exitCode = 64;
  } finally {
    if (database?.isInitialized) await database.destroy();
  }
}

void main();
