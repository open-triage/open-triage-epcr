import { pathToFileURL } from "node:url";
import pg from "pg";

export class UsageError extends Error {}

function positiveInteger(value, name, maximum) {
  if (!/^\d+$/.test(value ?? "")) throw new UsageError(`--${name} must be an integer from 1 to ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new UsageError(`--${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

export function parseArguments(arguments_) {
  const options = { batchSize: 100, maxBatches: 10 };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === "--batch-size") options.batchSize = positiveInteger(value, "batch-size", 1000);
    else if (name === "--max-batches") options.maxBatches = positiveInteger(value, "max-batches", 100);
    else throw new UsageError(`Unsupported argument: ${name ?? "(missing)"}`);
  }
  return options;
}

export async function expireBatch(client, batchSize) {
  await client.query("begin");
  try {
    await client.query("set local role open_triage_feedback_retention");
    const result = await client.query(
      "select * from feedback.expire_terminal_diagnostics($1::integer)", [batchSize]
    );
    await client.query("commit");
    return {
      deleted: Number(result.rows[0]?.deleted_count ?? 0),
      remainingEligible: Number(result.rows[0]?.remaining_eligible ?? 0)
    };
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  }
}

export async function run(arguments_, { Client = pg.Client, env = process.env, stdout = process.stdout } = {}) {
  const options = parseArguments(arguments_);
  const databaseUrl = env.FEEDBACK_RETENTION_DATABASE_URL;
  if (!databaseUrl) throw new UsageError("FEEDBACK_RETENTION_DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl, application_name: "open-triage-feedback-diagnostic-retention" });
  await client.connect();
  let deleted = 0;
  let batches = 0;
  let remainingEligible = 0;
  try {
    do {
      const batch = await expireBatch(client, options.batchSize);
      batches += 1;
      deleted += batch.deleted;
      remainingEligible = batch.remainingEligible;
      if (batch.deleted === 0) break;
    } while (remainingEligible > 0 && batches < options.maxBatches);
  } finally {
    await client.end();
  }
  const summary = { batches, deleted, remainingEligible, batchSize: options.batchSize, maxBatches: options.maxBatches };
  stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error instanceof UsageError ? `${error.message}\n` : "Feedback diagnostic retention failed\n");
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
