import { pathToFileURL } from "node:url";
import pg from "pg";

const STATUSES = new Set(["new", "triaged", "planned", "in_progress", "resolved", "declined", "duplicate"]);
const TYPES = new Set(["bug", "feature"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent", "unassigned"]);
const DECISION_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const REVIEWER_TYPES = new Set(["human", "ai-assisted"]);
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

function optionValues(arguments_, name) {
  const values = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== `--${name}`) continue;
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`--${name} requires a value`);
    values.push(value);
  }
  return values;
}

function timestamp(value, name) {
  if (value === undefined) return undefined;
  if (!RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new UsageError(`--${name} must be an RFC 3339 timestamp with a timezone`);
  }
  return new Date(value).toISOString();
}

function onlyKnownOptions(arguments_, allowed, flags = new Set()) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (!token.startsWith("--") || !allowed.has(token.slice(2))) {
      throw new UsageError(`Unsupported argument: ${token}`);
    }
    if (!flags.has(token.slice(2))) index += 1;
  }
}

function boundedText(value, name, maximum, required = false) {
  if (value === undefined && !required) return undefined;
  if (!value || value !== value.trim() || value.length > maximum) {
    throw new UsageError(`--${name} must be ${required ? "a non-empty" : "an optional"} trimmed value of at most ${maximum} characters`);
  }
  return value;
}

function decisionArguments(command, rest) {
  onlyKnownOptions(rest, new Set([
    "reference", "expected-version", "status", "priority", "summary", "note",
    "reviewer-type", "human-reviewer", "model", "review-run", "duplicate-of",
    "external-kind", "external-url", "format"
  ]));
  const reference = option(rest, "reference");
  if (!reference || !REFERENCE_PATTERN.test(reference)) {
    throw new UsageError("--reference must be a 12-character uppercase base32 feedback reference");
  }
  const status = option(rest, "status");
  if (!status || !STATUSES.has(status)) throw new UsageError("--status is required and must be supported");
  const priority = option(rest, "priority");
  if (!priority || !DECISION_PRIORITIES.has(priority)) {
    throw new UsageError("--priority is required and must be low, normal, high, or urgent");
  }
  const note = boundedText(option(rest, "note"), "note", 4000, true);
  const summary = boundedText(option(rest, "summary"), "summary", 1000);
  const reviewerType = option(rest, "reviewer-type") ?? "human";
  if (!REVIEWER_TYPES.has(reviewerType)) throw new UsageError("--reviewer-type must be human or ai-assisted");
  const model = boundedText(option(rest, "model"), "model", 200);
  const reviewRun = boundedText(option(rest, "review-run"), "review-run", 200);
  if (reviewerType === "ai-assisted" && (!model || !reviewRun)) {
    throw new UsageError("AI-assisted decisions require --model and --review-run");
  }
  if (reviewerType === "human" && (model || reviewRun)) {
    throw new UsageError("Human decisions cannot include --model or --review-run");
  }
  const format = option(rest, "format") ?? "json";
  if (format !== "json" && format !== "text") throw new UsageError("--format must be json or text");

  let expectedVersion;
  let humanReviewer;
  if (command !== "propose") {
    const rawVersion = option(rest, "expected-version");
    if (rawVersion === undefined || !/^\d+$/.test(rawVersion)) {
      throw new UsageError("--expected-version is required and must be a non-negative integer");
    }
    expectedVersion = Number(rawVersion);
    if (!Number.isSafeInteger(expectedVersion)) throw new UsageError("--expected-version is too large");
    humanReviewer = boundedText(option(rest, "human-reviewer"), "human-reviewer", 200, true);
  } else if (option(rest, "expected-version") !== undefined || option(rest, "human-reviewer") !== undefined) {
    throw new UsageError("Proposals do not accept approval or concurrency arguments");
  }
  const duplicateOf = option(rest, "duplicate-of");
  if (status === "duplicate") {
    if (!duplicateOf || !REFERENCE_PATTERN.test(duplicateOf) || duplicateOf === reference) {
      throw new UsageError("Duplicate decisions require --duplicate-of with another valid feedback reference");
    }
  } else if (duplicateOf !== undefined) {
    throw new UsageError("--duplicate-of is accepted only when --status duplicate");
  }
  const externalKind = option(rest, "external-kind");
  const externalUrl = option(rest, "external-url");
  if ((externalKind === undefined) !== (externalUrl === undefined)
      || (externalKind !== undefined && externalKind !== "issue" && externalKind !== "pull-request")) {
    throw new UsageError("External work requires --external-kind issue|pull-request and --external-url together");
  }
  if (externalUrl !== undefined) {
    let parsed;
    try { parsed = new URL(externalUrl); } catch { throw new UsageError("--external-url must be a valid HTTPS URL"); }
    if (externalUrl.length > 2000 || parsed.protocol !== "https:" || parsed.username || parsed.password
        || externalUrl !== externalUrl.trim()) throw new UsageError("--external-url must be a valid HTTPS URL");
  }
  return {
    command, reference, expectedVersion, status, priority, summary, note,
    reviewerType, humanReviewer, model, reviewRun, duplicateOf,
    externalKind: externalKind?.replace("-", "_"), externalUrl, format
  };
}

