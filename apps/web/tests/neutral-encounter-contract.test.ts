import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { configuredQuickActions } from "../app/encounter-definition";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from "../app/local-persistence";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";

const appRoot = new URL("../app/", import.meta.url);
const componentRoot = new URL("../components/", import.meta.url);

function sourceFiles(root: URL): ReadonlyArray<string> {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));
}

test("the active standard encounter has one neutral identity and fixed composition", () => {
  assert.equal(standardEncounterDefinition.id, "standard-encounter-v1");
  assert.equal(STORAGE_KEY, "open-triage:standard-encounter-v1");
  assert.deepEqual(configuredQuickActions(standardEncounterDefinition).map(({ id }) => id), ["vitals", "medication", "procedure", "note"]);
  assert.ok(Object.values(standardEncounterDefinition.events).every((event) => event.quickAction.visible));
  assert.deepEqual(standardEncounterDefinition.composition.review.eventTypeOrder, ["vitals", "medication", "procedure", "note"]);
  assert.deepEqual(standardEncounterDefinition.composition.summary.eventTypeOrder, ["vitals", "medication", "procedure", "note"]);
  assert.doesNotMatch(JSON.stringify(standardEncounterDefinition), /adult[-_ ]chest|chest[- ]pain|cardiac form/i);
});

test("active source cannot introduce category-specific form identities or conditional behavior", () => {
  const violations: string[] = [];
  for (const file of [...sourceFiles(appRoot), ...sourceFiles(componentRoot)]) {
    const source = readFileSync(file, "utf8");
    const displayName = relative(new URL("../../", import.meta.url).pathname, file);
    const legacyMatches = source.match(/adult[-_ ]chest|adultChestPain|chest[- ]pain form/gi) ?? [];
    const isLegacyResetBoundary = file.endsWith("local-persistence.ts");
    if (legacyMatches.length !== (isLegacyResetBoundary ? LEGACY_STORAGE_KEYS.length : 0)) violations.push(`${displayName}: legacy category identity`);
    if (/complaintCategory|clinicalCategory|categoryRule|complaintRule|displayWhen|enabledWhen|visibleWhen|requiredWhen/i.test(source)) {
      violations.push(`${displayName}: category-conditional form behavior`);
    }
  }
  assert.deepEqual(violations, []);
});
