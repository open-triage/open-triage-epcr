import { pathToFileURL } from "node:url";
import pg from "pg";

const STATUSES = new Set(["new", "triaged", "planned", "in_progress", "resolved", "declined", "duplicate"]);
const TYPES = new Set(["bug", "feature"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent", "unassigned"]);
const REFERENCE_PATTERN = /^[A-Z2-7]{12}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_PAGE_SIZE = 100;

export class UsageError extends Error {}
export class NotFoundError extends Error {}

function option(arguments_, name) {
  const index = arguments_.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`--${name} requires a value`);
  return value;
}

function timestamp(value, name) {
  if (value === undefined) return undefined;
  if (!RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new UsageError(`--${name} must be an RFC 3339 timestamp with a timezone`);
  }
  return new Date(value).toISOString();
}

function onlyKnownOptions(arguments_, allowed) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (!token.startsWith("--") || !allowed.has(token.slice(2))) {
      throw new UsageError(`Unsupported argument: ${token}`);
    }
    index += 1;
  }
}

export function parseArguments(arguments_) {
  const [command, ...rest] = arguments_;
  if (command === "list") {
    onlyKnownOptions(rest, new Set([
      "limit", "cursor", "status", "type", "priority", "organization", "created-from", "created-before", "format"
    ]));
    const rawLimit = option(rest, "limit") ?? "25";
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_PAGE_SIZE) {
      throw new UsageError(`--limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
    const status = option(rest, "status");
    if (status && !STATUSES.has(status)) throw new UsageError("--status is not supported");
    const type = option(rest, "type");
    if (type && !TYPES.has(type)) throw new UsageError("--type is not supported");
    const priority = option(rest, "priority");
    if (priority && !PRIORITIES.has(priority)) throw new UsageError("--priority is not supported");
    const organization = option(rest, "organization");
    if (organization && !UUID_PATTERN.test(organization)) throw new UsageError("--organization must be a UUID");
    const format = option(rest, "format") ?? "json";
    if (format !== "json" && format !== "text") throw new UsageError("--format must be json or text");
    return {
      command, limit: Number(rawLimit), cursor: option(rest, "cursor"), status, type, priority, organization,
      createdFrom: timestamp(option(rest, "created-from"), "created-from"),
      createdBefore: timestamp(option(rest, "created-before"), "created-before"), format
    };
  }
  if (command === "show") {
    onlyKnownOptions(rest, new Set(["reference", "format"]));
    const reference = option(rest, "reference");
    if (!reference || !REFERENCE_PATTERN.test(reference)) {
      throw new UsageError("--reference must be a 12-character uppercase base32 feedback reference");
    }
    const format = option(rest, "format") ?? "json";
    if (format !== "json" && format !== "text") throw new UsageError("--format must be json or text");
    return { command, reference, format };
  }
  throw new UsageError("usage: feedback-review.mjs <list|show> [supported options]");
}

export function encodeCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, id: String(id) }), "utf8").toString("base64url");
}

export function decodeCursor(value) {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new UsageError("Invalid cursor");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (decoded?.v !== 1 || !RFC3339_PATTERN.test(decoded.createdAt)
      || Number.isNaN(Date.parse(decoded.createdAt)) || !/^[1-9]\d*$/.test(decoded.id)) {
      throw new Error("invalid");
    }
    return { createdAt: new Date(decoded.createdAt).toISOString(), id: decoded.id };
  } catch {
    throw new UsageError("Invalid cursor");
  }
}

export async function listFeedback(client, options) {
  const cursor = options.cursor ? decodeCursor(options.cursor) : {};
  const result = await client.query(`select * from feedback.review_queue(
    $1::integer, $2::text, $3::text, $4::text, $5::boolean, $6::uuid,
    $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::bigint)`, [
    options.limit + 1, options.status ?? null, options.type ?? null,
    options.priority === "unassigned" ? null : options.priority ?? null,
    options.priority === "unassigned", options.organization ?? null,
    options.createdFrom ?? null, options.createdBefore ?? null,
    cursor.createdAt ?? null, cursor.id ?? null
  ]);
  const hasMore = result.rows.length > options.limit;
  const pageRows = result.rows.slice(0, options.limit);
  const nextCursor = hasMore && pageRows.length
    ? encodeCursor(pageRows.at(-1).created_at.toISOString?.() ?? pageRows.at(-1).created_at, pageRows.at(-1).cursor_id)
    : null;
  const items = pageRows.map(({ cursor_id: _cursorId, ...row }) => row);
  return { items, nextCursor };
}

export async function showFeedback(client, options) {
  const result = await client.query("select * from feedback.review_detail($1::text)", [options.reference]);
  if (result.rowCount !== 1) throw new NotFoundError("Feedback submission not found");
  return result.rows[0];
}

function renderText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function run(arguments_, { Client = pg.Client, env = process.env, stdout = process.stdout } = {}) {
  const options = parseArguments(arguments_);
  const databaseUrl = env.FEEDBACK_REVIEW_DATABASE_URL;
  if (!databaseUrl) throw new UsageError("FEEDBACK_REVIEW_DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl, application_name: "open-triage-feedback-review" });
  await client.connect();
  try {
    await client.query("begin read only");
    await client.query("set local role open_triage_feedback_reviewer");
    const value = options.command === "list"
      ? await listFeedback(client, options)
      : await showFeedback(client, options);
    await client.query("commit");
    stdout.write(options.format === "text" ? renderText(value) : `${JSON.stringify(value)}\n`);
    return value;
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError || error instanceof NotFoundError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error instanceof NotFoundError ? 3 : 2;
    } else {
      process.stderr.write("Feedback review command failed\n");
      process.exitCode = 1;
    }
  }
}