function bulkDecisionArguments(command, rest) {
  const flags = new Set(["confirm-bulk"]);
  onlyKnownOptions(rest, new Set([
    "item", "status", "priority", "summary", "note", "reviewer-type", "human-reviewer",
    "model", "review-run", "duplicate-of", "external-kind", "external-url", "format", "confirm-bulk"
  ]), flags);
  const itemValues = optionValues(rest, "item");
  if (itemValues.length < 1 || itemValues.length > 100) throw new UsageError("Bulk review requires 1 to 100 --item REFERENCE:VERSION values");
  const items = itemValues.map((value) => {
    const match = /^([A-Z2-7]{12}):(\d+)$/.exec(value);
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new UsageError("Each --item must be REFERENCE:VERSION");
    return { reference: match[1], expectedVersion: Number(match[2]) };
  });
  if (new Set(items.map(({ reference }) => reference)).size !== items.length) throw new UsageError("Bulk item references must be unique");
  const confirmed = rest.includes("--confirm-bulk");
  if (command === "bulk-apply" && !confirmed) throw new UsageError("bulk-apply requires --confirm-bulk");
  if (command === "bulk-dry-run" && confirmed) throw new UsageError("bulk-dry-run does not accept --confirm-bulk");

  const decisionRest = rest.filter((token, index) => {
    if (token === "--confirm-bulk") return false;
    if (token === "--item" || rest[index - 1] === "--item") return false;
    return true;
  });
  const first = items[0];
  const parsed = decisionArguments("dry-run", [
    "--reference", first.reference, "--expected-version", String(first.expectedVersion), ...decisionRest
  ]);
  if (parsed.duplicateOf && items.some(({ reference }) => reference === parsed.duplicateOf)) {
    throw new UsageError("Bulk duplicate decisions cannot include the canonical reference as an item");
  }
  return { ...parsed, command, items, confirmed };
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
  if (["propose", "dry-run", "apply"].includes(command)) return decisionArguments(command, rest);
  if (["bulk-dry-run", "bulk-apply"].includes(command)) return bulkDecisionArguments(command, rest);
  throw new UsageError("usage: feedback-review.mjs <list|show|propose|dry-run|apply|bulk-dry-run|bulk-apply> [supported options]");
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

function decisionOutput(options, expectedVersion) {
  return {
    referenceCode: options.reference,
    expectedVersion,
    status: options.status,
    priority: options.priority,
    approvedSummary: options.summary ?? null,
    reviewNote: options.note,
    reviewerType: options.reviewerType,
    humanReviewerId: options.humanReviewer ?? null,
    modelIdentifier: options.model ?? null,
    reviewRunId: options.reviewRun ?? null,
    duplicateOfReference: options.duplicateOf ?? null,
    externalWork: options.externalUrl ? { kind: options.externalKind, url: options.externalUrl } : null
  };
}

export async function proposeFeedback(client, options) {
  const detail = await showFeedback(client, options);
  return { proposal: decisionOutput(options, detail.submission.reviewVersion) };
}

export async function dryRunDecision(client, options) {
  const detail = await showFeedback(client, options);
  if (detail.submission.reviewVersion !== options.expectedVersion) {
    throw new StaleDecisionError("Review decision is stale; inspect the submission again");
  }
  return { dryRun: true, decision: decisionOutput(options, options.expectedVersion) };
}

export class StaleDecisionError extends Error {}

export async function recordDecision(client, options) {
  try {
    const result = await client.query(`select * from feedback.record_review_decision(
      $1::text, $2::bigint, $3::text, $4::text, $5::text, $6::text,
      $7::text, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text)`, [
      options.reference, options.expectedVersion, options.status, options.priority,
      options.summary ?? null, options.note, options.reviewerType.replace("-", "_"),
      options.humanReviewer, options.model ?? null, options.reviewRun ?? null,
      options.duplicateOf ?? null, options.externalKind ?? null, options.externalUrl ?? null
    ]);
    return { applied: true, decision: result.rows[0] };
  } catch (error) {
    if (error?.code === "PT001") throw new NotFoundError("Feedback submission not found");
    if (error?.code === "PT002") throw new StaleDecisionError("Review decision is stale; inspect the submission again");
    if (error?.code === "PT003") throw new ValidationError("Review decision failed supported validation");
    if (error?.code === "PT004") throw new CanonicalNotFoundError("Canonical feedback submission not found");
    throw error;
  }
}

export class ValidationError extends Error {}
export class CanonicalNotFoundError extends Error {}

function itemOptions(options, item) {
  return { ...options, reference: item.reference, expectedVersion: item.expectedVersion };
}

export async function dryRunBulk(client, options) {
  const results = [];
  for (const item of options.items) {
    try {
      const value = await dryRunDecision(client, itemOptions(options, item));
      results.push({ referenceCode: item.reference, ok: true, decision: value.decision });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof StaleDecisionError) {
        results.push({ referenceCode: item.reference, ok: false, error: error.message });
      } else throw error;
    }
  }
  return { dryRun: true, results };
}

