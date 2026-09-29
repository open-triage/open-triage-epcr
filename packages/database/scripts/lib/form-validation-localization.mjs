import { readFile } from "node:fs/promises";
import path from "node:path";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && !!value.trim();
const keysOnly = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const tokens = (value) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);
const identity = (name, message) => JSON.stringify([name, message]);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

/** Applies the language-level Swedish rule dictionary to every installed validation profile. */
export async function applyFormValidationLocalization(root, form, validation) {
  const seed = await json(path.join(root, "localization", "localization_sv.json"));
  if (seed.schemaVersion !== 1 || seed.language !== "sv" || !record(seed.validationRules))
    throw new Error(`Malformed Swedish localization definition for ${form.key}`);

  const bySource = new Map();
  const reviewPending = [];
  for (const [id, entry] of Object.entries(seed.validationRules)) {
    if (!record(entry) || !keysOnly(entry, ["sourceName", "sourceMessage", "name", "message", "reviewPending"]) ||
        !nonempty(entry.sourceName) || !nonempty(entry.sourceMessage) ||
        !nonempty(entry.name) || !nonempty(entry.message) ||
        (entry.reviewPending !== undefined && !nonempty(entry.reviewPending)))
      throw new Error(`Malformed Swedish validation text ${id}`);
    const key = identity(entry.sourceName, entry.sourceMessage);
    const previous = bySource.get(key);
    if (previous && (previous.name !== entry.name || previous.message !== entry.message))
      throw new Error(`Conflicting Swedish validation text ${id}`);
    bySource.set(key, entry);
    if (entry.reviewPending) reviewPending.push({ id, reason: entry.reviewPending });
  }
  for (const rule of validation.rules) {
    const entry = bySource.get(identity(rule.name, rule.message));
    if (!entry || tokens(entry.message).some((token) => rule.messageParameters?.[token] === undefined))
      throw new Error(`Stale Swedish validation text ${form.key}/${rule.id}`);
    rule.localization = { schemaVersion: 1, sv: { name: entry.name, message: entry.message,
      reviewedSource: { name: rule.name, message: rule.message } } };
  }
  return { rules: validation.rules.length, reviewPending };
}