export async function applyBulk(client, options) {
  const results = [];
  for (const [index, item] of options.items.entries()) {
    const savepoint = `feedback_bulk_${index}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      const value = await recordDecision(client, itemOptions(options, item));
      await client.query(`release savepoint ${savepoint}`);
      results.push({ referenceCode: item.reference, ok: true, decision: value.decision });
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
      if (error instanceof NotFoundError || error instanceof StaleDecisionError
          || error instanceof ValidationError || error instanceof CanonicalNotFoundError) {
        results.push({ referenceCode: item.reference, ok: false, error: error.message });
      } else throw error;
    }
  }
  return { applied: true, partialFailure: results.some(({ ok }) => !ok), results };
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
    await client.query(options.command === "apply" || options.command === "bulk-apply" ? "begin" : "begin read only");
    await client.query("set local role open_triage_feedback_reviewer");
    let value;
    if (options.command === "list") value = await listFeedback(client, options);
    if (options.command === "show") value = await showFeedback(client, options);
    if (options.command === "propose") value = await proposeFeedback(client, options);
    if (options.command === "dry-run") value = await dryRunDecision(client, options);
    if (options.command === "apply") value = await recordDecision(client, options);
    if (options.command === "bulk-dry-run") value = await dryRunBulk(client, options);
    if (options.command === "bulk-apply") value = await applyBulk(client, options);
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
    if (error instanceof UsageError || error instanceof NotFoundError || error instanceof StaleDecisionError
        || error instanceof ValidationError || error instanceof CanonicalNotFoundError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error instanceof NotFoundError ? 3 : error instanceof StaleDecisionError ? 4 : 2;
    } else {
      process.stderr.write("Feedback review command failed\n");
      process.exitCode = 1;
    }
  }
}
